# Reference implementation rules

- Keep the TypeScript SDK, direct REST and Java examples in the same order as the linked GitBook guide. Update the guide and all three implementations together when the public contract changes.
- Use published packages or the Java SDK built in this repository, and public Motif interfaces only. No monorepo imports or workspace dependencies. Proposed event contracts are not implemented SDK methods; keep them explicitly separated from runnable examples.
- Keep Motif SDK calls explicit in `sdk/main.ts` and HTTP methods and paths explicit in `rest/main.ts`. Java calls stay explicit in `Lifecycle`. Shared helpers must not hide product operations or depend on the SDK.
- Preserve strict TypeScript checking. No `any`, unsafe casts or narrative source comments.
- Run `npm run typecheck`, `npm test` and both previews after changes. Report live sandbox verification separately from fixture tests.
- Never print secrets or commit `.env`, local package tarballs or node_modules.
- These examples use sandbox data. Reject production before making requests; archive only IDs returned during the current run.
