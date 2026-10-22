---
name: pr-description
description: Write the PR body with Summary, Linked issue, Testing with pasted output, Risk tier and reason, How to revert, and Feature flag, then push the branch and open the PR with gh pr create --body-file. Use when a branch is ready for a pull request or the user asks to open a PR or write a PR description. Triggers include open a PR, create PR, PR description, write the PR body, ready for review.
---

# pr-description

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

## Steps

1. Check the branch: `git rev-parse --abbrev-ref HEAD`. If it is `main`, stop. Create a branch `<type>/<short-kebab>` first.
2. Check the working tree: `git status --short` must be empty. Commit or stash unrelated changes. Do not commit `.claude/state/`.
3. Check the verify state: `cat .claude/state/last-verify.json`. The `result` must be `pass`. If not, run the `verify` skill.
4. Gather facts: `git log --oneline main..HEAD` and `git diff --stat main...HEAD`.
5. Set the risk tier. Read `docs/standards/risk-tiers.md`. Apply its path rules to the changed files. Keep the highest tier that matches. Do not lower it.
6. Run `mkdir -p .claude/state`. Write `.claude/state/pr-body.md`.
   - The six sections below are required, in this order.
   - If `.github/pull_request_template.md` exists and has other headings, keep them after the six sections. Do not replace the six sections with them.
   - `## Summary`: 1 to 3 sentences. What changed and why.
   - `## Linked issue`: `Closes #<n>`. If there is no issue, write `None`. Ask the user for the number if it is unknown. Do not invent one.
   - `## Testing`: the commands you ran, and the last 30 lines of `.claude/state/verify-output.log`.
   - `## Risk`: the tier (low, medium, or high) and one line that gives the path rule.
   - `## How to revert`: the `git revert <sha>` command, or the flag to turn off.
   - `## Feature flag`: the flag name from `packages/flags`, or `None (no user-visible change)`.
   - Last line: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
7. Write the title in Conventional Commits style, under 70 characters. Example: `feat(order-export): add csv export`.
8. Push: `git push -u origin HEAD`. If `require-verify` blocks the push, run the `verify` skill again, then retry. If the gate integrity check blocks the push because the range has gate changes, a human pushes the branch. Report that and stop.
9. Open the PR: `gh pr create --base main --title "<title>" --body-file .claude/state/pr-body.md`.
10. Report the PR URL.

## Done when

- [ ] `.claude/state/pr-body.md` has all six sections. No placeholder text remains.
- [ ] `last-verify.json` has `result` pass for the current tree.
- [ ] The PR URL is shown.

## Do not

- Merge the PR, approve it, or run `gh pr merge`.
- Invent an issue number.
- Claim tests pass without pasted output.
- Force-push. Do not run `git push --force`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`. Use `rush install`.
- Run `cdk deploy`.
- Use `--no-verify`.
