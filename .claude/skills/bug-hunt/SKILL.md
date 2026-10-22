---
name: bug-hunt
description: Find bugs and root causes in a diff with a fresh-context reviewer subagent. For bug fixes, find the root cause and the bug class, then search the repo for other instances. Use when asked to find bugs, hunt bugs, review a diff, debug a regression, or check a fix. Triggers include bug hunt, find the bug, root cause, why does this fail, review this diff, regression.
---

# bug-hunt

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

## Steps

1. Choose the diff range. Use the range from the caller. If none, use the first of these that is not empty: `origin/main...HEAD`, `--staged`, `HEAD`.
   Check it: `git diff --stat <range>`.
2. List the changed files: `git diff --name-only <range>`.
3. Bug fix only: write a test that fails before the fix. Run it with `rush test --to <pkg>`. Paste the failing output. If the test passes before the fix, it does not cover the bug. Rewrite it.
4. Spawn the reviewer with the Agent tool, `subagent_type: "fresh-reviewer"`. Use this prompt:
   `Range: <range>. Changed files: <list>. Read CLAUDE.md, REVIEW.md, and projects/<name>/REVIEW.md for each changed project. Find bugs in this diff. Follow your output format.`
   Do not send your guesses or your hypothesis. Send only the range and the files.
5. Bug fix only: state the root cause in one sentence, with `file:line` evidence. Name the bug class, for example "Result error branch not handled".
6. Bug fix only: use Grep to search `projects/` and `packages/` for the same pattern. List each match with `file:line`. Report them. Fix only matches inside this diff. Report the others.
7. Fix each open finding in the code. Fix the bug class, not only one line.
8. Run the failing test again. It must pass.
9. Report. Give the reviewer's count line, each finding with its status, the root cause, the bug class, and the other matches.

## Done when

- [ ] The reviewer ran, and its output is shown.
- [ ] Each finding is fixed, or rejected with evidence in code.
- [ ] For a bug fix, the test failed before the fix and passes after. Both outputs are pasted.
- [ ] The root cause, the bug class, and the other matches are reported.

## Do not

- Say a bug is "unlikely" without evidence from code.
- Fix one line and skip the bug class.
- Send your hypothesis to the reviewer.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`. Use `rush install`.
- Run `cdk deploy` or `cdk destroy`.
- Use `--no-verify`.
