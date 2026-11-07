Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `tooling/**`.

## Scope

- `tooling/**` holds the shared config for ESLint, TypeScript, and Vitest. It also holds the license allowlist and the repo-wide CI checks (`repo-checks/`).
- This is a high-risk area. A human reviews each change. Agents can edit it.

## When a rule blocks you

1. Read the message. Find the rule and the file.
2. Fix the cause in your code. Do not weaken the rule.
3. If the rule is wrong, stop. Tell the human what is wrong and why.

## How to change a rule

1. Give the reason. Give one example that the rule gets wrong.
2. Put the change in its own PR. A human reviews it.
3. Never lower a threshold. Never add an allowlist entry. Never add a disable comment to pass a check.

## What lives here

- `eslint-config/`: flat config, boundaries, naming, `no-console`, restricted imports. `tooling/eslint-config/scripts/lint-on-edit.mjs` is the PostToolUse hook that runs ESLint and tsc for an edited file.
- `tsconfig/`: presets `base`, `node`, `library` and `web`. They hold all strictness. `tooling/tsconfig/scripts/check-tsconfigs.mjs` checks each tsconfig in the repo. See [coding-conventions.md](../docs/standards/coding-conventions.md) (B.18).
- `vitest-config/`: shared config and coverage thresholds (lines 80, branches 75, functions 80, statements 80). `createVitestConfig` is for packages. `createAppVitestConfig` is for CDK app projects (options: `web`, `testTimeout`, `alias`, `coverageExclude`).
- `templates/`: file templates (`*.tmpl`) and the scaffolder behind `rush new` and `rush add-part`. `library/` is the template for `rush new --library`, `project/` for `rush new --project`, and `parts/<part>/` for `rush add-part`.
- `repo-checks/`: repo-wide CI checks with Node built-ins only. `tooling/repo-checks/scripts/doc-lint.mjs` checks links, repo paths and Rush commands in each doc. `tooling/repo-checks/scripts/deploy-check.mjs` checks `factory.deploy` in each `projects/*/package.json` and the hostnames in `wrangler.jsonc`. It reads `route` and `routes` at the top level and in each `env.<name>`. Each route entry must be a `custom_domain` entry with no `zone_name` and no `zone_id`. CI runs it from the base commit. `tooling/repo-checks/scripts/deploy-plan.mjs` reads the output of `rush list --json` on stdin and lists the changed projects that deploy to `cloudflare` and to `aws`. A `cloudflare` project needs `wrangler` as a dependency (`deploy-check`), a `deploy:cloudflare` script, a `smoke` script, `assets.directory` in its folder, and a top-level `custom_domain` hostname. `deploy.yml` runs it. `tooling/repo-checks/scripts/deploy-revert.mjs` decides, from the jobs of a deploy run, whether a failed smoke test needs a revert PR (never for a revert), and writes the title and body of the PR. The `revert` job of `deploy.yml` runs it. `tooling/repo-checks/scripts/test-guard.mjs` fails a PR that weakens tests or checks, unless the PR has the `risk:high` label. `tooling/repo-checks/scripts/stop-gate.mjs` is the verify gate hook for Claude Code (Stop, SubagentStop, PreToolUse, PostToolUse and PostToolUseFailure). With the argument `commit`, it is the commit gate: a PreToolUse hook that denies `git commit` with no typecheck proof for the staged content. See [commands.md](../docs/guides/commands.md).
- `license-allowlist.json`: allowed licenses.

## Links

- [security.md](../docs/standards/security.md)
- [testing.md](../docs/standards/testing.md)
- [coding-conventions.md](../docs/standards/coding-conventions.md)
