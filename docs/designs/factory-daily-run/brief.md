---
status: approved
---

# Brief: Factory daily run

Size: M (new skill, new tooling scripts, changes to 4 skills, the PR template, and 2 workflow rules).

## Problem

The owner wants the agent to finish ticket work with no human in the loop. Today these points stop that:

- The owner starts each ticket by hand with `/work-ticket <n>`. One run works one ticket.
- A ticket that a blocker blocks waits until the owner merges the blocker PR.
- A decision that the ticket does not make stops the run (wiki Ticket Workflow rule 9).
- `pre-pr` runs every review pass on every PR, also on a doc-only change. The built-in `code-review` pass repeats the `bug-hunt` pass.
- Owner review comments on a PR need a new manual run.
- A run that stops in the middle has no stage record. The next run cannot resume it.
- `factory-metrics` has `cost: null` and `turns: null`.
- Nothing measures the size of a diff against the ticket size.

## Users

- The owner. The owner writes tickets, adds `agent:ready`, reviews PRs, writes review comments, and merges. The owner runs the factory every day on a Claude subscription.
- The agent (main session as orchestrator, writer and reviewer subagents).

## Non-goals

- Auto-merge. The owner merges each PR (software-factory design, section 3).
- Parallel writers. Writers run one at a time (root `CLAUDE.md`, "Agent roles").
- A run in GitHub Actions. That is Phase 2 (software-factory design, section 6.5).
- An intake agent that accepts or rejects tickets.
- A dashboard. The project board, the metrics comments, and the run report are the view.
- A change to any current gate: verify gate, commit gate, test guard, doc lint, CI, coverage. The deny rules for `.claude/state/` stay as they are.

## Constraints

### Entry point

- `/factory` is the only entry point. `/factory <n>` runs one ticket. `/work-ticket <n>` stays as an alias of `/factory <n>`.
- `/factory --dry-run` prints the plan (queue, order, stacks, routed passes) and changes nothing: no label, push, or comment.
- The owner turns the factory off with `FACTORY_RUN=off` in the shell or the user settings. The repo settings do not hold it.

### Trust

- The agent and the owner use one GitHub account (no bot account). Each comment that the agent writes starts with the marker `<!-- factory-agent -->`.
- A script, not the model, decides which input counts:
  - A ticket runs only when the owner wrote the issue and the owner added `agent:ready` (label event actor). Else the run skips the ticket and logs it.
  - A review comment counts only when the owner wrote it and it has no agent marker. The script stores each handled comment ID. A comment never runs twice.
  - The agent ignores issue and PR comments by all other accounts.

### Run

- Order in each run: first the owner's new review comments on open factory PRs, then the `agent:ready` queue in board order.
- One ticket at a time. Reviewers can run in parallel. They are read-only.
- The run keeps going while the gates pass and the review rounds pass.
- When only merge waits remain, the run ends with the run report. It does not poll.
- Run cap: 5 tickets. Then the run ends with the run report.

### Decisions

- A decision that the ticket does not make does not stop the run. The agent takes the safest option and records it in the PR section "Decisions I made". The safest option is reversible, has the smallest scope, and sits behind a flag when it is user-visible. The owner can overrule it in review.
- Exception: an open decision on a high-tier path (`docs/standards/risk-tiers.md` section 2: auth, IAM, `platform/**`, `packages/**`, `tooling/**`, `.github/**`) is a hard stop.
- Acceptance stays human-only (Ticket Workflow rule 3). If Acceptance contradicts itself, it is a hard stop.

### Hard stop

The whole run stops. No next ticket. A hard stop happens when:

- A gate still fails after the fix rounds: `verify`, CI (3 failed runs), or the test guard.
- 3 review rounds end with an open Important finding (root `CLAUDE.md` rule 12).
- A ticket cap is reached (see "Caps").
- An open decision is on a high-tier path, or Acceptance contradicts itself.
- Access or a secret is missing, or the work needs a deploy or a manual cloud console step.
- A blocker PR of a stacked ticket closes without a merge.

