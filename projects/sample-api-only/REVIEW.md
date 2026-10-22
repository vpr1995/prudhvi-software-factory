# REVIEW.md: sample-api-only

This file adds rules for `projects/sample-api-only/`. It applies together with `REVIEW.md` at the repository root. Read `CLAUDE.md` first.

This product has api, api-py, api-go, and infra parts. It has no web part. Apply each section to the changed files only.

## Review template: api (Fastify)

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

- The API runs on Lambda through `aws-lambda-fastify` behind API Gateway HTTP API.
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

## Review template: infra (AWS CDK)

Use this template with `REVIEW.md` for each change in `projects/<name>/infra/` or `packages/cdk-constructs/`. Apply the rules to the changed files only. Read the `cdk diff` output in the PR comment before you review.

## Checks

### IAM least privilege

- A policy does not use `*` for an action. Name each action.
- A policy does not use `*` for a resource unless the action has no resource-level support. State why in a comment.
- A role is not given `AdministratorAccess` or a broad managed policy.
- Use `grantRead` and `grantWrite` from the construct when they fit. Check the grant scope.

Example of a finding:

```
Important  projects/sample-fullstack/infra/src/constructs/assets.ts:31
Policy action is "s3:*" on resource "*". Access is not least privilege.
Fix: grant s3:GetObject on the bucket ARN only, or use bucket.grantRead().
```

### Stateful resources and replacement

- Read `cdk diff`. Find each resource marked `replace`.
- Stop and report `Important` for any replacement of a stateful resource (database, bucket, table, queue with messages, log group with data). Example: a changed logical ID or a changed immutable property.
- A rename of a construct ID changes the logical ID. Check the diff for it.

### RemovalPolicy

- A stateful resource does not use `RemovalPolicy.DESTROY` outside `dev`.
- Set `RemovalPolicy.RETAIN` for stateful resources in `staging` and `prod`.
- Do not set `removalPolicy` on a stateless resource unless the PR says why.

### Encryption

- Each S3 bucket has encryption. Use SSE-KMS or SSE-S3.
- Each database and each log group that holds data is encrypted.
- Each queue or topic that holds data is encrypted.
- TLS is required for each endpoint that the app uses.

### Public exposure

- A bucket does not allow public access. `blockPublicAccess` is set.
- A security group does not open `0.0.0.0/0` on a port other than 443 (or 80 for redirect).
- A database is not public.
- A public endpoint has an authentication path or a reason in the PR.

### Cost

- A new NAT gateway, load balancer, or instance type has a reason in the PR.
- A new log group sets a retention period. Do not leave it at "never expire".
- A new autoscaling setting has a maximum.
- A change in `dev` does not use a production instance size.

### Config and naming

- Account IDs and region values come from `config/<env>.ts`. Do not hard-code them in constructs.
- Construct IDs are PascalCase. Do not set physical resource names. Let CDK generate them.
- Each stack has the tags the repository requires.

### Tests

- Each construct has a `Template.fromStack` assertion for each property the construct sets.
- Snapshot changes have a reason in the PR.
- `cdk synth` runs with cdk-nag. A nag error must be fixed, or it must have a suppression with a reason that a human approved.

### Platform inputs (SSM)

- A project reads platform values only through the SSM helpers in `@vprprudhvi/shared-cdk-constructs`.
- A project does not import `platform/infra` code. Check the import list.
- A project does not hard-code a user pool ID, a zone ID, or a certificate ARN.
- Each project creates its own Cognito app client. The client has no secret unless the PR says why.
- A project creates DNS records only inside the imported hosted zone, under its own subdomain.

### Lambda and API Gateway

- Each Lambda sets a timeout. The timeout is lower than the API Gateway HTTP API limit of 30 seconds.
- Each Lambda has a memory size and a reserved concurrency or a reason for none.
- Each Lambda role grants only the actions the function calls.
- API Gateway routes use an authorizer (Cognito JWT or IAM) unless the route is public and the PR says why.
- Each API Gateway stage sets throttling for a public route.
- Logs have a retention period.

## Python backend (api-py)

Apply `docs/templates/REVIEW.api-py.md` to each change in `projects/sample-api-only/api-py/`.

## Go backend (api-go)

Apply `docs/templates/REVIEW.api-go.md` to each change in `projects/sample-api-only/api-go/`.
