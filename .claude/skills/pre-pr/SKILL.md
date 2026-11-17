---
name: pre-pr
description: Run up to three review rounds on the current branch, then push through the test guard. Each round takes its passes and models from the router (factory.mjs route), runs them, fixes findings, re-runs verify, and commits the fixes. A doc-only diff runs only the spec pass. Later rounds review only the previous round's fixes. State goes through the round and findings commands. Use before opening a PR or when asked to review, clean up, or harden a branch. Triggers include pre-pr, review my branch, ready for PR, run the review rounds, security review before PR.
---

# pre-pr

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Prerequisites: the working tree is clean (commit first, see implement-feature), and the `verify` skill passes.

State: the script `factory.mjs` holds the round and findings state. You never read or write its files. Call it as `node tooling/repo-checks/scripts/factory.mjs <command>` from the repo root. Write the full command each time: the allow rule matches this text.

Ticket `<n>`: a number in the request (`/factory` gives it), else a number in the branch name. In a command, `[<n>]` means: write `<n>` with a ticket, write nothing without one. With no ticket, the script uses an ad hoc folder that the script picks.

## Steps

1. Check the tree: `git status --porcelain` must print nothing. If it prints, stop and commit or discard the changes.
2. Find the ticket. Use the number in the request. Else run `git branch --show-current | sed -nE 's#^[a-z]+/([0-9]+)-.*#\1#p'`. No number: no ticket. Say so in the report.
3. Run the `verify` skill. It must pass.
4. Start the round. Round 1: `node tooling/repo-checks/scripts/factory.mjs round [<n>] start --new`. Round 2 or 3: `node tooling/repo-checks/scripts/factory.mjs round [<n>] start`. The script prints `round <k>`: use that `<k>`. Do not count rounds yourself.
5. Route and range. With a ticket, run `node tooling/repo-checks/scripts/factory.mjs route <n>`. It prints JSON. Use `base`, `passes`, `docOnly`, and the `model` of each pass from that output. Run only the passes of `passes`. Do not run a pass in `skipped`.
   - Round 1: Range = `<base>...HEAD`. With no ticket, `origin/main...HEAD` if `origin/main` exists, else `main...HEAD`.
   - Round 2 or 3: Range = `HEAD~1..HEAD`. This is the one fix commit of the previous round.
   - Write the range as text in each request. Shell state does not persist between Bash calls.
6. Run the passes of `passes`, in order.
   - `spec-reviewer`: spawn the `spec-reviewer` agent with `Issue: #<n>. Range: <base>...HEAD.` Always use the full branch range: the spec needs the whole change. With no ticket, skip it and say so in the report.
   - `fresh-reviewer`: run the `bug-hunt` skill on the range. Put `Model: <model>` in its request. It spawns the `fresh-reviewer` agent.
   - `simplify`: run the built-in `simplify` skill (it applies its fixes). Then run the built-in `code-review` skill with the same range. Do not pass `--comment` or `--fix` to `code-review`.
   - `security-reviewer` and `infra-reviewer`: spawn the agent of that name with `Range: <range>.`
   - Spawn each agent with the Agent tool and its `model` set to the `model` of that pass. `session`: set no `model`. Never use a model from your own choice or from the agent file.
   - `docOnly` is true: run only the `spec-reviewer` pass. No other pass runs: no `bug-hunt`, no `code-review`.
   - No ticket, so no route output: run `bug-hunt`, `simplify`, `code-review`, and the built-in `security-review` skill. Set no `model`.
7. Add each new finding of all passes: `node tooling/repo-checks/scripts/factory.mjs findings [<n>] add`. Put the rows on stdin (a heredoc with a quoted delimiter). One row each: `severity | file:line | bug class | reason`. Severity is `Important` or `Nit`. The script skips a finding that matches an `open` or `rejected` row. It reopens a `fixed` row: the fix failed.
8. Fix every open Important finding. Fix Nits when the change is small. After each fix: `node tooling/repo-checks/scripts/factory.mjs findings [<n>] set <id> fixed`. For a false positive: `node tooling/repo-checks/scripts/factory.mjs findings [<n>] set <id> rejected`, and quote the code that shows it is wrong. See the rows with `node tooling/repo-checks/scripts/factory.mjs findings [<n>] list`.
9. Run the `verify` skill. It must pass.
10. Commit the round's changes, if any. Stage explicit paths only: `git add <path> ...`. Run `git commit -m "fix(<scope>): address pre-pr round <k>"`.
11. Decide.
    - The round found no new Important finding and no open Important finding remains: report the rounds run and the count of each finding status. Go to step 13.
    - Else, if round < 3: go to step 4 for the next round. Round 2 reviews the fixes of round 1.
12. If open Important findings remain after round 3, stop. List the open findings with their IDs. Ask the human about the approach. Do not start round 4. Do not push.
13. Push through the test guard.
    - Ticket: run `node tooling/repo-checks/scripts/factory.mjs push <n>`. The script runs the test guard first (no PR labels, against the base of the ticket). Then it pushes `HEAD`. No ticket: skip this step and say so. `pr-description` pushes.
    - The finding "check config changed" does not block the push. Run `node tooling/repo-checks/scripts/factory.mjs route <n>` again: the tier is `risk:high`. Write the finding in the PR body.
    - Any other finding blocks the push (exit 2). Give it one fix round: fix each finding, run the `verify` skill, commit as in step 10, and run `push <n>` again.
    - A finding that stays after the one fix round, or an exit 3 with `hard stop: <reason>`: in a `/factory` run, run `node tooling/repo-checks/scripts/factory.mjs hardstop <n> "test guard finding stays"` (for exit 3: `"script hard stop"`). The `/factory` skill, section "Hard stop", has the stdin steps. Else stop and ask the human.

## Done when

- [ ] `verify` passed after the last fix, and its output is pasted.
- [ ] `findings [<n>] list` shows no open Important finding, or the human was asked after round 3.
- [ ] Rounds used are 3 or fewer. Each round that changed code has a commit.
- [ ] The push step ran with a ticket, or the report says there was no ticket.
- [ ] The final report lists each round, the counts, and each rejected finding with its reason.

## Do not

- Re-raise a finding that has an `open` or `rejected` row. The script skips it.
- Reject a finding only to finish the run. Give evidence.
- Run a pass that is not in `passes`, or choose a model yourself.
- Review files outside the range, except to read context.
- Pass `--comment` or `--fix` to `code-review`.
- Push with git. Use the `push` command.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`. Use `rush install`.
- Never run `cdk deploy` or `cdk destroy` (root CLAUDE.md rule 4).
- Use `--no-verify`.
