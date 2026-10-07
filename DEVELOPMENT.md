# Maintaining the reference implementations

The repository is independently versioned. Its only product dependency is the SDK package used by `sdk/`; `rest/` uses Node.js alone. Do not add monorepo imports, workspace dependency ranges, private API calls, generated SDK code, credentials or copied build output.

Run these from the repository root after installing the required SDK release:

```bash
npm ci
npm run typecheck
npm test
npm run rest
npm run sdk
```

The tests exercise signatures, organization boundaries, duplicate delivery, failed read recovery, production-host rejection and both complete request sequences against a local HTTP contract fixture. They do not verify a deployed API, market prices, worker execution or research publication. Run both implementations against the sandbox and retain their results before declaring the integration verified.

## Validate an unpublished SDK candidate

SDK `0.2.0` is not on npm as of 7 October 2026. Build and pack it in the Motif checkout with pnpm, which resolves its catalog dependency versions:

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

Do not replace the declared SDK dependency with a workspace path or commit the tarball. `npm pack` on the monorepo source leaves `catalog:` dependencies unresolved; use `pnpm pack`. When `0.2.0` is publicly available, install from npm in a clean checkout, commit the resulting `sdk/package-lock.json`, rerun the checks and sandbox walkthroughs, and update the release-status notices here and in GitBook. Only that clean installation verifies the public package.

## Publish the repository and connect the submodule

The local repository has no GitHub origin yet. The Motif parent checkout temporarily records a local submodule URL. Do not merge that parent change until the repository has a public origin and the URL is portable.

After the repository exists, set `REFERENCE_ORIGIN` to its actual Git URL and run in this repository:

```bash
git remote add origin "$REFERENCE_ORIGIN"
git push -u origin main
```

Then in the Motif parent checkout:

```bash
git submodule set-url examples/partner-integration "$REFERENCE_ORIGIN"
git submodule sync -- examples/partner-integration
git add .gitmodules examples/partner-integration
```

Verify a fresh recursive clone before merging the parent change. Keep the referenced commit available on the public origin. Add the actual public repository link to GitBook when the destination exists; do not publish a guessed link.
