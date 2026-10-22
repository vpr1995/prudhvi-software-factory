Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `platform/`.

## What this area is

- `platform/infra` (`@vprprudhvi/platform-infra`) is a CDK app. It owns the shared AWS resources: one Cognito user pool, the imported Route53 hosted zone, and one ACM wildcard certificate.
- It writes each ID and ARN to SSM under `/platform/<env>/...`.
- Every project reads these values. A broken change here breaks every project.

## Risk

- Every change under `platform/**` is `risk:high`. A human approves each change.
- Write a PR for a human. Never merge it. Never run `cdk deploy`.
- Deploy `platform/infra` before any project that reads a new output.

## Rules

- The SSM parameter names are a contract. Never rename or delete one. You can add a parameter. Use the pattern from ADR 0006.
- Example names: `/platform/<env>/cognito/user-pool-id`, `/platform/<env>/dns/hosted-zone-id`, `/platform/<env>/acm/wildcard-certificate-arn`.
- Never replace the Cognito user pool. Check `cdk diff` for an `AWS::Cognito::UserPool` replacement. Keep `RemovalPolicy.RETAIN` and deletion protection.
- Import the hosted zone. Never create a new zone.
- List each consumer project in the PR. Check each one.
- No code imports `platform/infra`. Projects read SSM values through `@vprprudhvi/shared-cdk-constructs`.

## Request a new platform resource

- A project needs a new shared resource. Open a request for a human. Do not add it from a project.
- Use the [use-platform-resource](../.claude/skills/use-platform-resource/SKILL.md) skill for the steps.

## Verify

- Run `rush verify --to @vprprudhvi/platform-infra` and paste the output.
- Run `cdk synth` and read the `cdk diff`. See the [e2e-verify](../.claude/skills/e2e-verify/SKILL.md) skill.

## Links

- [platform/REVIEW.md](REVIEW.md)
- [ADR 0006](../docs/adr/0006-platform-infra-shared-resources.md)
- [infra guide](../docs/guides/infra.md)
- [risk-tiers.md](../docs/standards/risk-tiers.md)
- [security.md](../docs/standards/security.md)
