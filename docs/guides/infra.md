# Guide: infra (AWS CDK)

Part: `projects/<name>/bin` (app entry) and `projects/<name>/lib` (stacks, constructs). Package: `@vprprudhvi/<name>` (one package for the whole project). Read the root `CLAUDE.md` and `projects/CLAUDE.md` first. Changes to `projects/*/bin/**` and `projects/*/lib/**` are medium risk. The infra reviewer, and cdk-nag check them. Changes to `platform/**` and `packages/**` (including `packages/cdk-constructs`) are high risk.

## Folder layout

- `bin/app.ts`: the CDK app entry. It creates the `App` and calls `add<Name>Stack` in `lib/<name>-app.ts`. That function adds the `AwsSolutionsChecks` plugin and the stacks.
- `lib/<name>-app.ts` and `lib/<name>-stack.ts`: the app helper and the stack. The infra part starts with both as a stub with one placeholder resource and no app resources (`rush add-part --part infra`, `scaffold` skill).
- `lib/constructs/`: constructs for this project only, in kebab-case files.
- `lib/config/<env>.ts`: account-neutral settings per project environment (`local` or `prod`). Never hard-code an account, region, pool ID, zone ID, or certificate ARN.
- `lib/nag-acknowledgments/<stack>.ts`: the one cdk-nag acknowledgments file for a stack (see Rules).
- `cdk.json` and `tsconfig.cdk.json` (project root). `rush add-part --part infra` writes them, so later infra work does not change them.
- `bin` and `lib` use the one project `package.json`. They have no `package.json` of their own.
- Shared constructs go in `packages/cdk-constructs` (`@vprprudhvi/shared-cdk-constructs`). That needs a human.
- The CDK app is optional. A project gets it with `rush add-part --project <name> --part infra` when it needs infra.

## Bundling

CDK bundles the Lambda code at synth. Do not build code in a separate deploy step.

| Part                   | Construct        | Bundling                           |
| ---------------------- | ---------------- | ---------------------------------- |
| `src/api` (TypeScript) | `NodejsFunction` | esbuild, entry `src/api/lambda.ts` |

- Unit tests turn bundling off, so `Template.fromStack` runs without Docker. Use the `bundling` skip context value or a test-only asset.
- Use local bundling first. Use Docker only when the local tool is missing.

## Rules

- Region is `us-east-1` only. Use one wildcard certificate (from the platform) for all project domains. Do not create a certificate in a project.
- Compute is Lambda first. API: Fastify on Lambda (`@fastify/aws-lambda`) behind an API Gateway HTTP API. Ask the human before any container or instance compute.
- Use PascalCase construct IDs. Set no physical names. Let CDK generate them.
- Stateful resources: encryption at rest and `RETAIN`. Use `DESTROY` only when `lib/config/local.ts` sets it, never in `prod`.
- Buckets block public access. Web buckets use CloudFront Origin Access Control only.
- Lambda: set timeout, memory, log retention, and active tracing.
- Use a JWT authorizer on the Cognito pool for each route that needs a user.
- Add each HTTP API route by hand with `TracedHttpApi.addLambdaRoute({ method, path, fn })`. A route uses the JWT authorizer unless it has `public: true`. Do not add a `$default` route or a greedy `{proxy+}` route: the construct rejects them. A request that matches no route gets a 404 from the gateway and never reaches the Lambda.
- A public route raises `AwsSolutions-APIG4`. In the acknowledgments file of the stack, acknowledge it only on the routes in `api.publicRoutes`, with `Validations.of(entry.route).acknowledge({ id: 'AwsSolutions-APIG4', reason })`. The owner approves each entry.
- Grant with `grantRead` and `grantWrite`. Never write `*` in IAM actions or resources.
- Read platform values only through the SSM helper in `shared-cdk-constructs`. Never import `platform/infra`. See the `use-platform-resource` skill.
- Each project makes its own Cognito app client, DNS records, and Lambdas.
- cdk-nag 3: the app runs `Validations.of(app).addPlugins(new AwsSolutionsChecks(app))`. A finding makes `cdk synth` fail. Meet each rule. If a rule cannot be met, add one `Validations.of(construct).acknowledge({ id, reason })` to the one acknowledgments file of the stack. The id includes the bracket part, for example `AwsSolutions-IAM5[Resource::*]`. Give a reason for each one. The owner approves each one. `TracedFunctionBase` (the base of `TracedNodeFunction`) holds two owner-approved acknowledgments (X-Ray `Resource: *`, log streams `<logGroupArn>:*`).
- Deploy rules: see root `CLAUDE.md`, rule 4. Never run `cdk destroy`.

## Tests

- `Template.fromStack` assertions for resources, encryption, removal policy, runtime, log retention, and grants. Bundling is off.
- `cdk-nag` with the AwsSolutions pack. Zero errors.
- Rules: `docs/standards/testing.md`, section 3.3.

## Telemetry

- The shared Lambda construct adds the ADOT collector-only layer and sets `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_PROPAGATORS`, `OTEL_TRACES_SAMPLER`, and `OTEL_TRACES_SAMPLER_ARG`. The shared Lambda construct is `TracedNodeFunction` (base: `TracedFunctionBase`) in `@vprprudhvi/shared-cdk-constructs`. Use that construct for each Lambda. Do not add the layer by hand. Do not set `AWS_LAMBDA_EXEC_WRAPPER`.
- Do not set tracing on the API Gateway stage. An HTTP API has no X-Ray support. The HTTP API forwards `traceparent`. Lambda active tracing starts the X-Ray segment.
- If the browser calls the API on another origin, allow the `traceparent` and `tracestate` request headers and expose the `traceparent` response header in CORS.
- Add an assertion: each Lambda has the ADOT layer and active tracing.
- Rules: `docs/standards/observability.md`, sections 8 and 11.

## Links

- Conventions: `docs/standards/coding-conventions.md`, sections A.15, A.16, D.4.
- Skills: `.claude/skills/new-cdk-construct/SKILL.md`, `.claude/skills/use-platform-resource/SKILL.md`.
- Review template: `docs/templates/REVIEW.infra.md`. ADR: `docs/adr/0006-platform-infra-shared-resources.md`.
