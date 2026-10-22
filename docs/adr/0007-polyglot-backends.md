# ADR 0007: Allow Python and Go backends next to the TypeScript API

- Status: Accepted
- Date: 2026-10-22

## Context

Some backends need Python or Go. Examples: data work in Python, and a service that needs Go's runtime. The team wants these backends to use the same monorepo, the same gates, and the same contracts as the TypeScript API. Each new language must not create a second source of truth for the API shape.

## Decision

- Add two backend kinds for each project: `api-py` (Python) and `api-go` (Go). Each sits next to `api` (TypeScript): `projects/<name>/api-py` and `projects/<name>/api-go`.
- Package names: `@vprprudhvi/<project>-api-py` and `@vprprudhvi/<project>-api-go`.
- Each backend has a thin `package.json`. Its `_phase:*` scripts call the native tools. Rush runs the scripts. So `rush verify`, `--impacted-by`, the build cache, the Stop hook, and CI work without change.
- Zod in `<project>-contracts` stays the only source of the API shape. The build step emits JSON Schema and OpenAPI with `z.toJSONSchema`. Then:
  - `datamodel-code-generator` makes Pydantic v2 models for Python,
  - `oapi-codegen` makes Go types.
- Generated code is committed. CI regenerates it and fails on any drift. Nobody edits generated code by hand.
- Python gates: `uv` with a lock file, ruff, `mypy --strict`, pytest with coverage, bandit, pip-audit, and a pip-licenses allowlist. Lambda uses `aws-lambda-powertools`.
- Go gates: gofumpt, goimports, `go vet`, golangci-lint, `go test -race -cover`, govulncheck, and go-licenses. Lambda uses `provided.al2023` and `aws-lambda-go`.
- Opengrep, gitleaks, TruffleHog, and OSV-Scanner cover both languages through their rules and lock files.
- Coding rules: `docs/standards/coding-conventions.md`, sections G (Python) and H (Go).
- Python and Go backends do not import TypeScript packages from `packages/*`.

## Consequences

- Positive: One contract source. Each language gets the same gate layers.
- Positive: Rush build cache and impacted-only builds work for all languages.
- Negative: Two code generators must stay in step with the Zod schema. The drift check catches a mismatch.
- Negative: Python and Go backends cannot reuse TypeScript packages such as `flags`, `logger`, and `result`. Each backend uses its own equivalent. Feature flags for these backends read the same flag source as `packages/flags`.
- Negative: More tools to install and keep current. Tool versions are pinned in the lock files.
- Open: Python and Go backends must show the same flag names and the same error envelope as the TypeScript API. The contract tests check the envelope.
