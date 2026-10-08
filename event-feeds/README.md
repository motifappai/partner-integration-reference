# Connector lifecycle

This is the executable version of the [GitBook blueprint](https://motif.gitbook.io/motif-docs/integrate-with-motif/event-data-feeds). The connector container, the Motif feeds service and the matching public API must be running before `--apply`.

## One sequence

| Step | Partner action | Confirmation |
| --- | --- | --- |
| Subscribe | PUT `/v1/sdk/feeds/subscription`; consume `partner.output` | Subscription readback; real publications observed separately |
| Discover | GET `/v1/sdk/assets`, following every cursor | One exact AAPL/NASDAQ/EQUITY listing; no ambiguous match |
| Map and create | Publish `ai.motif.asset.master.v1` to `partner.input`, key `events` | `APPLIED` receipts with Motif asset IDs |
| Price and FX | Publish `ai.motif.asset.price.v1` and `ai.motif.fx.rate.v1` to the same exchange | Applied receipts, correction revision, authorized FX read |
| Read content | Read market update and asset insight | Dated content or explicit unavailable research |
| Portfolio | PUT full snapshot to `/v1/sdk/portfolios/{externalId}` | Receipt followed by complete calculated revision |
| Update | Replace full snapshot with revision 2; retry identical payload | Idempotent receipt and updated valuation |
| Reconcile | Read portfolio insight, process publication events, GET a feed receipt | Stored outcome and a local durable event journal |

The REST adapter is [rest.ts](rest.ts), the TypeScript adapter is [sdk/connector.ts](../sdk/connector.ts), and their common lifecycle is [lifecycle.ts](lifecycle.ts). [Java/Jakarta](../java/README.md) uses the generated Java SDK and the same partner-side broker protocol. These are language implementations of the same blueprint.

## Configuration

```dotenv
MOTIF_API_BASE_URL=https://staging.backend.motifapp.ai/api
MOTIF_API_KEY=YOUR_SANDBOX_ORGANIZATION_KEY
MOTIF_ORG_ID=YOUR_SANDBOX_ORGANIZATION_ID
PARTNER_BROKER_URL_FILE=/absolute/private/path/application.url
PARTNER_BROKER_CA_FILE=/absolute/private/path/partner-ca.pem
```

Omit `PARTNER_BROKER_CA_FILE` for a publicly trusted certificate. Java uses the JVM trust store (`javax.net.ssl.trustStore`) for a private CA. `MOTIF_LOCAL_BROKER=true` permits local test AMQP; production broker connections use TLS. Broker credentials are separate from the Motif API key. The connector and application have different broker users.

```bash
npm ci --prefix connector
npm run rest
npm run rest -- --apply --listen-seconds=60
```

The SDK command is `npm run sdk -- --apply --listen-seconds=60` after installing a compatible SDK under `sdk/`. Both Node implementations need the connector's broker dependency installed. Java has its own broker client and does not require Node to run.

Required and optional fields for each event and the snapshot are listed in [Data feeds](https://motif.gitbook.io/motif-docs/data-feeds/data-feeds); [partner-events.schema.json](partner-events.schema.json) is the machine-readable event contract. The source examples under `examples/` illustrate the contract; the live walkthrough supplies a catalog ID and current timestamps. Financial quantities and prices stay decimal strings. Use a stable listing reference, not a display name. Master events explicitly choose mapping or custom creation; prices reference that identity.

The receiver writes and flushes each event to `.local/<run-id>.jsonl` before acknowledgment. It fetches published content before acknowledging publication events. A failure closes the connection, leaving unacknowledged work at the broker. Receipts are also available through Motif's receipt API. Production consumers should reconcile journaled work and deduplicate by event ID when resuming; the demo starts a new run ID each time and does not implement your application's business database.

Run once in a clean sandbox: an existing Apple reference stops the demonstration to avoid overwriting it. A normal exit restores the previous broker subscription. The custom instrument, prices, FX, mapping and portfolio remain for inspection. An abrupt exit can leave the subscription changed; read and reconcile it before restarting.

## Verify the transport

```bash
docker compose -f connector/tests/compose.yml up -d --wait
npm --prefix connector run test:integration
```

This test uses two real RabbitMQ instances with scoped runtime credentials. It tests confirmed forwarding, returned receipts, malformed-event quarantine, loss and restoration of a binding, and independence from an unhealthy connection. These are local functional checks, not evidence of production availability or capacity for 100,000 portfolios.
