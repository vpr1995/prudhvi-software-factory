# ADR 0008: Bruno for API requests and tests, Playwright for web

- Status: Accepted
- Date: 2026-10-22

## Context

Each API needs readable documentation for each route. The documentation must also test the route in CI. Web pages need browser tests and an accessibility check. The team uses open-source tools only (ADR 0004).

## Decision

- Each project has a Bruno collection in `projects/<name>/bruno/`. Bruno holds one `.bru` file for each route. Each file has a `docs` block and an `assert` block, with an optional `tests` block.
- The runner is `@usebruno/cli`. The version is pinned in the project or in an autoinstaller.
- Each API part (`api`, `api-py`, `api-go`) has a `_phase:e2e` script. The script starts the server on a free port, runs the Bruno folder for that part, and stops the server.
- Each web part has an `e2e/` folder with `@playwright/test` and `@axe-core/playwright`. The `_phase:e2e` script builds the app, starts it, and runs the suite.
- Playwright runs Chromium on each PR. The nightly run adds Firefox and WebKit.
- The Rush command `e2e` runs both. `verify` includes `e2e`. The Stop hook and CI run `e2e` for impacted parts.
- Two gates in `scripts/gates/check-gates.mjs` enforce the coverage:
  - `bruno-coverage`: each route in the OpenAPI output has a `.bru` request with an assertion.
  - `playwright-coverage`: each page has a spec with `page.goto` and an axe check.
- Secrets never appear in a Bruno environment file. A request reads them with `{{process.env.X}}`.
- The e2e rules are in `docs/standards/testing.md`, sections 9 to 11.

## Consequences

- Positive: The route documentation and the route tests live in one file. A route change needs a request change in the same PR.
- Positive: Each page has an accessibility check from the start.
- Positive: The same `e2e` command works for TypeScript, Python, and Go backends. Each part starts its own server.
- Negative: Each route and each page needs two artifacts. The coverage gates make a missing artifact fail.
- Negative: E2E runs take longer than unit tests. Use `--impacted-by` to run only the changed parts.
- Negative: Bruno and Playwright are new dependencies. Each needs a license check and a version pin (ADR 0004).
- Open: Bruno scripts and Playwright fixtures must not hide a failure. The anti-skip scan checks the patterns listed in `docs/standards/testing.md`, section 4.
