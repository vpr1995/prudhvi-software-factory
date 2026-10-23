# Guide: infra (AWS CDK)

Part: `projects/<name>/bin` (app entry) and `projects/<name>/lib` (stacks, constructs). Package: `@vprprudhvi/<name>` (one package for the whole project). Read the root `CLAUDE.md` and `projects/CLAUDE.md` first. Changes to `projects/*/bin/**` and `projects/*/lib/**` are high risk. A human approves them.

## Folder layout

- `bin/<name>.ts`: the CDK app entry. It creates the `App`, adds the `AwsSolutionsChecks` aspect, and adds the stacks.
- `lib/stacks/`: stacks. Example: `<name>-stack.ts`.
- `lib/constructs/`: constructs for this project only, in kebab-case files.
- `lib/config/<env>.ts`: account-neutral settings per environment. Never hard-code an account, region, pool ID, zone ID, or certificate ARN.
- `lib/nag-acknowledgments/<stack>.ts`: the one cdk-nag acknowledgments file for a stack (see Rules).
- `cdk.json` (project root): gate file.
- `bin` and `lib` use the one project `package.json`. They have no `package.json` of their own.
- Shared constructs go in `packages/cdk-constructs` (`@vprprudhvi/shared-cdk-constructs`). That needs a human.
- Wave 3 creates `bin/` and `lib/`. Until then the project has no CDK app.

## Bundling

CDK bundles the Lambda code at synth. Do not build code in a separate deploy step.

| Part | Construct | Bundling |
|---|---|---|
| `src/api` (TypeScript) | `NodejsFunction` | esbuild, entry `src/api/lambda.ts` |
| `src/api-go` | `Code.fromAsset` | Local bundling: `go build` for `linux/arm64`, output file `bootstrap`. Docker fallback. |
| `src/api-py` | `Code.fromAsset` | Local bundling: `uv` installs the locked dependencies and copies the source. Docker fallback. |
| `web` | OpenNext construct | Local bundling runs the OpenNext build. |

- Unit tests turn bundling off, so `Template.fromStack` runs without Go, `uv`, Docker, or a web build. Use the `bundling` skip context value or a test-only asset.
- Use local bundling first. Use Docker only when the local tool is missing.

## Rules

- Region is `us-east-1` only. Use one wildcard certificate (from the platform) for all project domains. Do not create a certificate in a project.
- Compute is Lambda first. API: Fastify on Lambda (`@fastify/aws-lambda`) behind an API Gateway HTTP API. Web: Next.js through OpenNext (CloudFront, S3, Lambda). Ask the human before any container or instance compute.
- Use PascalCase construct IDs. Set no physical names. Let CDK generate them.
- Stateful resources: encryption at rest and `RETAIN`. Use `DESTROY` only when `lib/config/dev.ts` sets it, never in prod.
- Buckets block public access. Web buckets use CloudFront Origin Access Control only.
- Lambda: set timeout, memory, log retention, and active tracing.
- Use a JWT authorizer on the Cognito pool for each route that needs a user.
- Grant with `grantRead` and `grantWrite`. Never write `*` in IAM actions or resources.
- Read platform values only through the SSM helper in `shared-cdk-constructs`. Never import `platform/infra`. See the `use-platform-resource` skill.
- Each project makes its own Cognito app client, DNS records, and Lambdas.
- cdk-nag 3: the app runs `Validations.of(app).addPlugins(new AwsSolutionsChecks(app))`. A finding makes `cdk synth` fail. Meet each rule. If a rule cannot be met, add one `Validations.of(construct).acknowledge({ id, reason })` to the one acknowledgments file of the stack. The id includes the bracket part, for example `AwsSolutions-IAM5[Resource::*]`. Give a reason for each one. The owner approves each one. `TracedFunctionBase` (the base of `TracedNodeFunction`, `TracedGoFunction` and `TracedPythonFunction`) holds two owner-approved acknowledgments (X-Ray `Resource: *`, log streams `<logGroupArn>:*`).
- Never run `cdk deploy` or `cdk destroy`. Run `cdk synth` and read-only commands.

## Tests

- `Template.fromStack` assertions for resources, encryption, removal policy, runtime, log retention, and grants. Bundling is off.
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
