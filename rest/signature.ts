import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifySignature(input: {
  rawBody: string
  signature: string
  timestamp: string
  secret: string
  now?: number
}): boolean {
  if (!/^\d+$/.test(input.timestamp) || !/^v1=[0-9a-f]{64}$/.test(input.signature))
    return false
  const seconds = Number(input.timestamp)
  if (
    !Number.isSafeInteger(seconds) ||
    Math.abs(Math.floor((input.now ?? Date.now()) / 1000) - seconds) > 300
  )
    return false
  const signingKey = createHmac('sha256', 'webhook-secret-salt')
    .update(input.secret, 'utf8')
    .digest('hex')
  const expected = createHmac('sha256', signingKey)
    .update(`${input.timestamp}.${input.rawBody}`, 'utf8')
    .digest()
  return timingSafeEqual(expected, Buffer.from(input.signature.slice(3), 'hex'))
}
