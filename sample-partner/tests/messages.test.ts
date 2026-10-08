import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  FX_PAIRS,
  fxMessage,
  nextValue,
  priceMessage,
  sampleInstruments,
  securityMessage,
} from '../src/messages.ts'

type Mapping = {
  match: { pointer: string; equals: string }
  idPointer: string
  timePointer: string
  subjectPointer: string
  fields: Record<string, string>
}

function mapping(name: string): Mapping {
  return JSON.parse(readFileSync(new URL(`../mappings/${name}.json`, import.meta.url), 'utf8'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function at(document: unknown, pointer: string): unknown {
  let selected = document
  for (const key of pointer.slice(1).split('/')) {
    assert.ok(isRecord(selected) && Object.hasOwn(selected, key), pointer)
    selected = selected[key]
  }
  return selected
}

function assertCovered(message: unknown, definition: Mapping) {
  assert.equal(at(message, definition.match.pointer), definition.match.equals)
  for (const pointer of [
    definition.idPointer,
    definition.timePointer,
    definition.subjectPointer,
    ...Object.values(definition.fields),
  ]) {
    const value = at(message, pointer)
    assert.ok(value !== undefined && value !== null, pointer)
  }
}

const [instrument] = sampleInstruments(1)
const observedAt = new Date('2026-10-08T12:00:00Z')

test('every generated message carries the fields its shipped mapping reads', () => {
  assert.ok(instrument)
  assertCovered(securityMessage(instrument), mapping('asset-master'))
  assertCovered(priceMessage(instrument, 123.4, observedAt), mapping('asset-price'))
  assertCovered(fxMessage(FX_PAIRS[0], 1.0875, observedAt), mapping('fx-rate'))
})

test('financial values are decimal strings and identities are stable', () => {
  assert.ok(instrument)
  assert.equal(priceMessage(instrument, 123.4, observedAt).quote.px, '123.4000')
  assert.equal(fxMessage(FX_PAIRS[0], 1.0875, observedAt).mid, '1.087500')
  assert.deepEqual(securityMessage(instrument), securityMessage(instrument))
  assert.notEqual(
    priceMessage(instrument, 1, observedAt).eventId,
    priceMessage(instrument, 1, new Date(observedAt.getTime() + 1)).eventId
  )
  assert.match(instrument.code, /^[A-Z0-9]{1,32}$/)
})

test('prices move gradually and never reach zero', () => {
  assert.equal(nextValue(100, () => 0.5), 100)
  assert.ok(nextValue(100, () => 1) <= 101)
  assert.ok(nextValue(0.01, () => 0) >= 0.01)
})