At a hard stop:

1. Commit and push the branch. No draft PR.
2. A script posts one ticket comment: the gate or rule that failed, a short redacted excerpt of the errors (size cap, secret-like strings and home paths removed), and the branch name. Full logs stay in the local state.
3. Set `needs-human` and remove `agent:in-progress`.
4. Update the metrics comment with outcome `needs-human`.
5. Write the run report and end the run.

Usage limit (subscription window or rate limit): save the stage and end the run with "resume later" in the run report. No `needs-human`. A limit is not a fault of the ticket.

### Caps

- The guard uses counts that the state script keeps. The counts do not depend on the transcript parse. A missing count fails closed.
- For each ticket: 3 review rounds, 3 failed CI runs, 30 subagent spawns, and 3 hours of wall-clock time. The counts add up across resumes.
- For each PR in the review loop: 3 fix rounds for owner comments.

### Test guard

- The CI test guard gives warnings, not errors, on a PR with `risk:high`.
- Before each push, `/factory` runs the test guard locally with no labels. Any finding is a hard stop, whatever label the PR has.
- The routing script sets the `risk:*` label. The agent does not choose it.

### Review routing

- A script picks the review passes and their models (root `CLAUDE.md` rule 5).
- One JSON file under `tooling/repo-checks/` holds the path globs for the risk tier and for each reviewer. `docs/standards/risk-tiers.md` links to it. A unit test fails when the file and the doc tables differ.
- Always: `verify`, the local test guard, the spec pass (`spec-reviewer`, Opus), `bug-hunt` (`fresh-reviewer`), `simplify`.
- Each code change (not doc-only): `security-reviewer`. It replaces the built-in `security-review` pass.
- By path: `infra-reviewer` for `projects/*/bin/**`, `projects/*/lib/**`, `platform/**`, and `packages/cdk-constructs/**`.
- Fail open: when no glob decides, the reviewer runs.
- Doc-only diff: no code review passes.
- Opus for `security-reviewer` and `infra-reviewer` on `risk:high`. Else Sonnet.
- The built-in `code-review` pass goes away. `bug-hunt` covers it. This change comes after one clean real run.
- The router prints JSON: each pass, its model, the rule that matched, and each skipped pass. The state keeps it. The PR body gets one line from it.

### State

- GitHub (labels, branches, PRs) is the source of truth. The local state is a cache.
- The state script derives the stage from GitHub first. The local files keep only what GitHub does not hold: handled comment IDs, counts, step summaries, the base branch, the routing JSON, and logs.
- State folder: `.claude/factory/<n>/` (gitignored). It is not under `.claude/state/`, so the gate proof stays protected.
- Only the state script reads and writes the folder. Skills and agents call its CLI with a ticket number. No skill text names the folder in a Bash command.
- Each step summary starts with `## Summary` and 3 to 5 bullets. The orchestrator reads only the summaries.
- The `pre-pr` state moves to a folder for each ticket. A second ticket does not see the findings of the first ticket.
- On resume the script reconciles the local state with GitHub. On a mismatch it prints both values and trusts GitHub.
- An append-only run log records each stage move, label move, skip, gate result, and decision.
- The run report lists: tickets done, PRs that wait for a merge, the ticket that stopped and why, the tickets skipped, and the resume command. The chat summary shows it too.

### Stacked PRs

- A ticket can start when each of its blockers has an open PR with green CI and no `needs-human`.
- The branch starts from the blocker branch. The PR targets the blocker branch. Maximum depth: 2.
- The state stores the base branch. Each review pass, the router, the diff count, and the risk tier use `origin/<base>...HEAD`.
- When a lower branch changes, the agent merges it into the upper branch. No rebase. No force push (`.claude/settings.json` denies it).
- Stacked PRs merge with merge commits. The repo setting `delete_branch_on_merge` is on (set 2026-11-16). GitHub then moves a child PR to the base of the merged PR.
- A child PR stays draft until the agent merges `main` into it after its parent merges. That push starts CI. The agent then marks the PR ready.
- The PR body says `Stacked on #<m>. Merge #<m> first.`
- A child PR that merged into a branch other than `main` does not close its issue. The run detects it, reports it, and gives the recovery step: a PR from the parent branch to `main`.

