import { restClient } from '../rest/http.ts'
import { configureFeedReference } from './config.ts'
import { runFeedLifecycle } from './lifecycle.ts'

const config = configureFeedReference()
if (config) {
  const request = restClient(config.baseURL, config.apiKey)
  await runFeedLifecycle(config, {
    subscription: () => request('GET', '/v1/sdk/feeds/subscription'),
    configureSubscription: input => request('PUT', '/v1/sdk/feeds/subscription', input),
    assets: cursor =>
      request(
        'GET',
        `/v1/sdk/assets?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      ),
    assetByReference: reference =>
      request('GET', `/v1/sdk/assets?externalId=${encodeURIComponent(reference)}`),
    receipt: (id, source) =>
      request(
        'GET',
        `/v1/sdk/feeds/receipts/${encodeURIComponent(id)}?source=${encodeURIComponent(source)}`
      ),
    fx: asOf =>
      request(
        'GET',
        `/v1/sdk/feeds/fx?baseCurrency=EUR&quoteCurrency=USD&asOf=${encodeURIComponent(asOf)}`
      ),
    market: () => request('POST', '/v1/sdk/clarity/market-update', { language: 'en' }),
    asset: (id, language = 'en') =>
      request(
        'GET',
        `/v1/sdk/clarity/assets/${encodeURIComponent(id)}?language=${encodeURIComponent(language)}`
      ),
    portfolio: (id, language = 'en') =>
      request(
        'GET',
        `/v1/sdk/clarity/portfolios/${encodeURIComponent(id)}?language=${encodeURIComponent(language)}&window=1D`
      ),
    putSnapshot: (id, input) =>
      request('PUT', `/v1/sdk/portfolios/${encodeURIComponent(id)}`, input),
    getPortfolio: id => request('GET', `/v1/sdk/portfolios/${encodeURIComponent(id)}`),
  })
}
