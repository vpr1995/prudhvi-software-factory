# Runbook: rollback

Use this runbook when a change harms users, data, cost, or security after release.

## 1. Revert the PR

1. Create a branch from `main`. Use the name `revert/<short-kebab>`.
2. Run `git revert <merge-sha>`. Do not rewrite `main`. Do not force push.
3. Run `node common/scripts/install-run-rush.js verify`. Show the output.
4. Open a PR. Use the title `revert: <original title>`.
5. Fill the PR template. Use the same risk tier as the original PR. Write the reason for the revert in the Summary.
6. The owner reviews and merges the PR. See `docs/standards/risk-tiers.md`.

A revert PR passes the same checks as any other PR. A revert does not skip a check.

## 2. After the rollback

1. Write a short incident note. Include the time, the cause, the impact.
2. Find the root cause. Fix the cause in a separate PR. Use `fix/<short-kebab>`.
3. Add a test that fails before the fix. See `docs/standards/testing.md`.
4. Add a reviewer case for the bug class. See `evals/reviewer/README.md`.

## 3. Stop rules

- Deploy rules: see root `CLAUDE.md`, rule 4. Never run `cdk destroy`.
- Do not change a branch ruleset to unblock a merge.
- Do not add `--no-verify` or a skip to a rollback PR.
- If a rollback fails, stop. Call the platform owners (`@vpr1995`).
