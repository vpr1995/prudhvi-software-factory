---
name: new-shared-package
description: Scaffold a project-neutral shared package under packages/<pkg> named @vprprudhvi/shared-<pkg>, built to dist, with tests and a Rush change file. Use when asked to add a shared library, logger, util, or cross-project package. Triggers include new shared package, shared library, add a package under packages, new util package.
---

# new-shared-package

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rules: `packages/*` never import from `projects/*`. Shared packages publish (`shouldPublish: true`). Consumers use the built `dist` output, not `transpilePackages`. Changes to `packages/*` are high risk, so a human reviews them.

## Steps

1. Ask the user what the package does and why it must be shared. Wait for the answer. If only one project needs it, stop. Suggest a project folder instead.
2. Run `rush new --library <pkg>`. `<pkg>` is kebab-case. The script:
   - checks the name, `rush.json` and the folder. On a problem, it stops, writes nothing and prints the reason.
   - copies `tooling/templates/library` to `packages/<pkg>` (package.json, tsconfig files, eslint, vitest, `config/rush-project.json`, `src/index.ts`, `test/index.test.ts`, README).
   - takes the dependency versions from `packages/result/package.json`.
   - adds the `rush.json` entry (`shouldPublish: true`, tag `shared`) and a change file under `common/changes/@vprprudhvi/shared-<pkg>/`.
   - runs `rush update` and prints the next steps.
3. Write the code in `src/`. Export the public API from `src/index.ts` only. Replace the sample function.
4. Write tests in `test/`. The path mirrors `src/`: `test/<name>.test.ts`. See `docs/standards/testing.md`, section 1.
5. Edit the description in `package.json` and `README.md`. Edit the comment in the change file.
6. Then:
   - Add each dependency with `rush add -p <pkg> [--dev]` from `packages/<pkg>`. List each new package with its version and license in your report. Never run `npm`, `pnpm` or `yarn` to add a package.
   - Run `rush build --only @vprprudhvi/shared-<pkg>` and paste the output.
   - Commit `packages/<pkg>/`, `rush.json`, the change file under `common/changes/`, and each file under `common/config/rush/` that `rush update` or `rush add -p` changed (for example `pnpm-lock.yaml` and `repo-state.json`). Put them in one commit. Check with `git status --short`.
   - Run `rush change --verify`. It reads only committed change files, so run it after the commit.
   - Run the `verify` skill.

## Done when

- [ ] `packages/<pkg>` has `package.json`, `src/index.ts`, and tests. The package builds to `dist`.
- [ ] `rush new --library <pkg>` made the package. `rush.json` has the entry.
- [ ] The build, the change file, `rush change --verify`, and the `verify` skill pass. Outputs are pasted.

## Do not

- Import from `projects/*` in a package.
- Set `"private": true` in the package. Set `shouldPublish` in rush.json instead.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`.
- Run `cdk deploy` or `cdk destroy`.
- Use `--no-verify`.
