Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `projects/<name>/`.

## Anatomy

- `projects/<name>/` is one product. Each part is a Rush project named `@vprprudhvi/<name>-<kind>`.
- Kinds: `contracts` (always), `infra` (always), `web`, `api` (TypeScript), `api-py` (Python), `api-go` (Go). `web` and `api` are optional. `api-py` and `api-go` are optional backends.
- `projects/<name>/bruno/` holds the Bruno collection. Each API route has one `.bru` request with docs and assertions.
- `projects/<name>/REVIEW.md` holds the review rules for the project.
- Samples: `sample-fullstack` (web and api product) and `sample-api-only` (API product).

## Contracts flow

1. Write the Zod schema in `<name>/contracts/src/<resource>.ts`.
2. `rush build` emits JSON Schema and OpenAPI.
3. Python: `datamodel-code-generator` writes Pydantic v2 models to `src/<package>/generated/`.
4. Go: `oapi-codegen` writes types to `internal/gen/`.
5. Never edit generated code by hand. Change the schema and regenerate.

## Import rules

- `web` imports its own `contracts` and `packages/*`. Never `api`.
- `api` imports its own `contracts` and `packages/*`. Never `web`.
- `contracts` imports only `zod`.
- `infra` imports its own `contracts` (types only) and `packages/cdk-constructs`.
- A project never imports another project. Shared code goes in `packages/*` (needs a human).
- `api-py` and `api-go` import only generated models and own code.
- A project `infra` never imports `platform/infra`. It reads SSM values through `@vprprudhvi/shared-cdk-constructs`.
- Full list: [repo-overview.md](../docs/guides/repo-overview.md).

## Duties for each part

- API route: add a Bruno request. The `bruno-coverage` gate fails without it.
- Web page: add a Playwright spec with `page.goto` and an axe check. The `playwright-coverage` gate fails without it.
- Each part: add a trace propagation test. See [observability.md](../docs/standards/observability.md).
- `projects/*/infra/**` is high risk. A human approves each change.

## Guides by kind

- contracts: [contracts.md](../docs/guides/contracts.md)
- web: [web.md](../docs/guides/web.md)
- api (TypeScript): [api.md](../docs/guides/api.md)
- api-py: [api-py.md](../docs/guides/api-py.md)
- api-go: [api-go.md](../docs/guides/api-go.md)
- infra: [infra.md](../docs/guides/infra.md)

## Skills

- New project: [new-project](../.claude/skills/new-project/SKILL.md). New part: [add-project-part](../.claude/skills/add-project-part/SKILL.md).
- Routes: [new-api-route](../.claude/skills/new-api-route/SKILL.md), [py](../.claude/skills/new-api-route-py/SKILL.md), [go](../.claude/skills/new-api-route-go/SKILL.md). Page: [new-web-page](../.claude/skills/new-web-page/SKILL.md).
- Bruno: [api-docs](../.claude/skills/api-docs/SKILL.md).

## Links

- [coding-conventions.md](../docs/standards/coding-conventions.md), [testing.md](../docs/standards/testing.md), [ADR 0002](../docs/adr/0002-projects-layout-and-contracts.md), [ADR 0007](../docs/adr/0007-polyglot-backends.md)
