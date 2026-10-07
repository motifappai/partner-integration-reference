import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

export const guideUrl =
  'https://motif.gitbook.io/motif-docs/integrate-with-motif/partner-data-and-insights'
export const steps = [
  'Subscribe and receive a webhook',
  'Discover and map assets (optionally add custom instruments)',
  'Read market updates and asset insights',
  'Create a portfolio',
  'Update a portfolio',
  'Read portfolio insights',
  'Keep the integration running',
]

export function sandboxUrl(value: string) {
  const url = new URL(value)
  const hostname = url.hostname.replace(/\.+$/, '').toLowerCase()
  if (hostname === 'backend.motifapp.ai')
    throw new Error('Use the sandbox for reference data')
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Use a plain API base URL')
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    )
  ) {
    throw new Error('Use HTTPS, or HTTP on localhost')
  }
  if (url.pathname.replace(/\/$/, '') !== '/api')
    throw new Error('API base URL must end in /api')
  return url.href.replace(/\/$/, '')
}

export function configure() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter(argument => argument !== '--'),
    options: {
      apply: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      assets: { type: 'boolean', default: false },
      mapping: { type: 'string', default: 'local' },
      document: { type: 'string' },
      archive: { type: 'boolean', default: false },
      'listen-seconds': { type: 'string', default: '60' },
    },
  })
  console.log(`Guide: ${guideUrl}\n${steps.join('\n')}`)
  if (!values.apply || values.help) {
    console.log(
      'Preview only; no requests. --apply executes the guide. --mapping=local keeps asset references locally; --mapping=motif stores them in Motif. --assets adds a custom holding and prices; --document=/path/factsheet.pdf adds its upload. --archive closes this run’s account. --listen-seconds=60 waits for publications (0–600).'
    )
    return
  }
  if (!['local', 'motif'].includes(values.mapping))
    throw new Error('Use --mapping=local or --mapping=motif')
  const baseURL = sandboxUrl(
    process.env.MOTIF_API_BASE_URL || 'https://staging.backend.motifapp.ai/api'
  )
  const apiKey = process.env.MOTIF_API_KEY
  const organizationId = process.env.MOTIF_ORG_ID
  const webhookUrl = process.env.MOTIF_WEBHOOK_URL
  if (!apiKey || !organizationId || !webhookUrl)
    throw new Error('Set MOTIF_API_KEY, MOTIF_ORG_ID and MOTIF_WEBHOOK_URL')
  const receiverUrl = new URL(webhookUrl)
  if (
    receiverUrl.protocol !== 'https:' ||
    receiverUrl.port ||
    receiverUrl.username ||
    receiverUrl.password ||
    receiverUrl.pathname !== '/webhooks/motif' ||
    receiverUrl.search ||
    receiverUrl.hash
  ) {
    throw new Error(
      'MOTIF_WEBHOOK_URL must be HTTPS on port 443 with path /webhooks/motif'
    )
  }
  const port = Number(process.env.MOTIF_WEBHOOK_PORT || '8787')
  const listenSeconds = Number(values['listen-seconds'])
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid receiver port')
  if (!Number.isInteger(listenSeconds) || listenSeconds < 0 || listenSeconds > 600)
    throw new Error('Invalid listen-seconds (0–600)')
  const runId = `reference-${randomUUID()}`
  const externalId = `${runId}-account-42-a`
  console.log(`Sandbox: ${baseURL}\nAccount external ID: ${externalId}`)
  return {
    baseURL,
    apiKey,
    organizationId,
    webhookUrl,
    port,
    listenSeconds,
    runId,
    externalId,
    mapping: values.mapping,
    assets: values.assets || Boolean(values.document),
    document: values.document,
    archive: values.archive,
  }
}

export function snapshot(revision: 1 | 2, assetId: string, customAssetId?: string) {
  return {
    revision,
    asOf: new Date().toISOString(),
    currency: 'USD',
    cash: revision === 1 ? '1000' : '600',
    holdings: [
      {
        instrument: {
          type: 'ASSET' as const,
          assetId,
        },
        quantity: revision === 1 ? '10' : '12',
        currency: 'USD',
      },
      ...(customAssetId
        ? [
            {
              instrument: { type: 'ASSET' as const, assetId: customAssetId },
              quantity: '5',
              currency: 'USD',
            },
          ]
        : []),
    ],
  }
}
