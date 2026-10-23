# ADR 0002: Use a projects layout with per-project contracts and import boundaries

- Status: Superseded by ADR 0010
- Date: 2026-10-22

## Context

Each product has more than one part: a contract, a web app, an API, and infrastructure. Parts of one product change together. Products must not depend on each other by accident. Agents can add imports quickly, so the boundaries must be enforced by tools.

## Decision

- Put each product in `projects/<name>/`.
- Each product has `contracts`. A product has `web`, `api`, or both. Each product has `infra`.
- `contracts` contains Zod schemas and types for that product only. It is always present.
- Shared AWS resources (one user pool, one DNS zone, one certificate) go to `platform/infra`. See ADR 0006.
- Shared, project-neutral code goes to `packages/*`.
- Tooling goes to `tooling/*`.
- Enforce these import rules with `eslint-plugin-boundaries` and `dependency-cruiser`:
  - `web` and `api` import their own `contracts` and `packages/*`. They never import each other.
  - `contracts` imports only `zod`.
  - `infra` imports its own `contracts` (types only) and `packages/cdk-constructs`.
  - A project never imports another project.
  - `packages/*` never imports from `projects/*`.
- Use Rush tags `project:<name>`, `kind:web|api|contracts|infra`, `shared`, and `tooling`.

## Consequences

- Positive: A product is one folder. Its parts are easy to find.
- Positive: The API and the web app share types through `contracts`. They do not share code.
- Positive: The boundary rules fail in lint and in CI.
- Negative: Code that two products need must move to `packages/*`. That change is `risk:high` and needs a human.
- Negative: Each new product needs entries in `rush.json`, CODEOWNERS, and the boundary config.
