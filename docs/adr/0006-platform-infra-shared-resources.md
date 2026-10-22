# ADR 0006: Shared platform infrastructure and Lambda-first compute

- Status: Accepted
- Date: 2026-10-22

## Context

Several projects need the same AWS resources: one user pool for sign-in, one DNS zone, and one wildcard certificate. If each project creates its own copy, the copies drift and cost more. A shared resource that breaks also breaks every project.

Compute choice: the team wants the lowest operating cost and the least server management. Lambda meets this need. Containers (ECS Fargate) are not used now.

## Decision

### Shared platform resources

- `platform/infra` (package `@vprprudhvi/platform-infra`) is a CDK app. It owns:
  - one Cognito user pool,
  - a Route53 hosted zone. The zone is imported, not created,
  - one ACM wildcard certificate for the zone.
- `platform/infra` writes each ID and ARN to SSM Parameter Store under `/platform/<env>/...`. Examples:
  - `/platform/<env>/cognito/user-pool-id`
  - `/platform/<env>/cognito/user-pool-arn`
  - `/platform/<env>/dns/hosted-zone-id`
  - `/platform/<env>/dns/zone-name`
  - `/platform/<env>/acm/wildcard-certificate-arn`
- The SSM parameter names are a contract. Changing a name breaks every project that reads it. A name change needs a human and a coordinated deploy.
- A project `infra` app reads these values through helpers in `@vprprudhvi/shared-cdk-constructs`.
- Nothing imports `platform/infra` code. A project `infra` app never imports it directly.
- Each project `infra` app creates its own resources:
  - its own Cognito app client (one client ID per project),
  - its own DNS records and custom domain in the imported zone,
  - its own Lambda functions.
- The user pool keeps `RemovalPolicy.RETAIN` and deletion protection. Do not replace it. A replacement in `cdk diff` stops the deploy.
- Changes to `platform/**` are `risk:high`. A human always approves them.

### Lambda-first compute

- API: Fastify runs on Lambda through `aws-lambda-fastify`. API Gateway HTTP API sits in front of it.
- Web: Next.js runs through OpenNext. The stack uses CloudFront, S3, and Lambda.
- Do not add ECS Fargate or another container runtime without a new ADR.

## Consequences

- Positive: One sign-in system and one certificate for all projects.
- Positive: No servers to run. Cost follows requests.
- Positive: Each project controls its own app client, DNS names, and functions.
- Negative: `platform/infra` is a shared blast radius. Deploy it before any project that reads its parameters.
- Negative: SSM names are a contract. Renames need a coordinated change.
- Negative: One user pool means one set of user accounts for all projects. Isolation is by app client and by authorization checks in each API.
- Negative: Lambda has cold starts. API Gateway HTTP API has a 30-second integration timeout. Long work must run as a background job.
