# Java 25 SDK and Jakarta reference implementation

This is the Java version of [Integrate insights into your app](https://motif.gitbook.io/motif-docs/integrate-with-motif/partner-data-and-insights). It follows the same seven steps, payloads and optional flags as the TypeScript SDK and REST implementations in this repository.

`java/sdk` is a reusable Java 25 SDK generated from Motif's public OpenAPI contract. `java/reference` uses it in a Jakarta REST/CDI application, running on Quarkus 3.40.1. `Lifecycle` contains the API calls; `WebhookResource` receives signed events. The SDK itself uses Java's HTTP client and Jackson and does not require Quarkus.

## Build and run

Install JDK 25 and Maven 3.9 or newer. Set `JAVA_HOME` to that JDK. From the repository root:

```bash
mvn -s java/.mvn/settings.xml -f java/pom.xml install
java -jar java/reference/target/quarkus-app/quarkus-run.jar
```

The Maven settings file selects the standard Maven Central repository without inheriting a private user mirror. Maven generates the SDK, runs its focused tests, builds the application, and installs `ai.motif:motif-sdk:0.2.0` into your local Maven repository. **The Java SDK is distributed as source here; it is not published to Maven Central.** Keep the whole `quarkus-app` directory together when copying the runnable application.

Copy the root `.env.example` to `.env` and fill in your sandbox settings. Quarkus reads `.env` from the working directory; operating-system environment variables also work. Keep credentials private. Each organization has separate sandbox and production environments. These examples reject Motif's production host.

Forward your public HTTPS route ending in `/webhooks/motif` to `127.0.0.1:8787`; change `MOTIF_WEBHOOK_PORT` if needed. Use a public endpoint on port 443, as described in GitBook. Run one implementation at a time.

```bash
java -jar java/reference/target/quarkus-app/quarkus-run.jar --apply
java -jar java/reference/target/quarkus-app/quarkus-run.jar --apply --mapping=motif --assets
java -jar java/reference/target/quarkus-app/quarkus-run.jar --apply --document=/absolute/path/factsheet.pdf --listen-seconds=300 --archive
```

Without `--apply`, the application prints the guide and sends no Motif requests. It briefly starts its HTTP receiver. The mapping endpoints must already be deployed in your sandbox; building this repository does not deploy the API.

## Follow the guide

| Step | Java behavior |
| --- | --- |
| 1. Subscribe and receive a webhook | Create an `assessment.published` subscription, retain its secret in memory, and verify a signed test at this receiver |
| 2. Discover and map assets | Paginate the catalog, verify NASDAQ AAPL, and print a local mapping or PATCH your organization reference with `--mapping=motif`; optionally create and price an unmatched custom instrument |
| 3. Read market updates and asset insights | Read both without a portfolio |
| 4. Create a portfolio | Submit revision 1 with 10 Apple shares and USD 1,000 cash, plus five fund units when enabled; wait for complete valuation |
| 5. Update a portfolio | Submit revision 2 with 12 shares and USD 600 cash, retain the optional five fund units, retry the identical snapshot and wait for valuation |
| 6. Read portfolio insights | Use the returned portfolio ID, English and window `1D` |
| 7. Keep the integration running | Read content in the event's language, inspect deliveries, replay a real event if available, pause/rotate/resume and retest, then delete this run's subscription; optionally archive its portfolio |

`AAPL` is a ticker. The catalog returns Motif asset IDs, listing names, exchanges and categories; it is not an ISIN resolver or a guarantee of research or price coverage. Resolve your ISIN to an exact listing through your security master/custodian, then store the link locally or as your organization's `externalId`. An ambiguous match stops the example. It does not silently create a custom asset.

`--mapping=local` is the default and prints a mapping for your own database. `--mapping=motif` stores a unique sandbox reference and verifies an exact lookup; it refuses to overwrite an existing reference. `--assets` creates Private Fund A if its exact reference is absent, selects custom pricing, sends USD 12.50 twice, corrects it to USD 13 at the same timestamp with revision 2, and reads history. `--document` also enables those asset steps and uploads a nonempty PDF up to 20 MiB, using only the returned storage headers, then finalizes and waits for completion.

All snapshots identify holdings by Motif asset ID. Market and asset reads need no portfolio; asset publication notifications currently require an active holding in the organization. Null research remains unavailable research. Missing prices fail the calculation check. Optional steps and unobserved real publications are printed explicitly.

The receiver verifies the raw request bytes, timestamp, endpoint, organization and event identity before accepting an event. Its bounded queue serializes reads and deduplicates event IDs; an explicit replay can retry a failed read. Secrets, queued work and receipts are only in memory. A production receiver must persist accepted events before acknowledging and securely store signing secrets; see [Webhooks](https://motif.gitbook.io/motif-docs/settings/webhooks).

Normal exits attempt to remove this run's subscription. `--archive` archives its portfolio; otherwise the portfolio remains. Custom assets, mappings and documents remain in the sandbox. Abrupt termination can leave subscriptions behind. A successful example run is not a production acceptance test; follow [Integration acceptance](https://motif.gitbook.io/motif-docs/integrate-with-motif/implementation).

## Use the SDK in your application

After installing the SDK locally using the build command above, add:

```xml
<dependency>
  <groupId>ai.motif</groupId>
  <artifactId>motif-sdk</artifactId>
  <version>0.2.0</version>
</dependency>
```

```java
var motif = new MotifClient(System.getenv("MOTIF_API_KEY"),
    URI.create("https://staging.backend.motifapp.ai/api"));
var catalog = motif.api().sdkAssetsList(null, 50, null, null);
var matches = motif.api().sdkAssetsList(null, 50, null, "your-security-reference");
```

Import `ai.motif.sdk.MotifClient` and `java.net.URI`. Calls return generated models and throw `ai.motif.sdk.client.ApiException`, including the HTTP status and response body. Each client owns its credentials and request timeouts; redirects are disabled. Supply a third constructor argument for user-scoped `x-user-id` calls when required. The generated `SdkApi` exposes all public SDK operations, including the separate profile and strategy APIs; those are outside this partner lifecycle walkthrough.

Use `new SdkAssetsUpdateRequest().externalId("your-reference").currency("USD")` for a first mapping configuration. `.externalId(null)` explicitly clears a public asset reference; leaving the property unset preserves it. Custom asset creation references are immutable. `WebhookSignature.verify(rawBytes, signature, timestamp, secret)` verifies Motif's signing format with a five-minute timestamp tolerance. `AssessmentEvent.parse(json)` validates the publication envelope before routing it.

## Maintain the contract

Generated Java lives under `target/` and is never edited or committed. To refresh the committed public contract from the authoritative API export:

```bash
node java/sdk/sync-openapi.mjs /absolute/path/to/motif-openapi.json
mvn -s java/.mvn/settings.xml -f java/pom.xml clean install
npm run test:java
```

The sync copies only public SDK operations and referenced schemas. Free-form profile-answer unions use Jackson `JsonNode`; all other request/response models are generated from the contract. The cross-language test command requires Node 24.18+, root development dependencies, the TypeScript SDK dependency, and the built Java application. It compares the complete Java, TypeScript and REST request sequences for both mapping modes, including real HTTP signature verification, replay deduplication, uploads, correction/retry semantics, and refusal of an API that ignores exact reference filters. These are local contract tests, not evidence of a deployed sandbox run.
