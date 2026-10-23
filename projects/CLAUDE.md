Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `projects/<name>/`.

## Anatomy

- `projects/<name>/` is one product and ONE Rush project: `@vprprudhvi/<name>`, tag `project/<name>`, one `package.json`. A part is a folder, never a package.
- Layout (CDK style): `bin/` and `lib/` (CDK app and stacks, Wave 3), `src/contracts`, `src/api` (TypeScript), `src/api-py` (Python), `src/api-go` (Go), `web/` (Next.js), `bruno/`, `scripts/`, `config/`. `src/contracts` is always present. The other parts are optional.
- The `package.json` has the phases `_phase:build`, `_phase:lint`, `_phase:typecheck`, `_phase:test`, `_phase:e2e`. Each phase runs every part and fails fast with the part name.
- `bruno/` holds the Bruno collection. Each API route has one `.bru` request with docs and assertions.
- `REVIEW.md` holds the review rules for the project.
- Sample: `projects/sample` has every part.

## Contracts flow

1. Write the Zod schema in `src/contracts/<resource>.ts`.
2. `rush build` emits JSON Schema and `dist/openapi.json`.
3. Python: `datamodel-code-generator` writes Pydantic v2 models to `src/api-py/src/<package>/generated/`.
4. Go: `oapi-codegen` writes types to `src/api-go/internal/gen/`.
5. Never edit generated code by hand. Change the schema and regenerate.

## Import rules

- Imports inside a project are relative.
- `web` imports `src/contracts` and `packages/*`. Never `src/api`.
- `src/api` imports `src/contracts` and `packages/*`. Never `web`.
- `src/contracts` imports only `zod`.
- `bin` and `lib` import `src/contracts` (types only) and `packages/cdk-constructs`.
- A project never imports another project. Shared code goes in `packages/*` (needs a human).
- `src/api-py` and `src/api-go` import only generated models and own code.
- A project `bin` or `lib` never imports `platform/infra`. It reads SSM values through `@vprprudhvi/shared-cdk-constructs`.
- Full list: [repo-overview.md](../docs/guides/repo-overview.md).

## Duties for each part

- API route: add a Bruno request. The `bruno-coverage` gate fails without it.
- Web page: add a Playwright spec with `page.goto` and an axe check. The `playwright-coverage` gate fails without it.
- Each part: add a trace propagation test. See [observability.md](../docs/standards/observability.md).
- `projects/*/bin/**` and `projects/*/lib/**` are high risk. A human approves each change.

## Guides by part

- contracts: [contracts.md](../docs/guides/contracts.md)
- web: [web.md](../docs/guides/web.md)
- api (TypeScript): [api.md](../docs/guides/api.md)
- api-py: [api-py.md](../docs/guides/api-py.md)
- api-go: [api-go.md](../docs/guides/api-go.md)
- infra (`bin`, `lib`): [infra.md](../docs/guides/infra.md)

## Skills

- New project: [new-project](../.claude/skills/new-project/SKILL.md). New part: [add-project-part](../.claude/skills/add-project-part/SKILL.md).
- Routes: [new-api-route](../.claude/skills/new-api-route/SKILL.md), [py](../.claude/skills/new-api-route-py/SKILL.md), [go](../.claude/skills/new-api-route-go/SKILL.md). Page: [new-web-page](../.claude/skills/new-web-page/SKILL.md).
- Bruno: [api-docs](../.claude/skills/api-docs/SKILL.md).

## Links

- [coding-conventions.md](../docs/standards/coding-conventions.md), [testing.md](../docs/standards/testing.md), [ADR 0002](../docs/adr/0002-projects-layout-and-contracts.md), [ADR 0010](../docs/adr/0010-single-package-projects.md), [ADR 0007](../docs/adr/0007-polyglot-backends.md)
