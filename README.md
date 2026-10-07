# Motif partner reference implementations

Three executable versions of [Integrate insights into your app](https://motif.gitbook.io/motif-docs/integrate-with-motif/partner-data-and-insights):

- [TypeScript SDK](sdk/main.ts) calls `@motif-ai/sdk`.
- [REST API](rest/main.ts) uses Node.js `fetch`, with no SDK or runtime dependencies.
- [Java 25 / Jakarta](java/README.md) uses the Java SDK in a Jakarta REST/CDI application.

All three follow the same guide, request bodies and order. Each organization has separate sandbox and production environments. Run these examples in the sandbox, review the results with Motif, then configure your own production integration. The examples reject Motif's production host.

**SDK version:** the TypeScript example requires `@motif-ai/sdk@0.2.0`. Publication is pending npm publisher access; use the REST implementation until it is available. The asset-reference PATCH and exact `externalId` filter require the matching API release in your sandbox.

## Run one implementation

For TypeScript and REST, use Node.js 24.18 or newer; neither needs a build step. For Java, follow the [Java build and run instructions](java/README.md) with JDK 25 and Maven 3.9+. This repository works independently of the Motif monorepo, database and workspace packages.

Clone the [public repository](https://github.com/motifappai/partner-integration-reference), then configure your environment:

```bash
git clone https://github.com/motifappai/partner-integration-reference.git
cd partner-integration-reference
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
# TypeScript SDK: after 0.2.0 is published
npm install --prefix sdk
npm run sdk
npm run sdk -- --apply
```

Without `--apply`, the command prints the sequence and makes no requests. Run one implementation at a time; all use the same receiver port. Each run creates a unique external account ID ending in `account-42-a` so it cannot overwrite a previous example account. The quantities and cash match GitBook; timestamps use the current observation time instead of the guide's illustrative dates.

## Follow the guide in the code

| GitBook section | What all implementations do |
| --- | --- |
| Subscribe and receive a webhook | Register `assessment.published`, configure signature verification, verify delivery of a signed test |
| Discover and map assets | Paginate the full visible catalog, match NASDAQ `AAPL`, keep a local mapping or store your reference in Motif; optionally create and price an unmatched custom instrument |
| Read market updates and asset insights | Read the market update and selected asset insight |
| Create a portfolio | Send revision 1: 10 Apple shares and USD 1,000 cash (plus five custom fund units with `--assets`); retain both IDs; wait for valuation |
| Update a portfolio | Replace the complete snapshot with revision 2: 12 shares and USD 600 cash; retry the exact request; read back the valuation |
| Read portfolio insights | Use the returned portfolio ID, requesting English and window `1D` |
| Keep the integration running | Fetch content for verified events in their language, inspect deliveries, replay a real event if available, pause/rotate/resume and retest; optionally archive the account |

The catalog lists available public and organization-private instruments, not guaranteed pricing or research coverage. `AAPL` is a ticker, not a Motif asset ID. The example paginates without a search query, checks exchange and category, and prints the name for review. Missing or ambiguous listings stop the run. If your source contains an ISIN, resolve the exact listing through your custodian/security master; Motif does not currently resolve ISINs. Do not automatically create a custom instrument for an uncertain match.

Choose where to keep your verified mapping:

```bash
npm run rest -- --apply --mapping=local
npm run rest -- --apply --mapping=motif
```

`local` is the default: the example prints your reference and Motif asset ID for storage in your own database. `motif` PATCHes an organization-specific `externalId`, then confirms it with an exact lookup. It supplies USD on first configuration and preserves the price provider. It verifies the exact reference returned by the API and refuses to overwrite an existing reference; use local mode on subsequent runs or deliberately reconcile that mapping first. A stored reference remains after exit. Your production reference should be stable, such as a security-master listing ID; this sandbox example uses a unique run prefix. References are unique per organization, not global, and a bare ISIN may need a listing suffix if you hold several listings.

All snapshots use `{type: 'ASSET', assetId}` for the chosen instruments. Market and asset insight reads do not need a portfolio. Asset notifications currently require that your organization holds that asset in an active portfolio.

The two `main.ts` files and Java’s [`Lifecycle`](java/reference/src/main/java/ai/motif/reference/Lifecycle.java) show every Motif call. `rest/http.ts` adds authentication, JSON handling and a request timeout; it does not wrap SDK methods. `shared/` contains the common configuration, example snapshots, polling and receiver, with no SDK imports. REST signature verification is in `rest/signature.ts`; the SDK example uses the SDK helper.

## Optional assets, prices and documents

These flags follow [Assets, prices and documents](https://motif.gitbook.io/motif-docs/reference/asset-data). Use the same flags with `npm run sdk`:

```bash
npm run rest -- --apply --assets
npm run rest -- --apply --document=/absolute/path/factsheet.pdf
```

`--assets` checks an exact external reference (and rejects a response for a different reference or category), creates Private Fund A if absent, selects CUSTOM pricing, sends USD 12.50, retries that exact price, corrects it to USD 13 with revision 2 at the same timestamp, and reads the price history. This happens during discovery, before portfolio creation. Both snapshots include five units of the fund alongside Apple, exactly as in the guide's optional holdings flow. At the corrected USD 13 price, those five units are worth USD 65. It does not demonstrate revaluing multiple portfolios or complete historical performance coverage.

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

Keep all three implementations and GitBook aligned in the same change. Add a missing documented step before adding it to an implementation. See [DEVELOPMENT.md](DEVELOPMENT.md) for checks and release preparation. Additional language examples should follow the same sections and payloads.
