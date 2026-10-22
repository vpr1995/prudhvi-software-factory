# Guide: contracts

Kind: `projects/<name>/contracts`. Package: `@vprprudhvi/<name>-contracts`. Read the root `CLAUDE.md` and `projects/CLAUDE.md` first.

## Purpose

- Zod in `<project>-contracts` is the only source of the API shape. Python and Go models are generated from it.
- Never edit generated Python or Go code by hand. Change the Zod schema and regenerate.

## Folder layout

- `contracts/src/<resource>.ts`: one file per resource. Zod schemas and inferred types only. No runtime logic.
- `contracts/scripts/`: build scripts that emit JSON Schema and OpenAPI.
- Output: `dist/openapi.json` and JSON Schema files, written by `_phase:build` (`z.toJSONSchema`).

## Rules

- `contracts` imports only `zod`. It never imports `web`, `api`, or `infra`.
- Name a schema `<Name>Schema`. The inferred type has the same name without `Schema`. Example: `CreateOrderSchema` and `CreateOrder`.
- API paths are kebab-case, plural, and versioned. JSON fields are camelCase.
- Every API error uses one envelope: `{ error: { code, message, requestId } }`. The `requestId` is the trace id (see `docs/standards/observability.md`).
- Do not put telemetry or logging code in contracts.

## Generation flow

1. Change the Zod schema.
2. Run `rush build --only @vprprudhvi/<name>-contracts`. It emits JSON Schema and OpenAPI.
3. Python: run `rush build --only @vprprudhvi/<name>-api-py`. `datamodel-code-generator` writes Pydantic v2 models to `src/<package>/generated/`.
4. Go: run `rush build --only @vprprudhvi/<name>-api-go`. `oapi-codegen` writes types to `internal/gen/`.
5. Commit the generated code. CI fails on drift.

## Tests

- Test each Zod schema with valid and invalid input. See `docs/standards/testing.md`, section 3.4.
- Mutation tests (Stryker) run nightly on `contracts`.
- Each generated Python model has a round-trip test. See `docs/standards/testing.md`, section 8.1.

## Links

- Conventions: `docs/standards/coding-conventions.md`, sections A.8, A.13, A.14, C.3, D.3.
- Skills: `.claude/skills/new-api-route/SKILL.md`, `.claude/skills/new-api-route-py/SKILL.md`, `.claude/skills/new-api-route-go/SKILL.md`.
- ADR: `docs/adr/0002-projects-layout-and-contracts.md`, `docs/adr/0007-polyglot-backends.md`.