### Review loop

- A fix round for an owner comment runs the same gates and the routed review passes.
- The agent replies to each comment with the commit that fixes it. The reply carries the agent marker. The owner resolves the threads.

### Metrics and diff size

- One `factory-metrics` comment for each ticket. The agent edits it in place. Schema version 2 adds `stages`, `reviewers`, `over_budget`, `decisions`, `stacked_on`, `resumes`, `ci_runs`, and the Claude Code version.
- `cost` is the API-equivalent cost in US dollars. The owner pays a subscription, so this number shows where the usage goes, not a bill. `turns` is the turn count.
- The cost script opens only the transcripts of the current session in this repo's project folder under `~/.claude/projects/`. It reads only numeric usage fields. It never writes transcript text to output, a warning, or GitHub. A parse failure writes `null` and a warning.
- Diff size: changed lines, without test files, the lockfile, and generated files. Limits: size 1: 150, size 2: 300, size 3: 500, size 5: 800. Over the limit: the PR gets an "Over budget" line. The run goes on.

### PR body

- The PR template and the `pr-description` skill get the sections "Decisions I made" and "Over budget", and the stack line.

### Code and rollout

- TypeScript and JavaScript only. Scripts are `.mjs` with unit tests in `tooling/`. `tooling/**` and `.github/**` are high risk. The owner reviews them.
- Unit tests: routing table (one case for each tier path, one doc-only case), illegal stage move, resume at each stage, state and GitHub mismatch, comment marker filter, caps, redaction, cost parser fixture with a fake secret.
- PR order (one PR each, each one checked before the next):
  1. Routing table and router, `risk:*` label from code, local test guard, `pre-pr` uses the router.
  2. State script, run log, run report, `/factory` skill with dry run and off switch, `/work-ticket` alias, caps, trust checks, hard stop comment.
  3. Metrics v2 and the cost script.
  4. Review loop.
  5. Stacked PRs, plus `git-workflow.md` and `risk-tiers.md`: stacked PRs merge with merge commits.
  6. After one clean real run: remove the built-in `code-review` pass, and edit the wiki Ticket Workflow (rules 8 and 9, stacked PRs).
- Rollback: revert the PR. For PR 6, also restore the wiki text.

### Rule changes

| Rule                                                           | Old                                                      | New                                                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Ticket Workflow rule 8                                         | Work one ticket at a time.                               | One ticket at a time, and one run works the queue.                                                                             |
| Ticket Workflow rule 9                                         | A decision that the ticket does not make: `needs-human`. | Decide, record in the PR, go on. A decision on a high-tier path stays a hard stop.                                             |
| Ticket Workflow rule 9                                         | At a stop, open a draft PR.                              | At a hard stop, push the branch and name it in the comment. No draft PR.                                                       |
| `work-ticket` "Do not"                                         | Start a 2nd ticket in the same run.                      | `/factory` works the queue. `/work-ticket <n>` is an alias of `/factory <n>`.                                                  |
| `implement-feature` step 3, `pre-pr` step 15, `pr-description` | Stop and ask the human.                                  | Inside `/factory`: a gate or round failure is a hard stop. A design question is decide-and-record (high-tier path: hard stop). |
| `git-workflow.md`, `risk-tiers.md`                             | Merge, squash, and rebase are allowed.                   | Stacked PRs merge with merge commits.                                                                                          |

### Files that change

