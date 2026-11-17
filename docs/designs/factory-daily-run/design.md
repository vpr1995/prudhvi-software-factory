---
status: approved
---

# Design: Factory daily run

Brief: `docs/designs/factory-daily-run/brief.md`

Differs from the brief (owner decisions in section 9): `/work-ticket` is deleted, not an alias. A run has no 5-ticket cap; it ends when no ticket can start. The routing table is a plain module, `lib/factory-routing.mjs`, not a JSON file. The subagent spawn cap is dropped. Caps reset when the owner restarts a `needs-human` ticket. The review round limit is the `pre-pr` limit (R-13), not a ticket cap.

## 1. Problem, Goals, Non-goals

The owner starts each ticket by hand, and a run stops at each open decision, at each blocker, and after each ticket. Owner review comments, resume after a crash, cost data, and review cost per change have no support in code.

Goals:

1. One `/factory` command works the owner's review comments and then the `agent:ready` queue, one ticket at a time, with no human in the loop.
2. Scripts decide which input to trust, which review passes run, the `risk:*` label, and when a cap stops the run (root `CLAUDE.md` rule 5).
3. A run resumes from state that GitHub confirms.
4. A gate failure, 3 failed review rounds, or a cap is a hard stop: the branch is pushed, the ticket gets a redacted comment and `needs-human`, and the whole run stops.
5. A blocked ticket can stack on an open green blocker PR (depth 2, merge commits, no force push).
6. Each ticket has one `factory-metrics` comment with cost, turns, and rounds.

Success measure (owner, brainstorm): owner time of 5 minutes or less for each ticket, cost visible on each PR, and a `needs-human` rate under 30%.

Non-goals: auto-merge, parallel writers, Phase 2 (the GitHub Actions runner of `docs/designs/software-factory/design.md` section 6.5), an intake agent, a dashboard, and a change to any current gate or to the deny rules.

### Minimal version

- `/factory` with the queue, the trust checks, the caps, the hard stop, the run log and report, resume, `--dry-run`, and `FACTORY_RUN=off`.
- The routing table and router: review passes and models from paths, the `risk:*` label from code, and the local test guard before each push.
- Decide-and-record for open decisions, with a hard stop on high-tier paths.

## 2. Requirements

Terms:

- "Owner": the GitHub login that owns the repo.
- "High-tier path": a path of `docs/standards/risk-tiers.md` section 2.
- "Hard stop": the steps of R-12, run by `factory.mjs hardstop`.
- "Code change": a diff that is not doc-only (R-18).
- "Verify gate": the `Stop` and `SubagentStop` hook of `tooling/repo-checks/scripts/stop-gate.mjs`. It blocks the stop until `rush test` passes for the edited projects.
- "Commit gate": the `PreToolUse` hook of `stop-gate.mjs`. It blocks `git commit` until the verify proof matches the staged change. So each commit on a branch passed the commit gate.
- `stop-gate defer "<reason>"`: an existing `stop-gate.mjs` command. It lets the main session stop with failing tests and records the reason.
- `pre-pr`: `.claude/skills/pre-pr/SKILL.md`. Up to 3 review rounds. Each finding has the severity Important or Nit.
- `bug-hunt`: the skill that runs the `fresh-reviewer` agent. `spec-reviewer`: the agent that checks the diff against the Acceptance list.

Run:

- R-1: WHEN the owner runs `/factory` THE SYSTEM SHALL work the `agent:ready` tickets in board order, one ticket at a time.
- R-2: WHEN the owner runs `/factory <n>` THE SYSTEM SHALL work only ticket `<n>` and only the owner comments on its PR. `/factory` is the only entry point. The `/work-ticket` skill does not exist.
- R-3: WHEN the owner runs `/factory --dry-run` THE SYSTEM SHALL print the queue, the order, the stack plan, and the routed passes, and SHALL make no label change, push, or comment, and SHALL not write or adopt a run.
- R-4: WHILE `FACTORY_RUN=off` is set THE SYSTEM SHALL refuse to start a run and print the reason.
- R-5: WHEN no ticket can start (the queue is empty, or each ticket left is blocked and cannot stack) THE SYSTEM SHALL end the run with the run report. The run has no ticket count limit.
- R-42: WHILE the CI of a blocker PR runs THE SYSTEM SHALL wait for the CI result, and then stack the blocked ticket (R-36) or skip it (R-6).
- R-43: WHEN `/factory` picks a new ticket THE SYSTEM SHALL skip it and log the reason if the issue is closed, has no `agent:ready`, has `agent:in-progress` or `needs-human`, has `[owner]` in the title, is a parent issue, has no Acceptance checkbox, or has a `Paths:` line that names a path under `tooling/repo-checks/` or `.claude/settings.json`. A ticket with `agent:in-progress` and a local `ticket.json` is not new: `next` resumes it at the stage of R-23. IF `gh` has no `project` scope THEN `start` SHALL refuse to start.
- R-6: IF a ticket has an open blocker and the ticket cannot stack (R-36) THEN THE SYSTEM SHALL skip the ticket, log the skip, and go to the next ticket.
- R-44: WHILE a run is active and the last `next` result is not `done`, THE SYSTEM SHALL block the stop of the session that owns the run with a `Stop` hook and give the stored next step as the reason. `next` reads GitHub and stores its result in `run.json`. The agent runs `next` before each stop. The first `stop-check` after `start` claims the run: it stores the `session_id` of the hook input. The hook allows the stop of each other session. `stop-check` reads only local state and makes no network call. A hook timeout (10 seconds) allows the stop. This is the `/goal` loop, with a script check in place of a model check. The factory check is a second command on the existing `Stop` event, next to the verify gate. The verify gate does not change. When both block, the agent gets both reasons and proves the tests first.
- R-56: IF `stop-check` fails with an error (also a load error of its own code) 3 times in a row THEN THE SYSTEM SHALL allow the stop and print the error. `stop-check` always exits 0 and blocks only through its JSON output.
- R-46: WHEN the owner runs `/factory status` THE SYSTEM SHALL print the run state: active or not, the current ticket and stage, the cap counts, and the next step.
- R-47: WHEN the owner runs `/factory stop` THE SYSTEM SHALL clear the active run, keep each `ticket.json`, write the run report with the current ticket and the resume command, and change no label.
- R-49: WHILE the run waits for CI THE SYSTEM SHALL run `factory.mjs wait <n>` as a background command, and the `Stop` hook SHALL allow the stop. `wait` polls `gh pr checks` every 30 seconds and exits when CI ends, which wakes the session. IF CI does not end in 60 minutes THEN `wait` SHALL exit with "timeout", and the agent SHALL do a hard stop with the reason "CI timeout". The same rule applies to the blocker wait of R-42.
- R-50: WHEN `/factory` starts and a run is active or `stalled` THE SYSTEM SHALL adopt the run, clear its owning session (the next `stop-check` claims it), log "resumed", and go on.
- R-48: IF the factory `Stop` hook blocks 3 times in a row with no change in the run state (stage, counts, the stored `next` result, and the last run log line), outside a CI wait, THEN THE SYSTEM SHALL mark the run `stalled`, allow the stop, change no label, and write "stalled: run `/factory` to resume" in the run report. A usage limit or a stuck session ends this way, with no `needs-human` (R-14). WHILE the run is `stalled`, `stop-check` SHALL allow each stop, and the next `start` adopts the run (R-50) and clears `stalled`.
- R-45: WHEN the run ends (R-5), a hard stop happens (R-12), the owner runs `/factory stop` (R-47), or `FACTORY_RUN=off` is set, THE SYSTEM SHALL clear the active run, and the `Stop` hook SHALL allow the stop.

Trust:

- R-7: IF the issue author, or the actor that added `agent:ready`, is not the owner THEN THE SYSTEM SHALL skip the ticket and log the skip.
- R-8: WHEN the agent posts a comment on GitHub (also the metrics comment) THE SYSTEM SHALL start the comment with the line `<!-- factory-agent -->`.
- R-9: IF a comment is not by the owner, or it has the agent marker, THEN THE SYSTEM SHALL not use the comment as input.

