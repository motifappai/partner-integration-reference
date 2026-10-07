import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { connect } from 'amqplib'
import pino from 'pino'
import { provisionBroker } from '../connector/ops/provision.ts'
import { connectorConfigSchema } from '../connector/src/config.ts'
import { type ConnectionHealth, runConnection } from '../connector/src/runner.ts'
import { publisher } from '../connector/src/transport.ts'
import { record } from '../shared/values.ts'

const implementations = [
  'rest',
  'sdk',
  ...(process.env.MOTIF_TEST_JAVA ? ['java'] : []),
]
for (const implementation of implementations)
  test(`${implementation} follows the connector blueprint over two real brokers and the HTTP contract fixture`, {
    timeout: 60_000,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'motif-blueprint-'))
    const virtualHost = `blueprint-${implementation}-${Date.now()}`
    const shutdown = new AbortController()
    const calls: { method: string; path: string; body: Record<string, unknown> }[] = []
    const events: Record<string, unknown>[] = []
    const receipts = new Map<string, Record<string, unknown>>()
    let subscription: Record<string, unknown> = {
      enabled: false,
      surfaces: ['MARKET', 'ASSET', 'PORTFOLIO'],
      language: 'en',
    }
    let revision = 0
    let failure: unknown
    const api = createServer(async (request, response) => {
      try {
        assert.equal(request.headers['x-api-key'], 'sandbox-key')
        const url = new URL(request.url || '/', 'http://localhost')
        const chunks: Buffer[] = []
        for await (const chunk of request)
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        const body = chunks.length
          ? record(JSON.parse(Buffer.concat(chunks).toString()))
          : {}
        calls.push({ method: request.method || '', path: url.pathname, body })
        let payload: unknown
        const path = url.pathname.replace('/api', '')
        if (path === '/v1/sdk/feeds/subscription') {
          if (request.method === 'PUT') subscription = body
          payload = subscription
        } else if (path === '/v1/sdk/assets')
          payload = {
            assets: [
              {
                id: 'apple-id',
                category: 'EQUITY',
                name: 'Apple Inc.',
                symbol: 'AAPL',
                exchange: 'NASDAQ',
                currency: 'USD',
                priceProvider: 'MARKET',
                description: null,
                externalId: url.searchParams.get('externalId'),
              },
            ],
            nextCursor: null,
          }
        else if (path === '/v1/sdk/feeds/fx')
          payload = {
            baseCurrency: 'EUR',
            quoteCurrency: 'USD',
            asOf: url.searchParams.get('asOf'),
            rate: '1.1',
            rateType: 'MID',
            revision: 1,
            source: 'urn:test',
          }
        else if (path.startsWith('/v1/sdk/feeds/receipts/'))
          payload = receipts.get(decodeURIComponent(path.split('/').at(-1) || ''))
        else if (path.startsWith('/v1/sdk/portfolios/')) {
          if (request.method === 'PUT') revision = Number(body.revision)
          payload = {
            portfolioId: 'portfolio-id',
            externalId: path.split('/').at(-1),
            revision,
            asOf: new Date().toISOString(),
            calculation: 'CURRENT',
            calculatedRevision: revision,
            calculatedAt: new Date().toISOString(),
            status: 'ACTIVE',
            currency: 'USD',
            totalValue: '2000',
            isComplete: true,
            holdings: [],
          }
        } else if (path.startsWith('/v1/sdk/clarity/')) payload = null
        else throw new Error(`Unexpected API path ${path}`)
        assert.notEqual(payload, undefined)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(payload))
      } catch (error) {
        failure = error
        response.writeHead(500)
        response.end('{}')
      }
    })
    await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve))
    const address = api.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    let runner: Promise<void> | undefined
    let destination: Awaited<ReturnType<typeof connect>> | undefined
    try {
      for (const [role, port, managementPort] of [
        ['partner', 5673, 15673],
        ['motif', 5674, 15674],
      ] as const) {
        const managementUrlFile = join(directory, `${role}.url`)
        await writeFile(
          managementUrlFile,
          `http://integration:local-test-only@127.0.0.1:${managementPort}`
        )
        await provisionBroker({
          managementUrlFile,
          brokerHost: '127.0.0.1',
          brokerPort: port,
          virtualHost,
          role,
          secretDirectory: join(directory, role),
          insecureLocal: true,
        })
      }
      destination = await connect(
        `amqp://integration:local-test-only@127.0.0.1:5674/${virtualHost}`
      )
      const transport = await publisher(destination, 10_000, () => undefined)
      await transport.channel.prefetch(1)
      await transport.channel.consume('motif.ingress', message => {
        if (!message) return
        void (async () => {
          const event = record(JSON.parse(message.content.toString()))
          const data = record(event.data)
          events.push(event)
          const id = String(event.id)
          let receipt = receipts.get(id)
          if (!receipt) {
            receipt = {
              eventId: id,
              source: event.source,
              status: 'APPLIED',
              code: null,
              resourceId:
                event.type === 'ai.motif.asset.master.v1'
                  ? data.action === 'MAP_EXISTING'
                    ? 'apple-id'
                    : 'fund-id'
                  : 'observation-id',
              processedAt: new Date().toISOString(),
            }
            receipts.set(id, receipt)
          }
          await transport.send(
            'motif.output',
            'events',
            Buffer.from(
              JSON.stringify({
                specversion: '1.0',
                id: `receipt-${id}`,
                source: 'urn:motif:feeds',
                type: 'ai.motif.feed.receipt.v1',
                subject: event.subject,
                time: receipt.processedAt,
                datacontenttype: 'application/json',
                data: receipt,
              })
            ),
            `receipt-${id}`
          )
          transport.channel.ack(message)
        })().catch(error => {
          failure = error
        })
      })
      const config = connectorConfigSchema.parse({
        version: 1,
        allowInsecureSandbox: true,
        connections: [
          {
            id: 'reference',
            organizationId: 'sandbox-org',
            environment: 'sandbox',
            source: {
              urlFile: join(directory, 'partner/connector.url'),
              queue: 'partner.ingress',
              quarantineQueue: 'partner.quarantine',
              outputExchange: 'partner.output',
              outputRoutingKey: 'events',
            },
            destination: {
              urlFile: join(directory, 'motif/connector.url'),
              inputExchange: 'motif.input',
              inputRoutingKey: 'events',
              outputQueue: 'motif.output',
              quarantineQueue: 'motif.connector-quarantine',
            },
          },
        ],
      })
      const connection = config.connections[0]
      assert.ok(connection)
      const health: ConnectionHealth = {
        state: 'connecting',
        forwarded: 0,
        returned: 0,
        quarantined: 0,
        reconnects: 0,
        lastConfirmedAt: null,
      }
      runner = runConnection(
        connection,
        config,
        health,
        pino({ level: 'silent' }),
        shutdown.signal
      )
      const entry =
        implementation === 'rest' ? 'event-feeds/rest.ts' : 'sdk/connector.ts'
      const child = spawn(
        implementation === 'java'
          ? `${process.env.JAVA_HOME}/bin/java`
          : process.execPath,
        implementation === 'java'
          ? [
              '-jar',
              'java/reference/target/quarkus-app/quarkus-run.jar',
              '--apply',
              '--listen-seconds=0',
            ]
          : [entry, '--apply', '--listen-seconds=0'],
        {
          env: {
            ...process.env,
            MOTIF_API_BASE_URL: `http://127.0.0.1:${address.port}/api`,
            MOTIF_API_KEY: 'sandbox-key',
            MOTIF_ORG_ID: 'sandbox-org',
            PARTNER_BROKER_URL_FILE: join(directory, 'partner/application.url'),
            MOTIF_LOCAL_BROKER: 'true',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      )
      let output = ''
      child.stdout.on('data', chunk => {
        output += chunk.toString()
      })
      child.stderr.on('data', chunk => {
        output += chunk.toString()
      })
      const timeout = setTimeout(() => child.kill('SIGKILL'), 40_000)
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on('exit', resolve)
        child.on('error', reject)
      })
      clearTimeout(timeout)
      if (failure) throw failure
      assert.equal(code, 0, output)
      assert.match(output, /NOT OBSERVED/)
      const snapshots = calls.filter(
        call => call.method === 'PUT' && call.path.includes('/portfolios/')
      )
      assert.equal(snapshots.length, 3)
      assert.deepEqual(snapshots[1]?.body, snapshots[2]?.body)
      assert.equal(snapshots[0]?.body.cash, '1000')
      assert.equal(snapshots[1]?.body.cash, '600')
      assert.equal(events.length, 6)
      assert.deepEqual(events[2], events[3])
      assert.equal(record(events[4]?.data).revision, 2)
      assert.equal(record(events[4]?.data).unitPrice, '13.00')
      assert.equal(events[5]?.type, 'ai.motif.fx.rate.v1')
      assert.equal(subscription.enabled, false)
    } finally {
      shutdown.abort()
      await runner
      await destination?.close()
      await new Promise<void>(resolve => api.close(() => resolve()))
      for (const port of [15673, 15674])
        await fetch(`http://127.0.0.1:${port}/api/vhosts/${virtualHost}`, {
          method: 'DELETE',
          headers: {
            authorization: `Basic ${Buffer.from('integration:local-test-only').toString('base64')}`,
          },
        })
      await rm(directory, { recursive: true, force: true })
    }
  })
