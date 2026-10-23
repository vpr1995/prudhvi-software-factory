---
name: use-platform-resource
description: Let a project use a shared platform resource such as the Cognito user pool, the imported Route53 hosted zone, or the ACM wildcard certificate. Reads platform values from SSM under /platform/<env>/ through the helper in shared-cdk-constructs, and explains how to request a NEW platform resource, which needs human approval in platform/infra. Triggers include use platform, platform resource, user pool, Cognito app client, hosted zone, wildcard cert, SSM platform value, add a platform resource.
---

# use-platform-resource

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Platform facts:

- `platform/infra` (`@vprprudhvi/platform-infra`) owns one Cognito user pool, the imported Route53 hosted zone, and the ACM wildcard certificate.
- It publishes their IDs and ARNs to SSM under `/platform/<env>/...`.
- Projects read those values through the SSM helper exported by `@vprprudhvi/shared-cdk-constructs` (folder `packages/cdk-constructs`).
- Projects never import code from `platform/infra`. They never use CloudFormation cross-stack references to platform stacks.

## Consume an existing platform value

1. Read the key list. Run `ls platform/infra/src` and read the file that publishes the `/platform/` keys. Do not guess key names.
2. Read the helper. Run `grep -n "export" packages/cdk-constructs/src/index.ts`. Use the exact export names. If no SSM helper is exported, stop and ask the human.
3. Check the value exists (read-only): `aws ssm get-parameter --name /platform/<env>/<key> --query Parameter.Name --output text`. If AWS credentials are missing, say so. Do not skip the rest.
4. In the project infra stack, call the helper with the env from `projects/<name>/lib/config/<env>.ts`. Do not hard-code a pool ID, zone ID, certificate ARN, or account ID.
5. Create only project resources: one Cognito app client on the platform user pool for this project, DNS records in the platform hosted zone under this project's subdomain, the project custom domain, and the project Lambdas. Use `new-cdk-construct` for each one.
6. Never create a user pool, hosted zone, or wildcard certificate in a project stack.
7. Run `Template.fromStack` tests that assert the helper's SSM path, then run the `verify` skill.

## Request a NEW platform resource (human-approved)

1. Stop. A new platform resource is a change to `platform/infra`. Only a human can approve it.
2. Write a proposal to `.claude/state/handoff/platform-<slug>/` as `.txt` files. Include the construct, the SSM keys, the IAM grants, the removal policy, and the projects that need it.
3. Tell the human what to review. Do not edit `platform/infra`.
4. Continue the project work only with values that already exist.

## Done when

- [ ] Every platform value comes from the SSM helper, with an exact export name.
- [ ] No project code imports `platform/infra`. No cross-stack reference to a platform stack.
- [ ] Tests assert the SSM path. The `verify` output is pasted.
- [ ] A new platform resource is only a handoff proposal, not an edit.

## Do not

- Guess SSM key names or helper export names.
- Hard-code a pool ID, zone ID, certificate ARN, or account ID.
- Create a user pool, hosted zone, or wildcard certificate in a project.
- Edit `platform/infra/**`. It needs a human.
- Share one Cognito app client across projects. Each project gets its own.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`.
- Run `cdk deploy`, `cdk destroy`, or any AWS write command.
- Use `--no-verify`.
