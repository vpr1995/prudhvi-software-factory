Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `.github/**`.

## Gate area

- `.github/**` holds CI workflows, `CODEOWNERS`, the PR template, and rulesets.
- Workflow changes are always human. Agents do not edit this folder. The `protect-gates.sh` hook blocks the edit. Do not bypass the hook.
- Changes here are `risk:high`. A human approves each change.

## What lives here

- `workflows/ci.yml`: required checks on each PR and on the merge queue.
- `workflows/`: security, risk-classify, review, nightly, infra, and release workflows.
- `CODEOWNERS`: owner rules. The last matching line wins.
- `pull_request_template.md`: Summary, Testing, Risk, How to revert, Flag.

## When a CI check fails

1. Read the failing log. Find the check and the file.
2. Fix the cause in your code. Run the same check on your machine with the command from [commands.md](../docs/guides/commands.md).
3. Never change a workflow to make a check pass. Never add a skip or an allow rule.
4. If the workflow looks wrong, stop. Tell the human what is wrong and why.

## How to propose a change

1. Write the change as text in your final message. Give the target path and the new content.
2. Give the reason.
3. Ask the human to apply it.

Do not run `gh` commands that change repo settings, labels, or rulesets. Do not run `cdk deploy`. Releases use `release.yml`.

## Links

- [gates.md](../docs/standards/gates.md): sections 2.1, 4, 5, 6.
- [git-workflow.md](../docs/standards/git-workflow.md)
- [risk-tiers.md](../docs/standards/risk-tiers.md)
- [security.md](../docs/standards/security.md)
- [rollback runbook](../docs/runbooks/rollback.md)