Decisions:

- R-10: WHEN the ticket does not make a decision that the work needs, and the decision touches no high-tier path, THE SYSTEM SHALL take the safest option (reversible, smallest scope, behind a flag when user-visible) and record it in the PR section "Decisions I made".
- R-11: IF an open decision touches a high-tier path, the Acceptance list contradicts itself, the work needs an access or a secret that the agent does not have, or the work needs a deploy or a manual console step, THEN THE SYSTEM SHALL do a hard stop.

Hard stop:

- R-12: WHEN a hard stop happens, the agent SHALL run `factory.mjs hardstop <n> "<reason>"`, and THE SYSTEM SHALL do these steps in this order, and each step SHALL be safe to run again: (1) set `needs-human` and remove `agent:in-progress`; (2) push `HEAD` of the branch through `factory.mjs push`, if the branch has a commit (this push skips the local test guard); (3) save the uncommitted changes, and each untracked file that git does not ignore, as a patch in `<n>/logs/`; (4) post one ticket comment with the reason, an error excerpt of at most 40 lines (from stdin) with secret-like strings and home paths removed, the branch name, and the patch file name; (5) create or edit the `factory-metrics` comment with the outcome `needs-human` (R-32); (6) write the run report; (7) clear the run. It SHALL open no draft PR and start no next ticket. The agent then ends the session with `stop-gate defer "<reason>"`. The gates do not change.
- R-13: IF `verify`, CI (3 failed runs), or the local test guard still fails after the fix rounds, or 3 review rounds of one `pre-pr` run end with an open Important finding, THEN THE SYSTEM SHALL do a hard stop.
- R-14: WHILE a run works THE SYSTEM SHALL save the state at each stage move, so that a usage limit or a crash loses at most the current step. The next `/factory` adopts the run (R-50) and SHALL not set `needs-human` for it.

Caps:

- R-15: IF a ticket reaches 3 failed CI runs or 3 hours of active time THEN THE SYSTEM SHALL do a hard stop. The script derives the counts only from events after `restartedAt` of the ticket: failed CI runs from GitHub, active time from the run log. Active time is the sum of the gaps between the run log lines of the ticket, with each gap capped at 10 minutes and CI waits left out. The model does not report the counts. The review round limit is R-13. The comment fix round limit is R-31.
- R-16: IF a count of R-15 cannot be derived THEN THE SYSTEM SHALL treat the cap as reached.
- R-51: WHEN the owner restarts a `needs-human` ticket (adds `agent:ready` again) THE SYSTEM SHALL set `restartedAt` of the ticket to the time of that label event and add 1 to `resumes`. The cap counts then start from 0.

Test guard and routing:

- R-17: WHEN the agent has committed and is about to push THE SYSTEM SHALL run the test guard locally with no PR labels, against the base of R-37. The finding "check config changed" goes to the router (R-21) and to the PR body. For each other finding the agent gets one fix round. IF a finding stays after that round THEN THE SYSTEM SHALL do a hard stop.
- R-18: WHEN a review round starts THE SYSTEM SHALL pick the passes and models from the pass table (4.2), and `pre-pr` SHALL spawn each pass with the model of the router output. For a doc-only diff, only the spec pass runs. A diff is doc-only when each changed path matches `docOnly` and no path matches `docOnlyExclude`.
- R-19: IF no glob of the routing table decides for a reviewer THEN THE SYSTEM SHALL run that reviewer.
- R-20: WHEN the router runs THE SYSTEM SHALL print JSON with each pass, its model, the matched rule, and each skipped pass, store it in the ticket state, and add one routing line to the PR body.
- R-21: WHEN the agent opens a PR or pushes to it THE SYSTEM SHALL set the `risk:*` label from the routing table: the highest tier that matches a changed path, or `risk:high` when the local test guard reports "check config changed".
- R-22: IF the routing table and the tables of `docs/standards/risk-tiers.md` differ THEN THE SYSTEM SHALL fail a unit test. The test takes each path in backticks from the tables, replaces each `*` with a sample name, and checks that the routing table puts the sample in the same tier. It also checks a sample with a dot name (for example `packages/x/.npmignore`) under each tier folder. Rows with no path (auth code, billing code, a new dependency) are listed in the test as known prose rows.

State:

- R-23: WHEN a run starts or resumes THE SYSTEM SHALL derive the stage of each ticket from GitHub, and on a mismatch with the local state SHALL print both values and use GitHub.
- R-24: IF a stage move is not legal THEN THE SYSTEM SHALL refuse it and exit non-zero with the reason.
- R-25: WHILE a run works THE SYSTEM SHALL keep its state in `.claude/factory/<n>/` and read and write it only through the state script. A unit test SHALL fail when a skill or agent file names that folder, or calls `gh pr comment` or `gh issue comment` directly (R-8).
- R-26: WHEN a step ends THE SYSTEM SHALL store a step summary that starts with `## Summary` and 3 to 5 bullets.
- R-27: WHEN a ticket starts THE SYSTEM SHALL use a `pre-pr` state folder for that ticket only, written through the `round` and `findings` commands. WHEN `pre-pr` runs with no ticket THE SYSTEM SHALL use an ad hoc folder that the script picks.
- R-28: WHEN the state script makes a stage move, a label move, a skip, a gate result, or a decision THE SYSTEM SHALL append one line to the run log.
- R-29: WHEN a run ends THE SYSTEM SHALL write the run report: tickets done, PRs that wait for a merge, the ticket that stopped and why, the tickets skipped, the hard-stop steps that failed, and the resume command.
- R-53: WHEN the state script writes state THE SYSTEM SHALL hold a lock file made with an exclusive create. IF the lock is held by a live process THEN the script SHALL exit non-zero with the reason. A lock of a dead process is removed.

Failures:

- R-54: IF a `gh` call fails THEN THE SYSTEM SHALL retry it once, and on a second failure do a hard stop. IF a push is rejected THEN THE SYSTEM SHALL fetch, merge the remote branch, and push once more, and on a second reject do a hard stop. Each push goes through `factory.mjs push`, which runs only `git push origin HEAD:<branch>` with no `+` and no force flag.
- R-55: IF a merge (R-38, R-39, R-54) has a conflict THEN THE SYSTEM SHALL abort the merge and do a hard stop that lists the conflict paths.

Review loop:

- R-30: WHEN an open factory PR has a new owner review comment (R-9) THE SYSTEM SHALL run a fix round with the gates and the routed passes before it starts a new ticket, reply to the comment with the fixing commit, and store the comment ID.
- R-31: IF the owner posts a new comment in a thread where the agent already replied 3 times THEN THE SYSTEM SHALL do a hard stop. A thread is a PR review comment with its replies. A review body or an issue comment is a thread of its own.

Metrics and PR body:

- R-32: WHEN a ticket ends or stops THE SYSTEM SHALL create, or edit in place, one `factory-metrics` comment with schema version 2: the version 1 fields plus `v`, `stages`, `reviewers`, `over_budget`, `decisions`, `stacked_on`, `resumes`, `ci_runs`, and the Claude Code version.
- R-33: WHEN the cost script runs THE SYSTEM SHALL open only the transcripts (main and subagent) of the session IDs of the run in this repo's project folder, count only the messages between the first and the last run log line of the ticket, read only numeric usage fields and the model name, write no transcript text to any output, and write `null` and a warning on a parse failure or an unknown model.
- R-34: WHEN the agent opens a PR THE SYSTEM SHALL count the changed lines without test files, the lockfile, and generated files, and add an "Over budget" line when the count is above the limit for the ticket size (`Size:` in the ticket Notes): 1: 150, 2: 300, 3: 500, 4 or 5: 800. A missing size, or a size above 5, uses 800 and adds a warning to the routing line.
- R-35: WHEN the agent writes a PR body THE SYSTEM SHALL include the sections "Decisions I made" and "Over budget", and the stack line for a stacked PR.

