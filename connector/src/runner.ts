import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChannelModel, ConsumeMessage } from 'amqplib'
import type { Logger } from 'pino'
import type { ConnectionConfig, ConnectorConfig } from './config.ts'
import { normalizeEvent, unmappedIdentity } from './envelope.ts'
import { closeBroker, openBroker, publisher, type Publisher } from './transport.ts'

export type ConnectionHealth = {
  state: 'connecting' | 'ready' | 'reconnecting' | 'stopped'
  forwarded: number
  returned: number
  quarantined: number
  reconnects: number
  lastConfirmedAt: string | null
}

export async function runConnection(
  config: ConnectionConfig,
  settings: ConnectorConfig,
  health: ConnectionHealth,
  logger: Logger,
  shutdown: AbortSignal
) {
  let retry = 0
  while (!shutdown.aborted) {
    const session = new AbortController()
    const stop = () => session.abort()
    shutdown.addEventListener('abort', stop, { once: true })
    let source: ChannelModel | undefined
    let destination: ChannelModel | undefined
    try {
      health.state = 'connecting'
      const allowInsecure =
        config.environment === 'sandbox' && settings.allowInsecureSandbox
      source = await openBroker(config.source, allowInsecure, stop)
      destination = await openBroker(config.destination, allowInsecure, stop)
      const sourcePublisher = await publisher(source, config.confirmTimeoutMs, stop)
      const destinationPublisher = await publisher(
        destination,
        config.confirmTimeoutMs,
        stop
      )
      await sourcePublisher.channel.checkQueue(config.source.queue)
      await sourcePublisher.channel.checkQueue(config.source.quarantineQueue)
      await destinationPublisher.channel.checkQueue(config.destination.outputQueue)
      await destinationPublisher.channel.checkQueue(config.destination.quarantineQueue)
      await sourcePublisher.channel.prefetch(config.prefetch)
      await destinationPublisher.channel.prefetch(config.prefetch)

      async function transfer(
        message: ConsumeMessage,
        incoming: Publisher,
        outgoing: Publisher,
        direction: 'forwarded' | 'returned'
      ) {
        const isForward = direction === 'forwarded'
        let body: Buffer
        let identifier: string
        let contentType = 'application/cloudevents+json'
        try {
          if (message.content.length > config.maxMessageBytes)
            throw new Error('Message size limit exceeded')
          const unmapped =
            isForward && config.forwardUnmapped
              ? unmappedIdentity(message.content)
              : null
          if (unmapped) {
            body = message.content
            identifier = unmapped
            contentType = 'application/json'
          } else {
            const envelope = normalizeEvent(
              message.content,
              isForward ? config.mapping : undefined
            )
            const isInput = [
              'ai.motif.asset.master.v1',
              'ai.motif.asset.price.v1',
              'ai.motif.fx.rate.v1',
            ].includes(envelope.type)
            if (isForward !== isInput) throw new Error('Event direction is invalid')
            body = Buffer.from(JSON.stringify(envelope))
            if (body.length > config.maxMessageBytes)
              throw new Error('Mapped message size limit exceeded')
            identifier = envelope.id
          }
        } catch {
          const digest = createHash('sha256').update(message.content).digest('hex')
          await incoming.send(
            isForward
              ? config.source.quarantineQueue
              : config.destination.quarantineQueue,
            'events',
            message.content,
            digest,
            'application/octet-stream'
          )
          if (session.signal.aborted) return
          incoming.channel.ack(message)
          health.quarantined++
          logger.warn(
            { connectionId: config.id, direction, digest },
            'Message quarantined: invalid envelope, mapping, direction or size'
          )
          return
        }
        await outgoing.send(
          isForward ? config.destination.inputExchange : config.source.outputExchange,
          isForward
            ? config.destination.inputRoutingKey
            : config.source.outputRoutingKey,
          body,
          identifier,
          contentType
        )
        if (session.signal.aborted) return
        incoming.channel.ack(message)
        health[direction]++
        health.lastConfirmedAt = new Date().toISOString()
        retry = 0
      }

      await sourcePublisher.channel.consume(
        config.source.queue,
        message => {
          if (!message) return stop()
          void transfer(
            message,
            sourcePublisher,
            destinationPublisher,
            'forwarded'
          ).catch(stop)
        },
        { noAck: false, exclusive: true }
      )
      await destinationPublisher.channel.consume(
        config.destination.outputQueue,
        message => {
          if (!message) return stop()
          void transfer(
            message,
            destinationPublisher,
            sourcePublisher,
            'returned'
          ).catch(stop)
        },
        { noAck: false, exclusive: true }
      )
      if (!session.signal.aborted) {
        health.state = 'ready'
        logger.info(
          {
            connectionId: config.id,
            organizationId: config.organizationId,
            environment: config.environment,
          },
          'Connector ready'
        )
        await new Promise<void>(resolve =>
          session.signal.addEventListener('abort', () => resolve(), { once: true })
        )
      }
    } catch {
      logger.warn(
        { connectionId: config.id },
        'Connector unavailable; unacknowledged messages remain at source'
      )
    } finally {
      health.state = shutdown.aborted ? 'stopped' : 'reconnecting'
      session.abort()
      shutdown.removeEventListener('abort', stop)
      await Promise.allSettled([closeBroker(source), closeBroker(destination)])
    }
    if (!shutdown.aborted) {
      health.reconnects++
      const waitMs =
        Math.min(30_000, 1000 * 2 ** Math.min(retry++, 5)) +
        Math.floor(Math.random() * 250)
      await delay(waitMs, undefined, { signal: shutdown }).catch(() => undefined)
    }
  }
  health.state = 'stopped'
}
