---
name: pr-description
description: Write the PR body with Summary, Linked issue, Testing with pasted output, Risk tier and reason, How to revert, and Feature flag, then push the branch and open the PR with gh pr create --body-file. Use when a branch is ready for a pull request or the user asks to open a PR or write a PR description. Triggers include open a PR, create PR, PR description, write the PR body, ready for review.
---

# pr-description

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

## Steps

1. Check the branch: `git rev-parse --abbrev-ref HEAD`. If it is `main`, stop. Create a branch `<type>/<short-kebab>` first.
2. Check the working tree: `git status --short` must be empty. Commit or stash unrelated changes. Do not commit `.claude/state/`.
3. Check the verify output: `tail -n 30 .claude/state/verify-output.log`. It must show a pass. If the file is missing or shows a failure, run the `verify` skill.
4. Gather facts: `git log --oneline main..HEAD` and `git diff --stat main...HEAD`.
5. Set the risk tier. Read `docs/standards/risk-tiers.md`. Apply its path rules to the changed files. Keep the highest tier that matches. Do not lower it.
6. Run `mkdir -p .claude/state`. Write `.claude/state/pr-body.md` with the Write tool. Do not write it with a shell heredoc: a quoted denied command in the body can trip the deny rules in `.claude/settings.json`.
   - The six sections below are required, in this order.
   - If `.github/pull_request_template.md` exists and has other headings, keep them after the six sections. Do not replace the six sections with them.
   - `## Summary`: 1 to 3 sentences. What changed and why.
   - `## Linked issue`: `Closes #<n>`. If there is no issue, write `None`. Ask the user for the number if it is unknown. Do not invent one.
   - `## Testing`: the commands you ran, and the last 30 lines of `.claude/state/verify-output.log`.
   - `## Risk tier`: the tier (low, medium, or high) and one line that gives the path rule. The label is for the reviewer. Nothing else reads it.
   - `## How to revert`: the `git revert <sha>` command, or the flag to turn off.
   - `## Feature flag`: the flag name (defined with `defineFlags` from `@vprprudhvi/shared-flags`), or `None (no user-visible change)`.
   - Last line: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
7. Write the title in Conventional Commits style, under 70 characters. Example: `feat(order-export): add csv export`.
8. Push: `git push -u origin HEAD`. If the pre-push hook fails, read the message and fix the cause. Then retry.
9. Open the PR with the risk label: `gh pr create --base main --title "<title>" --label risk:<tier> --body-file .claude/state/pr-body.md`. The agent PR uses the owner's GitHub user.
10. Report the PR URL.

## Done when

- [ ] `.claude/state/pr-body.md` has all six sections. No placeholder text remains.
- [ ] The verify output shows a pass for the current tree.
- [ ] The PR URL is shown.

## Do not

- Merge the PR, approve it, or run `gh pr merge`.
- Invent an issue number.
- Claim tests pass without pasted output.
- Force-push. Do not run `git push --force`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`. Use `rush install`.
- Run `cdk deploy` only as root CLAUDE.md rule 4 allows. Never run `cdk destroy`.
- Use `--no-verify`.
