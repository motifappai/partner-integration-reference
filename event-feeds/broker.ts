import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { normalizeEvent } from '../connector/src/envelope.ts'
import { openBroker, publisher } from '../connector/src/transport.ts'
import { record, text } from '../shared/values.ts'
import type { FeedReferenceConfig } from './config.ts'

export async function partnerBroker(
  config: FeedReferenceConfig,
  onAssessment: (payload: Record<string, unknown>) => Promise<void>
) {
  let failed = false
  let publications = 0
  const receipts = new Map<string, Record<string, unknown>>()
  const broker = await openBroker(
    { urlFile: config.sourceUrlFile, caFile: config.sourceCaFile },
    config.insecureLocal,
    () => {
      failed = true
    }
  )
  const transport = await publisher(broker, 15_000, () => {
    failed = true
  })
  await mkdir(dirname(config.receiptFile), { recursive: true, mode: 0o700 })
  const journal = await open(config.receiptFile, 'a', 0o600)
  await transport.channel.prefetch(1)
  const receive = async (body: Buffer) => {
    const envelope = normalizeEvent(body)
    await journal.write(`${JSON.stringify(envelope)}\n`)
    await journal.sync()
    if (envelope.type === 'ai.motif.feed.receipt.v1') {
      const receipt = record(envelope.data)
      if (text(receipt.source) === `urn:partner:${config.runId}`)
        receipts.set(text(receipt.eventId), receipt)
    } else if (envelope.type === 'ai.motif.assessment.published.v1') {
      await onAssessment(envelope.data)
      publications++
    } else throw new Error('Unexpected event on partner output queue')
  }
  await transport.channel.consume(
    'partner.output',
    message => {
      if (!message) {
        failed = true
        return
      }
      void receive(message.content)
        .then(() => transport.channel.ack(message))
        .catch(() => {
          failed = true
          void broker.close().catch(() => undefined)
        })
    },
    { noAck: false, exclusive: true }
  )
  return {
    async publish(
      id: string,
      type: string,
      subject: string,
      data: Record<string, unknown>
    ) {
      const event = {
        specversion: '1.0',
        id,
        source: `urn:partner:${config.runId}`,
        type,
        subject,
        time: text(data.asOf),
        datacontenttype: 'application/json',
        data,
      }
      await transport.send(
        'partner.input',
        'events',
        Buffer.from(JSON.stringify(event)),
        id
      )
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        if (failed)
          throw new Error(
            'Partner broker connection failed; acknowledged events remain in the journal'
          )
        const receipt = receipts.get(id)
        if (receipt) {
          if (receipt.status !== 'APPLIED')
            throw new Error(`Feed ${id} rejected: ${receipt.code}`)
          return receipt
        }
        await delay(100)
      }
      throw new Error(
        `Feed ${id} has no processing receipt; reconcile it through the receipt API`
      )
    },
    async listen(seconds: number) {
      for (let elapsed = 0; elapsed < seconds; elapsed++) {
        if (failed) throw new Error('Partner receiver failed')
        await delay(1000)
      }
      return publications
    },
    async close() {
      await broker.close().catch(() => undefined)
      await journal.close()
    },
  }
}
