---
name: pr-description
description: Write the PR body with Summary, Linked issue, Testing with pasted output, Risk tier and reason, How to revert, Feature flag, Decisions I made, and Over budget. With a ticket, add the routing line and set the risk label from the router. Then open the PR with gh pr create --body-file. Push only with no ticket (a ticket was pushed by factory.mjs push). Use when a branch is ready for a pull request or the user asks to open a PR or write a PR description. Triggers include open a PR, create PR, PR description, write the PR body, ready for review.
---

# pr-description

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

## Steps

1. If the caller passes `ticket <n>` (the `/factory` skill step 8 does: it validated the branch already), use `<n>` as the ticket and skip this step and step 2. Else check the branch: `git rev-parse --abbrev-ref HEAD`. If it is `main`, stop. Create a branch `<type>/<short-kebab>` first.
2. Find the ticket. Skip this step when the caller passed `ticket <n>`. The branch name is `<type>/<n>-...`: run `git branch --show-current | sed -nE 's#^[a-z]+/([0-9]+)-.*#\1#p'`. A number: use it. No number: use `#<n>` or `ticket <n>` of the request, only when the branch has none. Both present and different: stop and ask the human. A branch number that does not match `^[1-9][0-9]*$` (for example `feat/0-x`, `fix/007-x`): stop and ask the human. A request number that does not match is no ticket. No number: no ticket. Say so in the report.
3. Check the working tree: `git status --short` must be empty. Commit or stash unrelated changes. Do not commit `.claude/state/`.
4. Check the verify output.
   - With a ticket: use the output of the last `verify` run of this session. It must show a pass. A doc-only diff has the output of `doc-lint.mjs` (the doc-lint run of the `factory` skill) instead. Do not read the log file. If there is no passing output, run the `verify` skill.
   - No ticket: `tail -n 30 .claude/state/verify-output.log`. It must show a pass. If the file is missing or shows a failure, run the `verify` skill.
5. Gather facts: `git log --oneline main..HEAD` and `git diff --stat main...HEAD`.
6. Set the risk tier.
   - With a ticket: run `node tooling/repo-checks/scripts/factory.mjs route <n> 2>&1`. The Routing line and a possible `warning: #<n> has no ticket state` go to stderr. The JSON goes to stdout. Find the line that starts with `Routing: `. Copy it as it is into the body (step 7). A warning on that line (a missing or bad size) stays in it. Ignore the `warning: #<n>` line. Take `changedLines`, `budget` and `overBudget` from it. The tier is the `tier` of the output. Do not set it by hand. Do not lower it.
   - The finding "check config changed" comes from the output of `node tooling/repo-checks/scripts/factory.mjs push <n>` (the test guard). The route JSON has no flag for it. It gives `risk:high` (the router sets it): write the finding in `## Risk tier`.
   - No ticket: there is no router. Read `docs/standards/risk-tiers.md`. Apply its path rules to the changed files. Keep the highest tier that matches. Do not lower it.
7. Write the body. Run `mktemp /tmp/factory-pr.XXXXXX`. Write the body with the Write tool to the path that it prints. Do not write it with a shell heredoc: a quoted denied command in the body can trip the deny rules in `.claude/settings.json`. Never use a fixed path.
   - The six sections below are required, in this order. After them, write `## Decisions I made` and `## Over budget`, in this order.
   - If `.github/pull_request_template.md` exists and has other headings, keep them after these sections. Do not replace these sections with them.
   - Stacked PR (its base is a ticket branch, not `main`): the first line of the body is `Stacked on #<m>. Merge #<m> first.` (`<m>` is the PR number of the PR below it). Other PR: no stack line.
   - `## Summary`: 1 to 3 sentences. What changed and why.
   - `## Linked issue`: `Closes #<n>`. If there is no issue, write `None`. Ask the user for the number if it is unknown. Do not invent one.
   - `## Testing`: the commands you ran, and the output. With a ticket: the last `verify` run of step 4. No ticket: the last 30 lines of `.claude/state/verify-output.log`.
   - `## Risk tier`: the tier (low, medium, or high) and one line that gives the path rule. With a ticket, add the Routing line of step 6 after it. The label is for the reviewer. Nothing else reads it.
   - `## How to revert`: the `git revert <sha>` command, or the flag to turn off.
   - `## Feature flag`: the flag name (defined with `defineFlags` from `@vprprudhvi/shared-flags`), or `None (no user-visible change)`.
   - `## Decisions I made`: with a ticket, run `node tooling/repo-checks/scripts/factory.mjs read <n> decisions`. Copy the bullets. Drop the stored `## Summary` line. If `read` exits 2 (nothing stored), write `None`. No ticket: list each choice you made that the user did not state, or write `None`.
   - `## Over budget`: with a ticket, use `changedLines` and `budget` of step 6. If `overBudget` is true, write `Over budget: <changedLines> lines, limit <budget>.` and `Reason:` with one line on why the change needs the size. Else write `None. <changedLines> of <budget> lines.` No ticket: write `None (no ticket, no size)`.
   - Last line: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
8. Write the title in Conventional Commits style, under 70 characters. Example: `feat(order-export): add csv export`. The title must not contain `'`, `"`, `$`, a backtick or `\`. Remove them.
9. Push.
   - With a ticket: skip this step. `pre-pr` or `/factory` pushed already with `node tooling/repo-checks/scripts/factory.mjs push <n>`. That command runs the test guard first.
   - No ticket: `git push -u origin HEAD`. If the pre-push hook fails, read the message and fix the cause. Then retry.
10. Open the PR with the risk label: `gh pr create --base main --title '<title>' --label risk:<tier> --body-file <path>`. `<tier>` is the tier of step 6. `<path>` is the file of step 7. The stacked `--base` is not built yet (task 7b, #112). Until then the caller sets `--base` and `--draft`. The agent PR uses the owner's GitHub user. Then delete the body file with `rm /tmp/factory-pr.<suffix>` (the path that `mktemp` printed), also when `gh pr create` fails. Run `rm` only when the path matches `^/tmp/factory-pr\.[A-Za-z0-9]{6}$`.
11. Report the PR URL.

## Done when

- [ ] The body has the six sections, `## Decisions I made`, and `## Over budget`. With a ticket, it has the Routing line. No placeholder text remains.
- [ ] The verify output shows a pass for the current tree.
- [ ] The label is `risk:<tier>` with the tier of the router (a ticket) or the path rules (no ticket).
- [ ] The body file is removed.
- [ ] The PR URL is shown.

## Do not

- Merge the PR, approve it, or run `gh pr merge`.
- Invent an issue number.
- Claim tests pass without pasted output.
- With a ticket, never push with git. Use `node tooling/repo-checks/scripts/factory.mjs push <n>`.
- Force-push. Do not run `git push --force`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`. Use `rush install`.
- Never run `cdk deploy` or `cdk destroy` (root CLAUDE.md rule 4).
- Use `--no-verify`.
