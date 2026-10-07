import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { record } from '../shared/values.ts'

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP port')
  return address.port
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  )
}

async function exercise(
  implementation: 'sdk' | 'rest',
  mapping: 'local' | 'motif',
  ignoreExternalId = false
) {
  const allocation = createServer()
  const receiverPort = await listen(allocation)
  await close(allocation)
  const directory = await mkdtemp(join(tmpdir(), 'motif-reference-test-'))
  const documentPath = join(directory, 'factsheet.pdf')
  await writeFile(documentPath, '%PDF-1.7\nContract-test upload bytes\n%%EOF')
  let secret = 'whsec_contract_fixture'
  let storedReference: unknown
  let revision = 0
  let snapshotBody: unknown
  let publicationsSent = false
  const operations: string[] = []
  const snapshots: unknown[] = []
  const prices: unknown[] = []
  const notificationsRead: string[] = []
  const failures: string[] = []
  const apiKey = 'contract-fixture-key'

  async function send(surface?: string) {
    const event = surface
      ? {
          id: `event-${surface}`,
          event: 'assessment.published',
          version: 1,
          timestamp: new Date().toISOString(),
          organizationId: 'org-fixture',
          data: {
            surface,
            subjectId:
              surface === 'MARKET'
                ? 'GLOBAL'
                : surface === 'ASSET'
                  ? 'apple-id'
                  : 'portfolio-id',
            portfolioId: surface === 'PORTFOLIO' ? 'portfolio-id' : null,
            revision: 1,
            language: 'de',
          },
        }
      : {
          event: 'webhook.test',
          timestamp: new Date().toISOString(),
          data: { webhookId: 'subscription-id' },
        }
    const body = JSON.stringify(event)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signingKey = createHmac('sha256', 'webhook-secret-salt')
      .update(secret)
      .digest('hex')
    const signature = createHmac('sha256', signingKey)
      .update(`${timestamp}.${body}`)
      .digest('hex')
    const response = await fetch(`http://127.0.0.1:${receiverPort}/webhooks/motif`, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Id': 'subscription-id',
        'X-Webhook-Event': event.event,
        'X-Webhook-Timestamp': timestamp,
        'X-Webhook-Signature': `v1=${signature}`,
        ...(surface ? { 'X-Webhook-Event-Id': `event-${surface}` } : {}),
      },
    })
    assert.equal(response.status, 204)
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost')
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        assert.ok(Buffer.isBuffer(chunk))
        chunks.push(chunk)
      }
      const bytes = Buffer.concat(chunks)
      if (url.pathname === '/storage/document') {
        assert.equal(request.headers['x-api-key'], undefined)
        assert.equal(request.headers['x-upload-token'], 'upload-fixture')
        assert.match(bytes.toString(), /^%PDF/)
        operations.push('PUT storage')
        response.writeHead(200).end()
        return
      }
      assert.equal(request.headers['x-api-key'], apiKey)
      const payload: unknown = bytes.length ? JSON.parse(bytes.toString()) : undefined
      const path = url.pathname.replace('/api', '')
      const operation = `${request.method} ${path.replace(/reference-[^/]+-account-42-a/, 'account')}`
      if (
        url.searchParams.get('language') === 'de' ||
        (payload && record(payload).language === 'de')
      )
        notificationsRead.push(operation)
      else operations.push(operation)
      let content: unknown
      if (request.method === 'POST' && path === '/v1/sdk/webhooks') {
        assert.deepEqual(record(payload).events, ['assessment.published'])
        content = { id: 'subscription-id', secret }
      } else if (path.endsWith('/test')) {
        await send()
        content = { success: true, statusCode: 204, duration: 1, error: null }
      } else if (path === '/v1/sdk/clarity/market-update') content = null
      else if (path === '/v1/sdk/assets' && request.method === 'GET') {
        assert.equal(
          url.searchParams.has('query'),
          false,
          'Browse the full catalog, not a hardcoded ticker search'
        )
        if (url.searchParams.has('externalId'))
          content = {
            assets:
              ignoreExternalId || url.searchParams.get('externalId') === storedReference
                ? [{ id: 'apple-id', externalId: storedReference }]
                : [],
            nextCursor: null,
          }
        else if (url.searchParams.has('cursor'))
          content = {
            assets: [
              {
                id: 'apple-id',
                symbol: 'AAPL',
                category: 'EQUITY',
                exchange: 'NASDAQ',
                name: 'Apple Inc.',
              },
            ],
            nextCursor: null,
          }
        else
          content = {
            assets: [
              {
                id: 'wrong-listing',
                symbol: 'AAPL',
                category: 'EQUITY',
                exchange: 'OTHER',
                name: 'Other listing',
              },
            ],
            nextCursor: 'page-2',
          }
      } else if (path === '/v1/sdk/assets/apple-id' && request.method === 'PATCH') {
        assert.equal(mapping, 'motif')
        assert.equal(record(payload).currency, 'USD')
        assert.equal(record(payload).priceProvider, undefined)
        storedReference = record(payload).externalId
        content = { id: 'apple-id', externalId: storedReference }
      } else if (path === '/v1/sdk/clarity/assets/apple-id') content = null
      else if (path.startsWith('/v1/sdk/portfolios/reference-')) {
        if (request.method === 'PUT') {
          snapshotBody = payload
          snapshots.push(payload)
          const submittedRevision = record(payload).revision
          assert.ok(typeof submittedRevision === 'number')
          revision = submittedRevision
          content = { portfolioId: 'portfolio-id', revision }
        } else
          content = {
            ...record(snapshotBody),
            calculatedRevision: revision,
            calculation: 'CURRENT',
            isComplete: true,
            totalValue: '3000',
          }
      } else if (path === '/v1/sdk/clarity/portfolios/portfolio-id') {
        content = { card: null, read: null }
        if (!publicationsSent && url.searchParams.get('language') === 'en') {
          publicationsSent = true
          for (const surface of ['MARKET', 'ASSET', 'PORTFOLIO']) await send(surface)
        }
      } else if (path === '/v1/sdk/assets' && request.method === 'POST')
        content = { id: 'custom-id' }
      else if (path === '/v1/sdk/assets/custom-id')
        content = { id: 'custom-id', currency: 'USD', priceProvider: 'CUSTOM' }
      else if (path === '/v1/sdk/assets/custom-id/prices') {
        if (request.method === 'PUT') prices.push(payload)
        content = { prices, nextBefore: null }
      } else if (path === '/v1/sdk/assets/custom-id/documents') {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Missing port')
        content = {
          documentId: 'document-id',
          uploadUrl: `http://127.0.0.1:${address.port}/storage/document`,
          headers: { 'x-upload-token': 'upload-fixture' },
        }
      } else if (path === '/v1/sdk/assets/custom-id/documents/document-id/finalize')
        content = { status: 'QUEUED' }
      else if (path === '/v1/sdk/assets/custom-id/documents/document-id')
        content = { status: 'COMPLETED' }
      else if (path.endsWith('/deliveries'))
        content = {
          deliveries: [{ id: 'delivery-id', event: 'assessment.published' }],
          nextCursor: null,
        }
      else if (path.endsWith('/deliveries/delivery-id/replay')) {
        await send('PORTFOLIO')
        content = { eventId: 'event-PORTFOLIO' }
      } else if (path.endsWith('/rotate-secret')) {
        secret = 'whsec_rotated_fixture'
        content = { secret }
      } else if (path === '/v1/sdk/webhooks/subscription-id')
        content = { success: true }
      else if (path === '/v1/sdk/portfolios/by-id/portfolio-id/archive')
        content = { success: true }
      else throw new Error(`Unexpected request: ${operation}`)
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(content))
    } catch (error) {
      failures.push(String(error))
      response.writeHead(500).end(String(error))
    }
  })
  const port = await listen(server)
  try {
    const child = spawn(
      process.execPath,
      [
        `${implementation}/main.ts`,
        '--apply',
        `--mapping=${mapping}`,
        '--assets',
        `--document=${documentPath}`,
        '--archive',
        '--listen-seconds=0',
      ],
      {
        cwd: new URL('..', import.meta.url),
        env: {
          ...process.env,
          MOTIF_API_BASE_URL: `http://127.0.0.1:${port}/api`,
          MOTIF_API_KEY: apiKey,
          MOTIF_ORG_ID: 'org-fixture',
          MOTIF_WEBHOOK_URL: 'https://fixture.example/webhooks/motif',
          MOTIF_WEBHOOK_PORT: String(receiverPort),
        },
      }
    )
    let output = ''
    child.stdout.on('data', chunk => {
      output += String(chunk)
    })
    child.stderr.on('data', chunk => {
      output += String(chunk)
    })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 25_000)
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    clearTimeout(timeout)
    assert.deepEqual(failures, [], output)
    if (ignoreExternalId) {
      assert.notEqual(exitCode, 0, output)
      assert.match(output, /Exact custom reference lookup failed/)
      assert.ok(!operations.includes('POST /v1/sdk/assets'))
      assert.ok(!operations.includes('PATCH /v1/sdk/assets/custom-id'))
      assert.equal(snapshots.length, 0)
      return operations
    }
    assert.equal(exitCode, 0, output)
    assert.equal(snapshots.length, 3)
    assert.deepEqual(record(snapshots[0]).holdings, [
      {
        instrument: { type: 'ASSET', assetId: 'apple-id' },
        quantity: '10',
        currency: 'USD',
      },
      {
        instrument: { type: 'ASSET', assetId: 'custom-id' },
        quantity: '5',
        currency: 'USD',
      },
    ])
    assert.equal(storedReference !== undefined, mapping === 'motif')
    assert.deepEqual(snapshots[1], snapshots[2])
    assert.equal(record(snapshots[0]).cash, '1000')
    assert.equal(record(snapshots[1]).cash, '600')
    assert.deepEqual(prices[0], prices[1])
    assert.equal(record(prices[2]).revision, 2)
    assert.equal(record(prices[2]).asOf, record(prices[0]).asOf)
    assert.equal(
      notificationsRead.length,
      3,
      'replay must not process the duplicate a second time'
    )
    assert.match(output, /Replay received/)
    assert.doesNotMatch(output, /NOT OBSERVED:|NOT EXERCISED:/)
    assert.ok(!output.includes(apiKey) && !output.includes(secret))
    assert.equal(
      operations.at(-1),
      'POST /v1/sdk/portfolios/by-id/portfolio-id/archive'
    )
    return operations
  } finally {
    await close(server)
    await rm(directory, { recursive: true, force: true })
  }
}

for (const mapping of ['local', 'motif'] as const) {
  test(`SDK and REST execute the documented lifecycle with ${mapping} mappings`, {
    timeout: 60_000,
  }, async () => {
    const sdkOperations = await exercise('sdk', mapping)
    const restOperations = await exercise('rest', mapping)
    assert.deepEqual(restOperations, sdkOperations)
    assert.deepEqual(restOperations.slice(0, 4), [
      'POST /v1/sdk/webhooks',
      'POST /v1/sdk/webhooks/subscription-id/test',
      'GET /v1/sdk/assets',
      'GET /v1/sdk/assets',
    ])
    assert.ok(
      restOperations.indexOf('POST /v1/sdk/assets') <
        restOperations.indexOf('PUT /v1/sdk/portfolios/account')
    )
  })
}

for (const implementation of ['sdk', 'rest'] as const) {
  test(`${implementation} refuses an API that ignores exact reference lookup`, async () => {
    await exercise(implementation, 'local', true)
  })
}
