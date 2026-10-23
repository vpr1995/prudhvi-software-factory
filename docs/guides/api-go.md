# Guide: api-go (Go)

Part: `projects/<name>/src/api-go`. Package: `@vprprudhvi/<name>` (one package for the whole project). Go on Lambda (`provided.al2023`) behind an API Gateway HTTP API. Read the root `CLAUDE.md` and `projects/CLAUDE.md` first.

## Folder layout

- `src/api-go/cmd/<name>-api/main.go`: the Lambda entry point. A switch maps `METHOD /v1/<resources>` route keys to handlers.
- `src/api-go/internal/<resource>/`: domain code, handler, and tests.
- `src/api-go/internal/gen/`: types from `oapi-codegen`. Generated. Never edit.
- `src/api-go/scripts/`: `generate-types.sh`. The project `scripts/e2e.mjs` runs the e2e phase.
- `src/api-go/.golangci.yml`: lint rules. It is a gate file.

## Rules

- The schema source is Zod in `src/contracts`. Never write a type by hand.
- Follow Effective Go: MixedCaps names, short receiver names, `context.Context` as the first parameter.
- Wrap errors with `%w`. Check each error. Compare with `errors.Is` and `errors.As`.
- Never `panic` in a handler.
- Close HTTP response bodies. Build no SQL from strings.
- Import only generated types and own code. Never import TypeScript packages.
- Gates: `gofumpt`, `goimports`, `go vet`, `golangci-lint`, `govulncheck`, `go-licenses`. Complexity at most 15.
- `go.sum` is a gate file. Add a dependency only after the human approves.

## Tests

- Table-driven tests with `t.Run`. Run with `go test -race -cover`. Coverage at least 80%.
- Each handler has a test with `httptest`. Cover success, each error, and an invalid body.
- Add a Bruno request for each route. Use the `api-docs` skill.
- Rules: `docs/standards/testing.md`, sections 8.2, 9.

## Telemetry

- Missing package rule: if the OpenTelemetry modules are not available, skip this section and list it as an open item. See `docs/standards/observability.md`, section 2.
- Use `go.opentelemetry.io/otel` with `otelhttp` and `otellambda`.
- Extract the context from `event.Headers`. Set `traceparent` in the response headers. Call `ForceFlush(ctx)` on the tracer provider at the end of the handler.
- A `slog` handler wraps `slog.NewJSONHandler`. `ReplaceAttr` writes `level` in lower case. The handler adds `trace_id`, `span_id`, `trace_flags`, and `service.name` to each log record.
- Add a unit test: the log record has the trace id.
- The ADOT layer comes from the shared Lambda construct. See `docs/guides/infra.md`.
- Rules: `docs/standards/observability.md`.

## Links

- Conventions: `docs/standards/coding-conventions.md`, section H.
- Skills: `.claude/skills/new-api-route-go/SKILL.md`, `.claude/skills/api-docs/SKILL.md`.
- ADR: `docs/adr/0007-polyglot-backends.md`. Review template: `docs/templates/REVIEW.api-go.md`.
