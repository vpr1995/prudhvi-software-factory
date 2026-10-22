# Guide: api (TypeScript)

Kind: `projects/<name>/api`. Package: `@vprprudhvi/<name>-api`. Fastify on Lambda. Read the root `CLAUDE.md` and `projects/CLAUDE.md` first.

## Folder layout

- `api/src/routes/<resource>/`: one Fastify plugin per route. It wires the schema and calls the domain.
- `api/src/domain/`: pure logic. It returns `Result<T, E>`. It never imports `adapters/` or `fastify`.
- `api/src/adapters/`: DB and HTTP clients. Domain code receives an adapter as a parameter.
- `api/src/config.ts`: the only place that reads `process.env`. It parses env with Zod.
- `api/src/server.ts`: `buildServer()`, error handler, and plugin registration.
- `api/src/lambda.ts`: wraps `buildServer()` with `@fastify/aws-lambda`. Route code does not import Lambda types.

## Rules

- Validate input with the project `contracts`. Use `fastify-type-provider-zod` and `withTypeProvider<ZodTypeProvider>()`.
- Errors extend `AppError` with an UPPER_SNAKE_CASE `code`. Use the one error handler in `server.ts`.
- Use the existing auth hook for protected routes. Do not parse tokens in a route.
- Never import `@vprprudhvi/<name>-web` or another project.
- Put new user-visible behavior behind a flag from `@vprprudhvi/shared-flags`.
- Log only with `@vprprudhvi/shared-logger`.

## Tests

- Use `fastify.inject()`. Do not open a port.
- Cover success, each error path, and an invalid body (400 and the envelope).
- Add a contract test for each route.
- Add a Bruno request for each route. Use the `api-docs` skill. `rush e2e` runs it.
- Rules: `docs/standards/testing.md`, sections 3.1, 3.4, 9, 11.

## Telemetry

- Missing package rule: if `packages/telemetry` does not exist, skip this section and list it as an open item. See `docs/standards/observability.md`, section 2.
- `lambda.ts` calls `initTelemetry({ serviceName })`. Then it loads the server with `await import('./server.js')`. Static imports would run first.
- `lambda.ts` exports `wrapLambdaHandler(handler)` from `@vprprudhvi/shared-telemetry` (planned). The wrapper extracts `traceparent` from `event.headers`, sets the response `traceparent`, and calls `forceFlush` before the Lambda freezes.
- `@fastify/otel` names route spans `<METHOD> <route>`. It does not read `traceparent`.
- Put `withSpan` calls in routes and adapters. Keep `domain/` free of telemetry.
- Set `requestId` in the error envelope to `getTraceContext().traceId`.
- Add a trace test. Call the wrapped Lambda handler with a fake HTTP API v2 event that has a `traceparent` header. Expect the same trace id in the response `traceparent` and in the log line. A bare `fastify.inject` test skips the extraction step.
- The Lambda layer comes from the shared construct. See `docs/guides/infra.md`.
- Rules: `docs/standards/observability.md`.

## Links

- Conventions: `docs/standards/coding-conventions.md`, sections B, C, D.1, F.
- Skills: `.claude/skills/new-api-route/SKILL.md`, `.claude/skills/api-docs/SKILL.md`.
- Review template: `docs/templates/REVIEW.api.md`.
