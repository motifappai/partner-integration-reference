import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sandboxUrl, snapshot } from '../shared/config.ts'

test('production hostname variations are rejected before credentials or writes', () => {
  for (const url of [
    'https://backend.motifapp.ai/api',
    'https://backend.motifapp.ai./api',
    'https://BACKEND.MOTIFAPP.AI:443/api',
    'https://backend.motifapp.ai.../api',
    'https://backend%2Emotifapp%2Eai/api',
  ])
    assert.throws(() => sandboxUrl(url), /sandbox/)
  assert.equal(
    sandboxUrl('https://staging.backend.motifapp.ai/api/'),
    'https://staging.backend.motifapp.ai/api'
  )
  assert.equal(sandboxUrl('http://127.0.0.1:4000/api'), 'http://127.0.0.1:4000/api')
  assert.throws(() => sandboxUrl('http://example.com/api'), /HTTPS/)
  assert.throws(() => sandboxUrl('https://key@example.com/api'), /plain API/)
})

test('snapshots follow the guide and replace the complete holdings and cash', () => {
  const initial = snapshot(1, 'apple-id', 'fund-id')
  const updated = snapshot(2, 'apple-id', 'fund-id')
  assert.equal(initial.cash, '1000')
  assert.equal(updated.cash, '600')
  assert.equal(initial.holdings[0].quantity, '10')
  assert.equal(updated.holdings[0].quantity, '12')
  assert.deepEqual(updated.holdings[0].instrument, {
    type: 'ASSET',
    assetId: 'apple-id',
  })
  assert.deepEqual(updated.holdings[1], {
    instrument: { type: 'ASSET', assetId: 'fund-id' },
    quantity: '5',
    currency: 'USD',
  })
  assert.ok(Date.parse(updated.asOf) <= Date.now())
})
