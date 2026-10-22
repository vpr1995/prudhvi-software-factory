# REVIEW.md: platform

This file adds rules for `platform/`. It applies together with `REVIEW.md` at the repository root and with `docs/templates/REVIEW.infra.md`. Read `CLAUDE.md` first.

Every change here is `risk:high`. A human approves each change. The platform has a shared blast radius. Every project reads its outputs.

## Platform rules

### Shared blast radius

- List each project that reads a changed output. Check each one in the PR.
- A change that breaks a consumer is `Important`, even when the platform tests pass.
- Deploy `platform/infra` before any project that needs the new output.

### SSM parameter names are a contract

- Do not rename or delete a parameter under `/platform/<env>/...`.
- Adding a parameter is allowed. Check that the name follows the pattern in ADR 0006.
- A changed parameter value needs a reason and a consumer check.

### Cognito user pool

- Do not replace the user pool. Check `cdk diff` for any `AWS::Cognito::UserPool` replacement. Report it as `Important`.
- The user pool keeps `RemovalPolicy.RETAIN` and deletion protection.
- Changing a sign-in attribute or a schema after creation can require replacement. Check the diff before approving.

### Hosted zone and certificate

- The hosted zone is imported. Do not create a new zone. A lookup must not create a resource.
- The ACM wildcard certificate covers the zone only. Check the domain names in the request.
- Keep the DNS validation records for the certificate. Removing them stops renewal.

### Scope

- Platform code holds shared resources only. Report as `Important` any project-specific resource, such as a project app client, a project DNS record, or a project Lambda.
- Platform code never imports from `projects/*`. Report as `Important` any such import.
- `packages/cdk-constructs` helpers that read SSM must stay backward compatible. A removed or renamed export breaks every project.

## Inherited rules

Apply the infra template in `docs/templates/REVIEW.infra.md` to each changed file.
