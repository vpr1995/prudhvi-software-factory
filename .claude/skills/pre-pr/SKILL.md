---
name: pre-pr
description: Run up to three review rounds on the current branch before a PR. Each round runs bug-hunt, then the simplify, code-review and security-review built-ins, fixes findings, re-runs verify, and commits the fixes. Later rounds review only the previous round's fixes. Use before opening a PR or when asked to review, clean up, or harden a branch. Triggers include pre-pr, review my branch, ready for PR, run the review rounds, security review before PR.
---

# pre-pr

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Prerequisites: the working tree is clean (commit first, see implement-feature), and the `verify` skill passes.

State folder: `.claude/state/pre-pr/`.

- `round-<n>.start`: one line. The HEAD sha at the start of round n.
- `findings.md`: one row per finding: `id | round | severity | file:line | bug class | status (open, fixed, rejected) | reason`.

## Steps

1. Run `mkdir -p .claude/state/pre-pr`. Set round = 1.
2. Check the tree: `git status --porcelain` must print nothing. If it prints, stop and commit or discard the changes.
3. Run the `verify` skill. It must pass.
4. Record the start of the round: `git rev-parse HEAD > .claude/state/pre-pr/round-<n>.start`.
5. Choose the review range.
   - Round 1: `BASE` is `origin/main` if it exists, else `main`. Range = `$BASE...HEAD`.
   - Round 2 or 3: Range = `$(cat .claude/state/pre-pr/round-<n-1>.start)..HEAD`. This is only the fixes from the previous round.
6. Run the `bug-hunt` skill on that range. It spawns the `fresh-reviewer` agent.
7. Run these built-ins in order, with the same range in the request text: the `simplify` skill (it applies its fixes), then the `code-review` skill, then the `security-review` skill. Do not pass `--comment` or `--fix` to `code-review`. This skill fixes findings itself.
8. Merge all new findings into `findings.md`. Before you add a finding, check the file. Skip a finding that matches an existing row (same file, same bug class). Never repeat a finding.
9. Fix every open Important finding. Fix Nits when the change is small. For a false positive, set status `rejected` and quote the code that shows it is wrong. A fix to a gate file goes to `.claude/state/handoff/pre-pr/` instead of the real path.
10. Run the `verify` skill. It must pass.
11. Commit the round's changes, if any. Stage explicit paths only: `git add <path> ...`. Do not stage a gate file. Run `git commit -m "fix(<scope>): address pre-pr round <n>"`.
12. Stop when no open Important finding remains. Report the rounds run and the count of each finding status.
13. If open Important findings remain and round < 3, add 1 to round and go to step 2.
14. If open Important findings remain after round 3, stop. List the open findings with their IDs. Ask the human about the approach. Do not start round 4.

## Done when

- [ ] `verify` passed after the last fix, and its output is pasted.
- [ ] `findings.md` has no open Important finding, or the human was asked after round 3.
- [ ] Rounds used are 3 or fewer. Each round that changed code has a commit.
- [ ] The final report lists each round, the counts, and each rejected finding with its reason.

## Do not

- Re-raise a finding that already has a row in `findings.md`.
- Reject a finding only to finish the run. Give evidence.
- Review files outside the range, except to read context.
- Pass `--comment` or `--fix` to `code-review`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`. Use `rush install`.
- Run `cdk deploy`.
- Use `--no-verify`.
