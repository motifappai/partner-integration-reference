import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectorConfigSchema, mappingSchema } from '../src/config.ts'
import { normalizeEvent } from '../src/envelope.ts'

const envelope = {
  specversion: '1.0',
  id: 'event-1',
  source: 'urn:partner:test',
  type: 'ai.motif.fx.rate.v1',
  subject: 'fx/USD-NZD',
  time: '2026-10-07T08:00:00Z',
  datacontenttype: 'application/json',
  data: { rate: '1.65' },
}

test('preserves stable identity and exact decimal strings through reconnect deliveries', () => {
  const encoded = Buffer.from(JSON.stringify(envelope))
  assert.deepEqual(normalizeEvent(encoded), envelope)
  assert.deepEqual(normalizeEvent(encoded), normalizeEvent(encoded))
})
test('maps declared source fields without evaluating code or coercing financial numbers', () => {
  const mapping = mappingSchema.parse({
    source: 'urn:partner:test',
    type: envelope.type,
    id: '/identifier',
    time: '/timestamp',
    subject: '/pair',
    fields: { rate: '/quote/value' },
    constants: { rateType: 'MID' },
  })
  const source = Buffer.from(
    JSON.stringify({
      identifier: 'source-42',
      timestamp: envelope.time,
      pair: envelope.subject,
      quote: { value: '1.65000000' },
    })
  )
  assert.deepEqual(normalizeEvent(source, mapping).data, {
    rate: '1.65000000',
    rateType: 'MID',
  })
  assert.equal(normalizeEvent(source, mapping).id, 'source-42')
  assert.throws(() =>
    normalizeEvent(source, { ...mapping, fields: { rate: '/missing' } })
  )
  assert.throws(() =>
    normalizeEvent(source, { ...mapping, fields: { rate: '/__proto__/secret' } })
  )
})
test('rejects tenant claims and invalid source envelopes at the bridge boundary', () => {
  assert.throws(() =>
    normalizeEvent(
      Buffer.from(JSON.stringify({ ...envelope, organizationId: 'another-org' }))
    )
  )
  assert.throws(() =>
    normalizeEvent(Buffer.from(JSON.stringify({ ...envelope, id: '' })))
  )
  assert.throws(() => normalizeEvent(Buffer.from('not-json')))
  assert.equal(
    connectorConfigSchema.safeParse({ version: 1, connections: [] }).success,
    false
  )
})
