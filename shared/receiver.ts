import { createServer, type IncomingMessage } from 'node:http'
import { type AssessmentPublishedEvent, isAssessmentPublishedEvent } from './event.ts'

type ReceivedAssessment = {
  event: AssessmentPublishedEvent
  status: 'QUEUED' | 'READ' | 'FAILED'
  error?: string
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk)) {
      throw new Error('Expected request bytes')
    }
    size += chunk.length
    if (size > 1_048_576) {
      throw new Error('Request exceeds one MiB')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function isTestEvent(value: unknown, endpointId: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'event' in value &&
    value.event === 'webhook.test' &&
    'data' in value &&
    typeof value.data === 'object' &&
    value.data !== null &&
    'webhookId' in value.data &&
    value.data.webhookId === endpointId
  )
}

export async function startWebhookReceiver(input: {
  organizationId: string
  verifySignature: (input: {
    rawBody: string
    signature: string
    timestamp: string
    secret: string
  }) => boolean | Promise<boolean>
  port: number
  onAssessment: (event: AssessmentPublishedEvent) => Promise<void>
}) {
  let subscription: { id: string; secret: string } | undefined
  let queue = Promise.resolve()
  let testCount = 0
  const assessments = new Map<string, ReceivedAssessment>()
  const deliveryCounts = new Map<string, number>()
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/webhooks/motif') {
      response.writeHead(404).end()
      return
    }
    if (!subscription) {
      response.writeHead(503).end()
      return
    }
    try {
      const signature = request.headers['x-webhook-signature']
      const timestamp = request.headers['x-webhook-timestamp']
      const endpointId = request.headers['x-webhook-id']
      const eventName = request.headers['x-webhook-event']
      if (
        typeof signature !== 'string' ||
        typeof timestamp !== 'string' ||
        endpointId !== subscription.id
      ) {
        response.writeHead(401).end()
        return
      }
      const rawBody = await readBody(request)
      if (
        !(await input.verifySignature({
          rawBody,
          signature,
          timestamp,
          secret: subscription.secret,
        }))
      ) {
        response.writeHead(401).end()
        return
      }
      const event: unknown = JSON.parse(rawBody)
      if (eventName === 'webhook.test' && isTestEvent(event, subscription.id)) {
        testCount += 1
        response.writeHead(204).end()
        return
      }
      if (
        eventName !== 'assessment.published' ||
        !isAssessmentPublishedEvent(event) ||
        event.organizationId !== input.organizationId ||
        event.id !== request.headers['x-webhook-event-id'] ||
        (event.data.surface === 'MARKET' && event.data.subjectId !== 'GLOBAL') ||
        (event.data.surface === 'PORTFOLIO'
          ? event.data.portfolioId !== event.data.subjectId
          : event.data.portfolioId !== null)
      ) {
        response.writeHead(400).end()
        return
      }
      const key = `${event.organizationId}:${event.id}`
      deliveryCounts.set(event.id, (deliveryCounts.get(event.id) ?? 0) + 1)
      const existing = assessments.get(key)
      if (!existing || existing.status === 'FAILED') {
        const received: ReceivedAssessment = { event, status: 'QUEUED' }
        assessments.set(key, received)
        queue = queue.then(async () => {
          try {
            await input.onAssessment(event)
            received.status = 'READ'
          } catch (error) {
            received.status = 'FAILED'
            received.error = error instanceof Error ? error.message : String(error)
          }
        })
      }
      response.writeHead(204).end()
    } catch {
      response.writeHead(400).end()
    }
  })
  server.requestTimeout = 10_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Receiver did not start')
  }
  return {
    port: address.port,
    configure: (configuration: { id: string; secret: string }) => {
      subscription = configuration
    },
    testCount: () => testCount,
    deliveryCount: (eventId: string) => deliveryCounts.get(eventId) ?? 0,
    assessments: () => [...assessments.values()],
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
      })
      await queue
    },
    drain: () => queue,
  }
}
