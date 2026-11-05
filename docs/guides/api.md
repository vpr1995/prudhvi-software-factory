# Guide: api (TypeScript)

Part: `projects/<name>/src/api`. Package: `@vprprudhvi/<name>` (one package for the whole project). Fastify on Lambda. Read the root `CLAUDE.md` and `projects/CLAUDE.md` first.

## Folder layout

- `src/api/routes/<resource>/`: one Fastify plugin per route. It wires the schema and calls the domain.
- `src/api/domain/`: pure logic. It returns `Result<T, E>`. It never imports `adapters/` or `fastify`.
- `src/api/adapters/`: DB and HTTP clients. Domain code receives an adapter as a parameter.
- `src/api/config.ts`: the only place that reads `process.env`. It parses env with Zod.
- `src/api/server.ts`: `buildServer()`, error handler, and plugin registration.
- `src/api/lambda.ts`: wraps `buildServer()` with `@fastify/aws-lambda`. Route code does not import Lambda types.

## Rules

- Validate input with `src/contracts` (relative import). Use `fastify-type-provider-zod` and `withTypeProvider<ZodTypeProvider>()`.
- Errors extend `AppError` with an UPPER_SNAKE_CASE `code`. Use the one error handler in `server.ts`.
- No auth hook exists yet. When a route needs auth, add one hook. Do not parse tokens in a route.
- Never import from `web/` or another project.
- Put new user-visible behavior behind a flag from `@vprprudhvi/shared-flags`.
- Log only with `@vprprudhvi/shared-logger`.

## Tests

- Use `fastify.inject()`. Do not open a port.
- Cover success, each error path, and an invalid body (400 and the envelope).
- Add a contract test for each route.
- Add a Bruno request for each route. Use the `api-docs` skill. `rush e2e` runs it.
- Rules: `docs/standards/testing.md`, sections 3.1, 3.4, 8, 11.

## Telemetry

- `lambda.ts` calls `initTelemetry({ serviceName })`. Then it loads the server with `await import('./server.js')`. Static imports would run first.
- `lambda.ts` flushes the spans inline: it calls `forceFlush` (bounded by a timeout) before the Lambda freezes. See `projects/sample/src/api/lambda.ts`.
- `@fastify/otel` names route spans `<METHOD> <route>` and continues an incoming `traceparent`. The `onSend` hook in `server.ts` sets the response `traceparent`.
- Put `withSpan` calls in routes and adapters. Keep `domain/` free of telemetry.
- Set `requestId` in the error envelope to `getTraceContext().traceId`.
- Add a trace test. Call `fastify.inject` with a `traceparent` header. Expect the same trace id in the response `traceparent` and in the log line. See `projects/sample/test/api/trace-propagation.test.ts`.
- The Lambda layer comes from the shared construct. See `docs/guides/infra.md`.
- Rules: `docs/standards/observability.md`.

## Links

- Conventions: `docs/standards/coding-conventions.md`, sections B, C, D.1, F.
- Skills: `.claude/skills/new-api-route/SKILL.md`, `.claude/skills/api-docs/SKILL.md`.
- Review template: `docs/templates/REVIEW.api.md`.
