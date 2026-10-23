# Review template: api-py (Python, Lambda)

Use this template with `REVIEW.md` for each change in `projects/<name>/src/api-py/`. Apply the rules to the changed files only. The backend runs on Lambda through Powertools.

## Checks

### Input validation through contracts

- Each handler parses the request body with a Pydantic model from `generated/`. Do not read `event["body"]` without a model.
- Parse the path parameters and query parameters with a model too.
- Validation runs before any business logic.
- Reject unknown fields for write bodies. Use `extra="forbid"` on the model.

Example of a finding:

```
Important  projects/sample/src/api-py/src/sample_api/handlers/orders.py:21
Body is read with json.loads and used as a dict. Input is not validated.
Fix: parse the body with CreateOrder.model_validate_json and pass the model on.
```

### Generated models

- Imports come from `generated/`. A file in `generated/` is not edited.
- The drift check in CI must pass. Report `Important` if the PR changes `generated/` without a Zod change in `src/contracts`.

### Error envelope

- Each error response has the form `{"error": {"code", "message", "requestId"}}`.
- The `code` is UPPER_SNAKE_CASE. It comes from an exception class that the handler maps.
- An unexpected exception returns a generic 500. The response does not include a traceback.

### Authorization

- Each route that reads or writes user data checks the caller identity from the Cognito JWT claims.
- Each route checks that the caller owns the object. A valid token alone is not enough.

### Lambda runtime

- The app is built at module scope, once per cold start. Do not build it per invocation.
- Each function sets a timeout below the API Gateway HTTP API limit of 30 seconds.
- Do not keep request state in module scope.

### Logging and secrets

- Log with `aws_lambda_powertools` `Logger`. Do not use `print`.
- Logs do not include request bodies, tokens, or personal fields.
- Read configuration once. Do not read `os.environ` in a handler.

### N+1 queries

- A loop does not call the database or an HTTP client for each item. Use a batch call.
- A list endpoint has a limit.

### Timeouts

- Each outbound HTTP call sets a timeout.
- Each database call sets a timeout.

### Tests

- Each route has a test with the framework test client.
- Each generated model has a round-trip test.
- A new route with a new behavior has a flag. The flag source is the same as for the TypeScript API.

### Bruno requests

- Each new or changed route has a Bruno request in `projects/<name>/bruno/`. Report `Important` if it does not.
- The request has a `docs` block and an `assert` block. A request with no assertion fails `bruno-coverage`.
- Changing a route without changing its request is `Important`. Name the route and the request file.