- Skills: new `.claude/skills/factory/SKILL.md`. Changes in `work-ticket`, `pre-pr`, `implement-feature`, `pr-description`.
- `tooling/repo-checks/` (new routing table, router, state, and cost scripts with tests).
- `.github/pull_request_template.md`, `.gitignore`.
- `docs/designs/software-factory/design.md` (section 6.5), `docs/guides/commands.md`, `docs/standards/risk-tiers.md`, `docs/standards/git-workflow.md`, root `CLAUDE.md`.
- Wiki pages Ticket Workflow and Status.

## Chosen direction

One `/factory` command first fixes the owner's PR review comments, then works the `agent:ready` queue one ticket at a time, resumes from state that GitHub confirms, and stacks a ticket (depth 2, merge commits, no force push) when its blockers are open green PRs. It finishes each ticket with no human in the loop: scripts decide which input to trust, which review passes run, and when a cap is reached, and the agent records its own decisions in the PR. If a gate fails, 3 review rounds fail, or a cap is reached, it pushes the branch, writes a redacted error summary and the branch on the ticket, sets `needs-human`, and stops the whole run.

## Alternatives seen

- Keep `/work-ticket` per ticket and only add review routing. Rejected: the owner still starts each ticket.
- Parallel writers in git worktrees. Rejected: Rush runs one command at a time, and the verify gate tracks one writer.
- The model rates risk and picks reviewers. Rejected: rule 5 puts routing in code.
- Stop at each open decision. Rejected: the owner wants runs with no human in the loop.
- Continue to the next ticket after 3 failed review rounds. Rejected by the owner: a failure stops the run.
- Rebase stacked branches. Rejected: rebase needs a force push, which the settings deny.
- A dollar cap as the runaway guard. Rejected: it depends on an undocumented transcript format and fails open. Counts kept by the script are the guard.
- State under `.claude/state/`. Rejected: the deny rules protect the gate proof there.

## Lens findings

