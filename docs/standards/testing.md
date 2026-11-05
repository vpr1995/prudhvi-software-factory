# Testing

This document sets the test rules for all projects and packages.

## 1. Rules

- Each TypeScript project uses Vitest.
- Each new behavior has a test. Each bug fix has a test that fails before the fix.
- Do not skip, delete, or weaken a test to make a check pass.
- Do not lower a coverage threshold.
- Unit test files sit in a `test/` folder at the root of the package or project. The path under `test/` mirrors the source path. The name is `<file>.test.ts` or `<file>.test.tsx`.
- Vitest runs only `test/**`. A unit test file outside `test/` does not run.
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

The web test setup file is `projects/<name>/test/web/setup.ts`.

## 2. Coverage thresholds

| Threshold | Value | Where it is set         | Where it runs   |
| --------- | ----- | ----------------------- | --------------- |
| Lines     | 80%   | `tooling/vitest-config` | `rush test`, CI |
| Branches  | 75%   | `tooling/vitest-config` | `rush test`, CI |

### 2.1 Coverage on changed lines

In CI, tests must run at least 80% of the changed coverable lines of each project. The value is the lines threshold (`COVERAGE_THRESHOLDS.lines`). A changed line is a line that the PR adds or changes (merge base to PR head). A coverable line is a line that `coverage/lcov.info` lists. Other lines (comments, types, files outside coverage) do not count. With no changed coverable line, the check passes. On a fail, the check lists each uncovered line as `file:line`.

To run the check locally, run the tests with coverage, then:

```
node tooling/vitest-config/dist/diff-coverage.js <base-sha> <project-path> < <project-path>/coverage/lcov.info
```

Locally, the check compares the base with the working tree. It does not see untracked files.

A CDK app project sets its Vitest config with `createAppVitestConfig()`. It adds `{ web: true }` for a `web/` part. The thresholds apply to the sum and again to `src/`, `lib/` and `web/`.

## 3. Test types by part

### 3.1 API (`projects/<name>/src/api`)

- Use `fastify.inject()` for integration tests. Do not start a real port.
- Each route has a contract test. The contract test checks that the route matches the schemas in `src/contracts`.
- Test the error envelope. Every error response matches `{ error: { code, message, requestId } }`.
- Each route also has a Bruno request with docs and assertions. See section 8.

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
- Each page has a Playwright spec. See section 9.

### 3.3 Infra (`projects/<name>/bin` and `projects/<name>/lib`, `packages/cdk-constructs`)

- Use CDK assertions (`Template.fromStack`) for each stack and construct.
- Use snapshot tests for each stack. A snapshot change needs a reason in the PR.
- Run `cdk-nag` with the AwsSolutions pack. An unresolved nag error fails `cdk synth`.
- Turn Lambda bundling off in unit tests. See `docs/guides/infra.md`.

### 3.4 Contracts and domain code

- Test each Zod schema with valid and invalid input.
- Test pure domain functions in `src/api/domain/` without Fastify.
- Mutation tests (Stryker) run nightly on `src/contracts` and `src/api/domain`. They do not run on each PR.

## 4. Forbidden changes

Do not add any of these items to a diff. The reviewer checks the diff for them:

| Pattern                                                                               | Reason                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `.skip`, `.only`, `.todo`, `xit`, `xdescribe`, `test.fails`                           | Skips or focuses tests.                          |
| `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`                     | Hides a type or lint error.                      |
| `as any`, `as unknown as`                                                             | Hides a type error.                              |
| A deleted test file, or fewer `it(` or `test(` calls than before                      | Removes tests.                                   |
| A lower value in a coverage config, `--passWithNoTests`, `                            |                                                  | true` in a script | Lowers a threshold. |
| `nosec`, `gitleaks:allow`                                                             | Hides a security finding.                        |
| An empty `catch {}` block                                                             | Hides an error.                                  |
| A changed test with no assertion See the note below this table.                       | A test with no assertion passes without testing. |
| Playwright: `test.skip`, `test.fixme`, `test.fail`, `test.describe.skip`, `test.only` | Skips or focuses e2e tests.                      |
| Bruno: a `.bru` request with no `assert` or `tests` block                             | A request with no check passes without testing.  |
| Bruno: `skip-request` in a script                                                     | Skips a request.                                 |
| Bruno or Playwright: `--bail` removed from a script to hide a failure                 | Hides the first failure.                         |

