---
name: work-ticket
description: Work one GitHub ticket from the board, local run (Phase 1). Checks the ticket is ready, claims it, branches, runs implement-feature with the Acceptance list as the spec, watches CI, and stops at the caps with needs-human and a draft PR. Posts one factory-metrics comment. Never merges. Use when asked to work a ticket, take issue <n>, or start a ticket from the board. Triggers include work ticket, work-ticket, take ticket, do issue, start the ticket, next stage after plan-tickets.
---

# work-ticket

Argument: issue number `<n>`. Design source: [design.md](../../../docs/designs/software-factory/design.md) section 6.5. Rules: wiki [Ticket Workflow](https://github.com/vpr1995/prudhvi-software-factory/wiki/Ticket-Workflow).

## Steps

1. Read. `REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)`, then `gh issue view <n> --json number,title,body,labels,state`. Stop and tell the reason if any is true. A stop here changes no label and posts no metrics. Say so.
   - The issue is closed. It has no `agent:ready`. It has `agent:in-progress` or `needs-human`.
   - The title has the literal text `[owner]`.
   - Parent: `gh api repos/$REPO/issues/<n> -q .sub_issues_summary.total` is above 0.
   - Acceptance has no checkbox.
   - Open blocker: `gh api repos/$REPO/issues/<n>/dependencies/blocked_by -q '[.[] | select(.state=="open")] | length'` is above 0. Also stop when Notes has a `Blocked by (outside):` line: ask the owner.
   - The `blocked` label with no open blocker: remove the label, say so, go on.
2. Tree and resume. `git status --porcelain` must print nothing, else stop and ask. Check `git branch -a --list "*/<n>-*"`. A branch exists: reuse it and its open PR. Make no 2nd branch and no 2nd PR.
3. Branch (no branch yet). `git checkout main && git pull --ff-only`, then `git checkout -b <type>/<n>-<short-kebab>`. Type: `docs` for a doc-only ticket, `fix` for a bug, else `feat`. The branch has `<n>`, so the `pre-pr` spec pass finds the issue.
4. Claim. `gh issue edit <n> --add-label agent:in-progress --remove-label agent:ready`, then `gh issue comment <n> --body "Claimed for a local agent run."`
5. Work. Run the `implement-feature` skill. Skip its step 2 (the branch exists). The Acceptance list is the spec. The failing test of its step 5 covers the Acceptance items. Its step 10 runs `pre-pr` (spec pass first, max 3 rounds). The PR body has `Closes #<n>`.
   - Code ticket: also run `node tooling/repo-checks/scripts/doc-lint.mjs` before the PR. CI runs it.
   - Doc-only ticket (each changed path is `*.md`, no code): skip implement-feature steps 4, 5, 7, 8 and 10. Run doc-lint and `npx --no-install prettier --check <files>`. Open the PR with `pr-description`, with the override of design-review step 6: no verify log, and Testing holds the doc-lint and Prettier output.
6. CI. `PR=$(gh pr view --json number -q .number)`, then `gh pr checks $PR --watch`. If it says no checks, wait and run it again (max 3 tries). On a failed run: `RUN=$(gh run list --branch <branch> --limit 1 --json databaseId -q '.[0].databaseId')`, `gh run view $RUN --log-failed`, fix the cause, run the `verify` skill, commit (explicit paths, keep the Co-Authored-By trailer), push, watch again. Never weaken a test or a check (root CLAUDE.md rule 2).
7. Cap stop. Stop at any of these: 3 review rounds with an open Important finding; a 3rd failed CI run; a decision the ticket does not make; any stop or "ask the human" inside a sub-skill (implement-feature step 3, a failed `rush audit`, `verify` failing 3 times, `pre-pr` step 15, `pr-description` asking). Then:
   - No PR yet: commit the work (explicit paths), push, and open a draft PR: `gh pr create --draft --body-file <file>`. The body has `Closes #<n>` and lists the open findings or the blocker. No commit beyond main: skip the PR.
   - `gh issue edit <n> --add-label needs-human --remove-label agent:in-progress`.
   - Comment on the issue: what failed, what you tried, the question.
   - Post the metrics comment with outcome `needs-human`. Stop.
8. Green. `gh issue edit <n> --remove-label agent:in-progress`. Post the metrics comment with outcome `green`. Report: branch, PR URL, review rounds, CI rounds.

## Metrics comment

One comment on the PR. No PR: on the issue. Write the body to `/tmp/factory-metrics-<n>.md` with a quoted heredoc (`<<'EOF'`). Post it: `gh pr comment <pr> --body-file /tmp/factory-metrics-<n>.md` (or `gh issue comment`). Never pass the body inline: it has backticks. The body is one fenced block of type `factory-metrics` with one JSON line. `cost` and `turns` stay `null` until Phase 2. `review_rounds` = `pre-pr` rounds run. `ci_rounds` = failed CI runs.

````
```factory-metrics
{"issue":<n>,"pr":<m or null>,"cost":null,"turns":null,"review_rounds":<r>,"ci_rounds":<c>,"outcome":"<green|needs-human>"}
```
````

## Done when

- [ ] The step 1 checks passed, and the claim comment exists.
- [ ] One PR with `Closes #<n>` is open, `verify` passed, and CI is green. Or a cap stop ran: `needs-human`, a comment, a draft PR.
- [ ] The label `agent:in-progress` is gone.
- [ ] One `factory-metrics` comment is posted (not for a step 1 stop).
- [ ] The report shows the branch, the PR URL, and both round counts.

## Do not

- Merge, approve, or close the issue (Ticket Workflow rule 7).
- Edit Acceptance. Ask for a change in a comment (rule 3).
- Start a 2nd ticket in the same run (rule 8).
- Skip, delete, or weaken a test or a check.
- Run `cdk deploy`, `cdk destroy` or `--no-verify` (root CLAUDE.md rule 4).
