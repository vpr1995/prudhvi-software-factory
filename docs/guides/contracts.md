# Guide: contracts

Part: `projects/<name>/src/contracts`. Package: `@vprprudhvi/<name>` (one package for the whole project). Read the root `CLAUDE.md` and `projects/CLAUDE.md` first.

Contracts are optional. `rush new --project` and `rush add-part` do not make them. Add `src/contracts` when the project gets an endpoint with a request or a response body. The project owns its contracts.

## Purpose

- Zod in `src/contracts` is the only source of the API shape. OpenAPI is generated from it.
- Never edit generated output by hand. Change the Zod schema and rebuild.

## Folder layout

- `src/contracts/<resource>.ts`: one file per resource. Zod schemas and inferred types only. No runtime logic.
- `scripts/emit-openapi.mjs`: build script that emits OpenAPI.
- Output: `dist/openapi.json`, written by `_phase:build`.

## Rules

- `src/contracts` imports only `zod`. It never imports `web`, `src/api`, `bin`, or `lib`.
- Name a schema `<Name>Schema`. The inferred type has the same name without `Schema`. Example: `CreateOrderSchema` and `CreateOrder`.
- API paths are kebab-case, plural, and versioned. JSON fields are camelCase.
- Every API error uses one envelope: `{ error: { code, message, requestId } }`. The `requestId` is the trace id (see `docs/standards/observability.md`).
- Do not put telemetry or logging code in contracts.

## Generation flow

1. Change the Zod schema.
2. Run `rush build --only @vprprudhvi/<name>`. The build phase emits OpenAPI to `dist/`.
3. Use the schemas in `src/api` and `web` through the inferred types.

## Tests

- Test each Zod schema with valid and invalid input. See `docs/standards/testing.md`, section 3.4.

## Links

- Conventions: `docs/standards/coding-conventions.md`, sections A.8, A.13, A.14, C.3, D.3.
- Skills: `.claude/skills/new-api-route/SKILL.md`.
- ADR: `docs/adr/0002-projects-layout-and-contracts.md`.
