export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object')
  }
  return Object.fromEntries(Object.entries(value))
}

export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length)
    throw new Error('Expected a nonempty string')
  return value
}

export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected a JSON array')
  return value
}

export function show(label: string, value: unknown) {
  console.log(`\n${label}\n${JSON.stringify(value, null, 2)}`)
}
