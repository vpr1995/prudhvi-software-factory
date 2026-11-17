---
name: factory
description: Run the software factory in this repo. Works the owner review comments, then the agent:ready tickets one at a time, each to a PR with green CI, and stops at the first hard stop. Never merges. Drives the run only through the state script factory.mjs. Use when the owner runs /factory, /factory <n>, /factory status, /factory stop, or /factory --dry-run, or asks to work a ticket, take issue <n>, or run the queue. Triggers include factory, run the factory, work the queue, take ticket, do issue, start the ticket, next stage after plan-tickets.
---

# factory

Entry: `/factory [<n>] [--dry-run]`, `/factory status`, `/factory stop`. This is the only entry point for ticket work. Design: [design.md](../../../docs/designs/factory-daily-run/design.md). Rules: wiki [Ticket Workflow](https://github.com/vpr1995/prudhvi-software-factory/wiki/Ticket-Workflow).

Rules for the whole run:

- Call the state script as `node tooling/repo-checks/scripts/factory.mjs <command>` from the repo root. Write the full command each time: the allow rule matches this text.
- The script holds the run state. It decides the queue, the caps, and the labels. You never read or write its files.
- Post a comment only with the `comment` command or the `hardstop` command. They add the agent marker and remove secrets.
- Push only with the `push` command.
- One writer at a time. Spawn only read-only subagents, and only through `pre-pr`.

## Entry

1. Read the argument.
   - `status`: run `node tooling/repo-checks/scripts/factory.mjs status` and show the output. In the main checkout, run `git worktree list`, find the folder that ends with `projects-monorepo-factory`, and run the command in that folder. Stop.
   - `stop`: run `node tooling/repo-checks/scripts/factory.mjs stop`. Show the output and the resume command. Change no label. Stop.
   - `--dry-run`: run `node tooling/repo-checks/scripts/factory.mjs start --dry-run`. Show the queue, the order, and the routed passes. Stop. It changes nothing.
   - `<n>`: work only ticket `<n>`. Only the owner comments on its PR.
   - No argument: work the whole queue.
2. Check the place. `pwd` must end with `projects-monorepo-factory`, and `git status --porcelain` must print nothing. If not, stop and tell the owner. Setup is in "Worktree setup".
3. Start the run. Run `node tooling/repo-checks/scripts/factory.mjs start <n>` for one ticket, or `node tooling/repo-checks/scripts/factory.mjs start` for the queue. The script checks trust and readiness, adopts an active or stalled run, and prints the plan. If it exits non-zero (for example `FACTORY_RUN=off`, no `project` scope for `gh`, or a held lock), show the reason and stop. Do not retry.

## Loop

1. Run `node tooling/repo-checks/scripts/factory.mjs next`. It stores the next step. The `Stop` hook gives you that step each time you try to stop.
2. Read the line `next: ...` and go to the matching step.
   - `start #<m>` or `resume #<m> (stage <s>)`: work the ticket (next section).
   - `wait for the CI of PR #<m>`: a CI wait runs already. Wait for its end. Then run `next` again.
   - `stacked on #<k> (PR ...)`: the stack steps are (built in task 7b, #112). Do not start the ticket. Run `node tooling/repo-checks/scripts/factory.mjs stop`, tell the owner, and stop.
   - `done`: show the run report path that `next` prints. Report the tickets done, the PRs that wait for a merge, and the skips. The `Stop` hook allows the stop.
3. A new owner review comment on a factory PR comes before a new ticket (built in task 6, #101). The fix path is the same as "After a CI failure", then `node tooling/repo-checks/scripts/factory.mjs comment <n> reply <comment-id>` with the fixing commit on stdin. The comment limit and the thread rule belong to that task.

## Work a ticket

Ticket `<n>`. Run `node tooling/repo-checks/scripts/factory.mjs caps <n>` at the start of each step below and after each failed CI run. Exit 3 means a cap is reached: do a hard stop with the printed reason.

1. Read. `gh issue view <n> --json number,title,body,labels`. The Acceptance list is the spec. Do not edit it.
2. Branch and claim (a new ticket). Run `git fetch origin`. Then `git switch -c <type>/<n>-<short-kebab> origin/main`. Type: `docs` for a doc-only ticket, `fix` for a bug, else `feat`. The name has `<n>`, so the spec pass finds the issue. Then claim: `node tooling/repo-checks/scripts/factory.mjs stage <n> building`. Claim after the branch: the script stores the current branch at the claim.
   - A resume: `git branch -a --list "*/<n>-*"`, then `git switch <branch>`. Go to the step of the stage: `building` to step 3, `reviewing` to step 5, `ci` to step 9.
3. Decide. Check the ticket before you write code. Do a hard stop when any of these is true:
   - An open decision touches a high-tier path (`docs/standards/risk-tiers.md`, section 2).
   - The Acceptance list contradicts itself.
   - The work needs an access or a secret that you do not have.
   - The work needs a deploy or a manual console step.

   For any other decision that the ticket does not make, take the safest option: reversible, smallest scope, and behind a flag from `packages/flags` when user-visible. Record it with `node tooling/repo-checks/scripts/factory.mjs note <n> decisions`. The summary starts with `## Summary` and has 3 to 5 bullets: rewrite the whole summary and merge small decisions.

4. Build. Run the `implement-feature` skill as the base flow, with these overrides.
   - Skip its steps 2, 10, 11 and 12. This skill does them.
   - Each "stop and ask the human" in a sub-skill is a hard stop: the reason is the question.
   - Doc-only ticket (each changed path is `*.md`): skip its steps 4, 5, 7, 8. Run `node tooling/repo-checks/scripts/doc-lint.mjs` and `npx --no-install prettier --check <files>`.
   - Code ticket: also run doc-lint before the review.
   - If `verify` still fails after 3 fix rounds: hard stop.
   - Commit with explicit paths (`git add <path> ...`, then `git commit`). Never use `git add -A`.
   - Store the step: `node tooling/repo-checks/scripts/factory.mjs note <n> build` (summary on stdin).
5. Review. Run `node tooling/repo-checks/scripts/factory.mjs stage <n> reviewing`. Run `node tooling/repo-checks/scripts/factory.mjs route <n>`. It prints the passes, the models, the `risk:*` tier, and the over-budget data. Run the `pre-pr` skill with that output (pre-pr reads it in task 4b, #109). It runs 3 rounds at most. If 3 rounds end with an open Important finding: hard stop. Read the findings with `node tooling/repo-checks/scripts/factory.mjs read <n> pre-pr`. Store the step: `note <n> review`.
6. Route again after the review fixes: `node tooling/repo-checks/scripts/factory.mjs route <n>`. Keep the tier and the routing line.
7. Push. Run `node tooling/repo-checks/scripts/factory.mjs push <n>`. The script runs the local test guard first (no PR labels, against the base of the ticket). Then it pushes `HEAD` to the ticket branch.
   - The finding "check config changed" does not block the push. Use `risk:high` for the PR. Write the finding in the PR body.
   - Any other finding blocks the push (exit 2). Give it one fix round: fix each finding, commit, and run `push` again.
   - A finding that stays after the one fix round is a hard stop. An exit 3 with `hard stop: <reason>` is a hard stop too. Run `node tooling/repo-checks/scripts/factory.mjs hardstop <n> "<reason>"` (see "Hard stop").
8. Open the PR (a new PR only: if the branch has an open PR, run `gh pr edit` for the label and go to step 9). Use the `pr-description` skill for the body, with these overrides (the skill gets them in task 4c, #110).
   - Skip its push step. Step 7 pushed.
   - Write the body to `/tmp/factory-pr-<n>.md` with the Write tool.
   - Add `Closes #<n>`, the section `## Decisions I made` (read them with `node tooling/repo-checks/scripts/factory.mjs read <n> decisions`, or write `None`), the section `## Over budget` (from the `route` output), the routing line, and the check-config finding if there was one.
   - Open it: `gh pr create --base main --title "<title>" --label risk:<tier> --body-file /tmp/factory-pr-<n>.md`. The tier comes from the `route` output.
   - Then `node tooling/repo-checks/scripts/factory.mjs stage <n> ci`.
9. CI. Get the PR number with `gh pr view --json number -q .number`. Run `node tooling/repo-checks/scripts/factory.mjs wait <pr>` as a background command. The `Stop` hook allows the stop while it runs. When it ends:
   - `passed`: go to step 10.
   - `failed`: run `caps <n>`. Exit 3 means 3 failed CI runs: hard stop. Else read the log: `gh pr checks <pr> --json name,bucket,link`, then `gh run view <run-id> --log-failed`. Then follow "After a CI failure".
   - `timeout` (exit 3, `hard stop: CI timeout`): hard stop with the reason "CI timeout".
10. Green. Run `node tooling/repo-checks/scripts/factory.mjs stage <n> green`. Update the metrics comment with `node tooling/repo-checks/scripts/factory.mjs metrics <n>` (built in task 5, #100). Until that task ships, skip it and say so in the report. Go to the loop and run `next`.

After a CI failure (also for an owner comment): run `stage <n> building`, fix the cause, run the `verify` skill, commit, and go to step 5. The push in step 7 updates the PR. If the tier changed, run `gh pr edit <pr> --add-label risk:<new> --remove-label risk:<old>`. Then run `stage <n> ci` and go to step 9. Never weaken a test or a check to pass.

## Hard stop

Hard stop cases:

- A decision case of "Work a ticket" step 3 (high-tier path, contradicting Acceptance, missing access or secret, deploy or console step).
- `verify` fails after 3 fix rounds.
- The local test guard finding stays after the one fix round.
- 3 failed CI runs, or a cap from `caps`, or a CI timeout.
- 3 review rounds end with an open Important finding.
- A command that exits 3 and prints `hard stop: <reason>` (a `gh` call that failed twice, a second push reject, a merge conflict).
- Any "ask the human" inside a sub-skill.

Steps:

1. Run `node tooling/repo-checks/scripts/factory.mjs hardstop <n> "<reason>"`. Put the error excerpt (40 lines at most) on stdin with a quoted heredoc (`<<'EOF'`). The script sets `needs-human`, pushes `HEAD`, saves the patch and the excerpt in local files, posts one comment, writes the run report, and ends the run. It opens no draft PR and starts no next ticket.
2. If it exits 2, a step failed. Show the failed steps in the report.
3. End the session: `node tooling/repo-checks/scripts/stop-gate.mjs defer "<reason>"`.

## Worktree setup (owner, once)

The run works in its own worktree so that the main checkout keeps its branch. The worktree never runs `git checkout main`.

1. `git fetch origin`, then `git worktree add --detach ../projects-monorepo-factory origin/main`.
2. In that folder: `node common/scripts/install-run-rush.js install`.
3. In that folder, write the local settings file (it is not committed). Do not add `git push`: the `push` command does each push.

```json
{
  "permissions": {
    "allow": [
      "Bash(git fetch:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git merge:*)",
      "Bash(git switch:*)",
      "Bash(gh pr create:*)",
      "Bash(gh pr ready:*)",
      "Bash(gh pr edit:*)",
      "Bash(gh pr checks:*)",
      "Bash(gh run view:*)",
      "Bash(gh issue view:*)",
      "Bash(gh issue edit:*)"
    ]
  }
}
```

## Done when

- [ ] Each ticket of the run is green (PR open, `Closes #<n>`, CI green, one `risk:*` label), or the run ended in a hard stop with `needs-human` and one comment.
- [ ] `next` printed `done`, or the hard stop ran, or `stop` ran.
- [ ] The report shows the PR URLs, the run report path, and each step that is not built yet.

## Do not

- Merge, approve, or close an issue. The owner merges.
- Edit Acceptance. Only the owner edits it.
- Run `git push`. Use the `push` command. Never use a `+` refspec or a force flag.
- Post a comment with `gh`. Use `comment` or `hardstop`.
- Start a second ticket before the first is green, or work two tickets in parallel.
- Skip, delete, or weaken a test or a check.
- Run `cdk deploy`, `cdk destroy`, or `--no-verify` (root CLAUDE.md rule 4).
- Open a draft PR after a hard stop.
