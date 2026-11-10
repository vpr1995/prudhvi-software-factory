# Repository overview

This guide holds the stack, the layout, the full import rules, and the non-goals. The root `CLAUDE.md` links here. Read this guide when you need to know where code lives or what the repo does not do.

## 1. Stack

- Monorepo: Rush 5.181 with pnpm 10. Node 24 (see `.nvmrc`).
- Language: TypeScript, ESM only, `strict` mode.
- Web: Next.js (App Router). API: Fastify (TypeScript).
- Contracts: Zod schemas and types in `src/contracts` of each project. It is the single source of truth.
- Compute: Lambda first. API: Fastify on Lambda (`@fastify/aws-lambda`) behind API Gateway HTTP API. Web: Next.js.
- Infrastructure: AWS CDK. `platform/infra` owns shared AWS resources. A project that needs infra has its own CDK app in `bin` and `lib`.
- Tests: Vitest, Testing Library, Bruno (API requests), Playwright and axe (web), CDK assertions.
- Tracing: OpenTelemetry. See `docs/standards/observability.md`.

## 2. Layout

- `projects/<name>/`: one product and one Rush project (`@vprprudhvi/<name>`, one `package.json`). Parts are folders: `src/api`, `web`, and the CDK app in `bin` and `lib`. Each part is optional. When the project has an endpoint, its contract lives in `src/contracts`. `rush new --project` and `rush add-part` make them. Guide: `docs/guides/`.
- `projects/<name>/bruno/`: the Bruno collection of the project.
- `projects/sample/`: the sample product. It has every part.
- `platform/infra`: shared AWS resources (one Cognito user pool, imported Route53 zone, ACM wildcard certificate). Package `@vprprudhvi/platform-infra`. It writes IDs to SSM under `/platform/<env>/...`.
- `packages/*`: shared code with no project logic. Now: `cdk-constructs`, `flags`, `logger`, `result`, and `telemetry`.
- `tooling/*`: shared config for ESLint, TypeScript, Vitest.
- `common/`: Rush config, git hooks, autoinstallers.
- `docs/`: standards, guides, ADRs, runbooks, templates.

## 3. Import rules

- Imports inside a project are relative.
- `web` imports `src/contracts` and `packages/*`. It never imports `src/api`.
- `src/api` imports `src/contracts` and `packages/*`. It never imports `web`.
- `src/contracts` imports only `zod`. It never imports `web`, `src/api`, `bin`, or `lib`.
- `bin` and `lib` import `src/contracts` (types only) and `packages/cdk-constructs`.
- A project never imports another project.
- `packages/*` never imports from `projects/*`.
- `platform/infra` is imported by nothing. Project `bin` and `lib` never import it.
- A project reads platform values only through SSM helpers in `@vprprudhvi/shared-cdk-constructs`.
- Shared code goes in `packages/*`. That change needs a human.

Enforcer: `eslint-plugin-boundaries`. See `docs/standards/coding-conventions.md`, section D.

## 4. Non-goals

- No cloud other than AWS. Exception: static sites can deploy to Cloudflare. See [ADR 0012](../adr/0012-cloudflare-for-static-sites.md).
- No infrastructure tool other than AWS CDK. Exception: Cloudflare static sites use wrangler. See [ADR 0012](../adr/0012-cloudflare-for-static-sites.md).
- No feature-flag vendor yet. Flags use env or JSON files behind `packages/flags`.
- Deploy rules: see root `CLAUDE.md`, rule 4.
- No dependency on GitHub Advanced Security.

## 5. Who edits the agent documents

Agents can propose edits to `CLAUDE.md` files, `REVIEW.md` files, `docs/guides/**`, and `docs/standards/**`. A human approves each edit.

## 6. Where each rule lives

| Topic                                                                                                                                          | Document                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Commands                                                                                                                                       | [commands.md](commands.md)                                       |
| Naming, types, errors, logging, folders, comments                                                                                              | [coding-conventions.md](../standards/coding-conventions.md)      |
| Tests and coverage                                                                                                                             | [testing.md](../standards/testing.md)                            |
| Tracing and log fields                                                                                                                         | [observability.md](../standards/observability.md)                |
| Secrets, SAST, dependencies, IaC                                                                                                               | [security.md](../standards/security.md)                          |
| Branches, commits, hooks                                                                                                                       | [git-workflow.md](../standards/git-workflow.md)                  |
| Risk tiers and approvals                                                                                                                       | [risk-tiers.md](../standards/risk-tiers.md)                      |
| Review rules for the AI reviewer. Per-part templates are in `docs/templates/`. Project and platform `REVIEW.md` files sit beside each project. | [REVIEW.md](../../REVIEW.md)                                     |
| Setup for a new machine                                                                                                                        | [onboarding.md](../onboarding.md)                                |
| Rollback steps                                                                                                                                 | [rollback.md](../runbooks/rollback.md)                           |
| Decisions                                                                                                                                      | [ADRs](../adr/)                                                  |
| Plan, build status, roadmap and notes. Tasks are GitHub Issues on the [board](https://github.com/users/vpr1995/projects/2).                    | [Wiki](https://github.com/vpr1995/prudhvi-software-factory/wiki) |
