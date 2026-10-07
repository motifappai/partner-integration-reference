import { createClient } from '@motif-ai/sdk'
import { configureFeedReference } from '../event-feeds/config.ts'
import { runFeedLifecycle } from '../event-feeds/lifecycle.ts'

const config = configureFeedReference()
if (config) {
  const motif = createClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: 30_000,
  })
  await runFeedLifecycle(config, {
    subscription: () => motif.feeds.subscription(),
    configureSubscription: input => motif.feeds.configureSubscription(input),
    assets: cursor => motif.assets.list({ cursor, limit: 100 }),
    assetByReference: externalId => motif.assets.list({ externalId }),
    receipt: (id, source) => motif.feeds.receipt(id, { source }),
    fx: asOf => motif.feeds.fxRate({ baseCurrency: 'EUR', quoteCurrency: 'USD', asOf }),
    market: () => motif.clarity.marketUpdate({ language: 'en' }),
    asset: (id, language = 'en') => motif.clarity.assetById(id, { language }),
    portfolio: (id, language = 'en') =>
      motif.clarity.portfolioById(id, { language, window: '1D' }),
    putSnapshot: (id, input) => motif.portfolios.putSnapshot(id, input),
    getPortfolio: id => motif.portfolios.get(id),
  })
}
