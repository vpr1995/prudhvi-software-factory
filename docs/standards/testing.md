# Testing

This document sets the test rules for all projects and packages.

## 1. Rules

- Each TypeScript project uses Vitest.
- Each new behavior has a test. Each bug fix has a test that fails before the fix.
- Do not skip, delete, or weaken a test to make a check pass.
- Do not lower a coverage threshold.
- Unit test files sit in a `test/` folder at the root of the package or project. The path under `test/` mirrors the source path. The name is `<file>.test.ts` or `<file>.test.tsx`.
- The `test-location` check in `check-gates` fails a unit test file outside `test/`. Vitest runs only `test/**`.
- End-to-end tests sit in `e2e/` and use the name `*.spec.ts`.

| Source file                            | Unit test file                                   |
| -------------------------------------- | ------------------------------------------------ |
| `packages/<pkg>/src/a/b.ts`            | `packages/<pkg>/test/a/b.test.ts`                |
| `platform/infra/lib/x.ts`              | `platform/infra/test/x.test.ts`                  |
| `projects/<name>/src/contracts/x.ts`   | `projects/<name>/test/contracts/x.test.ts`       |
| `projects/<name>/src/api/routes/x.ts`  | `projects/<name>/test/api/routes/x.test.ts`      |
| `projects/<name>/web/components/x.tsx` | `projects/<name>/test/web/components/x.test.tsx` |
| `projects/<name>/lib/x.ts`             | `projects/<name>/test/infra/x.test.ts`           |
| `projects/<name>/bin/app.ts`           | `projects/<name>/test/infra/bin/app.test.ts`     |

The web test setup file is `projects/<name>/test/web/setup.ts`. Python and Go tests keep their own locations.

## 2. Coverage gates

| Gate                          | Value | Where it is set            | Where it runs   |
| ----------------------------- | ----- | -------------------------- | --------------- |
| Lines                         | 80%   | `tooling/vitest-config`    | `rush test`, CI |
| Branches                      | 75%   | `tooling/vitest-config`    | `rush test`, CI |
| Diff coverage (changed lines) | 90%   | CI script on the lcov file | CI (`ci.yml`)   |

Diff coverage checks only the lines changed in the PR.

## 3. Test types by part

### 3.1 API (`projects/<name>/src/api`)

- Use `fastify.inject()` for integration tests. Do not start a real port.
- Each route has a contract test. The contract test checks that the route matches the schemas in `src/contracts`.
- Test the error envelope. Every error response matches `{ error: { code, message, requestId } }`.
- Each route also has a Bruno request with docs and assertions. See section 9.

```ts
// Good: one request, one assertion on status and body.
const response = await app.inject({ method: 'GET', url: '/v1/users/u_1' });
expect(response.statusCode).toBe(200);
expect(UserSchema.parse(response.json())).toMatchObject({ id: 'u_1' });
```

```ts
// Bad: no assertion. The test passes even when the route fails.
await app.inject({ method: 'GET', url: '/v1/users/u_1' });
```

### 3.2 Web (`projects/<name>/web`)

- Use Testing Library for component tests. Query by role and label.
- Use Playwright for end-to-end tests and screenshot checks.
- Run `axe` checks in Playwright on each page that a PR changes.
- Each page has a Playwright spec. See section 10.

### 3.3 Infra (`projects/<name>/bin` and `projects/<name>/lib`, `packages/cdk-constructs`)

- Use CDK assertions (`Template.fromStack`) for each stack and construct.
- Use snapshot tests for each stack. A snapshot change needs a reason in the PR.
- Run `cdk-nag` with the AwsSolutions pack. An unresolved nag error fails `cdk synth`.
- Turn Lambda bundling off in unit tests. See `docs/guides/infra.md`.

### 3.4 Contracts and domain code

- Test each Zod schema with valid and invalid input.
- Test pure domain functions in `src/api/domain/` without Fastify.
- Mutation tests (Stryker) run nightly on `src/contracts` and `src/api/domain`. They do not run on each PR.

## 4. Anti-skip rules

