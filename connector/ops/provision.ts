import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'

const provisionSchema = z.strictObject({
  managementUrlFile: z.string(),
  brokerHost: z.string().min(1),
  brokerPort: z.number().int().default(5671),
  virtualHost: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  role: z.enum(['partner', 'motif']),
  secretDirectory: z.string(),
  insecureLocal: z.boolean().default(false),
})
export async function provisionBroker(raw: unknown) {
  const config = provisionSchema.parse(raw)
  const management = new URL((await readFile(config.managementUrlFile, 'utf8')).trim())
  if (
    management.protocol !== 'https:' &&
    !(config.insecureLocal && ['localhost', '127.0.0.1'].includes(management.hostname))
  )
    throw new Error('Management API requires HTTPS')
  if (config.insecureLocal && !['localhost', '127.0.0.1'].includes(config.brokerHost))
    throw new Error('Insecure provisioning is restricted to loopback')
  const authorization = `Basic ${Buffer.from(`${decodeURIComponent(management.username)}:${decodeURIComponent(management.password)}`).toString('base64')}`
  management.username = ''
  management.password = ''
  const request = async (path: string, body: unknown) => {
    const response = await fetch(new URL(`/api/${path}`, management), {
      method: 'PUT',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok)
      throw new Error(
        `Provisioning failed (${response.status}) at ${path.split('/')[0]}`
      )
  }
  const virtualHost = encodeURIComponent(config.virtualHost)
  await request(`vhosts/${virtualHost}`, {})
  const exchange = async (name: string) =>
    request(`exchanges/${virtualHost}/${name}`, {
      type: 'direct',
      durable: true,
      auto_delete: false,
      internal: false,
      arguments: {},
    })
  const queue = async (
    name: string,
    additional: Record<string, string | number> = {}
  ) =>
    request(`queues/${virtualHost}/${name}`, {
      durable: true,
      auto_delete: false,
      arguments: { 'x-queue-type': 'quorum', 'x-delivery-limit': -1, ...additional },
    })
  const bind = async (source: string, destination: string) => {
    const response = await fetch(
      new URL(`/api/bindings/${virtualHost}/e/${source}/q/${destination}`, management),
      {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ routing_key: 'events', arguments: {} }),
        signal: AbortSignal.timeout(15_000),
      }
    )
    if (!response.ok) throw new Error(`Binding failed (${response.status})`)
  }
  await mkdir(config.secretDirectory, { recursive: true, mode: 0o700 })
  const user = async (suffix: string, read: string, write: string) => {
    const username = `${config.virtualHost}-${suffix}`
    const password = randomBytes(32).toString('base64url')
    await request(`users/${encodeURIComponent(username)}`, { password, tags: '' })
    await request(`permissions/${virtualHost}/${encodeURIComponent(username)}`, {
      configure: '^$',
      read,
      write,
    })
    const address = new URL(
      `${config.insecureLocal ? 'amqp' : 'amqps'}://${config.brokerHost}:${config.brokerPort}/${virtualHost}?heartbeat=30`
    )
    address.username = username
    address.password = password
    await writeFile(
      resolve(config.secretDirectory, `${suffix}.url`),
      address.toString(),
      { mode: 0o600 }
    )
  }
  if (config.role === 'partner') {
    await exchange('partner.input')
    await exchange('partner.output')
    await queue('partner.ingress')
    await queue('partner.output')
    await queue('partner.quarantine')
    await exchange('partner.quarantine')
    await bind('partner.quarantine', 'partner.quarantine')
    await bind('partner.input', 'partner.ingress')
    await bind('partner.output', 'partner.output')
    await user(
      'connector',
      '^partner\\.ingress$',
      '^(partner\\.output|partner\\.quarantine)$'
    )
    await user('application', '^partner\\.output$', '^partner\\.input$')
  } else {
    await exchange('motif.input')
    await exchange('motif.output')
    await queue('motif.ingress')
    await queue('motif.output')
    await queue('motif.quarantine')
    await queue('motif.connector-quarantine')
    for (const name of ['motif.quarantine', 'motif.connector-quarantine']) {
      await exchange(name)
      await bind(name, name)
    }
    await queue('motif.retry', {
      'x-message-ttl': 10_000,
      'x-dead-letter-exchange': 'motif.input',
      'x-dead-letter-routing-key': 'events',
      'x-overflow': 'reject-publish',
    })
    await exchange('motif.retry')
    await bind('motif.retry', 'motif.retry')
    await request(`policies/${virtualHost}/retry-safety`, {
      pattern: '^motif\\.retry$',
      definition: { 'dead-letter-strategy': 'at-least-once' },
      priority: 1,
      'apply-to': 'quorum_queues',
    })
    await bind('motif.input', 'motif.ingress')
    await bind('motif.output', 'motif.output')
    await user(
      'connector',
      '^motif\\.output$',
      '^(motif\\.input|motif\\.connector-quarantine)$'
    )
    await user(
      'worker',
      '^motif\\.ingress$',
      '^(motif\\.output|motif\\.retry|motif\\.quarantine)$'
    )
  }
  return config.virtualHost
}
if (process.argv[1]?.endsWith('/provision.ts')) {
  const path = process.argv[2]
  if (!path) throw new Error('Usage: node ops/provision.ts manifest.json --apply')
  if (!process.argv.includes('--apply'))
    throw new Error(
      'Provisioning changes broker topology and rotates runtime credentials; add --apply'
    )
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  await provisionBroker(parsed)
  process.stdout.write(
    'Broker provisioned; credentials written to the configured secret directory.\n'
  )
}
