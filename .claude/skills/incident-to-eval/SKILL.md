---
name: incident-to-eval
description: Turn a revert, bug escape, or incident into a reviewer eval case at evals/reviewer/cases/<date>-<slug>.md, using evals/reviewer/case-template.md, and propose a lint or REVIEW.md fix for the root cause. Use when a PR was reverted, a bug reached production, or the user asks to record an incident as an eval. Triggers include incident, revert, postmortem, bug escaped, add an eval, make the reviewer catch this.
---

# incident-to-eval

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Goal: the reviewer must catch this bug class next time. The case file is the test.

## Steps

1. Collect the facts. Ask the user for any you lack: the PR or commit, the revert or incident link, the symptom, and the fix commit. Wait for the answers.
2. Read the reverted or buggy diff: `git show <sha>` or `gh pr view <n> --json title,body,files`.
3. Find the root cause. Write one sentence. Name the bug class, for example "missing authorization check on a route".
4. Choose the slug and the date: `date +%F`. Use kebab-case for the slug.
5. Read `evals/reviewer/case-template.md`. Copy its headings exactly.
6. Write `evals/reviewer/cases/<date>-<slug>.md`. Fill every section:
   - The diff under review. Use the file paths and the line numbers from the buggy commit.
   - The expected finding: severity, `file:line`, and bug class.
   - The expected fix.
   - The source: the PR number, the revert link, and the date.
   Do not paste secrets or real customer data. Replace them with placeholders.
7. Decide the prevention. Choose one:
   - A lint rule or a `REVIEW.md` rule that covers the bug class. Write the proposed rule text in chat. Mark it as a gate change. A human must approve it.
   - A test that would have failed. Write it in the affected project, and run it. It must fail on the buggy commit and pass on the fix.
8. Report the case file path, the bug class, and the proposed prevention.

## Done when

- [ ] `evals/reviewer/cases/<date>-<slug>.md` exists and follows the template headings.
- [ ] The expected finding names a file and a line.
- [ ] The prevention is either a proposed rule for a human, or a test that fails on the buggy code.
- [ ] No secret or customer data is in the case file.

## Do not

- Write a case without a file and line from the real diff.
- Edit `docs/standards/coding-conventions.md`, `REVIEW.md`, or any lint config. Propose the change in chat only.
- Remove or change an existing case in `evals/reviewer/cases/`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`.
- Run `cdk deploy` or `cdk destroy`.
- Use `--no-verify`.
