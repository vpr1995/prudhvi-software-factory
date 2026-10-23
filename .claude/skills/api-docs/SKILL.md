---
name: api-docs
description: Read, search, and extend the Bruno collection in projects/<name>/bruno as the API documentation for a project. Explains the folder layout, the bru file format with docs, assert and tests blocks, environment files, and how to run the collection with bru. Use when asked what an endpoint does, to list the API, to document a route, or to add or change a Bruno request. Triggers include api docs, document the api, bruno, bru file, list endpoints, what does this endpoint do, api reference.
---

# api-docs

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

The Bruno collection is the API reference. Each `.bru` file is one route. Its `docs` block says what the route does. Its `assert` and `tests` blocks check that the route still does it.

## Layout

- `projects/<name>/bruno/bruno.json`: collection name and settings.
- `projects/<name>/bruno/environments/local.bru`, `dev.bru`, `staging.bru`: base URL and non-secret variables.
- `projects/<name>/bruno/<resource>/<action>.bru`: one request per route.

## Read the docs

1. List all routes: `grep -rh -A1 -E '^(get|post|put|patch|delete) \{' projects/<name>/bruno` shows the method and the URL line for each file.
2. Read one route: `cat projects/<name>/bruno/<resource>/<action>.bru`.
3. Read the `docs` block for purpose, auth, and errors. Read the `assert` block for the status and key fields.
4. Check the path matches the OpenAPI output in `projects/<name>/dist/openapi.json` after a contracts build.

## File format

```
meta {
  name: Get health
  type: http
  seq: 1
}

get {
  url: {{baseUrl}}/v1/health
  body: none
  auth: none
}

docs {
  Purpose: returns the service health.
  Auth: none.
  Errors: none expected.
}

assert {
  res.status: eq 200
  res.body.status: eq ok
}

tests {
  test("status is 200", function () {
    expect(res.status).to.equal(200);
  });
}
```

For a protected route, use `auth: bearer` with `token: {{process.env.<PROJECT>_TEST_TOKEN>}}`. Never write a token value in a `.bru` or environment file.

For a path parameter, use `:name` in the URL and a `params:path` block. Keep the same path as the OpenAPI output.

## Add or change a route's documentation

1. Create or open the `.bru` file in the resource folder.
2. Write the `docs` block: purpose, auth, and each error code the route returns.
3. Write at least one `assert` line. Cover the status, the error envelope `error.code` on error routes, and the key fields.
4. Run the route: `rush e2e --only @vprprudhvi/<name>` . The e2e phase runs each API part (TypeScript, Python, Go). It starts each server on a free port and runs `bru run` with `--env local --env-var baseUrl=http://localhost:<port>`.
5. Paste the `bru run` summary.

## Done when

- [ ] Every route in the OpenAPI output has a `.bru` file with the same method and path.
- [ ] Each file has a `docs` block and at least one assertion.
- [ ] `rush e2e` passes, and its output is pasted.

## Do not

- Write a request with no `assert` line, or with `skip-request` in its scripts.
- Put a secret value in a `.bru` or environment file. Use `{{process.env.X}}`.
- Remove or weaken an assertion so a route passes.
- Edit the docs to describe behavior that the code does not have.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`.
- Run `cdk deploy` or `cdk destroy`.
- Use `--no-verify`.
