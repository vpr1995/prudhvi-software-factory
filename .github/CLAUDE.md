Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `.github/**`.

## Scope

- `.github/**` holds CI workflows, `CODEOWNERS`, the PR template, and rulesets.
- Changes here are `risk:high`. A human reviews each change. Agents can edit this folder.

## What lives here

- `workflows/ci.yml`: runs on each pull request. Jobs: `plan`, `project` (one job for each impacted project), `knip`, `ci-result`, `workflow-lint`. `ci-result` is a required check. Details: [testing.md](../docs/standards/testing.md) section 6.
- `workflows/secrets.yml`: runs gitleaks on the commits of each pull request. Its job `gitleaks` is a required check.
- `workflows/warm-cache.yml`: runs on each push to `main` and by hand. It builds all projects and saves the caches that pull requests restore.
- `zizmor.yml`: zizmor config. A human adds each entry, with a reason.
- `actions/repo-setup/action.yml`: composite action. It sets up Node, restores the caches, runs `rush install`, and restores the Rush build cache.
- `CODEOWNERS`: owner rules. The last matching line wins.
- `pull_request_template.md`: Summary, Testing, Risk, How to revert, Flag.

## When a CI check fails

1. Read the failing log. Find the check and the file.
2. Fix the cause in your code. Run the same check on your machine with the command from [commands.md](../docs/guides/commands.md).
3. Never change a workflow to make a check pass. Never add a skip or an allow rule.
4. If the workflow looks wrong, tell the human what is wrong and why.

## How to change a workflow

1. Pin each `uses:` to a full commit SHA with a version comment (`pinact run`).
2. Run `bash scripts/security/workflow-lint.sh`. The pre-commit hook runs it on staged files too.
3. Put the change in its own PR.
4. Give the reason in the PR description.
5. A human reviews it.

Do not run `gh` commands that change repo settings, labels, or rulesets. Do not run `cdk deploy`. Releases use `release.yml`.

## Links

- [git-workflow.md](../docs/standards/git-workflow.md)
- [risk-tiers.md](../docs/standards/risk-tiers.md)
- [security.md](../docs/standards/security.md)
- [rollback runbook](../docs/runbooks/rollback.md)
