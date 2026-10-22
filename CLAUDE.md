# CLAUDE.md

Read this file first. Read `REVIEW.md` before you review a change.

## Stack

- Monorepo: Rush 5.181 with pnpm 10. Node 24 (see `.nvmrc`).
- Language: TypeScript, ESM only, `strict` mode.
- Web: Next.js (App Router). API: Fastify (TypeScript). Optional: Python (`api-py`) and Go (`api-go`) backends.
- Contracts: Zod schemas and types, one `contracts` package per project (single source of truth).
- Compute: Lambda first. API: Fastify on Lambda (aws-lambda-fastify) behind API Gateway HTTP API. Web: Next.js via OpenNext (CloudFront, S3, Lambda).
- Infrastructure: AWS CDK. `platform/infra` owns shared AWS resources. Each project has its own `infra` app.
- Tests: Vitest, Testing Library, Bruno (API requests), Playwright and axe (web), pytest, go test, CDK assertions.

## Layout

- `projects/<name>/{contracts,web,api,api-py,api-go,infra}`: one product. Each part is a Rush project. `web` and `api` are optional. `api-py` and `api-go` are optional backends.
- `projects/sample-fullstack/`, `projects/sample-api-only/`: sample products.
- `platform/infra`: shared AWS resources (one Cognito user pool, imported Route53 zone, ACM wildcard certificate). Package `@vprprudhvi/platform-infra`. Writes IDs to SSM under `/platform/<env>/...`.
- `packages/*`: shared code with no project logic. Includes `flags`, `logger`, `result`, `cdk-constructs`.
- `tooling/*`: shared config for ESLint, TypeScript, Vitest, Opengrep.
- `common/`: Rush config, git hooks, autoinstallers. Gate files.
- `docs/`: standards, ADRs, runbooks, templates.

## Contracts

- Zod in `<project>-contracts` is the only source of the API shape. Python and Go models are generated from it.
- Never edit generated Python (`generated/`) or Go (`internal/gen/`) code by hand. Change the Zod schema and regenerate.

## Commands

Always run Rush through the wrapper. Do not install packages any other way. Python and Go parts use the same commands, through their `_phase:*` scripts.

```
node common/scripts/install-run-rush.js install      # alias: rush install
node common/scripts/install-run-rush.js build        # alias: rush build
node common/scripts/install-run-rush.js lint         # alias: rush lint
node common/scripts/install-run-rush.js typecheck    # alias: rush typecheck
node common/scripts/install-run-rush.js test         # alias: rush test
node common/scripts/install-run-rush.js verify       # alias: rush verify (runs build, lint, typecheck, test, e2e)
node common/scripts/install-run-rush.js e2e          # alias: rush e2e (Bruno and Playwright)
node common/scripts/install-run-rush.js verify --to <pkg>
node common/scripts/install-run-rush.js verify --impacted-by git:origin/main
node common/scripts/install-run-rush.js add -p <pkg> # alias: rush add -p <pkg>
node common/scripts/install-run-rush.js prettier     # alias: rush prettier
node common/scripts/install-run-rush.js audit        # alias: rush audit
node common/scripts/install-run-rush.js license-check
```

Never run `npm install`, `pnpm install`, or `pnpm add`. Use `rush add -p <pkg>`.

## Import rules

- `web` imports its own `contracts` and `packages/*`. It never imports `api`.
- `api` imports its own `contracts` and `packages/*`. It never imports `web`.
- `contracts` imports only `zod`. It never imports `web`, `api`, or `infra`.
- `infra` imports its own `contracts` (types only) and `packages/cdk-constructs`.
- A project never imports another project.
- `packages/*` never imports from `projects/*`.
- `api-py` and `api-go` import only their generated models and their own code. They never import TypeScript packages.
- `platform/infra` is imported by nothing. Project infra never imports it.
- A project's `infra` reads platform values only through SSM helpers in `@vprprudhvi/shared-cdk-constructs`.
- Shared code goes in `packages/*`. That change needs a human.

## Top rules

1. Show the command output. Paste the real output before you say a task is done.
2. Never say "done" without output from `verify` or the named command.
3. Never skip, delete, or weaken a test. Never weaken a lint rule, a threshold, or a gate.
4. Never use `--no-verify`, `git push --force`, or `cdk deploy` or `cdk destroy`.
5. Never edit a gate file. A gate file needs a human. See `docs/standards/gates.md`. Changes to `platform/**` and `packages/**` are high risk. A human approves them.
6. Each PR changes one thing. Keep the diff small.
7. Put each new user-visible behavior behind a flag from `packages/flags`.
8. Each bug fix adds a test that fails before the fix.
9. Read config only in `config.ts`. Validate input with the project's `contracts`.
10. Log only with `@vprprudhvi/shared-logger`. Never log secrets or personal data.
11. If a check fails, fix the cause. Do not work around the check.
12. After 3 failed review rounds, stop and ask the human about the approach.
13. Each API route has a Bruno request with docs and assertions. Each web page has a Playwright spec with an axe check.

## Non-goals

- No cloud other than AWS.
- No infrastructure tool other than AWS CDK.
- No feature-flag vendor yet. Flags use env or JSON files behind `packages/flags`.
- No deploy from a laptop. Releases use `release.yml`.
- No dependency on GitHub Advanced Security.

## Standards

- `docs/standards/coding-conventions.md`: naming, types, errors, logging, folders, comments.
- `docs/standards/testing.md`: test rules and coverage gates.
- `docs/standards/security.md`: secret, SAST, dependency, and IaC rules.
- `docs/standards/git-workflow.md`: branches, commits, hooks.
- `docs/standards/gates.md`: gate files, checks, and human unlock steps.
- `docs/standards/risk-tiers.md`: risk tiers and approvals.
- `docs/onboarding.md`, `docs/runbooks/rollback.md`, `docs/adr/`: setup, rollback, decisions.
- `REVIEW.md`: review rules. Per-kind templates are in `docs/templates/`. Project and platform `REVIEW.md` files sit beside each project.
- Agents may propose edits to `CLAUDE.md`, `REVIEW.md`, and `docs/standards/**`. A human approves them. See `docs/standards/gates.md`, section 2.2.
