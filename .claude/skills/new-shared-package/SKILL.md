---
name: new-shared-package
description: Scaffold a project-neutral shared package under packages/<pkg> named @vprprudhvi/shared-<pkg>, built to dist, with tests and a Rush change file. Writes non-gate files directly and writes gate-file contents to a handoff folder for a human. Use when asked to add a shared library, logger, util, or cross-project package. Triggers include new shared package, shared library, add a package under packages, new util package.
---

# new-shared-package

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rules: `packages/*` never import from `projects/*`. Shared packages publish (`shouldPublish: true`). Consumers use the built `dist` output, not `transpilePackages`. Changes to `packages/*` are high risk, so a human reviews them.

## Steps

1. Ask the user what the package does and why it must be shared. Wait for the answer. If only one project needs it, stop. Suggest a project folder instead.
2. Check the name: `ls packages/<pkg> 2>/dev/null` must print nothing.
3. Create the folders: `mkdir -p packages/<pkg>/src`.
4. Write `packages/<pkg>/package.json` (not a gate file):
   - `name`: `@vprprudhvi/shared-<pkg>`, `version`: `0.0.0`, `type`: `module`.
   - `main`: `dist/index.js`, `types`: `dist/index.d.ts`.
   - `scripts`: `_phase:build`, `_phase:lint`, `_phase:typecheck`, `_phase:test`. The build runs `tsc -b`. The test runs `vitest run --coverage`.
   - No dependencies yet. Add them later with `rush add`.
5. Write `packages/<pkg>/src/index.ts`. This is the one allowed index file, at the package root.
6. Write tests next to the source: `src/<name>.test.ts`.
7. Write the gate files to the handoff folder `.claude/state/handoff/<pkg>/`. Use the `.txt` suffix on each file. Name each file `NN-<target path with / replaced by __>.txt`. The first line of each file is `TARGET: <path>`.
   - `01-rush-json-entry.txt`: this entry, to add in the `projects` array of `rush.json`:
     `{ "packageName": "@vprprudhvi/shared-<pkg>", "projectFolder": "packages/<pkg>", "shouldPublish": true, "tags": ["shared"] }`
   - `02-...`: `packages/<pkg>/tsconfig.json`, `packages/<pkg>/eslint.config.mjs`, and `packages/<pkg>/vitest.config.ts`. Each one extends the base config in `tooling/`. Read the exact names in `tooling/` first.
8. Stop. Tell the human: "Copy each handoff file to its TARGET path. Add the rush.json entry. Reply 'gates applied' and approve any new dependency."
9. After the human replies, check that the files exist. Then:
   - Add each dependency with `rush add -p <pkg>` from `packages/<pkg>`. Show the list of new dependencies and their licenses first. Wait for approval.
   - Run `rush build --only @vprprudhvi/shared-<pkg>` and paste the output.
   - Run `rush change --bulk --bump-type patch --message "<what changed>"`. Then run `rush change --verify`.
   - Run the `verify` skill.

## Done when

- [ ] `packages/<pkg>` has `package.json`, `src/index.ts`, and tests. The package builds to `dist`.
- [ ] The handoff folder has the rush.json entry and each gate-file copy.
- [ ] After approval: the build, the change file, `rush change --verify`, and the `verify` skill pass. Outputs are pasted.

## Do not

- Import from `projects/*` in a package.
- Set `"private": true` in the package. Set `shouldPublish` in rush.json instead.
- Write gate files to their real paths. Write them to the handoff folder only.
- Add a dependency without human approval.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`.
- Run `cdk deploy` or `cdk destroy`.
- Use `--no-verify`.