Stacked PRs:

- R-36: WHEN each blocker of a ticket has an open PR with green CI and no `needs-human`, and the stack depth stays at 2 or less, THE SYSTEM SHALL start the branch from the blocker branch and open a draft PR that targets the blocker branch, with the line `Stacked on #<m>. Merge #<m> first.`
- R-37: WHILE a ticket is stacked THE SYSTEM SHALL use `origin/<base>...HEAD` (the merge base with the stack base) for each review pass, the router, the local test guard, the diff count, and the risk tier.
- R-38: WHEN a lower branch of a stack changes THE SYSTEM SHALL merge it into the upper branch with no rebase and no force push, and run `verify` again.
- R-39: WHEN the parent PR of a stacked PR merges THE SYSTEM SHALL merge `main` into the child branch, push it, and mark the child PR ready.
- R-40: IF a stacked PR merged into a branch other than `main` THEN THE SYSTEM SHALL report it and the recovery step in the run report.
- R-41: IF a blocker PR of a stacked ticket closes without a merge THEN THE SYSTEM SHALL do a hard stop.

Clean-up:

- R-52: WHEN `pre-pr` runs THE SYSTEM SHALL not run the built-in `code-review` pass. A unit test SHALL fail when `.claude/skills/pre-pr/SKILL.md` names that pass.

### Unchanged behavior

- The verify gate, the commit gate, and their hooks in `.claude/settings.json`.
- The deny rules, including the rules for `.claude/state/` and force push. The `ask` rules for `tooling/repo-checks/**` and `.claude/settings.json`. The `allow` rules of the main checkout get only the `factory.mjs` rule.
- The CI test guard, doc lint, coverage, and the jobs of `ci.yml`.
- The owner merges each PR. No auto-merge.
- Writers run one at a time.
- Only a human edits Acceptance (Ticket Workflow rule 3).
- One ticket is one PR with `Closes #<n>`. The agent never closes an issue.
- The design stages: `/brainstorm`, `/design`, `/design-review`, and `/plan-tickets` create and label the tickets. `/factory` starts only from a labeled ticket.
- The `factory-metrics` block format: one fenced block of type `factory-metrics` with one JSON line. Version 1 fields keep their names.
- `pre-pr` keeps 3 rounds at most, the spec pass first, and the `findings.md` row format and reopen rule. `bug-hunt` runs on each code change.

## 3. Critical user journeys

### J1. Daily run (happy path)

1. The owner runs `/factory` in the factory worktree (`../projects-monorepo-factory`, set up once as in section 6). The session is in auto mode. The owner plans in the main checkout at the same time.
2. The state script marks the run active and reconciles each ticket with GitHub (R-23). The first `Stop` hook call claims the run (R-44).
3. The script handles new owner review comments first (J2).
4. The script picks the next `agent:ready` ticket in board order and runs the trust and readiness checks (R-7, R-43).
5. The agent claims the ticket (`stage <n> building`: removes `agent:ready`, adds `agent:in-progress`), runs `git fetch`, creates the branch from `origin/main`, writes a failing test, and writes the code.
6. The verify gate and the commit gate run as today. The local test guard runs after each commit and before each push (R-17). Each push goes through `factory.mjs push`.
7. The router picks the review passes and models (R-18). The review rounds run (3 at most). The agent fixes the findings.
8. The agent opens the PR: `Closes #<n>`, "Decisions I made", the routing line, the "Over budget" line if needed, and `risk:*` from the router (R-21, R-35).
9. The agent runs `wait <n>` in the background (R-49). On a failure, it fixes the cause and pushes (3 failed runs at most).
10. CI is green. `stage <n> green` removes `agent:in-progress`. The agent updates the metrics comment (R-32).
11. The agent runs `next`, which stores the next step, and tries to stop. The `Stop` hook reads the stored step and blocks the stop with "next: #<m>" (R-44). Go to step 3.
12. `next` returns `done`. The script writes the run report and clears the run (R-5, R-45). The session stops.

Failure path: any gate failure or cap goes to J4. A stall goes to J5.

### J2. Owner review comment

1. The owner writes a review comment on factory PR #95. The owner does not merge.
2. The next `/factory` run (or the next loop of the active run) finds the comment: author is the owner, no agent marker, ID not handled (R-9, R-30).
3. The agent switches to the branch, fixes the comment, runs the gates and the routed passes, and pushes.
4. The agent replies to the comment with the commit SHA (`comment <n> reply <id>`). The script stores the comment ID and adds 1 to the reply count of the thread.
5. The run goes on with the queue.

Failure path: the owner comments again in a thread where the agent already replied 3 times, or a gate fails: J4 (R-31).

### J3. Stacked ticket

1. Ticket #90 is blocked by #92. PR #95 (for #92) is open.
2. CI of #95 runs. The run waits for the result (R-42).
3. CI is green and #95 has no `needs-human`. The stack depth is 1. The agent branches #90 from `origin/feat/92-...` and opens draft PR #96 to that branch (R-36).
4. Each review pass, the router, and the local test guard use `origin/feat/92-...` as the base (R-37).
5. The owner comments on #95. The agent fixes #95 (J2), then runs `restack 90`, which merges the #92 branch into the #90 branch. The agent runs `verify` (R-38).
6. The owner merges #95. GitHub deletes the #92 branch and moves #96 to `main`.
7. The next loop runs `restack 90`, which merges `main` into the #90 branch, pushes (CI runs), and marks #96 ready (R-39).

Failure paths:

- CI of #95 is red, or #95 has `needs-human`: the run skips #90 (R-6).
- The stack is already 2 deep: the run skips the ticket (R-6).
- #95 closes without a merge: hard stop (R-41).
- A merge has a conflict: hard stop with the conflict paths (R-55).
- The owner merges #96 into the #92 branch first: the run report names the case and the recovery step (R-40).

### J4. Hard stop

1. A gate fails after the fix rounds, 3 review rounds fail, a cap is reached, or a decision of R-11 comes up (R-11, R-13, R-15).
2. The agent runs `factory.mjs hardstop <n> "<reason>"` with the error excerpt on stdin.
3. The script sets `needs-human` and removes `agent:in-progress`, pushes `HEAD`, and saves the uncommitted changes and the untracked files as a patch in the ticket logs.
4. The script posts one comment on the ticket: the reason, a redacted excerpt, the branch, and the patch file name.
5. The script updates the metrics comment, writes the run report, and clears the run (R-45).
6. The agent ends the session with `stop-gate defer "<reason>"`.
7. The owner reads the comment, fixes the ticket or the code, removes `needs-human`, and adds `agent:ready` again. The next `/factory` resumes the ticket with the cap counts at 0 (R-51).

### J5. Session dies, stalls, or a usage limit is reached

1. The session crashes, an agent gets a usage limit or a rate limit error, or the `Stop` hook sees no progress 3 times (R-48).
2. The state was saved at the last stage move (R-14). On a stall, the run is marked `stalled` and the stop is allowed. The session ends. No label changes.
3. The owner runs `/factory` later.
4. The script reconciles each ticket with GitHub (R-23). GitHub wins on a mismatch.
5. The script adopts the run and logs "resumed" (R-50). The ticket with `agent:in-progress` and a local `ticket.json` resumes at its stage (R-43). The cap counts go on (R-15). No `needs-human`.

Failure path: a cap count that cannot be read counts as reached (R-16): hard stop.

### J6. Dry run and off switch

1. The owner runs `/factory --dry-run`. The script prints the queue, the order, the stack plan, and the routed passes. Nothing changes on GitHub, and no run is written (R-3).
2. The owner starts `claude` with `FACTORY_RUN=off` in the shell. `/factory` refuses to start (R-4). The `Stop` hook allows each stop (R-45).
3. The owner runs `/factory status` during a run. The script prints the ticket, the stage, the cap counts, and the next step (R-46).
4. The owner runs `/factory stop` in the running session. The run clears, the report names the current ticket and the resume command, and no label changes (R-47).

## 4. Contracts, data, infra

