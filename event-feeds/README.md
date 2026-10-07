# Proposed event-feed integration

This directory contains design examples for the proposed pub/sub extension. **There is no broker client or executable event-feed walkthrough here yet.** The existing [TypeScript](../sdk/main.ts), [REST](../rest/main.ts) and [Java/Jakarta](../java/README.md) implementations continue to demonstrate the implemented REST/webhook lifecycle.

The proposed architecture is a Motif-managed RabbitMQ service with one standard event contract for every partner. A partner can publish directly through a future SDK transport or connect an existing broker through a dedicated connector. A connector normalizes the partner's schema and binds its authenticated source to the correct organization and environment. A RabbitMQ Shovel can move compatible messages; it cannot perform that semantic mapping.

The [GitBook proposal](https://motif.gitbook.io/motif-docs/integrate-with-motif/event-data-feeds) is the partner-facing contract. Until that proposal is published, use [GitBook change request #49](https://github.com/motifappai/gitbook/pull/49). Example JSON bodies here match the proposal exactly:

- [Asset master](examples/asset-master.json): map a verified Motif asset ID to your stable reference and explicitly select partner pricing.
- [Asset price](examples/asset-price.json): send a dated decimal price with correction revision, currency, price kind and adjustment convention.
- [FX rate](examples/fx-rate.json): send quote-currency units per base-currency unit, with observation time and revision.

These are illustrative payloads, not current market data or live request bodies. Replace the example asset ID with a catalog result. No existing REST endpoint accepts the CloudEvents wrapper. The proposed price-kind and adjustment fields and FX feed require implementation; do not strip them and assume equivalent current behavior.

The TypeScript and Java transport implementations must follow the same sequence when added:

1. Connect with organization/environment-scoped credentials and establish durable receipt/insight subscriptions.
2. Publish asset master data directly, or bridge it from a dedicated source queue. Await the applied mapping receipt.
3. Publish dated prices and FX observations with stable event IDs and observe processing receipts.
4. PUT the complete portfolio snapshot using the existing REST contract; wait for valuation.
5. GET market, asset and portfolio insights, resolving external references through authorized mappings.
6. Consume publication notifications, read their content, and demonstrate reconnect, duplicate handling, failure/replay and cleanup.

A publish confirmation only means the broker accepted a message. It does not mean Motif applied the data or completed valuation/research. Subscribers acknowledge after their own durable processing. The connector acknowledges its source only after confirmed destination publication; business receipts provide end-to-end reconciliation.

Use a separate source integration queue rather than consuming the partner application's work queue. Multiple workers on one durable subscription share work; independent applications need separate subscriptions. Organization isolation, bounded concurrency, routing errors, restart recovery and uncertain confirmation must be verified against a real broker before this becomes an executable reference.

History imports, cross-currency valuation, position PnL and an Illio portfolio backtest path are not currently demonstrated. Portfolio PUT does not accept a two-year backfill after a newer snapshot. Those contracts must be implemented and added to GitBook before extending the walkthrough.
