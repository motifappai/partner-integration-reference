import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { sandboxUrl } from '../shared/config.ts'

export const blueprintSteps = [
  '1. Start the connector and subscribe to broker notifications',
  '2. Discover and map a supported asset; create a custom instrument',
  '3. Publish asset masters, prices and FX to the partner broker; await applied receipts',
  '4. Read market and asset insights',
  '5. PUT a portfolio snapshot and wait for valuation',
  '6. Replace the snapshot, retry it and read portfolio insights',
  '7. Receive publication events, fetch content and reconcile receipts',
]
export function configureFeedReference() {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      'listen-seconds': { type: 'string', default: '60' },
    },
  })
  console.log(
    `https://motif.gitbook.io/motif-docs/integrate-with-motif/event-data-feeds\n${blueprintSteps.join('\n')}`
  )
  if (!values.apply) {
    console.log(
      'Preview only. Use --apply against a provisioned sandbox with the connector running.'
    )
    return
  }
  const required = (name: string) => {
    const value = process.env[name]
    if (!value) throw new Error(`Set ${name}`)
    return value
  }
  const listenSeconds = Number(values['listen-seconds'])
  if (!Number.isInteger(listenSeconds) || listenSeconds < 0 || listenSeconds > 600)
    throw new Error('listen-seconds must be 0–600')
  const runId = `reference-${randomUUID()}`
  return {
    apiKey: required('MOTIF_API_KEY'),
    organizationId: required('MOTIF_ORG_ID'),
    baseURL: sandboxUrl(
      process.env.MOTIF_API_BASE_URL || 'https://staging.backend.motifapp.ai/api'
    ),
    sourceUrlFile: required('PARTNER_BROKER_URL_FILE'),
    sourceCaFile: process.env.PARTNER_BROKER_CA_FILE,
    insecureLocal: process.env.MOTIF_LOCAL_BROKER === 'true',
    listenSeconds,
    runId,
    receiptFile: `.local/${runId}.jsonl`,
  }
}
export type FeedReferenceConfig = NonNullable<ReturnType<typeof configureFeedReference>>
