import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { connect, type Channel, type GetMessage } from 'amqplib'
import pino from 'pino'
import { provisionBroker } from '../ops/provision.ts'
import { connectorConfigSchema } from '../src/config.ts'
import { runConnection, type ConnectionHealth } from '../src/runner.ts'

async function until<T>(
  operation: () => Promise<T | false>,
  timeout = 20_000
): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await operation()
    if (value !== false) return value
    await delay(50)
  }
  throw new Error('Condition timed out')
}
const get = (channel: Channel, queue: string) =>
  until<GetMessage>(() => channel.get(queue, { noAck: true }))
test('real brokers: least privilege, forwarding, receipts, quarantine, unroutable recovery and tenant isolation', {
  timeout: 90_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motif-connector-'))
  const virtualHost = `test-${Date.now()}`
  const shutdown = new AbortController()
  const brokers = []
  const runners: Promise<void>[] = []
  try {
    for (const [role, port, managementPort] of [
      ['partner', 5673, 15673],
      ['motif', 5674, 15674],
    ] as const) {
      const managementUrlFile = join(directory, `${role}-management.url`)
      await writeFile(
        managementUrlFile,
        `http://integration:local-test-only@127.0.0.1:${managementPort}`,
        { mode: 0o600 }
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
    const source = await connect(
      `amqp://integration:local-test-only@127.0.0.1:5673/${virtualHost}`
    )
    const destination = await connect(
      `amqp://integration:local-test-only@127.0.0.1:5674/${virtualHost}`
    )
    brokers.push(source, destination)
    const sourceChannel = await source.createChannel()
    const destinationChannel = await destination.createChannel()
    const config = connectorConfigSchema.parse({
      version: 1,
      allowInsecureSandbox: true,
      connections: [
        {
          id: 'healthy',
          organizationId: 'sandbox-test',
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
    runners.push(
      runConnection(
        connection,
        config,
        health,
        pino({ level: 'silent' }),
        shutdown.signal
      )
    )
    await until(async () => (health.state === 'ready' ? true : false))
    const event = {
      specversion: '1.0',
      id: 'stable-price-1',
      source: 'urn:partner:test',
      type: 'ai.motif.asset.price.v1',
      subject: 'intel',
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: { externalId: 'intel', unitPrice: '24.12345678', revision: 1 },
    }
    sourceChannel.publish(
      'partner.input',
      'events',
      Buffer.from(JSON.stringify(event)),
      { persistent: true }
    )
    const forwarded = await get(destinationChannel, 'motif.ingress')
    assert.deepEqual(JSON.parse(forwarded.content.toString()), event)
    assert.equal(forwarded.properties.messageId, event.id)
    const receipt = {
      ...event,
      id: 'receipt-1',
      source: 'urn:motif:feeds',
      type: 'ai.motif.feed.receipt.v1',
      data: { eventId: event.id, status: 'APPLIED' },
    }
    destinationChannel.publish(
      'motif.output',
      'events',
      Buffer.from(JSON.stringify(receipt)),
      { persistent: true }
    )
    assert.deepEqual(
      JSON.parse((await get(sourceChannel, 'partner.output')).content.toString()),
      receipt
    )
    sourceChannel.publish('partner.input', 'events', Buffer.from('not-json'), {
      persistent: true,
    })
    assert.equal(
      (await get(sourceChannel, 'partner.quarantine')).content.toString(),
      'not-json'
    )
    await destinationChannel.unbindQueue('motif.ingress', 'motif.input', 'events')
    sourceChannel.publish(
      'partner.input',
      'events',
      Buffer.from(JSON.stringify({ ...event, id: 'recover-1' })),
      { persistent: true }
    )
    await until(async () => (health.reconnects > 0 ? true : false))
    await destinationChannel.bindQueue('motif.ingress', 'motif.input', 'events')
    const recovered = await get(destinationChannel, 'motif.ingress')
    assert.equal(JSON.parse(recovered.content.toString()).id, 'recover-1')
    const restricted = await connect(
      (await readFile(join(directory, 'motif/connector.url'), 'utf8')).trim()
    )
    brokers.push(restricted)
    const forbidden = await restricted.createChannel()
    forbidden.on('error', () => undefined)
    await assert.rejects(forbidden.get('motif.ingress'), /ACCESS_REFUSED/)
    const badCredentials = join(directory, 'bad.url')
    await writeFile(badCredentials, `amqp://wrong:wrong@127.0.0.1:5674/${virtualHost}`)
    const unhealthy: ConnectionHealth = {
      ...health,
      state: 'connecting',
      reconnects: 0,
    }
    runners.push(
      runConnection(
        {
          ...connection,
          id: 'unhealthy',
          organizationId: 'different-org',
          source: { ...connection.source, urlFile: badCredentials },
        },
        config,
        unhealthy,
        pino({ level: 'silent' }),
        shutdown.signal
      )
    )
    await until(async () => (unhealthy.reconnects > 0 ? true : false))
    sourceChannel.publish(
      'partner.input',
      'events',
      Buffer.from(JSON.stringify({ ...event, id: 'healthy-during-failure' })),
      { persistent: true }
    )
    assert.equal(
      JSON.parse((await get(destinationChannel, 'motif.ingress')).content.toString())
        .id,
      'healthy-during-failure'
    )
    await until(async () =>
      health.forwarded >= 3 && health.returned === 1 && health.quarantined === 1
        ? true
        : false
    )
  } finally {
    shutdown.abort()
    await Promise.allSettled(runners)
    await Promise.allSettled(brokers.map(broker => broker.close()))
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
