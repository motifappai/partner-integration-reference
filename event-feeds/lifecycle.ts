import { snapshot } from '../shared/config.ts'
import { array, record, show, text } from '../shared/values.ts'
import { waitForCalculation } from '../shared/wait.ts'
import { partnerBroker } from './broker.ts'
import type { FeedReferenceConfig } from './config.ts'

export interface FeedReferenceApi {
  subscription(): Promise<unknown>
  configureSubscription(input: {
    enabled: boolean
    surfaces: ('MARKET' | 'ASSET' | 'PORTFOLIO')[]
    language: string
  }): Promise<unknown>
  assets(cursor?: string): Promise<unknown>
  assetByReference(externalId: string): Promise<unknown>
  receipt(id: string, source: string): Promise<unknown>
  fx(asOf: string): Promise<unknown>
  market(): Promise<unknown>
  asset(id: string, language?: string): Promise<unknown>
  portfolio(id: string, language?: string): Promise<unknown>
  putSnapshot(externalId: string, input: ReturnType<typeof snapshot>): Promise<unknown>
  getPortfolio(externalId: string): Promise<unknown>
}
export async function runFeedLifecycle(
  config: FeedReferenceConfig,
  api: FeedReferenceApi
) {
  const prior = record(await api.subscription())
  const restore = {
    enabled: prior.enabled === true,
    surfaces: array(prior.surfaces).map(surface => {
      if (surface !== 'MARKET' && surface !== 'ASSET' && surface !== 'PORTFOLIO')
        throw new Error('Unknown subscription surface')
      return surface
    }),
    language: text(prior.language),
  }
  const broker = await partnerBroker(config, async publication => {
    const language = text(publication.language)
    const subjectId = text(publication.subjectId)
    if (publication.surface === 'MARKET') show('Market publication', await api.market())
    else if (publication.surface === 'ASSET')
      show('Asset publication', await api.asset(subjectId, language))
    else if (publication.surface === 'PORTFOLIO')
      show('Portfolio publication', await api.portfolio(subjectId, language))
    else throw new Error('Unknown publication surface')
  })
  try {
    show(
      '1. Subscribe',
      await api.configureSubscription({
        enabled: true,
        surfaces: ['MARKET', 'ASSET', 'PORTFOLIO'],
        language: 'en',
      })
    )
    let cursor: string | undefined
    const matches: Record<string, unknown>[] = []
    do {
      const page = record(await api.assets(cursor))
      for (const candidate of array(page.assets).map(record))
        if (
          candidate.symbol === 'AAPL' &&
          candidate.category === 'EQUITY' &&
          candidate.exchange === 'NASDAQ'
        )
          matches.push(candidate)
      cursor = page.nextCursor ? text(page.nextCursor) : undefined
    } while (cursor)
    const apple = matches[0]
    if (matches.length !== 1 || !apple)
      throw new Error('Resolve the exact AAPL NASDAQ listing before continuing')
    if (apple.externalId)
      throw new Error(
        'This listing already has a partner reference; use a clean sandbox or reconcile the mapping'
      )
    show('2. Verified catalog listing', apple)
    const appleId = text(apple.id)
    const appleReference = `${config.runId}-apple`
    const privateReference = `${config.runId}-fund`
    const asOf = new Date().toISOString()
    const publish = (
      id: string,
      type: string,
      subject: string,
      data: Record<string, unknown>
    ) =>
      broker.publish(`${config.runId}-${id}`, type, subject, {
        ...data,
        asOf,
        revision: 1,
      })
    await publish('master-apple', 'ai.motif.asset.master.v1', appleReference, {
      externalId: appleReference,
      action: 'MAP_EXISTING',
      assetId: appleId,
      currency: 'USD',
      priceProvider: 'MARKET',
    })
    const fundReceipt = await publish(
      'master-fund',
      'ai.motif.asset.master.v1',
      privateReference,
      {
        externalId: privateReference,
        action: 'CREATE_CUSTOM',
        name: 'Private Fund A',
        symbol: 'PRIVATE-A',
        currency: 'USD',
        priceProvider: 'CUSTOM',
      }
    )
    const fundId = text(fundReceipt.resourceId)
    show('3. Stored mapping', await api.assetByReference(appleReference))
    const price = {
      externalId: privateReference,
      unitPrice: '12.50',
      currency: 'USD',
      priceType: 'CLOSE',
      adjustment: 'UNADJUSTED',
      asOf,
      revision: 1,
    }
    const priceId = `${config.runId}-price`
    show(
      'Applied price',
      await broker.publish(priceId, 'ai.motif.asset.price.v1', privateReference, price)
    )
    show(
      'Duplicate price',
      await broker.publish(priceId, 'ai.motif.asset.price.v1', privateReference, price)
    )
    await broker.publish(
      `${priceId}-correction`,
      'ai.motif.asset.price.v1',
      privateReference,
      { ...price, revision: 2, unitPrice: '13.00' }
    )
    await publish('fx', 'ai.motif.fx.rate.v1', 'EUR/USD', {
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: '1.10',
      rateType: 'MID',
    })
    show('Stored FX observation (not automatic conversion)', await api.fx(asOf))
    show('4. Market update', await api.market())
    show('Asset insight', await api.asset(appleId))
    const externalId = `${config.runId}-account-42-a`
    const first = record(
      await api.putSnapshot(externalId, snapshot(1, appleId, fundId))
    )
    show('5. Portfolio receipt', first)
    await waitForCalculation(() => api.getPortfolio(externalId), 1)
    const second = snapshot(2, appleId, fundId)
    await api.putSnapshot(externalId, second)
    show('6. Duplicate portfolio snapshot', await api.putSnapshot(externalId, second))
    await waitForCalculation(() => api.getPortfolio(externalId), 2)
    show('Portfolio insight', await api.portfolio(text(first.portfolioId)))
    show(
      '7. Reconciled feed receipt',
      await api.receipt(priceId, `urn:partner:${config.runId}`)
    )
    const publications = await broker.listen(config.listenSeconds)
    show('Publication observation', {
      publications,
      status: publications ? 'OBSERVED' : 'NOT OBSERVED',
      journal: config.receiptFile,
    })
    console.log(
      `Sandbox portfolio and mappings retained: ${externalId}. Subscription will be restored.`
    )
  } finally {
    try {
      await api.configureSubscription(restore)
    } finally {
      await broker.close()
    }
  }
}
