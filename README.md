# Motif partner integration reference

This repository implements the [Motif partner connector blueprint](https://motif.gitbook.io/motif-docs/integrate-with-motif/event-data-feeds).

Your systems publish asset masters, prices and FX to **your RabbitMQ**. The **Motif connector container** forwards them to Motif and returns processing receipts and insight notifications. Portfolio snapshots and content reads use the Motif API. Your application's language and internal architecture remain outside this boundary.

The connector runs beside your broker, or Motif can run the same image for you. These are hosting placements of the same integration. Start in your organization's sandbox and move to separately provisioned production credentials after acceptance.

## Run the blueprint

1. Follow [connector provisioning and Docker setup](connector/README.md). Start the connector with your dedicated source queue and Motif-issued sandbox broker connection.
2. Copy `.env.example` to `.env`. Set `MOTIF_API_BASE_URL`, `MOTIF_API_KEY`, `MOTIF_ORG_ID` and `PARTNER_BROKER_URL_FILE`. That file contains your application-side AMQP URL for **your broker**. Keep `.env` and secret files private. No public webhook URL is needed.
3. Follow the [full lifecycle](event-feeds/README.md) using your API client language below. All implementations execute the same steps and event bodies as GitBook.

| Implementation | Entry point | Run |
| --- | --- | --- |
| REST, Node.js 24.18+ | [REST calls](event-feeds/rest.ts) | `npm ci --prefix connector`, then `npm run rest -- --apply` |
| TypeScript SDK | [SDK calls](sdk/connector.ts) | Install the SDK under `sdk/`, then `npm run sdk -- --apply` |
| Java 25 / Jakarta CDI | [Java lifecycle](java/reference/src/main/java/ai/motif/reference/ConnectorLifecycle.java) | [Build and run](java/README.md) |

Without `--apply`, each command prints the sequence and makes no Motif requests. Use one walkthrough at a time in a dedicated sandbox: subscription settings and the example listing's organization reference are shared state.

The TypeScript example targets the SDK contract on this branch, including `feeds.subscription`, `feeds.configureSubscription`, `feeds.receipt` and `feeds.fxRate`. Use a published SDK containing those methods for a live sandbox. Maintainers can validate the packaged candidate through [DEVELOPMENT.md](DEVELOPMENT.md); a local package test does not verify npm publication. Java's SDK is generated from the same OpenAPI contract and distributed as source here, not as a claimed Maven Central release.

## What the lifecycle demonstrates

1. Subscribe to market, asset and portfolio publication events over the connector's return path.
2. Browse the asset universe and select the exact Apple NASDAQ listing. Store its partner reference through a master event; explicitly create a custom fund through another master event.
3. Publish a decimal price, retry the identical event, correct it with a higher revision, publish FX, and wait for applied receipts.
4. Read market and asset insights without creating a portfolio first.
5. PUT revision 1: ten Apple shares, five custom fund units and USD 1,000 cash. Wait for complete valuation.
6. PUT revision 2: twelve Apple shares, five fund units and USD 600 cash. Retry the exact snapshot and read portfolio insights.
7. Fetch content when publication events arrive, journal received events and reconcile a processing receipt through the API. Restore the prior subscription on exit.

`AAPL` is a ticker, not a Motif asset ID. The catalog returns the asset ID, name, category and exchange. An ISIN must first be resolved to the exact listing using your security master or custodian. Motif does not currently provide ISIN resolution. A missing or ambiguous match stops the example; it never guesses or silently creates an instrument.

The fund price is illustrative sandbox data. Its correction to USD 13 makes five units worth USD 65. FX is stored and readable; automatic cross-currency valuation, historical import, position PnL and Illio backtesting are not implemented by this walkthrough. Live price events accept observations from the current UTC day.

The API, broker topology and feeds worker must be deployed and provisioned in the sandbox before the live run. A locally passing test, processing receipt or broker confirmation does not prove that research was published. The walkthrough reports `NOT OBSERVED` when no real publication arrives. Assets, mappings and the example portfolio remain for inspection. The operator must reconcile any abrupt termination before reusing that sandbox.

See [connector operations and verification](connector/README.md) and [maintainer development checks](DEVELOPMENT.md).
