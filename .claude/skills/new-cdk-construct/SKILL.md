---
name: new-cdk-construct
description: Add an AWS CDK construct to a project CDK app (projects/<name>/bin and lib), Lambda-first, with PascalCase IDs, no physical names, least-privilege grants, platform values read through SSM, cdk-nag AwsSolutions checks, Template.fromStack assertions and a snapshot. Use when asked to add infra, a CDK construct, an API Lambda, a web site, a Cognito app client, a domain, a bucket, queue, table, or stack resource. Platform and shared constructs need a human. Triggers include new construct, add infra, CDK, add a bucket, add a queue, add a table, stack, lambda, api gateway, cognito client.
---

# new-cdk-construct

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rules:
- Project constructs live in `projects/<name>/lib/constructs/<kebab>.ts`.
- The CDK app (`bin/`, `lib/`) uses the one project `package.json`. CDK bundles Lambda code at synth: `NodejsFunction` for TypeScript, `Code.fromAsset` with local bundling for Go (`go build`, `linux/arm64`) and Python (`uv`), Docker as fallback, local bundling for the OpenNext web build. Unit tests turn bundling off. Region is `us-east-1` only. See `docs/guides/infra.md`.
- Shared constructs go to `packages/cdk-constructs` (`@vprprudhvi/shared-cdk-constructs`). That needs a human.
- Platform constructs live in `platform/infra`. Only a human changes them.
- Compute is Lambda-first. API = Fastify on Lambda (`@fastify/aws-lambda`) behind an API Gateway HTTP API. Web = Next.js via OpenNext (CloudFront, S3, Lambda). Ask the human before any container or instance compute.
- Projects never import code from `platform/infra`. Platform values come from SSM through the helper in `shared-cdk-constructs`. See `use-platform-resource`.

## Steps

1. Read `projects/<name>/lib/constructs/` and `lib/stacks/`. Copy the existing style.
2. Decide the location. If another project would use it, or it belongs to the platform, stop and ask the human.
3. Write the props type with `type`, not `interface`. Mark each field `readonly`.
4. Write the construct class in PascalCase. Use PascalCase construct IDs: `new Bucket(this, 'AssetsBucket', ...)`.
5. Do not set physical names: no `bucketName`, `functionName`, `tableName`, `queueName`, `roleName`, or `userPoolName`. Let CDK generate them.
6. Set the defaults:
   - Stateful resources: encryption at rest, and `removalPolicy: RETAIN`. Use `DESTROY` only when `config/dev.ts` sets it, and never in prod.
   - Buckets: block public access. Web buckets use CloudFront Origin Access Control only.
   - Lambda: explicit timeout and memory, log group with retention, active tracing. Use the shared Lambda construct from `@vprprudhvi/shared-cdk-constructs`. It adds the ADOT collector-only layer and sets `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_PROPAGATORS`, `OTEL_TRACES_SAMPLER`, and `OTEL_TRACES_SAMPLER_ARG`. Do not add the layer by hand. Do not set `AWS_LAMBDA_EXEC_WRAPPER`. If the shared construct does not offer them, stop and ask the human. See `docs/standards/observability.md`, section 8. Runtime from the build output: Node for TypeScript, `PROVIDED_AL2023` with a `bootstrap` binary for Go, the current Python runtime for Python.
   - API Gateway HTTP API: a JWT authorizer on the Cognito pool for every route that needs a user. Any route without an authorizer needs a written reason in the test.
   - API Gateway HTTP API: no stage tracing. An HTTP API has no X-Ray support. It forwards `traceparent`. Lambda active tracing starts the X-Ray segment.
   - Cognito app client: one per project. Browser clients do not generate a secret.
   - Grant access with `grantRead`, `grantWrite`, or similar. Do not write `*` in actions or resources.
7. Read the env from `projects/<name>/lib/config/<env>.ts`. Never hard-code an account, region, pool ID, zone ID, or certificate ARN.
8. Write the test at `projects/<name>/test/infra/constructs/<kebab>.test.ts`. The path mirrors `lib/constructs/<kebab>.ts`. See `docs/standards/testing.md`, section 1:
   - Create a stack: `new Stack(new App())`. cdk-nag 3 has no aspect. Run `new AwsSolutionsChecks().validateScope(stack)` and read `report.violations`.
   - Use `Template.fromStack(stack)` to assert resources, encryption, removal policy, runtime, log retention, and grants.
   - Assert that each Lambda has the ADOT layer and `TracingConfig` mode `Active`.
   - Assert that `report.violations` is empty. An `Annotations` check does not see cdk-nag 3 findings.
   - Add a snapshot: `expect(template.toJSON()).toMatchSnapshot()`.
9. Run `rush test --to @vprprudhvi/<name>` and paste the output. If the snapshot changes, read the diff. Update it only when the change is intended.
10. Run `cd projects/<name> && npx cdk synth --quiet`. It must show zero nag errors.
11. Run the `verify` skill.

## Done when

- [ ] PascalCase construct IDs. No physical names. No account, pool, zone, or certificate values in code.
- [ ] Lambda runtime, log retention, and tracing are set. Encryption and removal policy are set on stateful resources.
- [ ] `Template.fromStack` assertions and the snapshot pass. The output is pasted.
- [ ] `cdk synth` shows zero cdk-nag errors.
- [ ] The `verify` skill passes.
- [ ] Each Lambda has the ADOT layer and active tracing, and a test asserts it.

## Do not

- Add a cdk-nag acknowledgment (`Validations.of(construct).acknowledge({ id, reason })`) outside the one acknowledgments file of the stack (`lib/nag-acknowledgments/<stack>.ts`). Each acknowledgment needs a reason, and the owner approves it. A shared construct in `packages/cdk-constructs` can hold an acknowledgment only with an owner approval in the commit.
- Set `RemovalPolicy.DESTROY` on a stateful resource outside dev.
- Write `*` in IAM actions or resources.
- Import code from `platform/infra`, or use a CloudFormation cross-stack reference to a platform stack.
- Create a user pool, hosted zone, or wildcard certificate in a project.
- Update a snapshot only to make a test pass.
- Edit `packages/cdk-constructs` or `platform/infra` without a human.
- Run `cdk deploy` or `cdk destroy`. Run only `cdk synth` and read-only commands.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Write a gate file in place, such as `**/cdk.json` or a lockfile. Write it to `.claude/state/handoff/<name>/` (`docs/standards/gates.md`, section 2.4).
- Run `npm install` or `pnpm install`.
- Use `--no-verify`.
