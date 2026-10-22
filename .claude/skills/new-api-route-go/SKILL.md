---
name: new-api-route-go
description: Add a route to a project Go api (api-go) that runs on Lambda (provided.al2023) behind an API Gateway HTTP API. The schema starts in Zod contracts, types are regenerated with oapi-codegen, then the domain function, the handler, table-driven Go tests, and a Bruno request with docs and assertions. Use when asked to add a Go endpoint, route, or handler. Triggers include new go endpoint, add a route in go, api-go route, oapi-codegen, go lambda handler.
---

# new-api-route-go

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rules:
- The schema source is Zod in `projects/<name>/contracts`. Never write the Go type by hand.
- Generated code is in `internal/gen/` and starts with `// Code generated ... DO NOT EDIT.` Do not edit it.
- Path is kebab-case, plural, versioned: `/v1/<resources>`. The route key is `METHOD /v1/<resources>`.
- Errors use the envelope `{"error":{"code","message","requestId"}}`. Codes are UPPER_SNAKE_CASE.
- Context is the first parameter. Wrap errors with `%w`. Never `panic` in a handler.

## Steps

1. Read `projects/<name>/api-go/cmd/`, `internal/`, and `projects/<name>/bruno/`. Copy their style.
2. Add the schema in `projects/<name>/contracts/src/<resource>.ts`. Then build contracts so `dist/openapi.json` is emitted: `rush build --only @vprprudhvi/<name>-contracts`.
3. Regenerate the types: `rush build --only @vprprudhvi/<name>-api-go`. The `_phase:build` script runs `scripts/generate-types.sh`. Check `internal/gen/types.gen.go` has the new types.
4. Add the domain code in `internal/<resource>/<action>.go`. It returns `(T, error)`. Define sentinel errors with `errors.New` and check them with `errors.Is`. It does not import the Lambda package.
5. Add the handler in `internal/<resource>/handler.go`: `func (h *Handler) <Action>(ctx context.Context, req events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error)`. Decode the body into the generated type and validate it. Map each sentinel error to its status and envelope.
6. Add the route key to the switch in `cmd/<name>-api/main.go`.
7. Add telemetry. Read `docs/standards/observability.md`. If the OpenTelemetry modules do not exist for the part, skip this step and the trace test, and report them as open items (section 2 of that document). Start a span named `<domain>.<action>` with `go.opentelemetry.io/otel` around each adapter call. Pass `ctx` on. Log with `slog` through the handler that lower-cases `level` and adds `trace_id`, `span_id`, `trace_flags`, and `service.name`. The ADOT layer comes from the shared Lambda construct. Do not add it by hand. See `new-cdk-construct`. If the OpenTelemetry modules are not in `go.mod`, stop. A new dependency needs approval, and `go.sum` is a gate file.
8. Write table-driven tests in `internal/<resource>/<action>_test.go`. Cover success, each error, and an invalid body. Use `t.Run` for each case. Add a case with a `traceparent` header: the log record must have the trace id.
9. Write the Bruno request at `projects/<name>/bruno/<resource>/<action>.bru`. Use the `api-docs` skill for the format.
10. Run `go test -race -cover ./internal/<resource>/...` in `projects/<name>/api-go` and paste the output. Then run `rush test --only @vprprudhvi/<name>-api-go`.
11. Run `rush e2e --only @vprprudhvi/<name>-api-go` and paste the output.
12. Run the `verify` skill.

## Done when

- [ ] The Go types came from `internal/gen/`. No hand-written copy of a contract.
- [ ] `gofumpt`, `go vet`, and `golangci-lint` pass in `_phase:lint` and `_phase:typecheck`. Output is pasted.
- [ ] `go test -race` covers success, errors, and invalid input. Coverage stays at or above 80%.
- [ ] The `.bru` file has docs, at least one assertion, and a tests block. `rush e2e` output is pasted.
- [ ] The `verify` skill passes.
- [ ] A test proves the log record has the trace id. The Bruno request asserts the `traceparent` header.

## Do not

- Edit files in `internal/gen/`.
- Ignore an error return, or assign it to `_`.
- Use `panic` in a handler, or `%v` where `%w` is needed.
- Use `html/template` bypasses, `exec.Command` with input through a shell, or `InsecureSkipVerify`.
- Add a dependency by hand. Use `go get <module>` and `go mod tidy` only after the human approves. `go.sum` is a gate file.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `//nolint` or `// #nosec` without a human. Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Lower the 80% coverage threshold or the golangci-lint rule list in `.golangci.yml`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`.
- Run `cdk deploy`.
- Use `--no-verify`.
