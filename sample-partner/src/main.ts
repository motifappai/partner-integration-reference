import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { type ChannelModel, type ConfirmChannel, connect } from 'amqplib'
import {
  FX_PAIRS,
  fxMessage,
  nextValue,
  priceMessage,
  sampleInstruments,
  securityMessage,
} from './messages.ts'

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const brokerUrl = requiredEnv('SAMPLE_BROKER_URL')
const instrumentCount = Number(process.env.INSTRUMENT_COUNT ?? 5)
const priceIntervalMs = Number(process.env.PRICE_INTERVAL_MS ?? 30_000)
const fxIntervalMs = Number(process.env.FX_INTERVAL_MS ?? 60_000)
const invalidEvery = Number(process.env.INVALID_EVERY ?? 0)
const port = Number(process.env.PORT ?? 8080)

const instruments = sampleInstruments(instrumentCount)
const prices = new Map<string, number>(instruments.map((instrument, index) => [instrument.securityId, 100 + index * 25]))
const rates = new Map<string, number>(FX_PAIRS.map(pair => [`${pair.base}/${pair.quote}`, pair.rate]))
const stats = {
  connected: false,
  startedAt: new Date().toISOString(),
  lastError: null as string | null,
  published: { security: 0, price: 0, fx: 0, invalid: 0 },
  receipts: { APPLIED: 0, REJECTED: 0 } as Record<string, number>,
  rejectionCodes: {} as Record<string, number>,
  publications: 0,
  unrecognisedReturns: 0,
  quarantineDepth: null as number | null,
  lastReceiptAt: null as string | null,
}

const shutdown = new AbortController()
process.once('SIGINT', () => shutdown.abort())
process.once('SIGTERM', () => shutdown.abort())

async function topology(channel: ConfirmChannel) {
  for (const exchange of ['partner.input', 'partner.output', 'partner.quarantine']) {
    await channel.assertExchange(exchange, 'direct', { durable: true })
  }
  for (const [exchange, queue] of [
    ['partner.input', 'partner.ingress'],
    ['partner.output', 'partner.output'],
    ['partner.quarantine', 'partner.quarantine'],
  ] as const) {
    await channel.assertQueue(queue, { durable: true })
    await channel.bindQueue(queue, exchange, 'events')
  }
}

function publisher(channel: ConfirmChannel) {
  return (body: Buffer, messageId: string) =>
    new Promise<void>((resolve, reject) => {
      channel.publish(
        'partner.input',
        'events',
        body,
        { persistent: true, mandatory: true, messageId, contentType: 'application/json' },
        error => (error ? reject(new Error('Publication failed')) : resolve())
      )
    })
}

function recordReturn(content: Buffer) {
  let event: { type?: unknown; data?: { status?: unknown; code?: unknown } }
  try {
    event = JSON.parse(content.toString('utf8'))
  } catch {
    stats.unrecognisedReturns++
    return
  }
  if (event.type === 'ai.motif.feed.receipt.v1') {
    const status = String(event.data?.status)
    stats.receipts[status] = (stats.receipts[status] ?? 0) + 1
    if (typeof event.data?.code === 'string') {
      stats.rejectionCodes[event.data.code] = (stats.rejectionCodes[event.data.code] ?? 0) + 1
    }
    stats.lastReceiptAt = new Date().toISOString()
  } else if (event.type === 'ai.motif.assessment.published.v1') {
    stats.publications++
  } else {
    stats.unrecognisedReturns++
  }
}

async function session(broker: ChannelModel, signal: AbortSignal) {
  const channel = await broker.createConfirmChannel()
  await topology(channel)
  const publish = publisher(channel)
  await channel.consume('partner.output', message => {
    if (!message) return
    recordReturn(message.content)
    channel.ack(message)
  })
  for (const instrument of instruments) {
    const message = securityMessage(instrument)
    await publish(Buffer.from(JSON.stringify(message)), message.eventId)
    stats.published.security++
  }
  let priceRound = 0
  const publishPrices = async () => {
    priceRound++
    for (const instrument of instruments) {
      const price = nextValue(prices.get(instrument.securityId) ?? 100)
      prices.set(instrument.securityId, price)
      const message = priceMessage(instrument, price, new Date(Date.now() - 1000))
      await publish(Buffer.from(JSON.stringify(message)), message.eventId)
      stats.published.price++
    }
    if (invalidEvery > 0 && priceRound % invalidEvery === 0) {
      await publish(Buffer.from('this is not json'), `invalid-${Date.now()}`)
      stats.published.invalid++
    }
  }
  const publishFx = async () => {
    for (const pair of FX_PAIRS) {
      const key = `${pair.base}/${pair.quote}`
      const rate = nextValue(rates.get(key) ?? pair.rate)
      rates.set(key, rate)
      const message = fxMessage(pair, rate, new Date(Date.now() - 1000))
      await publish(Buffer.from(JSON.stringify(message)), message.eventId)
      stats.published.fx++
    }
  }
  await publishPrices()
  await publishFx()
  let nextPrices = Date.now() + priceIntervalMs
  let nextFx = Date.now() + fxIntervalMs
  while (!signal.aborted) {
    await delay(1000, undefined, { signal }).catch(() => undefined)
    if (Date.now() >= nextPrices) {
      await publishPrices()
      nextPrices += priceIntervalMs
    }
    if (Date.now() >= nextFx) {
      await publishFx()
      nextFx += fxIntervalMs
    }
    stats.quarantineDepth = (await channel.checkQueue('partner.quarantine')).messageCount
  }
}

async function run() {
  let attempt = 0
  while (!shutdown.signal.aborted) {
    const failed = new AbortController()
    const stop = () => failed.abort()
    shutdown.signal.addEventListener('abort', stop, { once: true })
    let broker: ChannelModel | undefined
    try {
      broker = await connect(brokerUrl)
      broker.on('error', stop)
      broker.on('close', stop)
      stats.connected = true
      stats.lastError = null
      attempt = 0
      await session(broker, failed.signal)
    } catch (error) {
      stats.lastError = error instanceof Error ? error.message : 'Broker session failed'
    } finally {
      stats.connected = false
      shutdown.signal.removeEventListener('abort', stop)
      await broker?.close().catch(() => undefined)
    }
    if (!shutdown.signal.aborted) {
      await delay(Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)), undefined, {
        signal: shutdown.signal,
      }).catch(() => undefined)
    }
  }
}

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'running' }))
    return
  }
  if (request.url === '/stats') {
    response.writeHead(stats.connected ? 200 : 503, { 'content-type': 'application/json' })
    response.end(JSON.stringify(stats))
    return
  }
  response.writeHead(404)
  response.end()
})
server.listen(port, '0.0.0.0')
setInterval(() => console.log(JSON.stringify({ msg: 'sample partner stats', ...stats })), 60_000).unref()
await run()
server.close()