| #   | Lenses                                                             | Finding                                                                                      | Severity | Decision | Reason or change                                                                                                                                   |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Security (1), UX (1)                                               | Agent and owner share one account. "Owner comments only" also picks the agent's own replies. | Blocker  | accept   | Agent marker on each agent comment. A script accepts owner comments with no marker and stores handled IDs. Section "Trust".                        |
| 2   | Security (1)                                                       | Any `agent:ready` ticket runs, whoever wrote it or added the label.                          | Change   | accept   | A script checks the issue author and the label actor. Section "Trust".                                                                             |
| 3   | Testing (1), Security (1)                                          | `risk:high` turns test guard findings into warnings, and the agent sets the label.           | Blocker  | accept   | Local test guard with no labels before each push. The router sets `risk:*`. Section "Test guard".                                                  |
| 4   | Security (1)                                                       | The hard stop comment posts raw errors.                                                      | Change   | accept   | Script posts the gate name, a redacted excerpt with a size cap, and the branch. Section "Hard stop".                                               |
| 5   | Security (1)                                                       | Decide-and-record also covers auth, IAM, and high-tier paths.                                | Question | accept   | A decision on a high-tier path is a hard stop. Section "Decisions".                                                                                |
| 6   | Security (1), Tech debt (1), Migration (1), Testing (1)            | `.claude/state/` is denied to agents because it holds the gate proof.                        | Blocker  | accept   | New folder `.claude/factory/`, access only through the state script CLI. Deny rules unchanged. Section "State".                                    |
| 7   | Observability (1), Migration (1), Tech debt (1), Testing (1)       | Local state and GitHub labels can disagree.                                                  | Change   | accept   | GitHub wins. The script reconciles on resume. Section "State".                                                                                     |
| 8   | Migration (1)                                                      | `pre-pr` state is not kept for each ticket.                                                  | Change   | accept   | `pre-pr` state moves to a folder for each ticket. Section "State".                                                                                 |
| 9   | YAGNI (1)                                                          | The state machine repeats what labels and branches hold.                                     | Change   | accept   | Partly. Stage comes from GitHub first. Files keep only what GitHub does not hold. Section "State".                                                 |
| 10  | Observability (1), Cost (1), YAGNI (1), Tech debt (1), Testing (1) | The $40 cap fails open when the transcript parse fails.                                      | Blocker  | accept   | Counts kept by the script are the guard and fail closed. Cost is a metric only. Sections "Caps" and "Metrics".                                     |
| 11  | Cost (1)                                                           | No run cap. Caps do not span resumes. No cap on review-loop rounds.                          | Change   | accept   | 5 tickets for each run. Counts add up across resumes. 3 fix rounds for each PR. Section "Caps".                                                    |
| 12  | Cost (1)                                                           | No rule for a usage limit or rate limit.                                                     | Question | accept   | Save the stage, end with "resume later", no `needs-human`. Owner answer: Claude subscription. Section "Hard stop".                                 |
| 13  | Cost (1)                                                           | Reviewer models are not defined.                                                             | Change   | accept   | The router outputs the model for each pass. Spec pass stays Opus. Section "Review routing".                                                        |
| 14  | Cost (1)                                                           | Each push uses Actions minutes.                                                              | Question | reject   | Owner answer: the repo is public, so standard runner minutes are free. `ci_runs` goes in the metrics only.                                         |
| 15  | YAGNI (1), Tech debt (1), Testing (1), UX (1)                      | Security triggers are not paths. The plan dropped the built-in security pass.                | Change   | accept   | One JSON glob table. `security-reviewer` runs on each code change and replaces the built-in pass. Fail open. Section "Review routing".             |
| 16  | Observability (1)                                                  | Routing and diff-size verdicts leave no trace.                                               | Change   | accept   | Router JSON in the state and one line in the PR body. Section "Review routing".                                                                    |
| 17  | YAGNI (1)                                                          | The diff budget repeats the spec scope check. The shrink round costs extra.                  | Change   | accept   | Partly. Keep the count and the PR line. No shrink round. Section "Metrics and diff size".                                                          |
| 18  | YAGNI (1), Tech debt (1)                                           | Stacked PRs are the largest part and only save a merge wait.                                 | Change   | reject   | The owner wants them. They ship last, in their own PR, with doc updates. Section "Code and rollout".                                               |
| 19  | Migration (1)                                                      | A stacked branch reviewed against `main` counts the blocker changes.                         | Change   | accept   | The state stores the base. Each pass uses `origin/<base>...HEAD`. Section "Stacked PRs".                                                           |
| 20  | Migration (1), UX (1), Testing (1)                                 | A retarget starts no CI. A wrong merge order does not close the issue.                       | Change   | accept   | The child stays draft until the agent merges `main` in. The run detects a non-main merge and reports the recovery. Section "Stacked PRs".          |
| 21  | Migration (1), UX (1)                                              | `/work-ticket` future unclear. Sub-skills still ask the human.                               | Change   | accept   | `/factory` is the entry point. `/work-ticket <n>` is an alias. Rule table added. Section "Rule changes".                                           |
| 22  | Migration (1), Testing (1)                                         | No rollout plan, dry run, or off switch.                                                     | Change   | accept   | 6 ordered PRs, dry run, `FACTORY_RUN=off`, rollback by revert. Section "Code and rollout".                                                         |
| 23  | Observability (1), UX (1)                                          | No run log. The run result is chat only.                                                     | Change   | accept   | Append-only run log and a run report. Section "State".                                                                                             |
| 24  | Observability (1), UX (1)                                          | Metrics are lost on a kill. No PR section for decisions. "Safest option" is not defined.     | Change   | accept   | One metrics comment edited in place, schema v2. PR template sections. Definition of the safest option. Sections "Metrics", "PR body", "Decisions". |
| 25  | Security (1)                                                       | The cost script reads transcripts that hold all prompts and file contents of the machine.    | Change   | accept   | Current session in this repo only, numeric fields only, never text in output. Fixture test with a fake secret. Section "Metrics and diff size".    |

41 raw findings, 25 rows: 23 accept, 2 reject, 0 open, 0 defer.

## Open items

None.
