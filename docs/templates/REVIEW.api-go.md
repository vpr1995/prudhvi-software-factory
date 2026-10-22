# Review template: api-go (Go, Lambda)

Use this template with `REVIEW.md` for each change in `projects/<name>/api-go/`. Apply the rules to the changed files only. The backend runs on Lambda with `provided.al2023` and `aws-lambda-go`.

## Checks

### Input validation through contracts

- Each handler decodes the request body into a type from `internal/gen/`. Do not decode into `map[string]any`.
- Validate the decoded value before any business logic. Reject unknown fields with `json.Decoder.DisallowUnknownFields`.
- Parse path and query parameters with the same rules as the contract.

Example of a finding:

```
Important  projects/sample-api-only/api-go/internal/handlers/orders.go:34
Body is decoded into map[string]any and the field is read by key. Input is not validated.
Fix: decode into gen.CreateOrder with DisallowUnknownFields and check the required fields.
```

### Generated types

- Types come from `internal/gen/`. A file in `internal/gen/` is not edited.
- The drift check in CI must pass. Report `Important` if the PR changes `internal/gen/` without a Zod change in `<project>-contracts`.

### Error envelope

- Each error response has the form `{"error": {"code", "message", "requestId"}}`.
- The `code` is UPPER_SNAKE_CASE. It comes from a sentinel error or a typed error.
- An unexpected error returns a generic 500. The response does not include the Go error text.

### Errors and control flow

- Wrap each error with `%w` and add context.
- Compare errors with `errors.Is` and `errors.As`.
- Handlers return errors. A handler does not call `panic`.
- Each `context.Context` argument comes first.

### Authorization

- Each route that reads or writes user data checks the caller identity from the Cognito JWT claims.
- Each route checks that the caller owns the object.

### Lambda runtime

- Create clients and the router at package init or in `main`. Do not create them per invocation.
- Each function sets a timeout below the API Gateway HTTP API limit of 30 seconds. Use the context deadline.
- Do not keep request state in package variables.

### Logging and secrets

- Logs do not include request bodies, tokens, or personal fields.
- Read configuration once in `main`. Do not read environment variables in a handler.

### N+1 queries

- A loop does not call the database or an HTTP client for each item. Use a batch query.
- A list endpoint has a limit.

### Timeouts and resources

- Each outbound HTTP call uses a client with a timeout.
- Each `resp.Body` is closed.
- Each goroutine ends. A goroutine started in a handler waits for its result or uses the context.

### Tests

- Each route has a test with `httptest`.
- Each generated type has a round-trip test.
- Tests run with `-race`.

### Bruno requests

- Each new or changed route has a Bruno request in `projects/<name>/bruno/`. Report `Important` if it does not.
- The request has a `docs` block and an `assert` block. A request with no assertion fails `bruno-coverage`.
- Changing a route without changing its request is `Important`. Name the route and the request file.
