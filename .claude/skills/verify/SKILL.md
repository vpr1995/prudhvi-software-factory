---
name: verify
description: Run the build, lint, typecheck, test and e2e gates for changed projects in any language (TypeScript, Python, Go), run cdk synth for changed infra including platform/infra, then record the result in .claude/state/last-verify.json. Use before any PR, push, or done claim. Triggers include verify, run the checks, run the gates, is it green, check my changes, ready to push.
---

# verify

Alias (define it in every Bash call, because shell state does not persist):
`rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rule: show real output. Never say "pass" without pasted output.

## Steps

1. Make the state folder: `mkdir -p .claude/state`.
2. Check for the base branch: `git rev-parse --verify origin/main >/dev/null 2>&1 && echo HAS_ORIGIN || echo NO_ORIGIN`.
3. Run the gates. `rush verify` runs `build`, `lint`, `typecheck`, `test`, and `e2e` for each project's `_phase:*` scripts. Python and Go parts use the same phases.
   - If `HAS_ORIGIN`: `rush verify --impacted-by git:origin/main > .claude/state/verify-output.log 2>&1; echo "exit=$?"; tail -n 120 .claude/state/verify-output.log`
   - If `NO_ORIGIN`: `rush verify > .claude/state/verify-output.log 2>&1; echo "exit=$?"; tail -n 120 .claude/state/verify-output.log`
   The e2e phase starts each api server, runs its Bruno collection, and runs Playwright for each web part.
4. Find changed infra. This includes `platform/infra`:
   `{ git diff --name-only origin/main...HEAD 2>/dev/null; git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u | grep -E '^(projects/[^/]+/infra|platform/infra)/'`
5. For each changed infra folder, run `cdk synth` in that folder. Use the folder path, and name the log `cdk-synth-<name>.log`, where `<name>` is the project name or `platform`:
   `(cd <folder> && npx cdk synth --quiet) > .claude/state/cdk-synth-<name>.log 2>&1; echo "exit=$?"`
   Read the log tail. Any `Error` line, or any nag error, means fail.
6. Write the state file: `bash .claude/hooks/stop-gate.sh --write-state-only`.
   If the script is missing, stop. Report: "verify cannot run: stop-gate.sh is missing." Do not write the JSON by hand.
7. Show the state: `cat .claude/state/last-verify.json`.
8. Report. Paste the exit codes, the tail of the verify log, the synth result, and the `result` field of the state file. For Python and Go parts, the log must show the pytest or `go test` summary lines. For e2e, it must show the Bruno and Playwright summaries.

## On failure

- Read the first failing error. Fix its cause in code, tests, or the Bruno or Playwright spec.
- Run this skill again.
- After 3 failed runs, stop. Show the failing output and ask the human.

## Done when

- [ ] `rush verify` exits 0, and its output is pasted. The output includes the e2e phase.
- [ ] Each changed infra folder, including `platform/infra`, runs `cdk synth` with exit 0 and no nag error.
- [ ] `.claude/state/last-verify.json` exists, is written by `stop-gate.sh`, and `result` is `pass`.
- [ ] The final message shows the pasted output and the state result.

## Do not

- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion, no `skip-request`.
- Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, `t.Skip(`, or a lower `--cov-fail-under` or coverage threshold.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`. Use `rush install`.
- Run `cdk deploy` or `cdk destroy`.
- Use `--no-verify`.
- Write `last-verify.json` by hand.
