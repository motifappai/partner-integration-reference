import { readFile } from 'node:fs/promises'
import { z } from 'zod'

const name = z.string().min(1).max(200)
const pointer = z.string().regex(/^(\/([^~]|~[01])*)*$/)
const brokerSchema = z.strictObject({
  urlFile: z.string().min(1),
  caFile: z.string().min(1).optional(),
  certificateFile: z.string().min(1).optional(),
  keyFile: z.string().min(1).optional(),
})

export const mappingSchema = z.strictObject({
  type: name,
  source: z.string().url(),
  id: pointer,
  time: pointer,
  subject: pointer,
  fields: z.record(z.string(), pointer),
  constants: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
})

export const connectorConfigSchema = z
  .strictObject({
    version: z.literal(1),
    healthPort: z.number().int().min(1024).max(65535).default(8080),
    allowInsecureSandbox: z.boolean().default(false),
    connections: z
      .array(
        z.strictObject({
          id: name,
          organizationId: name,
          environment: z.enum(['sandbox', 'production']),
          source: brokerSchema.extend({
            queue: name,
            quarantineQueue: name,
            outputExchange: name,
            outputRoutingKey: name,
          }),
          destination: brokerSchema.extend({
            inputExchange: name,
            inputRoutingKey: name,
            outputQueue: name,
            quarantineQueue: name,
          }),
          mapping: mappingSchema.optional(),
          forwardUnmapped: z.boolean().default(false),
          prefetch: z.number().int().min(1).max(64).default(8),
          maxMessageBytes: z.number().int().min(1024).max(1_048_576).default(262_144),
          confirmTimeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
        })
      )
      .min(1)
      .max(100),
  })
  .superRefine((config, context) => {
    const identifiers = new Set<string>()
    for (const connection of config.connections) {
      if (identifiers.has(connection.id))
        context.addIssue({ code: 'custom', message: 'Connection IDs must be unique' })
      identifiers.add(connection.id)
      if (connection.source.queue === connection.source.quarantineQueue)
        context.addIssue({
          code: 'custom',
          message: 'Source and quarantine queues must differ',
        })
      if (connection.destination.outputQueue === connection.destination.quarantineQueue)
        context.addIssue({
          code: 'custom',
          message: 'Output and quarantine queues must differ',
        })
      if (connection.mapping && connection.forwardUnmapped)
        context.addIssue({
          code: 'custom',
          message: 'Use either a connector mapping or forwardUnmapped, not both',
        })
    }
  })

export type ConnectorConfig = z.infer<typeof connectorConfigSchema>
export type ConnectionConfig = ConnectorConfig['connections'][number]
export type BrokerConfig = z.infer<typeof brokerSchema>
export type Mapping = z.infer<typeof mappingSchema>

export async function loadConfig(path: string) {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  const config = connectorConfigSchema.parse(parsed)
  const sourceQueues = new Set<string>()
  const destinationHosts = new Map<string, string>()
  const outputQueues = new Set<string>()
  for (const connection of config.connections) {
    const allowInsecure =
      connection.environment === 'sandbox' && config.allowInsecureSandbox
    const source = new URL(
      (await brokerConnection(connection.source, allowInsecure)).address
    )
    const destination = new URL(
      (await brokerConnection(connection.destination, allowInsecure)).address
    )
    const host = (url: URL) =>
      `${url.hostname}:${url.port || (url.protocol === 'amqps:' ? '5671' : '5672')}${url.pathname}`
    const sourceIdentity = `${host(source)}:${connection.source.queue}`
    const destinationIdentity = host(destination)
    const outputIdentity = `${destinationIdentity}:${connection.destination.outputQueue}`
    if (sourceQueues.has(sourceIdentity) || outputQueues.has(outputIdentity))
      throw new Error('Each connection requires exclusive source and output queues')
    const organization = destinationHosts.get(destinationIdentity)
    if (organization && organization !== connection.organizationId)
      throw new Error('Organizations cannot share a Motif virtual host')
    sourceQueues.add(sourceIdentity)
    outputQueues.add(outputIdentity)
    destinationHosts.set(destinationIdentity, connection.organizationId)
  }
  return config
}

export async function brokerConnection(config: BrokerConfig, allowInsecure: boolean) {
  const address = (await readFile(config.urlFile, 'utf8')).trim()
  const url = new URL(address)
  if (url.protocol !== 'amqps:' && !(allowInsecure && url.protocol === 'amqp:')) {
    throw new Error('TLS is required for broker connections')
  }
  if (!url.username || !url.password || !url.pathname)
    throw new Error('Explicit broker credentials and virtual host are required')
  if (Boolean(config.certificateFile) !== Boolean(config.keyFile))
    throw new Error('Client certificate and key must be configured together')
  return {
    address,
    options: {
      timeout: 10_000,
      rejectUnauthorized: true,
      ...(config.caFile ? { ca: [await readFile(config.caFile)] } : {}),
      ...(config.certificateFile
        ? { cert: await readFile(config.certificateFile) }
        : {}),
      ...(config.keyFile ? { key: await readFile(config.keyFile) } : {}),
    },
  }
}
