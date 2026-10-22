# Review template: api (Fastify)

Use this template with `REVIEW.md` for each change in `projects/<name>/api/`. Apply the rules to the changed files only.

## Checks

### Input validation through contracts

- Each route validates the body, params, and query with a Zod schema from the project's `contracts`.
- The route uses `fastify-type-provider-zod`. Do not read `request.body` without the schema.
- Validation runs before any business logic.
- A schema does not accept unknown keys by default. Use `.strict()` for write bodies.
- Path params that are IDs are checked for format. Do not pass them to a query unchecked.

Example of a finding:

```
Important  projects/sample-api-only/api/src/routes/order/create-order.ts:18
Body is cast with `as CreateOrder`. Input is not validated at runtime.
Fix: attach the CreateOrderSchema to the route and remove the cast.
```

### Error envelope

- Every error response has the form `{ error: { code, message, requestId } }`.
- `code` is UPPER_SNAKE_CASE and comes from an `AppError` subclass.
- The error handler maps unknown errors to a generic 500. The response does not include a stack trace.
- The `requestId` is returned in the body and in a header.

### Authorization

- Each route that reads or writes user data checks the caller's identity.
- Each route checks that the caller owns the object it reads or writes. A valid session alone is not enough.
- Authorization runs in a plugin or a hook. A route does not skip it.
- Admin-only routes check the role. They do not check a flag from the client.

### N+1 queries

- A loop does not call the database, a cache, or an HTTP client for each item.
- Use a batch query or a join.
- A list endpoint has a limit and a maximum limit.

### Timeouts

- Each outbound HTTP call has a timeout.
- Each database query has a timeout or uses a pool timeout.
- A timeout returns an error with a code. It does not hang the request.

### Logging and secrets

- Logs use `@vprprudhvi/shared-logger`. Do not use `console`.
- Logs do not include request bodies, tokens, or personal fields. Check the redaction list.
- Configuration comes from `config.ts`. Do not read `process.env` in a route.

### Contracts and tests

- The route matches the contract. A contract test checks the path, the method, the body, and the response.
- A route has a `fastify.inject()` test for success and for each error code.
- A new route with a new behavior has a flag from `packages/flags`.

### Layers

- `domain/` has no import from `fastify` or `adapters/`.
- Route handlers call domain functions. They do not contain business rules.

### Runtime (Lambda)

- The API runs on Lambda through `@fastify/aws-lambda` behind API Gateway HTTP API.
- The Fastify app is built once per cold start. Do not build it per request.
- A request that takes longer than the API Gateway limit (30 seconds) fails. Move long work to a background job.
- Do not keep state between requests in module scope, except a cached client or config.
- Do not write files to the Lambda filesystem except under `/tmp`.

### Bruno requests

- Each new or changed route has a Bruno request in `projects/<name>/bruno/`. Report `Important` if it does not.
- The request has a `docs` block with purpose, auth, and error codes.
- The request has an `assert` block with the status, the error envelope shape, and the key fields.
- The request has no `skip-request` in a script. A request with no assertion fails `bruno-coverage`.
- Environment files hold no secrets. Secrets use `{{process.env.X}}`.
- Changing a route without changing its request is `Important`. Name the route and the request file.
