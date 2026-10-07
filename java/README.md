# Java 25 / Jakarta partner reference

The Java reference follows the [connector blueprint](https://motif.gitbook.io/motif-docs/integrate-with-motif/event-data-feeds). `ConnectorLifecycle` is a Jakarta CDI bean using the generated `MotifClient` for API operations. `PartnerBroker` represents the partner publishing to its own RabbitMQ and receiving the connector's returned events. The Motif connector runs as the separate shared container; it is not embedded in the Java application.

Use JDK 25 and Maven 3.9+. Build from the repository root:

```bash
mvn -s java/.mvn/settings.xml -f java/pom.xml install
java -jar java/reference/target/quarkus-app/quarkus-run.jar
java -jar java/reference/target/quarkus-app/quarkus-run.jar --apply --listen-seconds=60
```

Set `MOTIF_API_BASE_URL`, `MOTIF_API_KEY`, `MOTIF_ORG_ID` and `PARTNER_BROKER_URL_FILE` as described in the [shared lifecycle guide](../event-feeds/README.md). Use JVM trust-store settings for a private broker CA. No webhook URL is required. The broker URL file must contain the application-side credentials for the partner broker, not Motif's broker or the connector's credentials.

The walkthrough subscribes, discovers the exact listing, publishes master/price/FX events and waits for applied receipts, PUTs and updates a portfolio, reads insights, processes publication events and reconciles receipts. It uses the same quantities, revisions and cleanup behavior as TypeScript and REST. The prior subscription is restored on exit, and sandbox data remains for inspection.

The SDK uses Java's HTTP client and Jackson and does not require Quarkus. The reference executable uses Quarkus as its Jakarta CDI/REST runtime; deploying it to WildFly is not required to operate the standalone connector. Keep the whole `quarkus-app` directory together when copying the executable.

The Java SDK is distributed as source here and installed locally by Maven as `ai.motif:motif-sdk:0.2.0`; it is not published to Maven Central. `MotifClient.api()` exposes the generated SDK operations, including the new feed subscription, receipt and FX reads. Each client owns its credentials and timeouts; redirects are disabled.

To refresh the SDK contract from Motif's authoritative exported OpenAPI:

```bash
node java/sdk/sync-openapi.mjs /absolute/path/to/motif-openapi.json
mvn -s java/.mvn/settings.xml -f java/pom.xml install
```

Generated Java sources live under `target/` and are never edited by hand. RabbitMQ transport belongs to the reference application; the public SDK remains an API client. Local build and contract tests do not verify a deployed sandbox or a published artifact.
