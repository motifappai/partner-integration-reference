# Sample partner

A self-contained partner that exercises a Motif data connection end to end. It runs its own RabbitMQ and a generator that publishes asset master data, prices and FX rates continuously, in a partner-style format rather than Motif's event format, so Motif's mapping is part of every test. It consumes the receipts and notifications Motif returns and reports what came back.

Use it in a sandbox organization to check that a Motif-hosted connection, the mappings and the feeds pipeline behave as expected.

## What it publishes

| Message | Format | Default schedule |
| --- | --- | --- |
| Instrument (`kind: "security"`) | `securityId`, `name`, `code`, `ccy`, `observedAt`, `version` | Once per instrument at start (`INSTRUMENT_COUNT`, default 5); resent unchanged on reconnect |
| Price (`kind: "price"`) | `securityId`, `observedAt`, `version`, `quote.px`, `quote.ccy` | Every `PRICE_INTERVAL_MS` (30 s), a random walk per instrument |
| FX rate (`kind: "fx"`) | `pair`, `base`, `quote`, `observedAt`, `version`, `mid` | Every `FX_INTERVAL_MS` (60 s) for EUR/USD, GBP/USD and USD/CHF |
| Unreadable message | Plain text | Every `INVALID_EVERY` price rounds (20); `0` disables. Expect it in quarantine. |

Prices and rates are decimal strings. Every message has a stable event ID, so redelivery is safe.

The [`mappings`](mappings) folder holds the three Motif mapping definitions for this format. Paste each one into **Settings → Partner feeds → Mapping** in Motif, or save them with the SDK (`motif.feeds.saveMapping`).

## Run it

The broker password comes from `SAMPLE_PARTNER_BROKER_PASSWORD`. Use letters and digits only, because it is placed in a broker URL.

```bash
docker network create dokploy-network
SAMPLE_PARTNER_BROKER_PASSWORD=choose-one docker compose -f sample-partner/compose.yml up -d --build
```

On Dokploy, deploy `sample-partner/compose.yml` from this repository as a Compose service in its own project and set `SAMPLE_PARTNER_BROKER_PASSWORD` in its environment. Both containers join `dokploy-network`, so Motif's feeds service reaches the broker at `sample-partner-rabbitmq:5672` without a public route.

## Connect Motif to it

In the sandbox organization, open **Settings → Partner feeds**:

1. **Mapping:** save the three definitions from `mappings`.
2. **Connection:** choose *Motif connects to your broker* and enter host `sample-partner-rabbitmq`, port `5672`, virtual host `partner`, queue `partner.ingress`, output exchange `partner.output`, routing key `events`, quarantine exchange `partner.quarantine`, TLS off, username `sample-partner` and the password you set. Save, then **Enable feed**.
3. **Status:** within a minute the connection reports Ready and applied events start to appear. Instruments create custom assets; prices and FX follow.

Plain AMQP to a partner broker is accepted only for sandbox organizations.

## What to check

`GET /stats` on the generator (port 8080, inside the network) reports what it published, the receipts it received by status and rejection code, insight publications, and the quarantine depth. Healthy behaviour:

* Receipts arrive for every published message, almost all `APPLIED`.
* Unreadable messages accumulate in `partner.quarantine` and never produce a receipt.
* Restarting the generator resends instruments with the same event IDs; their receipts repeat the original outcome instead of creating new assets.
* Disabling the feed in Motif stops receipts; messages wait in `partner.ingress` and are processed after re-enabling.
