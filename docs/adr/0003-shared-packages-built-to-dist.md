# ADR 0003: Build shared packages to `dist` and consume the output

- Status: Accepted
- Date: 2026-10-22

## Context

The web app (Next.js) and the API use shared packages from `packages/*`. Two ways exist to consume a TypeScript package:

1. Next.js transpiles the source of the package (`transpilePackages`).
2. The package builds to JavaScript and type declarations in `dist/`, and the app uses `dist/`.

Option 1 adds a second build path for the web app. The Rush build cache works best when each package has one build step.

## Decision

- Each package in `packages/*` builds to `dist/` with `tsc` (ESM, with declarations).
- Each package sets `exports` in `package.json` to point at `dist/`.
- Next.js uses the packages through `dist/`. Do not add `transpilePackages`.
- The build order comes from Rush. A project depends on `dist/` output only after `rush build` ran.
- Each package also builds and tests on its own.

## Consequences

- Positive: One build path for every package. The Rush build cache works for all of them.
- Positive: The web app and the API use the same compiled output.
- Negative: A change to a shared package needs a rebuild before the web app sees it. `rush build --impacted-by` handles this in CI.
- Negative: A developer who runs the web app alone must run `rush build` first.