No API route, no web page, no Zod contract. `@vprprudhvi/tooling-repo-checks` uses Node built-ins only (Node 24). Each script checks the shape of its input and exits non-zero with the path and the rule on a bad shape.

### 4.1 Script

One CLI: `tooling/repo-checks/scripts/factory.mjs`. Logic in `lib/factory-*.mjs`, as in `stop-gate.mjs`. It is the only reader and writer of `.claude/factory/`.

- Environment reads (`FACTORY_RUN`) are only in `lib/factory.config.mjs`. `FACTORY_RUN` comes from the environment of the `claude` process, and the hook gets the same environment.
- Each file call with a computed path goes through `lib/fs-io.mjs` (the lint rule allows computed paths only there). New `fs-io` functions: exclusive create (`wx`), atomic write (write a temp file, then rename), append a line, and list a folder.
- Each `gh` call goes through one wrapper in `lib/factory-github.mjs` (R-54). Tests replace the wrapper with a stub. Each `git` write goes through `push` or `restack`.

| Command                                     | Job                                                                                                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start [<n>] [--dry-run]`                   | Trust and readiness checks, reconcile with GitHub, mark the run active or adopt it, print the plan.                                                                          |
| `next`                                      | Find the next step (a comment to fix, a ticket to start or resume, a CI wait, or `done`) and store it.                                                                       |
| `stage <n> <stage>`                         | Move a ticket stage and its labels (4.4). Refuse an illegal move.                                                                                                            |
| `caps <n>`                                  | Derive the cap counts (R-15) and print them. Exit non-zero with the reason when a cap is reached.                                                                            |
| `hardstop <n> "<reason>"`                   | Run the R-12 steps. Error excerpt from stdin.                                                                                                                                |
| `push <n>`                                  | Run the local test guard (R-17), then `git push origin HEAD:<branch>` with the R-54 retry. No `+`, no force flag.                                                            |
| `restack <n>`                               | Merge the stack base (or `main` after the parent merged) into the branch, push, and mark the PR ready (R-38, R-39).                                                          |
| `note <n> <step>`                           | Store a step summary from stdin.                                                                                                                                             |
| `round <n> start`                           | Start a `pre-pr` review round (R-27).                                                                                                                                        |
| `findings <n> add\|set <id> <status>\|list` | `add`: append `findings.md` rows from stdin; a row that matches a `fixed` row (same `file:line` and bug class) reopens it. `set`: change the status. `list`: print the rows. |
| `comment <n> <kind> [<reply-to-id>]`        | Post an agent comment from stdin (`kind`: `hard-stop` or `reply`). A reply stores the comment as handled.                                                                    |
| `route <n>`                                 | Print the routing JSON (4.2) and store it in the ticket state.                                                                                                               |
| `metrics <n>`                               | Read the cost and turns, and create or edit the metrics comment.                                                                                                             |
| `status`, `stop`, `report`                  | R-46, R-47, R-29.                                                                                                                                                            |
| `read <n> <step>`                           | Print a step summary or the `pre-pr` findings for the orchestrator.                                                                                                          |
| `wait <n>`                                  | Mark a CI wait, poll `gh pr checks` until CI ends, exit with the result or "timeout" after 60 minutes (R-49).                                                                |
| `stop-check`                                | The `Stop` hook (R-44, R-48, R-56).                                                                                                                                          |

The skill calls it as `node tooling/repo-checks/scripts/factory.mjs <command>`. No command names `.claude/factory`. With no ticket, `round`, `findings`, and `route` use the ad hoc folder (R-27). `findings.md` keeps the current `pre-pr` row format: `id | round | severity | file:line | bug class | status | reason`.

`comment`, `hardstop`, and `metrics` add the marker line (R-8), redact, and cap the body at 60,000 characters. Redaction replaces each match with `[redacted]`:

| Pattern                                                         | Catches                       |
| --------------------------------------------------------------- | ----------------------------- |
| `AKIA[0-9A-Z]{16}`                                              | AWS access key ID             |
| `gh[pousr]_[A-Za-z0-9]{36,}`                                    | GitHub token                  |
| `sk-[A-Za-z0-9_-]{20,}`                                         | API key with the `sk-` prefix |
| `-----BEGIN [A-Z ]*PRIVATE KEY-----`                            | Private key                   |
| `(secret\|token\|password\|api[_-]?key)\s*[:=]\s*\S+` (no case) | Key and value pair            |
| `/Users/[^/\s]+`, `/home/[^/\s]+` (replaced with `~`)           | Home path                     |

### 4.2 Routing table

File: `tooling/repo-checks/scripts/lib/factory-routing.mjs`. It exports a plain object.

Glob match: a `matches(path, glob)` wrapper on the Node built-in `path.matchesGlob`. `path.matchesGlob` does not match a name that starts with a dot through `*` or `**`. So the wrapper replaces a leading dot in each path segment, in the path and in the glob the same way, before the match. Then `packages/**` matches `packages/x/.npmignore`, and `**/*.md` matches `.github/x.md`. Test files: the router imports `isTestFile` from `lib/test-guard-rules.mjs`. It keeps no own test glob list.

```js
export default {
  docOnly: ['**/*.md'],
  docOnlyExclude: ['**/CLAUDE.md', '**/REVIEW.md', '.claude/**', '.github/**'],
  excludeFromCount: ['common/config/rush/pnpm-lock.yaml', '**/*.generated.*'],
  tiers: {
    high: [
      'platform/**',
      'packages/**',
      'tooling/**',
      '.github/**',
      'projects/*/cdk.json',
      'common/config/rush/pnpm-lock.yaml',
      '**/auth/**',
    ],
    medium: [
      'projects/*/bin/**',
      'projects/*/lib/**',
      '**/CLAUDE.md',
      '**/REVIEW.md',
      'docs/guides/**',
      'docs/standards/**',
    ],
  },
  // A path in no tier: low when doc-only or a test file (isTestFile), else medium.
  passes: {
    'spec-reviewer': { when: 'always', model: 'opus' },
    'fresh-reviewer': { when: 'code-change', model: 'sonnet' },
    simplify: { when: 'code-change', model: 'session' },
    'security-reviewer': { when: 'code-change', model: 'tier' },
    'infra-reviewer': {
      when: ['projects/*/bin/**', 'projects/*/lib/**', 'platform/**', 'packages/cdk-constructs/**'],
      model: 'tier',
    },
  },
  models: { high: 'opus', default: 'sonnet' }, // "tier": opus on risk:high, else sonnet
  diffBudget: { 1: 150, 2: 300, 3: 500, 4: 800, 5: 800, missing: 800 },
};
```

Pass table:

| Config name         | Agent or skill                            | Model                       | Runs when             |
| ------------------- | ----------------------------------------- | --------------------------- | --------------------- |
| `spec-reviewer`     | `spec-reviewer` agent                     | Opus                        | each round            |
| `fresh-reviewer`    | `bug-hunt` skill (`fresh-reviewer` agent) | Sonnet                      | code change           |
| `simplify`          | built-in `simplify`                       | session model               | code change           |
| `security-reviewer` | `security-reviewer` agent                 | Opus on `risk:high`, Sonnet | code change           |
| `infra-reviewer`    | `infra-reviewer` agent                    | Opus on `risk:high`, Sonnet | an infra glob matches |

The agent files keep their `model` front matter. `pre-pr` reads `route` output and gives each agent spawn the router `model` as the override. `bug-hunt` gets the model in its request.

Local test guard: `factory.mjs push` imports `guardRepository` from `test-guard.mjs` and `CHECK_CONFIG_MESSAGE` from `lib/test-guard-rules.mjs`. `guardRepository` takes the base ref and reads commits only, so it runs after the commit. A finding with `message === CHECK_CONFIG_MESSAGE` sets `risk:high` (R-21). The test guard itself does not change.

A unit test checks the routing table against the tables of `docs/standards/risk-tiers.md` sections 2 and 2.1 with the sample-path rule of R-22.

Router output (printed, and stored in the ticket state, R-20):

```json
{
  "base": "origin/main",
  "tier": "medium",
  "docOnly": false,
  "passes": [
    { "name": "spec-reviewer", "model": "opus", "rule": "always" },
    { "name": "fresh-reviewer", "model": "sonnet", "rule": "code-change" },
    { "name": "simplify", "model": "session", "rule": "code-change" },
    { "name": "security-reviewer", "model": "sonnet", "rule": "code-change" }
  ],
  "skipped": [{ "name": "infra-reviewer", "reason": "no path matched" }],
  "changedLines": 212,
  "budget": 300,
  "overBudget": false,
  "warnings": []
}
```

### 4.3 State folder

`.claude/factory/` (gitignored). Only `factory.mjs` reads and writes it. Each worktree has its own state folder.

```text
.claude/factory/
  lock                     lock file with the writer PID (R-53)
  stop-errors              count of stop-check errors in a row (R-56)
  run.json                 active run: { runId, sessionId, sessionIds, active, stalled, startedAt, only (ticket or null), next, waiting: { pr, since }, stopChecks: { count, lastHash } }
  runs/<runId>.jsonl       run log, one line per event (R-28)
  runs/<runId>-report.md   run report (R-29)
  <n>/ticket.json          ticket state (below)
  <n>/steps/<step>.md      step summaries, each starts with "## Summary" (R-26)
  <n>/pre-pr/              round-<k>.json ({ sha, ts }) and findings.md for this ticket (R-27)
  <n>/logs/                full gate logs and hard-stop patches (never posted)
  adhoc/pre-pr/            pre-pr state with no ticket (R-27)
