import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Mapping } from './config.ts'

export const envelopeSchema = z.strictObject({
  specversion: z.literal('1.0'),
  id: z.string().min(1).max(200),
  source: z.string().url().max(300),
  type: z.enum([
    'ai.motif.asset.master.v1',
    'ai.motif.asset.price.v1',
    'ai.motif.fx.rate.v1',
    'ai.motif.feed.receipt.v1',
    'ai.motif.assessment.published.v1',
  ]),
  subject: z.string().min(1).max(300),
  time: z.iso.datetime({ offset: true }),
  datacontenttype: z.literal('application/json'),
  data: z.record(z.string(), z.unknown()),
})
export type Envelope = z.infer<typeof envelopeSchema>

function atPointer(document: unknown, pointer: string): unknown {
  let selected = document
  for (const segment of pointer === '' ? [] : pointer.slice(1).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~')
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      throw new Error('Unsafe mapping key')
    if (
      typeof selected !== 'object' ||
      selected === null ||
      !Object.hasOwn(selected, key)
    )
      throw new Error('Required mapping field is missing')
    const record = z.record(z.string(), z.unknown()).parse(selected)
    selected = record[key]
  }
  return selected
}

export function normalizeEvent(content: Buffer, mapping?: Mapping): Envelope {
  const parsed: unknown = JSON.parse(content.toString('utf8'))
  if (!mapping) return envelopeSchema.parse(parsed)
  const fields: Record<string, unknown> = { ...mapping.constants }
  for (const [field, pointer] of Object.entries(mapping.fields)) {
    if (['__proto__', 'constructor', 'prototype'].includes(field))
      throw new Error('Unsafe mapping key')
    if (Object.hasOwn(fields, field))
      throw new Error('Mapping field and constant overlap')
    fields[field] = atPointer(parsed, pointer)
  }
  return envelopeSchema.parse({
    specversion: '1.0',
    id: atPointer(parsed, mapping.id),
    source: mapping.source,
    type: mapping.type,
    subject: atPointer(parsed, mapping.subject),
    time: atPointer(parsed, mapping.time),
    datacontenttype: 'application/json',
    data: fields,
  })
}

export function unmappedIdentity(content: Buffer) {
  let parsed: unknown
  try {
    parsed = JSON.parse(content.toString('utf8'))
  } catch {
    return null
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.hasOwn(parsed, 'specversion')
  )
    return null
  return createHash('sha256').update(content).digest('hex')
}
