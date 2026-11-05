Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `packages/*`.

## What this area is

- `packages/*` holds shared code with no project logic. Package names: `@vprprudhvi/shared-<pkg>`.
- Packages: `cdk-constructs`, `flags`, `logger`, `result`, `telemetry`. No project imports `shared-flags` yet.
- Consumers use the built `dist` output. Do not use `transpilePackages`.

## Risk

- Every change under `packages/**` is `risk:high`. The owner reviews each change (CODEOWNERS).
- A change here has a wide effect. List the consumers in the PR. Check each one.

## Rules

- `packages/*` never imports from `projects/*`.
- A package serves at least two projects. If only one project needs it, put the code in that project.
- Each package has one `src/index.ts`. No other barrel files.
- Each package builds to `dist` with `tsc -p tsconfig.build.json`. `main` is `dist/index.js` and `types` is `dist/index.d.ts`.
- Each package has unit tests in `test/` at the package root. The path under `test/` mirrors `src/`. See [testing.md](../docs/standards/testing.md), section 1.
- Shared packages publish (`shouldPublish: true` in `rush.json`). Do not set `"private": true`.
- Each change needs a Rush change file. Run `rush change --bulk --bump-type patch --message "<what changed>"`. Then run `rush change --verify` by hand. CI does not run it.
- Only `packages/telemetry` imports the OpenTelemetry SDK. Only `packages/logger` configures the logger. See [observability.md](../docs/standards/observability.md).
- Add a dependency with `rush add -p <pkg>` from the package folder. No approval is needed when `rush audit` passes. If the audit fails, stop and ask the human.

## How to add a package

- Use the [scaffold](../.claude/skills/scaffold/SKILL.md) skill. It runs `rush new --library <pkg>`. The owner reviews the PR.

## Links

- [ADR 0003](../docs/adr/0003-shared-packages-built-to-dist.md)
- [coding-conventions.md](../docs/standards/coding-conventions.md)
- [risk-tiers.md](../docs/standards/risk-tiers.md)
- [infra guide](../docs/guides/infra.md)