The Stop hook and CI scan the diff. They fail when the diff adds any of these items:

| Pattern                                                                                                                        | Reason                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `.skip`, `.only`, `.todo`, `xit`, `xdescribe`, `test.fails`                                                                    | Skips or focuses tests.                                 |
| `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`                                                              | Hides a type or lint error.                             |
| `as any`, `as unknown as`                                                                                                      | Hides a type error.                                     |
| A deleted test file, or fewer `it(` or `test(` calls than before                                                               | Removes tests.                                          |
| A lower value in a coverage config, `--passWithNoTests`, `                                                                     |                                                         | true` in a script | Lowers a gate. |
| `nosemgrep`, `nosec`, `gitleaks:allow`, `checkov:skip`                                                                         | Hides a security finding.                               |
| An empty `catch {}` block                                                                                                      | Hides an error.                                         |
| Python: `@pytest.mark.skip`, `@pytest.mark.xfail`, `pytest.skip(`, `# noqa`, `# type: ignore`, `# pragma: no cover`, `# nosec` | Skips tests or hides a lint, type, or security finding. |
| Go: `t.Skip(`, `//nolint` without a linter name and reason, `// #nosec`                                                        | Skips tests or hides a finding.                         |
| A changed test with no assertion (rule `test-without-assertion`). See the note below this table.                               | A test with no assertion passes without testing.        |
| `--cov-fail-under` or a Go coverage minimum that goes down                                                                     | Lowers a gate.                                          |
| Playwright: `test.skip`, `test.fixme`, `test.fail`, `test.describe.skip`, `test.only`                                          | Skips or focuses e2e tests.                             |
| Bruno: a `.bru` request with no `assert` or `tests` block                                                                      | A request with no check passes without testing.         |
| Bruno: `skip-request` in a script                                                                                              | Skips a request.                                        |
| Bruno or Playwright: `--bail` removed from a script to hide a failure                                                          | Hides the first failure.                                |

The `test-without-assertion` rule reads each changed test. These items count as an assertion:

- JavaScript and TypeScript: `expect`, `assert`, `should`, `fail`, `t.is` and the other `t.` checks, `getBy` and `findBy` queries, and a helper named `assertX`, `expectX`, `checkX`, `verifyX`, `validateX` or `ensureX` (for example `verifyHealth(app)`).
- Python: `assert`, `pytest.raises`, `self.assertX`, `self.fail`, and a helper named `assert_x`, `check_x`, `expect_x`, `verify_x`, `validate_x` or `ensure_x`.
- Go: `t.Error`, `t.Fatal`, `t.Fail`, `assert.X(`, `require.X(`, `cmp.Diff`, and a call that passes `t`, for example `compare(t, got, want)`.

These items do not count as an assertion:

- `require('fs')` or `require("fs")`. This call loads a module.
- The bare words `verify`, `validate` and `ensure` in JavaScript, TypeScript and Python. A call such as `validate(input)` can pass and check nothing.
- A method call such as `schema.validateSync(input)` or `model.validate_json(data)`. This call can parse and check nothing.
- A method call `.check()`, for example `locator.check()` in Playwright. This call clicks a check box.
- Go `t.Run(`. The closure that `t.Run` gets must have its own assertion. When `t.Run` gets a named function, the test must also have an assertion or a call that passes `t`.

If a test must change, the change needs a reason in the PR. Removing a test needs the `test-removal` label from a human. See `docs/standards/gates.md`.

## 5. Stop hook checks

When an agent tries to finish, the Stop hook runs these checks on the session diff:

1. `rush build --to <impacted>`.
2. `rush typecheck --only <impacted>`.
3. `rush lint --only <impacted>`.
4. `rush test --impacted-by <changed>` with coverage.
5. `cdk synth` with cdk-nag, when `infra` changed.
   5a. `rush e2e --impacted-by <changed>` for each impacted web or api part (Bruno and Playwright).
6. Gitleaks on the diff and Opengrep on changed files.
7. The anti-skip scan in section 4.

The hook writes the result to `.claude/state/last-verify.json`. It blocks `gh pr create` and `git push` when the result does not match the current tree or does not pass.

