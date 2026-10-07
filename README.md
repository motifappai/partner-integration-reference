# Motif partner reference implementations

Two executable versions of [Integrate insights into your app](https://motif.gitbook.io/motif-docs/integrate-with-motif/partner-data-and-insights):

- [TypeScript SDK](sdk/main.ts) calls `@motif-ai/sdk`.
- [REST API](rest/main.ts) uses Node.js `fetch`, with no SDK or runtime dependencies.

Both follow the same guide, request bodies and order. Each organization has separate sandbox and production environments. Run these examples in the sandbox, review the results with Motif, then configure your own production integration. The examples reject Motif's production host.

**SDK release status:** the example targets `0.2.0`, which contains the required methods. As checked on 7 October 2026, npm publishes only `0.1.1`–`0.1.3`; the SDK installation below will work after Motif publishes `0.2.0`. Use REST now. Maintainers can validate a packaged release using [DEVELOPMENT.md](DEVELOPMENT.md). A local package test is not verification of a published npm release.

## Run one implementation

Use Node.js 24.18 or newer. This repository works on its own; no Motif monorepo, database, workspace packages or build step is needed.

Clone the [public repository](https://github.com/motifappai/partner-integration-referenc), then configure your environment:

```bash
git clone https://github.com/motifappai/partner-integration-referenc.git
cd partner-integration-referenc
cp .env.example .env
```

Fill in the sandbox organization key from **Settings → API keys**, its organization ID, and a public HTTPS webhook URL. Keep `.env` private. Set `MOTIF_WEBHOOK_URL` to `https://your-host/webhooks/motif` and forward that route to this process on `127.0.0.1:8787` using your existing HTTPS proxy or tunnel. Motif requires a public endpoint on port 443. `MOTIF_WEBHOOK_PORT` changes the local port.

The walkthrough starts its receiver before creating the subscription. It holds the returned signing secret in memory and sends a real signed test to your public URL. A test response must report success, a `2xx` status, and receipt by this process before the walkthrough continues. Motif must separately enable event-driven insight publication in your sandbox.

Choose one:

```bash
# REST: no installation required
npm run rest
npm run rest -- --apply
```

```bash
# SDK: requires the 0.2.0 release described above
npm install --prefix sdk
npm run sdk
npm run sdk -- --apply
```

Without `--apply`, the command prints the sequence and makes no requests. Run one implementation at a time; both use the same receiver port. Each run creates a unique external account ID ending in `account-42-a` so it cannot overwrite a previous example account. The quantities and cash match GitBook; timestamps use the current observation time instead of the guide's illustrative dates.

## Follow the guide in the code

| GitBook section | What both implementations do |
| --- | --- |
| Subscribe and receive a webhook | Register `assessment.published`, configure signature verification, verify delivery of a signed test |
| Read market updates and asset insights | Read the market update, search all pages for NASDAQ `AAPL`, verify the listing, read its asset insight |
| Create a portfolio | Send revision 1: 10 Apple shares and USD 1,000 cash; retain both IDs; wait for valuation |
| Update a portfolio | Replace the complete snapshot with revision 2: 12 shares and USD 600 cash; retry the exact request; read back the valuation |
| Read portfolio insights | Use the returned portfolio ID, requesting English and window `1D` |
| Supply your own assets, prices or documents | Optional: create a custom asset, read/update it, send and correct a price, inspect history, upload and process a PDF |
| Keep the integration running | Fetch content for verified events in their language, inspect deliveries, replay a real event if available, pause/rotate/resume and retest; optionally archive the account |

`AAPL` is a stock ticker, not a Motif asset ID. The search checks its exchange and category and prints its name for review. Your integration should validate mappings against your custodian or security master and store the returned IDs. The example fails on a missing or ambiguous listing. Market and asset insight reads do not need a portfolio. Asset notifications currently require that your organization holds that asset in an active portfolio.

The two `main.ts` files show every Motif call. `rest/http.ts` adds authentication, JSON handling and a request timeout; it does not wrap SDK methods. `shared/` contains the common configuration, example snapshots, polling and receiver, with no SDK imports. REST signature verification is in `rest/signature.ts`; the SDK example uses the SDK helper.

## Optional assets, prices and documents

These flags follow [Assets, prices and documents](https://motif.gitbook.io/motif-docs/reference/asset-data). Use the same flags with `npm run sdk`:

```bash
npm run rest -- --apply --assets
npm run rest -- --apply --document=/absolute/path/factsheet.pdf
```

`--assets` searches the asset catalog, creates Private Fund A under a unique external ID, selects CUSTOM pricing, sends USD 12.50, retries that exact price, corrects it to USD 13 with revision 2 at the same timestamp, and reads the price history. The fund is separate from the Apple portfolio, exactly as in the guide's optional asset examples. It does not demonstrate revaluing multiple portfolios or complete historical performance coverage.

`--document` also enables the asset steps. Supply a sandbox PDF of at most 20 MiB. The example creates an upload session, prints the document ID, sends raw bytes with the returned storage headers (without the Motif API key), finalizes and polls for completion. A timeout or failed document exits with an error. Use the printed receipt to inspect an unfinished document; restarting the walkthrough creates a new run and document.

## Observe notifications and close an account

```bash
npm run rest -- --apply --listen-seconds=300 --archive
```

The receiver normally waits 60 seconds for real publications; choose 0–600. It verifies the original body, timestamp, endpoint, organization and event identifiers, then queues the read and acknowledges promptly. It deduplicates by `(organizationId, id)` and serializes reads. An explicitly replayed event can retry a failed read.

This small receiver keeps its queue, signing secret and deduplication records **only in memory**. In a production integration, store the subscription and secret securely, persist events before acknowledgment, and retry failed background work. See the [webhook guide](https://motif.gitbook.io/motif-docs/settings/webhooks). The sample does not provide a durable queue or automatic recovery after process termination.

Every normal exit, including a failed API step, attempts to delete this run's subscription before stopping the receiver. `--archive` also archives this run's returned portfolio ID. Otherwise the portfolio remains and its IDs are printed. An abrupt termination can leave resources behind; reconcile subscriptions by the printed run name before deleting them. Custom assets, prices and uploaded documents remain in the sandbox because no public delete endpoint exists for them.

All insight responses are printed with dates and sources. `null` research is unavailable research. Missing prices fail the valuation check; a signed test is not a research publication. The output marks optional work as `NOT EXERCISED` and missing real publications or replay receipts as `NOT OBSERVED`. A completed process is not full integration acceptance. Use [Integration acceptance](https://motif.gitbook.io/motif-docs/integrate-with-motif/implementation) to record a live pilot and production handoff.

The scope is the partner insight and data lifecycle documented above. User profiling, brokerage, strategy recommendations, chat and iframe products are separate integration guides and are not inserted into this walkthrough.

## Contributing

Keep both implementations and GitBook aligned in the same change. Add a missing documented step before adding it to an implementation. See [DEVELOPMENT.md](DEVELOPMENT.md) for checks and release preparation. A future language example should follow the same sections and payloads.