```

`sessionId` is the session that owns the run (R-44). `sessionIds` lists each session that owned the run, for the cost read (R-33). `next` is the last `next` result. The script numbers the rounds of each `pre-pr` run. A new `pre-pr` run starts at round 1. `stop-check` writes `stop-errors` with a plain `node:fs` call in its own file, so a load error of `lib/` still counts (R-56).

`ticket.json`:

```json
{
  "issue": 90,
  "stage": "reviewing",
  "branch": "feat/90-favorites-api",
  "base": "feat/92-favorites-table",
  "pr": 96,
  "stackedOn": 95,
  "restartedAt": null,
  "threadReplies": { "<thread-root-id>": 1 },
  "handledComments": [],
  "decisions": 1,
  "resumes": 0,
  "routing": {}
}
```

The cap counts are not stored. `caps` derives them each time (R-15).

Run log line:

```json
{
  "ts": "2026-11-16T14:02:11Z",
  "ticket": 90,
  "event": "stage",
  "from": "building",
  "to": "reviewing",
  "detail": ""
}
```

Events: `stage`, `label`, `skip`, `gate`, `decision`, `comment`, `cap`, `wait`, `stop`, `stall`, `resume`, `reconcile`.

### 4.4 Stages

| Stage         | Meaning                                                     | Labels on entry                                    | Legal next stages                           |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| `building`    | Code, tests, fixes (also for an owner comment or a restack) | remove `agent:ready`, add `agent:in-progress`      | `reviewing`, `needs-human`                  |
| `reviewing`   | Review rounds                                               | none                                               | `building`, `ci`, `needs-human`             |
| `ci`          | PR is open, CI runs                                         | none                                               | `building`, `green`, `needs-human`          |
| `green`       | Waits for the owner                                         | remove `agent:in-progress`                         | `building`, `done`, `needs-human`           |
| `needs-human` | Hard stop                                                   | add `needs-human`, remove `agent:in-progress`      | `building` (owner adds `agent:ready` again) |
| `done`        | PR merged                                                   | none (GitHub closes the issue through `Closes #n`) | none                                        |

A move from `green` to `building` (owner comment, restack) adds `agent:in-progress` again and removes it at the next `green`. Reconcile from GitHub (R-23), in this order: PR merged: `done`. Issue has `needs-human`: `needs-human`. PR open with green CI: `green`. PR open with CI pending or red: `ci`. Else the stored stage.

### 4.5 GitHub data

Each `gh` call follows R-54 (one retry).

- Owner: `gh repo view --json owner -q .owner.login`.
- Queue and board order: `gh project item-list 2 --owner vpr1995 --format json`. It needs the `project` scope. With no scope, `start` refuses (R-43).
- Blockers: `gh api repos/<repo>/issues/<n>/dependencies/blocked_by`.
- Parent issue: `.sub_issues_summary.total` above 0 in `gh api repos/<repo>/issues/<n>`.
- Acceptance checkbox: a line that matches `^- \[[ xX]\] ` after the `### Acceptance` heading.
- Ticket size (R-34) and paths (R-43): the `Size: <n>` line in `### Notes` and the `Paths:` line in `### Context`, both written by `/plan-tickets`.
- CI result: `gh pr checks <pr> --json name,state,bucket`. Failed CI runs (R-15): `gh run list --branch <branch> --json conclusion,createdAt`, counted after `restartedAt`.
- Label actor (R-7, R-51): the last `labeled` event for `agent:ready` from `gh api repos/<repo>/issues/<n>/events`.
- Owner comments (R-9, R-30): `gh api repos/<repo>/pulls/<pr>/comments` (with `in_reply_to_id` for the thread root, R-31), `.../pulls/<pr>/reviews` (review bodies, "Request changes"), and `.../issues/<pr>/comments`. Kept: author is the owner, the body does not start with `<!-- factory-agent -->`, the body has no `factory-metrics` block (a version 1 metrics comment has no marker), the ID is not in `handledComments`. With `only` set, only the PR of that ticket (R-2).
- Agent comment marker: the first line of each agent comment, the metrics comment too, is `<!-- factory-agent -->` (R-8).

### 4.6 Metrics schema version 2

````text
<!-- factory-agent -->
```factory-metrics
{"v":2,"issue":90,"pr":96,"cost":1.84,"turns":41,"review_rounds":2,"ci_rounds":0,"outcome":"green","stages":{"building":1210,"reviewing":640},"reviewers":["spec-reviewer","fresh-reviewer","security-reviewer"],"over_budget":false,"decisions":1,"stacked_on":95,"resumes":0,"ci_runs":2,"claude_code":"2.1.300"}
```
````

