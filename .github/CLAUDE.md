Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `.github/**`.

## Scope

- `.github/**` holds CI workflows, `CODEOWNERS`, the PR template, and the issue form. The rulesets live in the GitHub settings, not in this folder.
- Changes here are `risk:high`. A human reviews each change. Agents can edit this folder.

## What lives here

- `workflows/ci.yml`: runs on each pull request. Jobs: `plan` (repo-wide checks, doc lint and test guard included), `project` (one job for each impacted project), `knip`, `ci-result`, `workflow-lint`. `ci-result` is a required check. The test guard runs from the base commit (`git archive`), so a change to the guard takes effect only after merge. Details: [testing.md](../docs/standards/testing.md) section 6.
- `workflows/deploy.yml`: runs on each push to `main`. Jobs: `plan` (`deploy-plan.mjs` lists the impacted projects by `factory.deploy` target) and `cloudflare` (one job for each web project: build, check `_headers`, `npm run deploy:cloudflare`, wait for the site, `npm run smoke`). The `cloudflare` job uses the environment `prod`, which holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Only the deploy step reads them. Each project lists `wrangler` itself and has the `deploy:cloudflare` script (see [projects/CLAUDE.md](../projects/CLAUDE.md)). Deploys run one at a time and are never cancelled. The plan starts from the last successful deploy run, so a push that GitHub cancelled in the queue is not lost, and a failed deploy runs again. The `aws` job and the revert PR on a smoke failure are not built yet.
- `workflows/secrets.yml`: runs gitleaks on the commits of each pull request. Its job `gitleaks` is a required check.
- `workflows/warm-cache.yml`: runs on each push to `main` and by hand. It builds all projects and saves the caches that pull requests restore.
- `zizmor.yml`: zizmor config. A human adds each entry, with a reason.
- `actions/repo-setup/action.yml`: composite action. It sets up Node, restores the caches, runs `rush install`, and restores the Rush build cache.
- `CODEOWNERS`: owner rules. The last matching line wins.
- `pull_request_template.md`: Summary, Linked issue, Testing, Risk tier, How to revert, Feature flag, Checklist.
- `ISSUE_TEMPLATE/ticket.yml`: issue form for tickets: Context, Acceptance, Risk tier, Notes. Blank issues are off. Rules: wiki page Ticket Workflow.

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

Do not run `gh` commands that change repo settings, labels, or rulesets.

## Links

- [git-workflow.md](../docs/standards/git-workflow.md)
- [risk-tiers.md](../docs/standards/risk-tiers.md)
- [security.md](../docs/standards/security.md)
- [rollback runbook](../docs/runbooks/rollback.md)
