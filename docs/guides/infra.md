# Guide: infra (AWS CDK)

Kind: `projects/<name>/infra`. Package: `@vprprudhvi/<name>-infra`. Read the root `CLAUDE.md` and `projects/CLAUDE.md` first. Changes to `projects/*/infra/**` are high risk. A human approves them.

## Folder layout

- `infra/src/stacks/`: stacks. Example: `<name>-stack.ts`.
- `infra/src/constructs/`: constructs for this project only, in kebab-case files.
- `infra/src/config/<env>.ts`: account-neutral settings per environment. Never hard-code an account, region, pool ID, zone ID, or certificate ARN.
- `infra/cdk.json`: gate file.
- Shared constructs go in `packages/cdk-constructs` (`@vprprudhvi/shared-cdk-constructs`). That needs a human.

## Rules

- Compute is Lambda first. API: Fastify on Lambda (`@fastify/aws-lambda`) behind an API Gateway HTTP API. Web: Next.js through OpenNext (CloudFront, S3, Lambda). Ask the human before any container or instance compute.
- Use PascalCase construct IDs. Set no physical names. Let CDK generate them.
- Stateful resources: encryption at rest and `RETAIN`. Use `DESTROY` only when `config/dev.ts` sets it, never in prod.
- Buckets block public access. Web buckets use CloudFront Origin Access Control only.
- Lambda: set timeout, memory, log retention, and active tracing.
- Use a JWT authorizer on the Cognito pool for each route that needs a user.
- Grant with `grantRead` and `grantWrite`. Never write `*` in IAM actions or resources.
- Read platform values only through the SSM helper in `shared-cdk-constructs`. Never import `platform/infra`. See the `use-platform-resource` skill.
- Each project makes its own Cognito app client, DNS records, and Lambdas.
- Never add a `NagSuppressions` call. A suppression needs a human.
- Never run `cdk deploy` or `cdk destroy`. Run `cdk synth` and read-only commands.

## Tests

- `Template.fromStack` assertions for resources, encryption, removal policy, runtime, log retention, and grants.
- A snapshot for each stack. Update it only for an intended change.
- `cdk-nag` with the AwsSolutions pack. Zero errors.
- Rules: `docs/standards/testing.md`, section 3.3.

## Telemetry

- The shared Lambda construct adds the ADOT collector-only layer and sets `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_PROPAGATORS`, `OTEL_TRACES_SAMPLER`, and `OTEL_TRACES_SAMPLER_ARG` (planned). Use that construct for each Lambda. Do not add the layer by hand. Do not set `AWS_LAMBDA_EXEC_WRAPPER`.
- Do not set tracing on the API Gateway stage. An HTTP API has no X-Ray support. The HTTP API forwards `traceparent`. Lambda active tracing starts the X-Ray segment.
- If the browser calls the API on another origin, allow the `traceparent` and `tracestate` request headers and expose the `traceparent` response header in CORS.
- Add an assertion: each Lambda has the ADOT layer and active tracing.
- Rules: `docs/standards/observability.md`, sections 8 and 11.

## Links

- Conventions: `docs/standards/coding-conventions.md`, sections A.15, A.16, D.4.
- Skills: `.claude/skills/new-cdk-construct/SKILL.md`, `.claude/skills/use-platform-resource/SKILL.md`.
- Review template: `docs/templates/REVIEW.infra.md`. ADR: `docs/adr/0006-platform-infra-shared-resources.md`.