## 6. CI checks

| Check                                       | Where                                                             | Blocks when                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `rush test` with coverage                   | `ci.yml`                                                          | A threshold fails.                                                                 |
| Diff coverage                               | `ci.yml`                                                          | Changed lines are below 90%.                                                       |
| Test-deletion check                         | `ci.yml`, `check-gates`                                           | A test file or test case is removed and the PR has no `test-removal` label.        |
| `rush e2e` (Bruno and Playwright, with axe) | `ci.yml`                                                          | A request, a spec, or an accessibility check fails.                                |
| `bruno-coverage` gate                       | `ci.yml`, `check-gates`, `local-gates.sh` (impacted API projects) | A route has no `.bru` request with an assertion.                                   |
| `playwright-coverage` gate                  | `ci.yml`, `check-gates`                                           | A page has no spec with `page.goto` and an axe check, or a web part has no `e2e/`. |
| `cdk synth` with cdk-nag                    | `infra.yml`                                                       | A nag error is unresolved.                                                         |
| Mutation tests                              | `nightly.yml`                                                     | Reported only. Open an issue for surviving mutants.                                |

## 7. When a test fails

1. Read the failing output. Find the file and the line.
2. Fix the cause in the source code, or fix a wrong expectation with a reason.
3. Run the same command again. Show the output.
4. Do not change the test to match a wrong result. Do not add a skip.

## 8. Python and Go backends

The Python (`api-py`) and Go (`api-go`) backends use the same rules as the TypeScript API. The tools differ.

### 8.1 Python (`projects/<name>/src/api-py`)

| Rule                                                                                         | Tool                                | Gate            |
| -------------------------------------------------------------------------------------------- | ----------------------------------- | --------------- |
| Tests run with pytest. Test files are named `test_*.py` and sit in `tests/`.                 | `pytest`                            | `rush test`     |
| Coverage: lines 80% minimum.                                                                 | `pytest-cov`, `--cov-fail-under=80` | `rush test`, CI |
| Each route has a test with the framework test client (Powertools event or ASGI test client). | `pytest`                            | Review and CI   |
| Each generated model has a round-trip test: parse valid JSON, reject invalid JSON.           | `pytest`                            | CI              |
| Contract tests check each route against the OpenAPI document in `dist/openapi.json`.         | `pytest`                            | CI              |
| Diff coverage on changed lines: 90%.                                                         | Same script as TypeScript           | CI              |

Use `uv run pytest` through `rush test`. Do not run `pip install` or `pytest` outside `uv`.

### 8.2 Go (`projects/<name>/src/api-go`)

| Rule                                                                                 | Tool                               | Gate            |
| ------------------------------------------------------------------------------------ | ---------------------------------- | --------------- |
| Tests use `go test`. Test files are named `*_test.go` and sit next to the source.    | `go test`                          | `rush test`     |
| Each test run uses the race detector: `go test -race`.                               | `go test -race -cover`             | `rush test`, CI |
| Coverage: 80% minimum.                                                               | `go test -coverprofile`, CI script | CI              |
| Each handler has a test with `httptest`.                                             | `go test`                          | Review and CI   |
| Contract tests check each route against the OpenAPI document in `dist/openapi.json`. | `go test`                          | CI              |
| Diff coverage on changed lines: 90%.                                                 | Same script as TypeScript          | CI              |

Do not use `t.Skip` to pass a check. Do not remove a `-race` flag.

## 9. API requests with Bruno

Each API route has a Bruno request. Bruno documents the route for people. It also tests the route in CI.

### 9.1 Collection layout

```text
projects/<name>/bruno/
  bruno.json
  environments/
    local.bru
    prod.bru
  orders/
    get-order.bru
    create-order.bru
```

- One folder for each resource. One `.bru` file for each route.
- Environment files hold URLs and variable names only. Secrets use `{{process.env.X}}`. Never write a secret in an environment file.
- The gitleaks rules and `check-gates` check these files.

### 9.2 Required blocks

Each request has these blocks:

| Block                                   | Required content                                          |
| --------------------------------------- | --------------------------------------------------------- |
| `meta`                                  | Name and type.                                            |
| Method block (`get`, `post`, and so on) | The URL and the body type.                                |
| `docs`                                  | Purpose, auth, and error codes.                           |
| `assert`                                | The status, the error envelope shape, and the key fields. |
| `tests`                                 | Checks that `assert` cannot express. Optional.            |

### 9.3 Example

```bru
meta {
  name: Get order
  type: http
  seq: 2
}

get {
  url: {{baseUrl}}/v1/orders/:orderId
  body: none
  auth: bearer
}

params:path {
  orderId: ord_123
}

auth:bearer {
  token: {{accessToken}}
}

docs {
  Returns one order that the caller owns.

  Auth: Cognito bearer token.
  Errors: 401 UNAUTHORIZED, 404 ORDER_NOT_FOUND.
}

assert {
  res.status: eq 200
  res.body.id: eq ord_123
}

tests {
  test("success response has no error envelope", function () {
    expect(res.body.error).to.be.undefined;
  });
}
```

### 9.4 Rules

- Each route in the `dist/openapi.json` OpenAPI output has at least one `.bru` request with the same method and path, and at least one assertion. `bruno-coverage` checks this.
- Update the `.bru` request in the same PR as the route.
- Run the collection with `@usebruno/cli`. The Rush `e2e` phase runs it. Do not run `bru` with a different version.
- Each project pins `@usebruno/cli` in its devDependencies or in an autoinstaller.

## 10. Web pages with Playwright

Each web part has an `e2e/` folder. The folder uses `@playwright/test` and `@axe-core/playwright`.

### 10.1 Rules

- Each `app/**/page.tsx` route has a spec. The spec calls `page.goto('<route>')` and runs an axe check. `playwright-coverage` checks this.
- A project with a `web/` folder and no `web/e2e/` folder fails the gate.
- Use a role or a label to find an element. Do not select by CSS class.
- Keep the screenshot and trace settings. They are on for failures in CI.
- In PR runs, use Chromium. The nightly run uses Chromium, Firefox, and WebKit.

### 10.2 Example

```ts
// projects/sample/web/e2e/home.spec.ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('home page renders and has no axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

### 10.3 Update rule

Update the spec in the same PR as the page. A changed page without a changed spec needs a reason in the PR.

## 11. Coverage gates for e2e

| Gate                      | Value                                                        | Where it runs                                               |
| ------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| `bruno-coverage`          | Each route has at least one `.bru` request with an assertion | `check-gates`, CI, `local-gates.sh` (impacted API projects) |
| `playwright-coverage`     | Each page has a spec with `page.goto` and an axe check       | `check-gates`, CI                                           |
| Playwright skip and fixme | Zero in the diff                                             | Anti-skip scan, CI                                          |

## 12. Trace propagation tests

Each part that handles a request has one test that proves trace propagation. The rules are in `docs/standards/observability.md`. The gates are planned until `packages/telemetry` lands. If the package does not exist, skip the test and list it as an open item (observability.md, section 2).

| Part                  | Test                                                                                              | What it asserts                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `api` (TypeScript)    | Call the wrapped Lambda handler with a fake HTTP API v2 event that has a `traceparent` header     | The response `traceparent` and the log line have the same trace id. |
| `api-py`              | pytest with a fake event that has a `traceparent` header                                          | The log record has the trace id.                                    |
| `api-go`              | `go test` with a request that has a `traceparent` header                                          | The log record has the trace id.                                    |
| `web` (browser fetch) | Playwright spec that watches the API request. Applies only when a client component calls the API. | The API request carries a `traceparent` header.                     |
| `web` (server fetch)  | Vitest test of `lib/<resource>-client.ts` with a fake server and an active span                   | The request carries a `traceparent` header.                         |
| Bruno                 | `assert` block in the `.bru` request                                                              | The response has a `traceparent` header.                            |
| `infra`               | `Template.fromStack`                                                                              | Each Lambda has the ADOT layer and active tracing.                  |