Each changed test needs an assertion. These items count as an assertion:

- JavaScript and TypeScript: `expect`, `assert`, `should`, `fail`, `t.is` and the other `t.` checks, `getBy` and `findBy` queries, and a helper named `assertX`, `expectX`, `checkX`, `verifyX`, `validateX` or `ensureX` (for example `verifyHealth(app)`).

These items do not count as an assertion:

- `require('fs')` or `require("fs")`. This call loads a module.
- The bare words `verify`, `validate` and `ensure` in JavaScript and TypeScript. A call such as `validate(input)` can pass and check nothing.
- A method call such as `schema.validateSync(input)`. This call can parse and check nothing.
- A method call `.check()`, for example `locator.check()` in Playwright. This call clicks a check box.

If a test must change, the change needs a reason in the PR. A human approves the removal of a test.

## 5. Checks before a PR

Run these checks on your change before you open a PR:

1. `rush verify`. It runs build, lint, typecheck, test, and e2e for the impacted projects.
2. `cdk synth` with cdk-nag, when `infra` changed.
3. The forbidden-change list in section 4. Check your own diff.

The pre-commit hook runs gitleaks on staged files and lint-staged (Prettier and ESLint). For staged `.github/workflows` and `.github/actions` files, lint-staged also runs actionlint, zizmor and pinact.

## 6. CI checks

CI runs on pull requests. It checks the PR head against the merge base with the target branch.

The required checks are `ci-result` (from `ci.yml`) and `gitleaks` (from `secrets.yml`). `ci-result` passes only when `plan`, `knip` and `workflow-lint` pass and `project` passes or skips. Make these two checks the only required checks of the `main` ruleset. Do not make the jobs of each project required checks. Their names change with the impacted projects.

`ci.yml` has these jobs:

| Job             | Commands                                                                                                                                                                                                              | Blocks when                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `plan`          | `rush check`, `node tooling/tsconfig/scripts/check-tsconfigs.mjs`, `rush audit`, `rush list --impacted-by git:<base> --json`                                                                                          | Versions are not consistent, a tsconfig rule fails, or `pnpm-lock.yaml` changed and an audit pass fails. |
| `project`       | One job for each impacted project: `rush build --to <project>`, then `rush lint`, `rush typecheck`, `rush test`, `rush e2e`, each with `--only <project>`. After `rush test`: coverage on changed lines (section 2.1) | A build, lint rule, type, test, coverage threshold, coverage on changed lines, or e2e test fails.        |
| `knip`          | `rush build --to @vprprudhvi/tooling-vitest-config`, then `rush knip` (default and `github-actions` reporters)                                                                                                        | Knip finds an unused file, export, type or dependency, an unlisted dependency, or an unresolved import.  |
| `ci-result`     | Reads the results of `plan`, `project`, `knip` and `workflow-lint`                                                                                                                                                    | `plan`, `knip` or `workflow-lint` did not pass, or `project` did not pass or skip.                       |
| `workflow-lint` | `bash scripts/security/workflow-lint.sh` (actionlint, zizmor, pinact)                                                                                                                                                 | A workflow or action file fails a check.                                                                 |

`secrets.yml` runs gitleaks on the PR commits (merge base to head). A finding fails the job `gitleaks`.

`warm-cache.yml` runs on each push to `main` and by hand. It runs `rush build` for all projects. Then it saves the pnpm store, the Rush build cache with the scope `main`, and the Playwright browsers (same key as `ci.yml`). A pull request can read the caches of `main`.

Notes:

