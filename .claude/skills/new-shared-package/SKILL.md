---
name: new-shared-package
description: Scaffold a project-neutral shared package under packages/<pkg> named @vprprudhvi/shared-<pkg>, built to dist, with tests and a Rush change file. Use when asked to add a shared library, logger, util, or cross-project package. Triggers include new shared package, shared library, add a package under packages, new util package.
---

# new-shared-package

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rules: `packages/*` never import from `projects/*`. Shared packages publish (`shouldPublish: true`). Consumers use the built `dist` output, not `transpilePackages`. Changes to `packages/*` are high risk, so a human reviews them.

## Steps

1. Ask the user what the package does and why it must be shared. Wait for the answer. If only one project needs it, stop. Suggest a project folder instead.
2. Check the name: `ls packages/<pkg> 2>/dev/null` must print nothing.
3. Create the folders: `mkdir -p packages/<pkg>/src packages/<pkg>/test`.
4. Write `packages/<pkg>/package.json`:
   - `name`: `@vprprudhvi/shared-<pkg>`, `version`: `0.0.0`, `type`: `module`.
   - `main`: `dist/index.js`, `types`: `dist/index.d.ts`.
   - `scripts`: `_phase:build`, `_phase:lint`, `_phase:typecheck`, `_phase:test`. The build runs `tsc -b`. The test runs `vitest run --coverage`.
   - No dependencies yet. Add them later with `rush add -p` (step 8).
5. Write `packages/<pkg>/src/index.ts`. This is the one allowed index file, at the package root.
6. Write tests in `test/`. The path mirrors `src/`: `test/<name>.test.ts`. See `docs/standards/testing.md`, section 1.
7. Write the config files and the `rush.json` entry.
   - `rush.json`: add this entry to the `projects` array:
     `{ "packageName": "@vprprudhvi/shared-<pkg>", "projectFolder": "packages/<pkg>", "shouldPublish": true, "tags": ["shared"] }`
   - `packages/<pkg>/tsconfig.json`, `packages/<pkg>/eslint.config.mjs`, `packages/<pkg>/vitest.config.ts`: each one extends the base config in `tooling/`. Read the exact names in `tooling/` first.
8. Then:
   - Run `rush update`.
   - Add each dependency with `rush add -p <pkg> [--dev]` from `packages/<pkg>`. List each new package with its version and license in your report. Never run `npm`, `pnpm` or `yarn` to add a package.
   - Run `rush build --only @vprprudhvi/shared-<pkg>` and paste the output.
   - Run `rush change --bulk --bump-type patch --message "<what changed>"`. Then run `rush change --verify`.
   - Commit `packages/<pkg>/`, `rush.json`, the change file under `common/changes/`, and each file under `common/config/rush/` that `rush update` or `rush add -p` changed (for example `pnpm-lock.yaml` and `repo-state.json`). Put them in one commit. Check with `git status --short`.
   - Run the `verify` skill.

## Done when

- [ ] `packages/<pkg>` has `package.json`, `src/index.ts`, and tests. The package builds to `dist`.
- [ ] `rush.json` has the entry, and the config files exist.
- [ ] The build, the change file, `rush change --verify`, and the `verify` skill pass. Outputs are pasted.

## Do not

- Import from `projects/*` in a package.
- Set `"private": true` in the package. Set `shouldPublish` in rush.json instead.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`.
- Run `cdk deploy` or `cdk destroy`.
- Use `--no-verify`.
