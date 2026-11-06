---
name: new-api-route
description: Add a Fastify route to a project TypeScript api. Adds the Zod schema in the project contracts, a pure domain function that returns Result, the route with fastify-type-provider-zod, fastify.inject tests, and a Bruno request with docs and assertions. Use when asked to add a TypeScript endpoint, route, API resource, or handler. Triggers include new endpoint, add a route, add an API, new resource, CRUD endpoint, add GET or POST.
---

# new-api-route

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rules: path is kebab-case, plural, versioned: `/v1/<resources>`. Errors use the envelope `{ error: { code, message, requestId } }`. Codes are UPPER_SNAKE_CASE. The API runs on Lambda through `src/api/lambda.ts`. Route code does not import Lambda types.

## Steps

1. Read the existing routes in `projects/<name>/src/api/routes/`, the schemas in `projects/<name>/src/contracts/`, and the Bruno folder in `projects/<name>/bruno/`. Copy their style. Follow the sample layout in `projects/sample`.
2. Add the schema in `projects/<name>/src/contracts/<resource>.ts`:
   `export const CreateOrderSchema = z.object({ ... });` and `export type CreateOrder = z.infer<typeof CreateOrderSchema>;`
   Use only Zod and types in this file.
3. Add the domain function in `projects/<name>/src/api/domain/<resource>.ts`. It returns `Result<T, AppError>` from `@vprprudhvi/shared-result`. It does not import fastify. Use an options object when it has more than 3 parameters.
4. If the route needs data access, add an adapter in `projects/<name>/src/api/adapters/`. Domain code receives the adapter as a parameter.
5. Add the route in `projects/<name>/src/api/routes/<resource>/<resource>-routes.ts`. Export a Fastify plugin. Use `withTypeProvider<ZodTypeProvider>()` and set `schema: { body, params, querystring, response }` from the contracts.
6. Do not parse tokens in the route. The API Gateway JWT authorizer checks tokens. No auth hook exists in `src/api` yet.
7. Map each `Result` error to an HTTP status and the error envelope. Use the existing error handler in `server.ts`. Do not add a second handler.
8. Register the plugin in `projects/<name>/src/api/server.ts`. When the project has infra, add the route to its route list (`SAMPLE_ROUTES` in `projects/sample/lib/sample-api-stack.ts`). The gateway blocks every other path.
9. Add telemetry. Read `docs/standards/observability.md`. Wrap each adapter call in `withSpan('<domain>.<action>', ...)` from `@vprprudhvi/shared-telemetry`. Keep `domain/` free of telemetry. Set `requestId` in the error envelope to the trace id from `getTraceContext()`. Log only with `@vprprudhvi/shared-logger`. `src/api/lambda.ts` calls `initTelemetry` and flushes spans inline before it returns (see `projects/sample`). If the api does not do this, copy that code from the sample. If `@vprprudhvi/shared-telemetry` is not a dependency of the api, run `rush add -p @vprprudhvi/shared-telemetry` from `projects/<name>`. This needs no approval when `rush audit` passes. The pre-push hook and CI run it when the lockfile changes. If the audit fails, stop and ask the human. Stage `package.json` and each file under `common/config/rush/` that the command changed. They go in the same commit as the route. Check with `git status --short`.
10. Write the tests in `projects/<name>/test/`. The path mirrors the source path. See `docs/standards/testing.md`, section 1.

- `test/api/server.test.ts`: `app.inject()` for success, each error path, and an invalid body (expect 400 and the envelope). Add the cases for the new route there.
- `test/api/domain/<resource>.test.ts`: unit tests for the domain function.
- `test/api/trace-propagation.test.ts`: send a request with a `traceparent` header. Expect the response `traceparent` and the log line to carry the same trace id. Add a case for the new route.

11. Write the Bruno request at `projects/<name>/bruno/<resource>/<action>.bru`. Use the `api-docs` skill for the format. It needs a `docs` block (purpose, auth, errors), and an `assert` block and a `tests` block that cover the status, the envelope shape on errors, and the key fields, and that the response has a `traceparent` header. The URL path must equal the OpenAPI path from the contracts.
12. Run `rush test --to @vprprudhvi/<name>` and paste the output.
13. Run `rush e2e --only @vprprudhvi/<name>` and paste the output. It starts the server and runs the Bruno folder.
14. Run the `verify` skill.

## Done when

- [ ] The schema is in contracts. The inferred type has the same name without `Schema`.
- [ ] The domain code does not import fastify or adapters. The route does not read `process.env`.
- [ ] `inject` tests cover success, errors, and invalid input. The output is pasted.
- [ ] The `.bru` file has docs, at least one assertion, and a tests block. `rush e2e` output is pasted.
- [ ] The `verify` skill passes.
- [ ] The route has a trace propagation test, and the Bruno request asserts the `traceparent` header. No `@opentelemetry/*` SDK import in the api.

## Do not

- Put fastify imports in `domain/`. Put `process.env` in routes.
- Write a second copy of a schema type by hand.
- Use a barrel `index.ts` inside the project.
- Import from `web/` or another project from `src/api`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`.
- Never run `cdk deploy` or `cdk destroy` (root CLAUDE.md rule 4).
- Use `--no-verify`.
