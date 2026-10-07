import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { restClient } from './http.ts'
import { verifySignature } from './signature.ts'
import { configure, snapshot } from '../shared/config.ts'
import type { AssessmentPublishedEvent } from '../shared/event.ts'
import { startWebhookReceiver } from '../shared/receiver.ts'
import { array, record, show, text } from '../shared/values.ts'
import { waitForCalculation, waitForDocument } from '../shared/wait.ts'

async function main() {
  const config = configure()
  if (!config) return
  const request = restClient(config.baseURL, config.apiKey)

  async function readPublication(event: AssessmentPublishedEvent) {
    const { surface, subjectId, language } = event.data
    if (surface === 'MARKET')
      show(
        'Market publication',
        await request('POST', '/v1/sdk/clarity/market-update', { language })
      )
    else if (surface === 'ASSET')
      show(
        'Asset publication',
        await request(
          'GET',
          `/v1/sdk/clarity/assets/${encodeURIComponent(subjectId)}?${new URLSearchParams({ language })}`
        )
      )
    else
      show(
        'Portfolio publication',
        await request(
          'GET',
          `/v1/sdk/clarity/portfolios/${encodeURIComponent(subjectId)}?${new URLSearchParams({ language, window: '1D' })}`
        )
      )
  }

  let documentBytes: Buffer<ArrayBuffer> | undefined
  if (config.document) {
    documentBytes = await readFile(config.document)
    if (
      !config.document.toLowerCase().endsWith('.pdf') ||
      !documentBytes.length ||
      documentBytes.length > 20 * 1024 * 1024
    ) {
      throw new Error('Use a nonempty sandbox PDF of at most 20 MiB')
    }
  }

  const receiver = await startWebhookReceiver({
    organizationId: config.organizationId,
    port: config.port,
    verifySignature,
    onAssessment: readPublication,
  })
  let subscriptionId: string | undefined
  let portfolioId: string | undefined

  async function testSubscription(id: string) {
    const before = receiver.testCount()
    const delivery = record(
      await request('POST', `/v1/sdk/webhooks/${encodeURIComponent(id)}/test`)
    )
    if (
      delivery.success !== true ||
      typeof delivery.statusCode !== 'number' ||
      delivery.statusCode < 200 ||
      delivery.statusCode >= 300 ||
      receiver.testCount() <= before
    ) {
      throw new Error('Signed test did not succeed at this receiver')
    }
    show('Signed test received and verified', delivery)
  }

  try {
    console.log('\n1. Subscribe and receive a webhook')
    const subscription = record(
      await request('POST', '/v1/sdk/webhooks', {
        name: config.runId,
        url: config.webhookUrl,
        events: ['assessment.published'],
      })
    )
    subscriptionId = text(subscription.id)
    receiver.configure({ id: subscriptionId, secret: text(subscription.secret) })
    show('Subscription ID (secret held in memory)', subscriptionId)
    await testSubscription(subscriptionId)

    console.log('\n2. Discover and map assets')
    let cursor: string | undefined
    let assetId: string | undefined
    do {
      const candidates = record(
        await request(
          'GET',
          `/v1/sdk/assets?${new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) })}`
        )
      )
      for (const candidate of array(candidates.assets)) {
        const asset = record(candidate)
        if (
          asset.symbol === 'AAPL' &&
          asset.exchange === 'NASDAQ' &&
          asset.category === 'EQUITY'
        ) {
          if (assetId && assetId !== text(asset.id))
            throw new Error(
              'More than one NASDAQ AAPL listing; resolve the instrument mapping before continuing'
            )
          assetId = text(asset.id)
          if (config.mapping === 'motif' && asset.externalId != null)
            throw new Error(
              'This listing already has an external reference; preserve it and use --mapping=local'
            )
          show('Selected Apple listing; verify name and exchange', asset)
        }
      }
      cursor = candidates.nextCursor == null ? undefined : text(candidates.nextCursor)
    } while (cursor)
    if (!assetId)
      throw new Error(
        'No NASDAQ AAPL equity in the catalog; resolve the listing with Motif'
      )
    const externalAssetId = `${config.runId}-security-apple`
    if (config.mapping === 'motif') {
      await request('PATCH', `/v1/sdk/assets/${encodeURIComponent(assetId)}`, {
        externalId: externalAssetId,
        currency: 'USD',
      })
      const mapped = record(
        await request(
          'GET',
          `/v1/sdk/assets?${new URLSearchParams({ externalId: externalAssetId, limit: '1' })}`
        )
      )
      const stored = record(array(mapped.assets)[0])
      if (stored.id !== assetId) throw new Error('Asset mapping was not persisted')
      show('Organization asset reference stored in Motif', stored)
    } else {
      show('Save this mapping in your own instrument database', {
        externalId: externalAssetId,
        assetId,
      })
    }
    let customAssetId: string | undefined
    if (config.assets) {
      console.log('Create an unmatched custom instrument and supply prices')
      const customExternalId = `${config.runId}-private-fund-a`
      const existing = record(
        await request(
          'GET',
          `/v1/sdk/assets?${new URLSearchParams({ externalId: customExternalId, limit: '1' })}`
        )
      )
      const customAsset = record(
        array(existing.assets)[0] ??
          (await request('POST', '/v1/sdk/assets', {
            externalId: customExternalId,
            name: 'Private Fund A',
            symbol: 'PFA',
            currency: 'USD',
            description: 'Partner supplied private fund units',
          }))
      )
      customAssetId = text(customAsset.id)
      show(
        'Custom asset',
        await request('GET', `/v1/sdk/assets/${encodeURIComponent(customAssetId)}`)
      )
      await request('PATCH', `/v1/sdk/assets/${encodeURIComponent(customAssetId)}`, {
        currency: 'USD',
        priceProvider: 'CUSTOM',
      })
      const price = {
        asOf: new Date().toISOString(),
        revision: 1,
        unitPrice: '12.50',
        currency: 'USD',
      }
      await request(
        'PUT',
        `/v1/sdk/assets/${encodeURIComponent(customAssetId)}/prices`,
        price
      )
      await request(
        'PUT',
        `/v1/sdk/assets/${encodeURIComponent(customAssetId)}/prices`,
        price
      )
      await request(
        'PUT',
        `/v1/sdk/assets/${encodeURIComponent(customAssetId)}/prices`,
        { ...price, revision: 2, unitPrice: '13' }
      )
      show(
        'Price history after an identical retry and dated correction',
        await request(
          'GET',
          `/v1/sdk/assets/${encodeURIComponent(customAssetId)}/prices?limit=50`
        )
      )
      if (config.document && documentBytes) {
        const upload = record(
          await request(
            'POST',
            `/v1/sdk/assets/${encodeURIComponent(customAssetId)}/documents`,
            {
              fileName: basename(config.document),
              mimeType: 'application/pdf',
              sizeBytes: documentBytes.byteLength,
            }
          )
        )
        const documentId = text(upload.documentId)
        show('Save document receipt', { assetId: customAssetId, documentId })
        const headers = new Headers()
        for (const [name, value] of Object.entries(record(upload.headers)))
          headers.set(name, text(value))
        const stored = await fetch(text(upload.uploadUrl), {
          method: 'PUT',
          headers,
          body: documentBytes,
          signal: AbortSignal.timeout(30_000),
          redirect: 'error',
        })
        if (!stored.ok) throw new Error(`Storage upload failed: HTTP ${stored.status}`)
        await request(
          'POST',
          `/v1/sdk/assets/${encodeURIComponent(customAssetId)}/documents/${encodeURIComponent(documentId)}/finalize`
        )
        const documentAssetId = customAssetId
        await waitForDocument(() =>
          request(
            'GET',
            `/v1/sdk/assets/${encodeURIComponent(documentAssetId)}/documents/${encodeURIComponent(documentId)}`
          )
        )
      }
      if (!config.document)
        console.log('NOT EXERCISED: optional document upload (use --document).')
    } else
      console.log(
        'NOT EXERCISED: optional assets, prices and documents (use --assets / --document).'
      )

    console.log('\n3. Read market updates and asset insights')
    show(
      'Market update; null means not yet available',
      await request('POST', '/v1/sdk/clarity/market-update', { language: 'en' })
    )
    show(
      'Asset insight; null means not yet available',
      await request(
        'GET',
        `/v1/sdk/clarity/assets/${encodeURIComponent(assetId)}?language=en`
      )
    )

    console.log('\n4. Create a portfolio')
    const initialSnapshot = snapshot(1, assetId, customAssetId)
    show('Initial complete snapshot', initialSnapshot)
    const receipt = record(
      await request(
        'PUT',
        `/v1/sdk/portfolios/${encodeURIComponent(config.externalId)}`,
        initialSnapshot
      )
    )
    portfolioId = text(receipt.portfolioId)
    show('Store externalId → portfolioId', {
      externalId: config.externalId,
      ...receipt,
    })
    await waitForCalculation(
      () =>
        request('GET', `/v1/sdk/portfolios/${encodeURIComponent(config.externalId)}`),
      1
    )

    console.log('\n5. Update a portfolio')
    const updatedSnapshot = snapshot(2, assetId, customAssetId)
    show('Replacement complete snapshot', updatedSnapshot)
    await request(
      'PUT',
      `/v1/sdk/portfolios/${encodeURIComponent(config.externalId)}`,
      updatedSnapshot
    )
    await request(
      'PUT',
      `/v1/sdk/portfolios/${encodeURIComponent(config.externalId)}`,
      updatedSnapshot
    )
    await waitForCalculation(
      () =>
        request('GET', `/v1/sdk/portfolios/${encodeURIComponent(config.externalId)}`),
      2
    )

    console.log('\n6. Read portfolio insights')
    show(
      'Portfolio insight; card/read may be null',
      await request(
        'GET',
        `/v1/sdk/clarity/portfolios/${encodeURIComponent(portfolioId)}?language=en&window=1D`
      )
    )

    console.log('\n7. Keep the integration running')
    console.log(
      `Waiting ${config.listenSeconds}s for real publications; a signed test does not generate research.`
    )
    await setTimeout(config.listenSeconds * 1000)
    await receiver.drain()
    const history = record(
      await request(
        'GET',
        `/v1/sdk/webhooks/${encodeURIComponent(subscriptionId)}/deliveries?limit=50`
      )
    )
    show('Webhook delivery history', history)
    const assessment = array(history.deliveries)
      .map(record)
      .find(delivery => delivery.event === 'assessment.published')
    if (assessment) {
      const previousCounts = new Map(
        receiver
          .assessments()
          .map(received => [
            received.event.id,
            receiver.deliveryCount(received.event.id),
          ])
      )
      const replay = record(
        await request(
          'POST',
          `/v1/sdk/webhooks/${encodeURIComponent(subscriptionId)}/deliveries/${encodeURIComponent(text(assessment.id))}/replay`
        )
      )
      const eventId = text(replay.eventId)
      const previousCount = previousCounts.get(eventId) ?? 0
      show('Replay queued', replay)
      const deadline = Date.now() + 120_000
      while (receiver.deliveryCount(eventId) <= previousCount && Date.now() < deadline)
        await setTimeout(2000)
      if (receiver.deliveryCount(eventId) <= previousCount)
        console.log('NOT OBSERVED: replay delivery within two minutes')
      else console.log('Replay received; duplicate event is not processed twice')
    } else console.log('NOT EXERCISED: replay requires a real delivered assessment')
    await request('PATCH', `/v1/sdk/webhooks/${encodeURIComponent(subscriptionId)}`, {
      enabled: false,
    })
    const rotated = record(
      await request(
        'POST',
        `/v1/sdk/webhooks/${encodeURIComponent(subscriptionId)}/rotate-secret`
      )
    )
    receiver.configure({ id: subscriptionId, secret: text(rotated.secret) })
    await request('PATCH', `/v1/sdk/webhooks/${encodeURIComponent(subscriptionId)}`, {
      enabled: true,
    })
    await testSubscription(subscriptionId)
    await receiver.drain()
    show('Publication processing results', receiver.assessments())
    for (const surface of ['MARKET', 'ASSET', 'PORTFOLIO']) {
      if (
        !receiver
          .assessments()
          .some(received => received.event.data.surface === surface)
      )
        console.log(`NOT OBSERVED: real ${surface} publication`)
    }
    if (receiver.assessments().some(received => received.status === 'FAILED'))
      throw new Error('A publication could not be read; inspect processing results')
    console.log(
      'Walkthrough complete. Null content and NOT OBSERVED / NOT EXERCISED results remain unverified.'
    )
  } finally {
    try {
      if (subscriptionId) {
        await request(
          'DELETE',
          `/v1/sdk/webhooks/${encodeURIComponent(subscriptionId)}`
        )
        console.log(`Deleted this run’s subscription ${subscriptionId}`)
      }
    } finally {
      await receiver.close()
      if (portfolioId && config.archive) {
        await request(
          'POST',
          `/v1/sdk/portfolios/by-id/${encodeURIComponent(portfolioId)}/archive`
        )
        console.log(`Archived this run’s portfolio ${portfolioId}`)
      } else if (portfolioId)
        show('Retained sandbox portfolio', {
          externalId: config.externalId,
          portfolioId,
        })
      console.log(
        'Custom assets and documents, if created, remain in the sandbox; there is no public deletion endpoint.'
      )
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
