Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `projects/<name>/`.

## Anatomy

- `projects/<name>/` is one product and ONE Rush project: `@vprprudhvi/<name>`, tag `project/<name>`, one `package.json`. A part is a folder, never a package.
- A project has only the parts it needs. All parts are optional: `src/api` and `bruno/` (node part, Fastify), `web/` (web part, Next.js), `bin/` and `lib/` (infra part, CDK app). `src/contracts`, `scripts/` and `config/` complete the layout.
- `rush new --project <name>` makes a bare project with no parts. `rush add-part --project <name> --part <node|web|infra>` adds one part, in any order. Use the [scaffold](../.claude/skills/scaffold/SKILL.md) skill.
- When the project has an endpoint, its contract (Zod) lives in `src/contracts`. A project with no endpoint has no `src/contracts`.
- The infra part has `bin/app.ts`, `lib/<name>-app.ts` with cdk-nag `AwsSolutionsChecks`, `lib/<name>-stack.ts`, `test/infra`, `cdk.json` and `tsconfig.cdk.json`. A project gets this part before it gets new infra.
- The `package.json` has the phases `_phase:build`, `_phase:lint`, `_phase:typecheck`, `_phase:test`, `_phase:e2e`. Each phase runs every part that is present and fails fast with the part name. A phase passes when the project has no part.
- `bruno/` holds the Bruno collection. Each API route has one `.bru` request with docs and assertions.
- `REVIEW.md` holds the review rules for the project.
- Sample: `projects/sample` has every part.

## Contracts flow

1. Write the Zod schema in `src/contracts/<resource>.ts`.
2. `rush build` emits `dist/openapi.json`.
3. Never edit generated output by hand. Change the schema and rebuild.

## Import rules

- Imports inside a project are relative.
- `web` imports `src/contracts` and `packages/*`. Never `src/api`.
- `src/api` imports `src/contracts` and `packages/*`. Never `web`.
- `src/contracts` imports only `zod`.
- `bin` and `lib` import `src/contracts` (types only) and `packages/cdk-constructs`.
- A project never imports another project. Shared code goes in `packages/*` (needs a human).
- A project `bin` or `lib` never imports `platform/infra`. It reads SSM values through `@vprprudhvi/shared-cdk-constructs`.
- Full list: [repo-overview.md](../docs/guides/repo-overview.md).

## Duties for each part

- API route: add a Bruno request.
- Web page: add a Playwright spec with `page.goto` and an axe check.
- Each part: add a trace propagation test. See [observability.md](../docs/standards/observability.md).
- `projects/*/bin/**` and `projects/*/lib/**` are medium risk. The infra reviewer agent checks them locally, cdk-nag runs in the infra unit tests, and the PR review covers them. `projects/*/cdk.json` stays high risk.

## Guides by part

- contracts: [contracts.md](../docs/guides/contracts.md)
- web: [web.md](../docs/guides/web.md)
- api (TypeScript): [api.md](../docs/guides/api.md)
- infra (`bin`, `lib`): [infra.md](../docs/guides/infra.md)

## Skills

- New project or new part: [scaffold](../.claude/skills/scaffold/SKILL.md).
- Routes: [new-api-route](../.claude/skills/new-api-route/SKILL.md). Page: [new-web-page](../.claude/skills/new-web-page/SKILL.md).
- Bruno: [api-docs](../.claude/skills/api-docs/SKILL.md).

## Links

- [coding-conventions.md](../docs/standards/coding-conventions.md), [testing.md](../docs/standards/testing.md), [ADR 0002](../docs/adr/0002-projects-layout-and-contracts.md), [ADR 0010](../docs/adr/0010-single-package-projects.md)
