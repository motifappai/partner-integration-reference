# Maintaining the reference implementations

The repository is independently versioned. The TypeScript reference depends on the public npm SDK; `event-feeds/rest.ts` uses direct HTTP; the reference publisher uses the connector broker library. The Java reference depends on the Java SDK built in the same Maven reactor. Do not add monorepo imports, workspace dependency ranges, private API calls, generated SDK output, credentials or copied build output.

Run these from the repository root once the required SDK version is published:

```bash
npm ci
npm ci --prefix connector
npm install --prefix sdk
npm run typecheck
npm test
npm run rest
npm run sdk
```

The tests exercise signatures, organization boundaries, duplicate delivery, failed read recovery, production-host rejection and both mapping modes and complete request sequences against a local HTTP contract fixture. They do not verify a deployed API, market prices, worker execution or research publication. Run all three implementations against the sandbox and retain their results before declaring the integration verified.

## Validate an unpublished SDK candidate

For a future unpublished release, build and pack the candidate in the Motif checkout with pnpm, which resolves its catalog dependency versions:

```bash
pnpm --dir packages/sdk build
pnpm --dir packages/sdk pack --pack-destination /tmp
```

Then, from this independent repository:

```bash
npm install --prefix sdk --no-save --package-lock=false /tmp/motif-ai-sdk-0.2.0.tgz
npm ci
npm run typecheck
npm test
```

Do not replace the declared SDK dependency with a workspace path or commit the tarball. `npm pack` on the monorepo source leaves `catalog:` dependencies unresolved; use `pnpm pack`. For each published release, update the pinned dependency and `sdk/package-lock.json`, install from npm in a clean checkout, and rerun the focused checks and sandbox walkthroughs. Contract tests verify the installed package against fixtures; only sandbox walkthroughs verify the deployed integration.

## Update the parent submodule

The public repository is [motifappai/partner-integration-reference](https://github.com/motifappai/partner-integration-reference). Push a reviewed reference commit to its origin before updating the Motif parent repository's `examples/partner-integration` pointer.

From the Motif parent checkout, select the reference commit you intend to release:

```bash
git submodule update --init examples/partner-integration
git -C examples/partner-integration fetch origin
git -C examples/partner-integration checkout "$REFERENCE_COMMIT"
git add examples/partner-integration
```

Set `REFERENCE_COMMIT` to the verified commit SHA. Keep that commit available on the public origin and verify a fresh submodule checkout before merging the parent change. Run the independent checks above whenever the reference code changes.

## Java SDK and Jakarta reference

See [Java instructions](java/README.md). Build with JDK 25 and `mvn -s java/.mvn/settings.xml -f java/pom.xml install`, then run `npm run test:java` with the two test brokers running to compare all three implementations against the same HTTP and broker contract fixture. Commit the filtered OpenAPI source, generator configuration and handwritten helpers; never commit `target/`. The SDK JAR is built locally and is not a Maven Central release.

## Connector and blueprint checks

```bash
npm ci --prefix connector
npm --prefix connector run typecheck
npm --prefix connector test
docker compose -f connector/tests/compose.yml up -d --wait
npm --prefix connector run test:integration
npm run test:blueprint
npm run test:java
docker build -t motif-partner-connector:0.1.0 connector
```

The blueprint tests run the real connector across two real RabbitMQ brokers. Their HTTP server and receiving Motif processor are contract fixtures, so these tests verify cross-language request/event parity, not product valuation or research. The Motif repository separately tests the real feed worker against RabbitMQ and PostgreSQL, including dependency retry and durable outcomes.

`event-feeds/partner-events.schema.json` is generated from Motif's authoritative Zod event schema using `pnpm --filter @motif-ai/api export-partner-events`, then copied here. Do not hand-edit it. Resync the Java OpenAPI document whenever API controls change. Confirm source examples validate against the exported contract.

Publishing a `connector-vX.Y.Z` Git tag triggers the container workflow. Keep the tag, package version, documentation and image digest aligned. Release activation also requires deployed migrations/API/feeds worker, tenant provisioning, matching public SDK and a live sandbox acceptance run.
