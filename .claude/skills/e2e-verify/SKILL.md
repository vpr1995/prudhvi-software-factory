---
name: e2e-verify
description: Run the end-to-end gates for changed web and api parts with rush e2e, run the Bruno collections with bru run, review Playwright screenshots, and run cdk synth plus a read-only cdk diff for changed infra including platform/infra. Use when asked to run the app, confirm a change in the real app, run e2e, take screenshots, or check a route or stack end to end. Triggers include e2e, playwright, bruno, bru run, screenshot, check the running app, cdk diff.
---

# e2e-verify

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rules: use localhost only. Never use a deployed URL. The gates run through `rush e2e`, so CI runs the same commands.

## Steps

1. Run `mkdir -p .claude/state/screenshots`.
2. Run the rush e2e gate for the impacted parts:
   `rush e2e --impacted-by git:origin/main > .claude/state/e2e-output.log 2>&1; echo "exit=$?"; tail -n 120 .claude/state/e2e-output.log`
   If `origin/main` does not exist, run `rush e2e --impacted-by git:main` or, for one project, `rush e2e --only @vprprudhvi/<name>`.
   The project `_phase:e2e` starts each api server (TypeScript, Python, Go) on a free port, runs the Bruno folder, and stops the server. It then runs `next start` and Playwright for web.
3. If the e2e run fails, read the first failing request or test in the log. Fix the cause, then run step 2 again.
4. Run the Bruno collections by hand when you need to inspect one API. Start the API with its dev script first, then run:
   `(cd projects/<name>/bruno && npx bru run --env local --env-var baseUrl=http://localhost:<port> --reporter-junit ../../../.claude/state/bruno-<name>.xml)`
   Paste the summary lines.
5. Open each Playwright screenshot in `.claude/state/screenshots/` with the Read tool. Write one line per screenshot. Do not claim a visual pass if you did not look. Playwright writes screenshots and traces on failure under `test-results/`.
6. For each changed infra app (`projects/<name>` when `bin` or `lib` changed, and `platform/infra`):
   - `(cd <folder> && npx cdk synth --quiet)`
   - `(cd <folder> && npx cdk diff <StackName>)`. This is read-only.
   - If AWS credentials are missing, write "cdk diff not available: <error>" and skip the diff.
   - Report every `Replacement` and every `destroy` line. A platform diff needs human review.
7. Report. Paste the exit codes, the rush e2e summary, the Bruno summary, the screenshot lines, and the cdk diff summary.

## Done when

- [ ] `rush e2e` exits 0 for the impacted parts, and the output is pasted.
- [ ] Every changed Bruno collection runs with no failed assertion.
- [ ] Screenshots are viewed and described.
- [ ] `cdk synth` passes for each changed infra app. The diff is pasted or marked not available.

## Do not

- Run `cdk deploy`, `cdk destroy`, or any AWS write command.
- Call a deployed or production URL.
- Skip a failing Playwright test, or mark it `test.skip` or `test.fixme`.
- Run a Bruno request with no assertion, or put a secret value in a command or an env file. Read secrets from env vars.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`.
- Use `--no-verify`.
