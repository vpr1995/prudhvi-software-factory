Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `packages/*`.

## What this area is

- `packages/*` holds shared code with no project logic. Package names: `@vprprudhvi/shared-<pkg>`.
- Planned packages: `flags`, `logger`, `result`, `cdk-constructs`, `telemetry`. None exists yet. The `packages/` folder holds only this file.
- If a step needs a package that does not exist, do not create a stub or a fake. Skip that step. Name it in the PR and in your final message. For telemetry, see [observability.md](../docs/standards/observability.md), section 2.
- Consumers use the built `dist` output. Do not use `transpilePackages`.

## Risk

- Every change under `packages/**` is `risk:high`. A human approves each change.
- A change here has a wide effect. List the consumers in the PR. Check each one.

## Rules

- `packages/*` never imports from `projects/*`.
- A package serves at least two projects. If only one project needs it, put the code in that project.
- Each package has one `index.ts` at the package root. No other barrel files.
- Each package builds to `dist` with `tsc -b`. `main` is `dist/index.js` and `types` is `dist/index.d.ts`.
- Each package has unit tests in `test/` at the package root. The path under `test/` mirrors `src/`. Coverage gates apply. See [testing.md](../docs/standards/testing.md), section 1.
- Shared packages publish (`shouldPublish: true` in `rush.json`). Do not set `"private": true`.
- Each change needs a Rush change file. Run `rush change --bulk --bump-type patch --message "<what changed>"`. Then run `rush change --verify`.
- Only `packages/telemetry` (planned) imports the OpenTelemetry SDK. Only `packages/logger` (planned) configures the logger. See [observability.md](../docs/standards/observability.md).
- Add a dependency with `rush add -p <pkg>` and only after the human approves.

## How to add a package

- Use the [new-shared-package](../.claude/skills/new-shared-package/SKILL.md) skill. It writes gate files to a handoff folder for a human.

## Links

- [ADR 0003](../docs/adr/0003-shared-packages-built-to-dist.md)
- [coding-conventions.md](../docs/standards/coding-conventions.md)
- [risk-tiers.md](../docs/standards/risk-tiers.md)
- [infra guide](../docs/guides/infra.md)
