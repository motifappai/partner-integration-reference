# Motif partner connector

The connector is the standard bridge between a partner's RabbitMQ and Motif's RabbitMQ. It is a Node.js 24 container; the partner application's language and framework are irrelevant. Use the same image when Motif operates the connector on the partner's behalf.

Follow the [GitBook blueprint](https://motif.gitbook.io/motif-docs/integrate-with-motif/event-data-feeds) and [executable lifecycle](../event-feeds/README.md).

## Provision and run

1. Motif provisions a separate virtual host and credentials for each organization and environment. The sandbox is a different organization from production. Motif's ingestion service binds the virtual host to the organization; an event cannot select a tenant.
2. The partner provisions a dedicated integration queue on its existing broker. Bind it to the partner's exchange. Do not consume an existing application work queue. Provide separate return and quarantine exchanges/queues.
3. Copy `config.example.json` to `config.json`. Replace the organization ID and connection names. Put the two AMQP URLs and CA certificates into `secrets/`, with access restricted to the container's user. URL format: `amqps://USER:PASSWORD@HOST:5671/VHOST?heartbeat=30`; percent-encode URL components. Never commit secrets.
4. From the repository root, run `docker compose -f connector/compose.yml pull`, then `docker compose -f connector/compose.yml up -d`. No registry login is needed. `/health` reports process liveness; `/ready` reports every connection and returns 503 if any is unavailable. Keep health endpoints internal.
5. Run the reference lifecycle in a provisioned sandbox. Agree acceptance, then provision separate production connections and keys.

The container runs as UID/GID 1000, without root or a writable filesystem. Make mounted secret files readable by that identity. TLS certificate verification cannot be disabled. Client certificates are supported through paired `certificateFile` and `keyFile` fields. Omit `caFile` to use system trust. Reload credentials/configuration by restarting the container.

The public image supports Linux amd64 and arm64:

```bash
docker pull ghcr.io/motifappai/partner-integration-reference:connector-v0.1.0
```

Release tags `connector-vX.Y.Z` run broker tests, publish the image and verify a pull without registry credentials. Pin the released image digest in production. Building from source is only needed when developing the connector; see [maintainer instructions](../DEVELOPMENT.md).

## Hosting

**Partner-hosted:** run beside the source broker. Source credentials remain with the partner; the connector initiates outbound TLS connections to Motif.

**Motif-hosted:** run the same image on Dokploy with approved network access to the source broker. One process can run multiple entries in `connections`. Each has its own source queue, credentials, channel, prefetch, reconnect loop and counters. Each organization/environment needs its own Motif virtual host. Do not put multiple organizations on one shared queue. Use a dedicated instance when required by network or operational boundaries.

Both placements implement exactly the same protocol. There is no direct-to-Motif publisher path in the reference. The SDKs manage the API operations; they do not embed this connector into a partner application.

## Source mapping

Canonical CloudEvents pass through unchanged. For an existing source format, configure explicit JSON Pointers:

```json
{
  "type": "ai.motif.asset.price.v1",
  "source": "urn:chelmer:market-data",
  "id": "/eventId",
  "time": "/observedAt",
  "subject": "/securityId",
  "fields": {
    "externalId": "/securityId",
    "asOf": "/observedAt",
    "revision": "/revision",
    "unitPrice": "/price",
    "currency": "/currency"
  },
  "constants": { "priceType": "CLOSE", "adjustment": "UNADJUSTED" }
}
```

Place this under a connection's `mapping`. Missing fields, invalid envelopes and oversized events go to that source's quarantine. Mapping never evaluates code, guesses identifiers or converts floating-point values to financial decimals. A mapped connection carries one event type; use canonical events for a mixed feed. A separate mapped connection needs separate source/return queues and bindings.

## Delivery and recovery

Source messages are manually acknowledged only after persistent, mandatory destination publication receives a broker confirmation. Unroutable messages and uncertain confirmations close the session and leave source messages unacknowledged. Reconnection uses capped exponential backoff. Delivery is at least once; preserve `(source, id)` across every retry. Motif applies each organization/source/event identity once; reusing an identity with different content is quarantined.

Motif's processing receipt is separate from the broker confirmation. An `APPLIED` receipt confirms the database transaction, not valuation or research completion. Invalid source envelopes have no trustworthy identity and are quarantined without a processing receipt. Valid rejected events receive `REJECTED` receipts. The receipt API supports reconciliation after reconnects.

Return messages travel from `motif.output` to `partner.output`. They cannot re-enter the source input path. Every quarantine queue has an exchange of the same name, bound with routing key `events`; this avoids broad default-exchange permissions. Only one connector may consume each source/return queue at once. Stop the old instance before handing that connection to another instance.

The connector has no local message database. Broker queues retain pending events; Motif retains outcomes and its transactional outbox. Ensure durable source queues, publisher confirms in the source publisher, persistent messages, sufficient disk space and broker backups. Quorum queues require multiple broker nodes for node-failure tolerance; a single Dokploy container is not a highly available broker.

## Operator provisioning and verification

`node connector/ops/provision.ts manifest.json --apply` creates the standard topology and rotates runtime credentials. The manifest contains `managementUrlFile`, `brokerHost`, `brokerPort`, `virtualHost`, `role` (`partner` or `motif`) and `secretDirectory`. The management URL is read from a protected file. HTTPS/TLS is required; `insecureLocal: true` is restricted to loopback test brokers. The command writes separate least-privilege connector/application or connector/worker URL files. Run it with the respective broker operator's credentials, not application credentials. Coordinate rotation before restarting consumers.

```bash
npm ci --prefix connector
npm --prefix connector run typecheck
npm --prefix connector test
docker compose -f connector/tests/compose.yml up -d --wait
npm --prefix connector run test:integration
```

The real-broker test verifies forwarding, receipts, quarantine, routing-loss recovery, permissions and isolation from a failing connection. Inspect queue depth, oldest message age, quarantine count, connection readiness and Motif's oldest unsent receipt in production. Repair quarantined payloads with a new event ID; uncertain deliveries retain their original ID.
