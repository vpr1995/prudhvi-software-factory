Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `platform/`.

## What this area is

- `platform/infra` (`@vprprudhvi/platform-infra`) is a CDK app. It owns the shared AWS resources: one Cognito user pool. It also fronts the imported Route53 hosted zone and the ACM wildcard certificate, whose parameters the owner creates by hand (below).
- It writes the Cognito IDs and ARNs to SSM under `/platform/<env>/...`. Only `prod` exists.
- The DNS and ACM parameters are not written by the stack. The owner creates them by hand with `aws ssm put-parameter` (type `String`, in the region of the stacks that read them): `/platform/prod/dns/hosted-zone-id` (the Route53 zone `api.vprprudhvi.dev`), `/platform/prod/dns/zone-name` (`api.vprprudhvi.dev`) and `/platform/prod/acm/wildcard-certificate-arn` (`*.api.vprprudhvi.dev`). The stack must not manage them, because a deploy would overwrite the values. Websites use `vprprudhvi.dev` on Cloudflare. Backend APIs use names under `api.vprprudhvi.dev`. See [ADR 0011](../docs/adr/0011-local-and-prod-environments.md).
- Every project reads these values. A broken change here breaks every project.

## Risk

- Every change under `platform/**` is `risk:high`. The owner reviews each change (CODEOWNERS).
- Write a PR for the owner. Never merge it. A human deploys `platform/infra` (root [CLAUDE.md](../CLAUDE.md) rule 4).
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
