import { randomUUID } from 'node:crypto'
import { connect, type ChannelModel, type Message } from 'amqplib'
import { brokerConnection, type BrokerConfig } from './config.ts'

export async function openBroker(
  config: BrokerConfig,
  allowInsecure: boolean,
  failure: () => void
) {
  const credentials = await brokerConnection(config, allowInsecure)
  const broker = await connect(credentials.address, credentials.options)
  broker.on('error', failure)
  broker.on('close', failure)
  return broker
}

export async function publisher(
  broker: ChannelModel,
  timeoutMs: number,
  failure: () => void
) {
  const channel = await broker.createConfirmChannel()
  channel.on('error', failure)
  channel.on('close', failure)
  const pending = new Map<string, { reject: (error: Error) => void }>()
  channel.on('return', (message: Message) => {
    const identifier: unknown = message.properties.correlationId
    if (typeof identifier === 'string')
      pending.get(identifier)?.reject(new Error('Publication was not routed'))
  })
  channel.on('close', () => {
    for (const publication of pending.values())
      publication.reject(new Error('Publisher closed before confirmation'))
  })
  return {
    channel,
    send(
      exchange: string,
      routingKey: string,
      content: Buffer,
      messageId: string,
      contentType = 'application/cloudevents+json'
    ) {
      const correlationId = randomUUID()
      let timeout: ReturnType<typeof setTimeout> | undefined
      return new Promise<void>((resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Publisher confirmation timed out'))
          failure()
        }, timeoutMs)
        pending.set(correlationId, { reject })
        try {
          channel.publish(
            exchange,
            routingKey,
            content,
            {
              persistent: true,
              mandatory: true,
              correlationId,
              messageId,
              contentType,
            },
            (error: unknown) => {
              if (error) reject(new Error('Publisher confirmation failed'))
              else resolve()
            }
          )
        } catch {
          reject(new Error('Publisher is unavailable'))
        }
      }).finally(() => {
        clearTimeout(timeout)
        pending.delete(correlationId)
      })
    },
  }
}

export type Publisher = Awaited<ReturnType<typeof publisher>>

export async function closeBroker(broker: ChannelModel | undefined) {
  if (!broker) return
  try {
    await broker.close()
  } catch {
    return
  }
}
