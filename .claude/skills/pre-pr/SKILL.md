---
name: pre-pr
description: Run up to three review rounds on the current branch before a PR. Each round runs a spec pass (spec-reviewer against the issue Acceptance list), then bug-hunt, then the simplify, code-review and security-review built-ins, fixes findings, re-runs verify, and commits the fixes. Later rounds review only the previous round's fixes. Use before opening a PR or when asked to review, clean up, or harden a branch. Triggers include pre-pr, review my branch, ready for PR, run the review rounds, security review before PR.
---

# pre-pr

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Prerequisites: the working tree is clean (commit first, see implement-feature), and the `verify` skill passes.

State folder: `.claude/state/pre-pr/`.

- `round-<n>.start`: one line. The HEAD sha at the start of round n.
- `findings.md`: one row per finding: `id | round | severity | file:line | bug class | status (open, fixed, rejected) | reason`.

## Steps

1. Run `mkdir -p .claude/state/pre-pr`. Set round = 1.
2. Check the tree: `git status --porcelain` must print nothing. If it prints, stop and commit or discard the changes.
3. Run the `verify` skill. It must pass.
4. Record the start of the round: `git rev-parse HEAD > .claude/state/pre-pr/round-<n>.start`.
5. Choose the review range.
   - Round 1: Range = `origin/main...HEAD` if `origin/main` exists, else `main...HEAD`. Write the range as text in each request. Shell state does not persist between Bash calls.
   - Round 2 or 3: Range = `$(cat .claude/state/pre-pr/round-<n-1>.start)..HEAD`. This is only the fixes from the previous round.
6. Spec pass. Take the issue number from the branch name: `git branch --show-current | sed -nE 's#^[a-z]+/([0-9]+)-.*#\1#p'`. If it prints nothing, skip this step and say so in the report. Else spawn the `spec-reviewer` agent with `Issue: #<n>. Range: origin/main...HEAD.` (or `main...HEAD`). Always use the full branch range of round 1: the spec needs the whole change, not only the fixes.
7. Run the `bug-hunt` skill on that range. It spawns the `fresh-reviewer` agent.
8. Run these built-ins in order, with the same range in the request text: the `simplify` skill (it applies its fixes), then the `code-review` skill, then the `security-review` skill. Do not pass `--comment` or `--fix` to `code-review`. This skill fixes findings itself.
9. Merge all new findings, the spec pass included, into `findings.md`. Before you add a finding, check the file. A finding that matches a row with status `fixed` reopens that row: the fix failed. Set it to `open`. Skip a finding that matches a row with status `open` or `rejected`.
10. Fix every open Important finding. Fix Nits when the change is small. For a false positive, set status `rejected` and quote the code that shows it is wrong.
11. Run the `verify` skill. It must pass.
12. Commit the round's changes, if any. Stage explicit paths only: `git add <path> ...`. Run `git commit -m "fix(<scope>): address pre-pr round <n>"`.
13. Stop when the round found no new Important finding and no open Important finding remains. Report the rounds run and the count of each finding status.
14. If the round found any new Important finding, or open Important findings remain, and round < 3, add 1 to round and go to step 2. Round 2 reviews the fixes of round 1.
15. If open Important findings remain after round 3, stop. List the open findings with their IDs. Ask the human about the approach. Do not start round 4.

## Done when

- [ ] `verify` passed after the last fix, and its output is pasted.
- [ ] `findings.md` has no open Important finding, or the human was asked after round 3.
- [ ] Rounds used are 3 or fewer. Each round that changed code has a commit.
- [ ] The final report lists each round, the counts, and each rejected finding with its reason.

## Do not

- Re-raise a finding that has an `open` or `rejected` row in `findings.md`. A match with a `fixed` row reopens that row.
- Reject a finding only to finish the run. Give evidence.
- Review files outside the range, except to read context.
- Pass `--comment` or `--fix` to `code-review`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`. Use `rush install`.
- Never run `cdk deploy` or `cdk destroy` (root CLAUDE.md rule 4).
- Use `--no-verify`.