- Version 1 fields (from the deleted `/work-ticket` skill): `issue`, `pr`, `cost`, `turns`, `review_rounds` (the `pre-pr` rounds run), `ci_rounds` (the failed CI runs), and `outcome` (`green` or `needs-human`). They keep their names and meaning. Version 1 has no `v` field.
- `ci_runs` is the count of all CI runs of the PR, green and failed. `ci_rounds` stays the count of failed runs.
- `cost` is the API-equivalent in US dollars. The price for each model is in `lib/factory-prices.mjs`.
- The ticket slice (R-33): the messages of the main and subagent transcripts of each session in `sessionIds`, with a time stamp between the first and the last run log line of the ticket.
- Usage fields read: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`. The model comes from `message.model`. An unknown model gives `cost: null` and a warning (R-33).
- `turns` is the count of assistant messages in the slice. `review_rounds` is the count of `pre-pr` round files of the ticket.
- `claude_code` comes from `claude --version`. `stages` holds seconds.
- The comment goes on the PR, or on the issue when no PR exists. The agent finds its earlier comment by the `factory-metrics` block and edits it.

### 4.7 Hook and settings

- `.claude/settings.json`, `Stop` event: a second command, `node "$CLAUDE_PROJECT_DIR"/tooling/repo-checks/scripts/factory.mjs stop-check || exit 0`, with a 10-second timeout. `stop-check` imports its code inside `try`, always exits 0, and blocks only through its JSON output, as `stop-gate.mjs` does. With no active run, or with `FACTORY_RUN=off`, it allows the stop.
- On an error during an active run, it blocks and names the error, at most 3 times in a row (R-56).
- `.claude/settings.json` `allow`: only `Bash(node tooling/repo-checks/scripts/factory.mjs:*)`. The `gh` and `git push` calls of `factory.mjs` run inside this rule.
- The factory worktree's `.claude/settings.local.json` (gitignored, set up once, section 6) `allow`: `git fetch`, `git add`, `git commit`, `git merge`, `git switch`, `gh pr create`, `gh pr ready`, `gh pr edit`, `gh pr checks`, `gh run view`, `gh issue view`, `gh issue edit`. No `git push`: each push goes through `factory.mjs push`. The main checkout keeps its current `allow` rules.
- The deny rules do not change. The `ask` rules for `tooling/repo-checks/**` and `.claude/settings.json` stay. `/factory` skips tickets that change these paths (R-43). The owner builds them with the current flow.
- `.gitignore`: add `.claude/factory/`.

### 4.8 Infra

None. No AWS or Cloudflare resource. No platform value.

## 5. Alternatives considered

- `/goal` with a model judge: the judge reads only the transcript and cannot see GitHub or the queue. Rule 5 puts this logic in code. The design copies its `Stop` hook loop instead (R-44).
- `stop-check` reads GitHub: a network call in a 10-second hook can time out and make the loop flaky. `next` reads GitHub and stores the result.
- A stall as a hard stop: a usage limit would set `needs-human` on a healthy ticket. A stall pauses the run instead (R-48).
- An `allow` rule for `git push`: it also allows a `+` refspec, which is a force push. `factory.mjs push` is the only push path.
- Stage only from labels: labels cannot hold the handled comment IDs, the restart time, or the stack base.
- State under `.claude/state/`: the deny rules protect the gate proof there.
- Separate route and cost scripts: more files for the same job. One CLI is simpler.
- A dollar cap as the guard: the transcript format is not documented, so the cap fails open.
- Rebase for stacked branches: rebase needs a force push, which the settings deny.
- Parallel writers in worktrees: Rush runs one command at a time, and the verify gate tracks one writer.
- Keep `/work-ticket` next to `/factory`: two entry points with different rules. The owner wants one.
- A ticket count limit for each run: the owner wants the run to go on until no ticket can start.
- A glob library for the router: the repo-checks package uses Node built-ins only, and Node 24 has `path.matchesGlob`.
- `/factory` builds its own later tasks: the hook would run a half-changed `factory.mjs` mid-run, and the `ask` rules on `tooling/repo-checks/**` stop an unattended run.

## 6. Flag, observability, cost, security, migration

Flag: none from `packages/flags`. The factory is repo tooling, not a user-visible app behavior (root `CLAUDE.md` rule 6 covers app behavior). The off switch is `FACTORY_RUN=off` (R-4, R-45).

Observability:

- The run log (`runs/<runId>.jsonl`) has one line for each event (R-28). The run report lists the result of the run (R-29). `/factory status` shows the live state (R-46).
- The metrics comment on each PR has cost, turns, rounds, and stages (R-32).
- `@vprprudhvi/shared-logger` does not apply. The repo-checks scripts use Node built-ins only and print to stdout and stderr, as `stop-gate.mjs` does.

Cost:

- Infra: $0 a month. No cloud resource.
- Model usage: the owner pays a Claude subscription. The metrics show the API-equivalent cost of each ticket. Opus runs only for the spec pass and for the security and infra passes on `risk:high`. A doc-only change runs only the spec pass.
- GitHub Actions: the repo is public, so standard runner minutes are free.

Security (`docs/standards/security.md`):

- Trust: only tickets that the owner wrote and labeled (R-7). Only owner comments with no agent marker (R-8, R-9).
- Redaction: each agent comment goes through `factory.mjs`, which applies the patterns of 4.1 and caps the size (R-12).
- Transcripts: the cost read opens only this repo's run session files, reads only numbers and the model name, and prints no text (R-33).
- The test guard runs locally with no labels before each push (R-17). `risk:*` comes from code (R-21).
- A decision on a high-tier path, a missing access or secret, or a deploy step is a hard stop (R-11).
- Push only through `factory.mjs push`, with no `+` and no force flag (R-54). The extra `allow` rules live only in the factory worktree's local settings.
- The deny rules, the `ask` rules, and the gates do not change.

Migration:

- One-time setup by the owner:
  1. Run `git fetch origin`, then `git worktree add --detach ../projects-monorepo-factory origin/main`. A detached worktree does not hold `main`, so the main checkout can stay on `main`.
  2. Run `node common/scripts/install-run-rush.js install` in that folder.
  3. Write `.claude/settings.local.json` in that folder with the `allow` list of 4.7. The `/factory` skill has the file text.
  4. Repo setting `delete_branch_on_merge` is on (done on 2026-11-16).
- The factory worktree never runs `git checkout main`. Each branch starts with `git fetch` and `git switch -c <branch> origin/<base>`.
- `/factory status` in the main checkout finds the factory worktree with `git worktree list` and prints its state.
- `/work-ticket` is deleted in task 4a. Each live doc that names it changes to `/factory`: `.claude/**`, each `CLAUDE.md`, `docs/guides/**`, and `docs/standards/**`. `docs/designs/**` is history and keeps the old name. A grep test checks this scope.
- `pre-pr` state moves from `.claude/state/pre-pr/` to `.claude/factory/<n>/pre-pr/` (R-27). The old folder stays and is not read.
- Metrics: version 1 fields keep their names (R-32). Old comments stay as they are.
- An open ticket with `agent:in-progress` from an older run: `start` reconciles it from GitHub (R-23).

## 7. Deploy and rollback

Deploy target: none (`factory.deploy` does not apply). The change is repo tooling, skills, docs, and settings. It is live when the owner merges each PR.

Rollback (`docs/runbooks/rollback.md`):

1. Fast stop: run `/factory stop` in the running session, or start `claude` with `FACTORY_RUN=off`. `/factory` refuses to start, and the `Stop` hook allows each stop.
2. Revert the PR of the task that broke. Each task is one PR.
3. Delete `.claude/factory/` and `.claude/settings.local.json` in the factory worktree.
4. Remove `agent:in-progress` by hand from each open ticket that has it.
5. After a revert of task 4b, `pre-pr` uses `.claude/state/pre-pr/` again.
6. To stop stacking for good, turn off `delete_branch_on_merge`: `gh api -X PATCH repos/vpr1995/prudhvi-software-factory -F delete_branch_on_merge=false`.
7. For task 8, also restore the wiki text of Ticket Workflow and Status from the wiki history.

## 8. Implementation plan

Package for each `rush` command: `@vprprudhvi/tooling-repo-checks`. "Test" in the Verify column means `rush test --to @vprprudhvi/tooling-repo-checks`, and the named cases are in that run. Each task is one PR, in this order. Each one is checked before the next. Each task changes `tooling/repo-checks/**` or `.claude/**`, so each task uses the current flow (`implement-feature`), not `/factory` (R-43).

A later task can fill a step that an earlier task calls. The earlier task ships the step as a named no-op that logs "skipped: task <id>", and the later task replaces it and tests it. This applies to R-12 steps 5 (task 5) and 6 and 7 (task 2c).

| Task                                 | Files                                                                                                                                                                                                                                                                                      | R-IDs                                                            | Risk | Verify                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Router                            | `scripts/factory.mjs` (`route`, print only), `scripts/lib/factory-routing.mjs`, `scripts/lib/factory-route.mjs`, `test/factory-route.test.js`, `docs/standards/risk-tiers.md` (link)                                                                                                       | R-18, R-19, R-20, R-21, R-22, R-34                               | high | Test cases: doc-only diff gives only the spec pass; `.github/x.md` and `.claude/x.md` are not doc-only; `packages/x/.npmignore` is high; a reviewer with no matching glob runs; the JSON has `rule` and `skipped`; a check-config finding gives `risk:high`; a missing size gives 800 and a warning                                                                                                                                |
| 2a. State core                       | `scripts/factory.mjs` (`stage`, `note`, `read`, `round`, `findings`, `push`, `route` stores), `scripts/lib/factory-state.mjs`, `scripts/lib/factory-github.mjs` (the `gh` wrapper), `scripts/lib/factory.config.mjs`, `scripts/lib/fs-io.mjs`, `test/factory-state.test.js`, `.gitignore`  | R-14, R-17, R-20, R-23, R-24, R-25, R-26, R-27, R-28, R-53, R-54 | high | Test cases: an illegal stage move exits non-zero; `stage building` moves the labels of 4.4; a GitHub mismatch prints both values and uses GitHub; a held lock exits non-zero; a `gh` stub that fails twice gives the error; `push` never sends `+` or a force flag; a non-config test guard finding makes `push` exit non-zero with no `git push`; `findings add` reopens a matching `fixed` row; each move appends a run log line |
| 2b. Hard stop and caps               | `scripts/factory.mjs` (`hardstop`, `caps`, `comment`), `scripts/lib/factory-caps.mjs`, `scripts/lib/factory-hard-stop.mjs`, `test/factory-caps.test.js`                                                                                                                                    | R-8, R-12, R-15, R-16, R-51, R-55                                | high | Test cases: the hard-stop steps run in order and a second run changes nothing; each comment starts with the marker; `restartedAt` sets the counts to 0; each redaction pattern; a count that cannot be read stops; a merge conflict gives a hard stop with the paths                                                                                                                                                               |
| 2c. Queue and run                    | `scripts/factory.mjs` (`start`, `--dry-run`, `next`, `status`, `stop`, `report`), `scripts/lib/factory-queue.mjs`, `test/factory-queue.test.js`                                                                                                                                            | R-1, R-2, R-3, R-4, R-5, R-6, R-7, R-29, R-43, R-46, R-47, R-50  | high | Test cases: `start --dry-run` on a stub board prints the queue in board order, calls no write, and writes no `run.json`; `start 7` queues only #7; `FACTORY_RUN=off` exits non-zero; an empty queue gives `done` and a report; `stop` changes no label; a non-owner label actor is skipped; a ticket with `agent:in-progress` and a `ticket.json` resumes; an active run is adopted; `status` prints the counts                    |
| 3. Stop hook                         | `scripts/factory.mjs` (`stop-check`, `wait`), `test/factory-stop-check.test.js`, `.claude/settings.json` (`Stop` command, `factory.mjs` `allow` rule)                                                                                                                                      | R-44, R-45, R-48, R-49, R-56                                     | high | Test cases: the owning session is blocked with the stored step; another session is allowed; `next` = `done` is allowed; 3 blocks with no change mark the run `stalled` and allow, with no label call; a CI wait is allowed; `wait` on a stub CI that never ends exits "timeout" after 60 minutes; a `stalled` run allows each stop; a load error is allowed after 3 tries                                                          |
| 4a. `/factory` skill                 | new `.claude/skills/factory/SKILL.md` (loop, decide-and-record, hard stop calls, worktree rules, `settings.local.json` text), delete `.claude/skills/work-ticket/`, root `CLAUDE.md` (routing table), `.claude/skills/plan-tickets/SKILL.md` (line 37), `test/factory-skill-paths.test.js` | R-2, R-10, R-11, R-13, R-17, R-25                                | high | Test: no skill names `.claude/factory` or calls `gh pr comment` or `gh issue comment`; no `work-ticket` reference in the scope of section 6. Manual: the owner runs `/factory` on test ticket A (doc-only: expects an open PR with `Closes #<A>` and the `risk:low` label) and test ticket B (asks for a high-tier decision: expects `gh issue view <B> --json labels` to show `needs-human` and one comment with the marker)      |
| 4b. `pre-pr` and `implement-feature` | `.claude/skills/pre-pr/SKILL.md` (router, models, local test guard, `round` and `findings` commands), `.claude/skills/implement-feature/SKILL.md` (state for each ticket), `test/factory-skill-paths.test.js`                                                                              | R-17, R-18, R-27                                                 | high | Test: `pre-pr/SKILL.md` calls `factory.mjs route` and `round`, and passes `model` to each spawn                                                                                                                                                                                                                                                                                                                                    |
| 4c. PR body                          | `.claude/skills/pr-description/SKILL.md` (sections, routing line, `risk:*`), `.github/pull_request_template.md`, `test/factory-skill-paths.test.js`                                                                                                                                        | R-20, R-21, R-34, R-35                                           | high | Test: the template and the skill have "Decisions I made", "Over budget", and the routing line                                                                                                                                                                                                                                                                                                                                      |
| 5. Metrics                           | `scripts/factory.mjs` (`metrics`, R-12 step 5), `scripts/lib/factory-cost.mjs`, `scripts/lib/factory-prices.mjs`, `scripts/lib/fs-io.mjs` (list a folder), `test/factory-cost.test.js` (fixture with a fake secret)                                                                        | R-32, R-33                                                       | high | Test cases: the fixture output has no transcript text; an unknown model gives `null`; only messages in the ticket slice count; a second `metrics` call edits the comment in place with the version 2 fields                                                                                                                                                                                                                        |
| 6. Review loop                       | `scripts/factory.mjs` (`next` handles comments first), `scripts/lib/factory-github.mjs` (owner comments), `test/factory-comments.test.js`, `.claude/skills/factory/SKILL.md`                                                                                                               | R-9, R-30, R-31                                                  | high | Test cases: a comment with the agent marker (also the metrics comment) or a non-owner author is not returned; a new owner comment comes before a new ticket; a reply stores the comment ID; a new comment in a thread with 3 agent replies gives a hard stop                                                                                                                                                                       |
| 7a. Stack logic                      | `scripts/factory.mjs` (`next` stack plan, `restack`), `scripts/lib/factory-stack.mjs`, `test/factory-stack.test.js`                                                                                                                                                                        | R-36, R-37, R-38, R-39, R-40, R-41, R-42                         | high | Test cases: the plan starts the branch from the blocker branch; the base is `origin/<base>...HEAD`; a depth-3 plan is refused; a red blocker CI skips; a pending blocker CI waits; a closed blocker gives a hard stop; `restack` merges with no rebase and marks the PR ready after the parent merged; a merge into a non-`main` branch is in the report                                                                           |
| 7b. Stack skill steps                | `.claude/skills/factory/SKILL.md` (branch from the blocker, `gh pr create --draft --base`, `restack`, `verify`), `.claude/skills/pr-description/SKILL.md` (stack line), `docs/standards/git-workflow.md`, `docs/standards/risk-tiers.md`, `test/factory-skill-paths.test.js`               | R-35, R-36                                                       | high | Test: the skill has the stack line and the `--draft --base` step; `node tooling/repo-checks/scripts/doc-lint.mjs` passes                                                                                                                                                                                                                                                                                                           |
| 8. Clean-up                          | `.claude/skills/pre-pr/SKILL.md` (drop the built-in `code-review` pass), `test/factory-skill-paths.test.js` (R-52 grep check), `docs/designs/software-factory/design.md` (6.5), `docs/guides/commands.md`, root `CLAUDE.md` (routing table)                                                | R-52                                                             | high | Test: the R-52 grep check; doc lint passes; manual: the owner edits wiki Ticket Workflow and Status and ticks the item in the PR                                                                                                                                                                                                                                                                                                   |

Task 8 starts after one clean real run: the first `/factory` run after task 7b merges, on a real ticket, with a run report of 1 ticket done and 0 hard stops. The owner confirms it in the task 8 PR.

## 9. Decision log

- 2026-11-16: no auto-merge; writers run one at a time; current gates and deny rules stay (owner, brief).
- 2026-11-16: a gate failure or 3 failed review rounds is a hard stop of the whole run; push the branch, comment, `needs-human`, no draft PR (owner, brief).
- 2026-11-16: an open decision is decide-and-record; a decision on a high-tier path is a hard stop (owner, brief).
- 2026-11-16: counts kept by the script are the runaway guard; cost is a metric only (owner, brief).
- 2026-11-16: state in `.claude/factory/`, only through the script; GitHub wins on a mismatch (owner, brief).
- 2026-11-16: stacked PRs, depth 2, merge commits, no rebase or force push; repo setting `delete_branch_on_merge` on (owner, brief).
- 2026-11-16: billing is a Claude subscription, so cost is an API-equivalent figure; the repo is public, so no Actions minute cap (owner, brief).
- 2026-11-16: `/factory` is the only entry point; `/work-ticket` is deleted. This replaces the alias of the brief (owner, design).
- 2026-11-16: no ticket count limit for each run; the run waits for the CI of a blocker PR and ends when no ticket can start. This replaces the 5-ticket cap of the brief (owner, design).
- 2026-11-16: the run loop copies `/goal`: a second command on the existing `Stop` event, with a script check; `/factory status`, `/factory stop`, and a "no progress" stop (owner, design).
- 2026-11-16: keep it simple: one script, 6 stages, routing table as a plain module (owner, design).
- 2026-11-16: scope check: keep the review loop, metrics, and stacked PRs (owner, design).
- 2026-11-16: `/factory` runs in its own git worktree, `../projects-monorepo-factory`, so that it never changes the branch of the owner's main checkout (owner, design).
- 2026-11-16: the local test guard lets the finding "check config changed" through to the PR body; each other finding is a hard stop (owner, design).
- 2026-11-16: no flag from `packages/flags`; the off switch is `FACTORY_RUN=off` (owner, design).
- 2026-11-16: advisor review fixes: the `Stop` hook blocks only the session that owns the run; a CI wait runs in a background watch and allows the stop; a new `/factory` adopts a dead run; cap counts come from GitHub and the run log, not from the model (architect, design).
- 2026-11-16: the spawn cap is dropped, caps reset when the owner restarts a `needs-human` ticket, and the fix round cap counts for each owner comment thread. These change the brief caps (owner confirmed, design review).
- 2026-11-16: round 1 fix: a hard stop pushes the branch, saves uncommitted changes as a patch, and ends with `stop-gate defer`; no gate change (R-12, J4) (owner, design review).
- 2026-11-16: round 1 fix: cap counts start from `restartedAt`; counts are not stored (R-15, R-51) (owner, design review).
- 2026-11-16: round 1 fix: a pass table names each agent, skill, and model; a doc-only diff runs only the spec pass; `docOnlyExclude` added (R-18, 4.2) (owner, design review).
- 2026-11-16: round 1 fix: the router sets `risk:high` on the "check config changed" finding; a stacked ticket uses the merge base with the stack base (R-17, R-21, R-37) (owner, design review).
- 2026-11-16: round 1 fix: failure rules: lock file, one `gh` retry, push retry, merge conflict hard stop, ordered and idempotent hard-stop steps, `start` adopts the active run (R-12, R-50, R-53, R-54, R-55) (owner, design review).
- 2026-11-16: round 1 fix: GitHub data sources named; no `project` scope means `start` refuses (R-43, 4.5) (owner, design review).
- 2026-11-16: round 1 fix: `round` and `findings` commands; an ad hoc folder for `pre-pr` with no ticket (R-27, 4.1) (owner, design review).
- 2026-11-16: round 1 fix: routing data in plain `lib/factory-routing.mjs`, environment reads in `lib/factory.config.mjs`, globs with `path.matchesGlob`. This replaces the `.config.mjs` decision above (owner, design review).
- 2026-11-16: round 1 fix: cost details, `green` to `needs-human` is legal, metrics example on one line, rollback steps, active time rule, worktree setup, `allow` rules, more R-11 hard-stop cases, one fix round for the local test guard, Phase 2 defined, R-52 added (owner, design review).
- 2026-11-16: round 2 fix (Blocker): `stop-check` reads only the stored `next` result; the agent runs `next` before each stop; a hook timeout allows the stop (R-44, R-48, J1) (owner delegated, design review).
- 2026-11-16: round 2 fix: 3 `stop-check` errors in a row allow the stop (R-56) (owner delegated, design review).
- 2026-11-16: round 2 fix: the review round limit is the `pre-pr` limit for each `pre-pr` run (R-13); it is no longer a ticket cap in R-15 (owner delegated, design review).
- 2026-11-16: round 2 fix: the comment fix round limit counts agent replies for each review thread (R-31, 4.3, 4.5) (owner delegated, design review).
- 2026-11-16: round 2 fix: each task uses the current flow, because each task changes `tooling/repo-checks/**` or `.claude/**`; `/factory` skips tickets with such paths; the `ask` rules stay (R-43, 4.7, section 8) (owner delegated, design review).
- 2026-11-16: round 2 fix: a hard stop pushes `HEAD`, because each commit passed the commit gate; the patch has untracked files; the metrics update is a hard-stop step (R-12) (owner delegated, design review).
- 2026-11-16: round 2 fix: tasks split and reordered; R-9 moved to task 6; R-18 removed from task 8; each Verify names failing test cases (section 8) (owner delegated, design review).
- 2026-11-16: round 2 fix: the `/work-ticket` grep scope is the live docs; `docs/designs/**` keeps history (section 6) (owner delegated, design review).
- 2026-11-16: round 2 fix: the local test guard uses `guardRepository` of `test-guard.mjs` after the commit; the worktree is detached at `origin/main`; the R-22 sample-path rule; `pre-pr` gives the router model to each agent spawn; ticket size and paths come from `/plan-tickets` text; terms list, `FACTORY_RUN` source, redaction patterns, and the cost slice (owner delegated, design review).
- 2026-11-16: round 3 fix: `factory.mjs hardstop` is the one entry point of R-12; steps that a later task builds ship as named no-ops until that task (R-12, section 8) (owner delegated, design review).
- 2026-11-16: round 3 fix: a "no progress" stall marks the run `stalled`, allows the stop, and changes no label, so a usage limit does not set `needs-human` (R-48, J5) (owner delegated, design review).
- 2026-11-16: round 3 fix: the claim removes `agent:ready`; 4.4 lists the labels of each stage; a ticket with `agent:in-progress` and a local `ticket.json` resumes; `stop` keeps ticket state (R-43, R-47, 4.4) (owner delegated, design review).
- 2026-11-16: round 3 fix: each push goes through `factory.mjs push` with no `+` and no force flag; the extra `allow` rules live only in the factory worktree's `settings.local.json`; the deny rules do not change (R-54, 4.7, section 6) (owner delegated, design review).
- 2026-11-16: round 3 fix: the CI watch is `gh pr checks --watch` in the background, with a 60-minute limit (R-49) (owner delegated, design review).
- 2026-11-16: round 3 fix: the metrics comment carries the agent marker; the version 1 fields and the `ci_rounds` and `ci_runs` meanings are listed (R-8, R-32, 4.6) (owner delegated, design review).
- 2026-11-16: round 3 fix: `stop-check` always exits 0 and counts a load error, as `stop-gate.mjs` does (R-56, 4.7) (owner delegated, design review).
- 2026-11-16: round 3 fix: computed-path file calls go through `lib/fs-io.mjs`; the glob wrapper matches dot names; the router reuses `isTestFile` (4.1, 4.2, R-22) (owner delegated, design review).
- 2026-11-16: round 3 fix: `/work-ticket` is deleted in task 4a, so the skill path test passes; task 4 is split into the skill, `pre-pr` and `implement-feature`, and the PR body; `restack` runs the stack merges; each R-ID has a named test case or a manual check with an expected result (section 8) (owner delegated, design review).
- 2026-11-16: round 3 fix: `/factory <n>` handles only the comments of its own PR; `--dry-run` writes no run; `findings` keeps the `findings.md` rows and the reopen rule (R-2, R-3, 4.1) (owner delegated, design review).
- 2026-11-16: advisor final check: `wait` polls and ends after 60 minutes, so the CI timeout has an actor; `push` runs the local test guard (R-17 in task 2a); a `stalled` run stays adoptable; a comment with a `factory-metrics` block is never owner input; the no-op rule covers R-12 step 7 (R-17, R-48, R-49, R-50, 4.5, section 8) (owner delegated, design review).
