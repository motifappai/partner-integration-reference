import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import type { AssessmentPublishedEvent } from '../shared/event.ts'
import { startWebhookReceiver } from '../shared/receiver.ts'

import { verifySignature as verifyRest } from '../rest/signature.ts'
import { verifySignature as verifySdk } from '../sdk/signature.ts'

const secret = 'whsec_unit_test'
const subscriptionId = 'webhook-test'
const publication: AssessmentPublishedEvent = {
  id: 'event-test',
  event: 'assessment.published',
  version: 1,
  timestamp: new Date().toISOString(),
  organizationId: 'org-test',
  data: {
    surface: 'PORTFOLIO',
    subjectId: 'portfolio-test',
    portfolioId: 'portfolio-test',
    revision: 1,
    language: 'de',
  },
}

function signedHeaders(rawBody: string, eventName: string, eventId?: string) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signingKey = createHmac('sha256', 'webhook-secret-salt')
    .update(secret)
    .digest('hex')
  const signature = createHmac('sha256', signingKey)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')
  return {
    'content-type': 'application/json',
    'x-webhook-signature': `v1=${signature}`,
    'x-webhook-timestamp': timestamp,
    'x-webhook-id': subscriptionId,
    'x-webhook-event': eventName,
    ...(eventId ? { 'x-webhook-event-id': eventId } : {}),
  }
}

async function send(
  port: number,
  payload: unknown,
  eventName = 'assessment.published',
  eventId = publication.id
) {
  const body = JSON.stringify(payload)
  return fetch(`http://127.0.0.1:${port}/webhooks/motif`, {
    method: 'POST',
    body,
    headers: signedHeaders(body, eventName, eventId),
  })
}

for (const [implementation, verifySignature] of [
  ['REST', verifyRest],
  ['SDK', verifySdk],
] as const) {
  test(`${implementation}: verifies the test schema separately and deduplicates signed publication retries`, async () => {
    const reads: AssessmentPublishedEvent[] = []
    const receiver = await startWebhookReceiver({
      port: 0,
      verifySignature,
      organizationId: 'org-test',
      onAssessment: async event => {
        reads.push(event)
      },
    })
    try {
      receiver.configure({ id: subscriptionId, secret })
      const testResponse = await send(
        receiver.port,
        {
          event: 'webhook.test',
          timestamp: new Date().toISOString(),
          data: { webhookId: subscriptionId },
        },
        'webhook.test',
        ''
      )
      assert.equal(testResponse.status, 204)
      assert.equal(receiver.testCount(), 1)
      assert.equal((await send(receiver.port, publication)).status, 204)
      assert.equal((await send(receiver.port, publication)).status, 204)
      await receiver.drain()
      assert.deepEqual(reads, [publication])
      assert.equal(receiver.assessments()[0]?.status, 'READ')
      assert.equal(receiver.deliveryCount(publication.id), 2)
    } finally {
      await receiver.close()
    }
  })

  test(`${implementation}: rejects tampered bodies, foreign organizations, inconsistent IDs and wrong event headers`, async () => {
    let readCount = 0
    const receiver = await startWebhookReceiver({
      port: 0,
      verifySignature,
      organizationId: 'org-test',
      onAssessment: async () => {
        readCount += 1
      },
    })
    try {
      receiver.configure({ id: subscriptionId, secret })
      const signedBody = JSON.stringify(publication)
      const tampered = await fetch(`http://127.0.0.1:${receiver.port}/webhooks/motif`, {
        method: 'POST',
        body: `${signedBody} `,
        headers: signedHeaders(signedBody, publication.event, publication.id),
      })
      assert.equal(tampered.status, 401)
      assert.equal(
        (
          await send(receiver.port, {
            ...publication,
            organizationId: 'other-org',
          })
        ).status,
        400
      )
      assert.equal(
        (
          await send(receiver.port, {
            ...publication,
            data: { ...publication.data, portfolioId: 'other-portfolio' },
          })
        ).status,
        400
      )
      assert.equal((await send(receiver.port, publication, 'webhook.test')).status, 400)
      assert.equal(
        (await send(receiver.port, publication, publication.event, 'different-event'))
          .status,
        400
      )
      assert.equal(
        (
          await send(receiver.port, {
            ...publication,
            data: {
              ...publication.data,
              surface: 'MARKET',
              subjectId: 'OTHER',
              portfolioId: null,
            },
          })
        ).status,
        400
      )
      await receiver.drain()
      assert.equal(readCount, 0)
    } finally {
      await receiver.close()
    }
  })

  test(`${implementation}: serializes content reads and allows a failed event to be retried`, async () => {
    let active = 0
    let maximumActive = 0
    let shouldFail = true
    const receiver = await startWebhookReceiver({
      port: 0,
      verifySignature,
      organizationId: 'org-test',
      onAssessment: async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise(resolve => setTimeout(resolve, 10))
        active -= 1
        if (shouldFail) {
          throw new Error('API unavailable')
        }
      },
    })
    try {
      receiver.configure({ id: subscriptionId, secret })
      await send(receiver.port, publication)
      await receiver.drain()
      assert.equal(receiver.assessments()[0]?.status, 'FAILED')
      shouldFail = false
      await Promise.all([
        send(receiver.port, publication),
        send(
          receiver.port,
          { ...publication, id: 'event-second' },
          publication.event,
          'event-second'
        ),
      ])
      await receiver.drain()
      assert.equal(maximumActive, 1)
      assert.equal(
        receiver.assessments().filter(received => received.status === 'READ').length,
        2
      )
    } finally {
      await receiver.close()
    }
  })
}