- When no project is impacted, `project` skips and `ci-result` passes.
- `project` restores the Rush build cache (`common/temp/build-cache`), so unchanged dependencies do not build again. It takes the newest entry of the same project in the PR. If there is none, it takes the newest entry of `main`.
- `project` installs Chromium only for a project that has `playwright.config.ts`.
- CI does not run `cdk synth` for `platform/infra`. Run `rush verify` before you push. Mutation tests run nightly (`nightly.yml`, planned). They report only. Open an issue for surviving mutants.

## 7. When a test fails

1. Read the failing output. Find the file and the line.
2. Fix the cause in the source code, or fix a wrong expectation with a reason.
3. Run the same command again. Show the output.
4. Do not change the test to match a wrong result. Do not add a skip.

## 8. API requests with Bruno

Each API route has a Bruno request. Bruno documents the route for people. It also tests the route in CI.

### 8.1 Collection layout

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
- The gitleaks rules check these files.

### 8.2 Required blocks

Each request has these blocks:

| Block                                   | Required content                                          |
| --------------------------------------- | --------------------------------------------------------- |
| `meta`                                  | Name and type.                                            |
| Method block (`get`, `post`, and so on) | The URL and the body type.                                |
| `docs`                                  | Purpose, auth, and error codes.                           |
| `assert`                                | The status, the error envelope shape, and the key fields. |
| `tests`                                 | Checks that `assert` cannot express. Optional.            |

### 8.3 Example

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

### 8.4 Rules

- Each route in the `dist/openapi.json` OpenAPI output has at least one `.bru` request with the same method and path, and at least one assertion. The reviewer checks this.
- Update the `.bru` request in the same PR as the route.
- Run the collection with `@usebruno/cli`. The Rush `e2e` phase runs it. Do not run `bru` with a different version.
- Each project pins `@usebruno/cli` in its devDependencies or in an autoinstaller.

## 9. Web pages with Playwright

Each web part has an `e2e/` folder. The folder uses `@playwright/test` and `@axe-core/playwright`.

### 9.1 Rules

- Each `app/**/page.tsx` route has a spec. The spec calls `page.goto('<route>')` and runs an axe check. The reviewer checks this.
- A project with a `web/` folder and no `web/e2e/` folder fails review.
- Use a role or a label to find an element. Do not select by CSS class.
- Keep the screenshot and trace settings. They are on for failures in CI.
- In PR runs, use Chromium. The nightly run uses Chromium, Firefox, and WebKit.

### 9.2 Example

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

### 9.3 Update rule

Update the spec in the same PR as the page. A changed page without a changed spec needs a reason in the PR.

## 10. Coverage rules for e2e

| Rule                                                         | How it is checked                        |
| ------------------------------------------------------------ | ---------------------------------------- |
| Each route has at least one `.bru` request with an assertion | The reviewer, with `REVIEW.api.md`       |
| Each page has a spec with `page.goto` and an axe check       | The reviewer, with `REVIEW.web.md`       |
| Playwright skip and fixme: zero in the diff                  | The reviewer, with the list in section 4 |

## 11. Trace propagation tests

Each part that handles a request has one test that proves trace propagation. The rules are in `docs/standards/observability.md`. The checks are planned until `packages/telemetry` lands. If the package does not exist, skip the test and list it as an open item (observability.md, section 2).

| Part                  | Test                                                                                              | What it asserts                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `api` (TypeScript)    | Call the wrapped Lambda handler with a fake HTTP API v2 event that has a `traceparent` header     | The response `traceparent` and the log line have the same trace id. |
| `web` (browser fetch) | Playwright spec that watches the API request. Applies only when a client component calls the API. | The API request carries a `traceparent` header.                     |
| `web` (server fetch)  | Vitest test of `lib/<resource>-client.ts` with a fake server and an active span                   | The request carries a `traceparent` header.                         |
| Bruno                 | `assert` block in the `.bru` request                                                              | The response has a `traceparent` header.                            |
| `infra`               | `Template.fromStack`                                                                              | Each Lambda has the ADOT layer and active tracing.                  |
