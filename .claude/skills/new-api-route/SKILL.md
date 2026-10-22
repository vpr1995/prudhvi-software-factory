---
name: new-api-route
description: Add a Fastify route to a project TypeScript api. Adds the Zod schema in the project contracts, a pure domain function that returns Result, the route with fastify-type-provider-zod, fastify.inject tests, and a Bruno request with docs and assertions. Use when asked to add a TypeScript endpoint, route, API resource, or handler. Triggers include new endpoint, add a route, add an API, new resource, CRUD endpoint, add GET or POST.
---

# new-api-route

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rules: path is kebab-case, plural, versioned: `/v1/<resources>`. Errors use the envelope `{ error: { code, message, requestId } }`. Codes are UPPER_SNAKE_CASE. The API runs on Lambda through `src/lambda.ts`. Route code does not import Lambda types.

## Steps

1. Read the existing routes in `projects/<name>/api/src/routes/`, the schemas in `projects/<name>/contracts/src/`, and the Bruno folder in `projects/<name>/bruno/`. Copy their style.
2. Add the schema in `projects/<name>/contracts/src/<resource>.ts`:
   `export const CreateOrderSchema = z.object({ ... });` and `export type CreateOrder = z.infer<typeof CreateOrderSchema>;`
   Use only Zod and types in this file.
3. Add the domain function in `projects/<name>/api/src/domain/<resource>/<action>.ts`. It returns `Result<T, AppError>` from `@vprprudhvi/shared-result`. It does not import fastify. Use an options object when it has more than 3 parameters.
4. If the route needs data access, add an adapter in `projects/<name>/api/src/adapters/`. Domain code receives the adapter as a parameter.
5. Add the route in `projects/<name>/api/src/routes/<resource>/<action>.ts`. Export a Fastify plugin. Use `withTypeProvider<ZodTypeProvider>()` and set `schema: { body, params, querystring, response }` from the contracts.
6. Protected routes use the auth hook already in `src/`. Do not parse tokens in the route.
7. Map each `Result` error to an HTTP status and the error envelope. Use the existing error handler in `server.ts`. Do not add a second handler.
8. Register the plugin in `projects/<name>/api/src/server.ts`.
9. Add telemetry. Read `docs/standards/observability.md`. If `packages/telemetry` does not exist, skip this step, the trace test in step 10, and the `traceparent` assertion in step 11, and report them as open items (section 2 of that document). Wrap each adapter call in `withSpan('<domain>.<action>', ...)` from `@vprprudhvi/shared-telemetry`. Keep `domain/` free of telemetry. Set `requestId` in the error envelope to the trace id from `getTraceContext()`. Log only with `@vprprudhvi/shared-logger`. If the package exists but is not a dependency of the api, or `src/lambda.ts` does not call `initTelemetry` and use `wrapLambdaHandler`, stop. A new dependency needs approval. After approval, write `rush add -p @vprprudhvi/shared-telemetry` (run from the api folder) to `.claude/state/handoff/<name>/NN-commands.txt`. A human runs it.
10. Write the tests next to the source:
   - `<action>.test.ts`: `app.inject()` for success, each error path, and an invalid body (expect 400 and the envelope).
   - `<action>.domain.test.ts`: unit tests for the domain function.
   - `<action>.trace.test.ts`: call the wrapped Lambda handler with a fake HTTP API v2 event that has a `traceparent` header. Expect the response `traceparent` and the log line to carry the same trace id.
11. Write the Bruno request at `projects/<name>/bruno/<resource>/<action>.bru`. Use the `api-docs` skill for the format. It needs a `docs` block (purpose, auth, errors), and an `assert` block and a `tests` block that cover the status, the envelope shape on errors, and the key fields, and that the response has a `traceparent` header. The URL path must equal the OpenAPI path from the contracts.
12. Run `rush test --to @vprprudhvi/<name>-api` and paste the output.
13. Run `rush e2e --only @vprprudhvi/<name>-api` and paste the output. It starts the server and runs the Bruno folder.
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
- Import `@vprprudhvi/<name>-web` or another project from the api.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Run `rush add -p <pkg>` yourself. Write the command to `.claude/state/handoff/<name>/NN-commands.txt` after the human approves. A human runs it.
- Write a gate file in place. Write it to `.claude/state/handoff/<name>/` (`docs/standards/gates.md`, section 2.4).
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`.
- Run `cdk deploy`.
- Use `--no-verify`.
