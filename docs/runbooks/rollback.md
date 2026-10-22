# Runbook: rollback

Use this runbook when a change harms users, data, cost, or security after release. Choose the fastest step that fixes the harm.

## 1. Choose the step

| Step | Use when | Time |
|---|---|---|
| A. Turn off the flag | The harm comes from a new behavior behind a flag. | Minutes |
| B. Re-deploy the last good build | The harm comes from a deploy with no flag. | Minutes to one deploy |
| C. Revert the PR | The harm stays after A or B, or the code must not stay on `main`. | One PR and one deploy |

Start with A when a flag exists. Then do C so that `main` is correct.

## 2. Step A: turn off the flag (kill switch)

1. Find the flag name in the PR. The PR template has a Feature flag field.
2. Run the `rollback.yml` workflow for the affected environment. Choose the flag name and the value `off`. (The workflow is planned. See `docs/standards/gates.md`.)
3. Approve the `prod` environment step if the environment asks for it.
4. Check the behavior in the affected environment. Confirm that the new code path is off.
5. Open an issue. Name the flag and the time that you turned it off.

Do not delete the flag in the rollback. Remove it in a separate PR after the fix is stable.

## 3. Step B: re-deploy the last good build

1. Find the last good release. Use the release tag or the build ID from the last passing `release.yml` run.
2. Run the `rollback.yml` workflow. Choose the build ID and the environment.
3. Approve the `prod` environment step.
4. Check the health endpoint and the error rate for the affected service.
5. Check the stack diff before the deploy. Do not roll back a stack that has a stateful replacement in its diff. Stop and call a human.

Rollback does not undo a database migration or data written by the new code. Check the data before you decide.

## 4. Step C: revert the PR

1. Create a branch from `main`. Use the name `revert/<short-kebab>`.
2. Run `git revert <merge-sha>`. Do not rewrite `main`. Do not force push.
3. Run `node common/scripts/install-run-rush.js verify`. Show the output.
4. Open a PR. Use the title `revert: <original title>`.
5. Fill the PR template. Use the same risk tier as the original PR. Write the reason for the revert in the Summary.
6. Get the approvals for the tier. See `docs/standards/risk-tiers.md`.
7. Merge through the merge queue.

A revert PR passes the same gates as any other PR. A revert does not skip a gate.

## 5. After the rollback

1. Write a short incident note. Include the time, the cause, the step used, and the impact.
2. Find the root cause. Fix the cause in a separate PR. Use `fix/<short-kebab>`.
3. Add a test that fails before the fix. See `docs/standards/testing.md`.
4. Add a reviewer case for the bug class. See `evals/reviewer/README.md`.
5. Remove the flag after the fix is stable. Use a separate PR.

## 6. Stop rules

- Do not run `cdk deploy` or `cdk destroy` from a laptop. Use the workflow.
- Do not change a branch ruleset to unblock a merge.
- Do not add `--no-verify` or a skip to a rollback PR.
- If a rollback fails, stop. Call the platform owners (`@vprprudhvi`).
