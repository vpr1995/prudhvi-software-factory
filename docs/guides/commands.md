# Commands

Always run Rush through the wrapper. Do not install packages any other way.

```
node common/scripts/install-run-rush.js install      # alias: rush install
node common/scripts/install-run-rush.js build        # alias: rush build
node common/scripts/install-run-rush.js lint         # alias: rush lint
node common/scripts/install-run-rush.js typecheck    # alias: rush typecheck
node common/scripts/install-run-rush.js test         # alias: rush test
node common/scripts/install-run-rush.js verify       # alias: rush verify (runs build, lint, typecheck, test, e2e)
node common/scripts/install-run-rush.js e2e          # alias: rush e2e (Bruno and Playwright)
node common/scripts/install-run-rush.js verify --to <pkg>
node common/scripts/install-run-rush.js build --from git:origin/main
node common/scripts/install-run-rush.js verify --impacted-by git:origin/main
node common/scripts/install-run-rush.js add -p <pkg> # alias: rush add -p <pkg>
node common/scripts/install-run-rush.js new --library <name> # alias: rush new; makes packages/<name>
node common/scripts/install-run-rush.js new --project <name> # makes a bare projects/<name>
node common/scripts/install-run-rush.js add-part --project <name> --part <node|web|infra> # alias: rush add-part
node common/scripts/install-run-rush.js prettier     # alias: rush prettier
node common/scripts/install-run-rush.js audit        # alias: rush audit
node common/scripts/install-run-rush.js license-check
node common/scripts/install-run-rush.js knip         # alias: rush knip (unused files, exports, dependencies; config: knip.jsonc)
node tooling/tsconfig/scripts/check-tsconfigs.mjs     # tsconfig rules (CI runs it)
node tooling/repo-checks/scripts/doc-lint.mjs         # doc lint: links, repo paths and Rush commands in *.md (CI runs it)
node tooling/repo-checks/scripts/test-guard.mjs "$(git merge-base main HEAD)" # test guard: weakened tests or checks in the diff (CI runs it)
node scripts/security/install-tools.mjs              # pinned gitleaks, actionlint, zizmor, pinact (rush install runs it)
bash scripts/security/workflow-lint.sh               # actionlint, zizmor, pinact on .github (hook and CI run it)
node tooling/vitest-config/dist/diff-coverage.js <base-sha> <project-path> < <project-path>/coverage/lcov.info # coverage on changed lines (CI runs it)
```

Never run `npm install`, `pnpm install`, or `pnpm add`. Use `rush add -p <pkg>` in the folder of the project.

## Notes

- Use `rush verify --to <pkg>` to check one package and its dependencies.
- `rush new --library <name>` makes a shared library from `tooling/templates/library`. It adds the `rush.json` entry and a change file, then runs `rush update`. On a bad name, it stops and writes nothing.
- `rush new --project <name>` makes a bare project from `tooling/templates/project`: the five phases, config and one test, with no parts. It adds the `rush.json` entry (no change file), then runs `rush update`.
- `rush add-part --project <name> --part <node|web|infra>` adds one part from `tooling/templates/parts/<part>` to a project that `rush new --project` made. It adds the part scripts and dependencies (versions from `projects/sample/package.json`), then runs `rush update`. It stops and writes nothing when the part exists, the project is missing, or the name is not valid.
- To check only the parts that your branch changes, run `rush build --from git:origin/main`, then `rush verify --impacted-by git:origin/main`. `--impacted-by` selects the changed projects and the projects that depend on them, but not their dependencies. `rush build --from` builds the dependencies too, so they have a `dist/` folder, also on a fresh clone.
- To run the CI checks for one project, run `rush build --to <pkg>`, then `rush lint --only <pkg>`, `rush typecheck --only <pkg>`, `rush test --only <pkg>` and `rush e2e --only <pkg>`. `.github/workflows/ci.yml` runs these commands, one job for each impacted project. `.github/workflows/warm-cache.yml` runs `rush build` for all projects on each push to `main`, so pull requests restore a full Rush build cache.
- `rush knip` runs Knip on the whole repo. It needs `tooling/vitest-config/dist`, so run `rush build --to @vprprudhvi/tooling-vitest-config` first on a fresh clone. Exit code 0 is clean, 1 is findings, 2 is an error. Fix a finding in the code. Each ignore in `knip.jsonc` needs a reason comment and a human review.
- `--only <pkg>` also selects no dependencies. Use it only when the dependencies are already built.
- Coverage on changed lines: run the tests of the project with coverage first. Exit code 0 is pass, 1 is below 80% (the lines threshold), 2 is a usage or git error. See [testing.md](../standards/testing.md) (section 2.1).
- Lint on edit (Claude Code): `.claude/settings.json` has a `PostToolUse` hook for `Edit`, `Write` and `MultiEdit`. It runs `tooling/eslint-config/scripts/lint-on-edit.mjs`. For a `.ts`, `.tsx`, `.js`, `.mjs` or `.cjs` file in a Rush project, the script runs ESLint on the file and `tsc --noEmit` on the nearest `tsconfig.json`. It skips `dist`, `.next`, `node_modules`, `coverage` and `cdk.out`. It never blocks the edit. It gives the findings to the agent as context. With no findings, it gives nothing. Each tool has a 30 s limit.
- Doc lint checks each tracked `*.md` file. It skips `docs/adr/`, `evals/reviewer/cases/`, `common/`, `CHANGELOG.md` files, and each design in `docs/designs/` without `status: implemented`. A design with no `status` is a finding. It fails when a relative link, a repo path in inline code, or a `rush <cmd>` names something that does not exist. It skips paths in fenced code blocks and paths with a placeholder (`<`, `>`, `*`, `{`, `}`, `$`, `...`, or a space). To skip one line, put `<!-- doc-lint-ignore-next-line -->` on the line above it.
- The test guard checks the committed diff from the merge base to `HEAD`. It does not check uncommitted changes. It reads the base SHA from the first argument or from `BASE_SHA`, and the PR labels from `PR_LABELS` (a JSON array). A finding is one of these:
  - A deleted test file: `*.test.*`, `*.spec.*`, or a Bruno request. A rename is not a deletion.
  - Fewer `it(`, `test(`, `it.each` or `test.each` calls in a test file.
  - An added `.skip`, `.only`, `.todo`, `.fixme`, `xit(` or `xdescribe(` in a test file.
  - An added `eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck` in any file.
  - A lowered, removed or changed threshold in `tooling/vitest-config/src/config.ts` or `tooling/vitest-config/src/diff-coverage.ts`.
  - A changed check config: `eslint.config.*`, `vitest.config.*`, `playwright.config.*` (a new file is not a finding), `knip.jsonc`, `.lintstagedrc.cjs`, `commitlint.config.cjs`, `audit-ci.jsonc`, `tooling/tsconfig/*.json`, and each file in `tooling/eslint-config/`, `tooling/vitest-config/`, `tooling/repo-checks/`, `.github/workflows/` and `.github/actions/`.
- The content rules skip Markdown files, `test/fixtures/` folders and `tooling/repo-checks/`. With the `risk:high` label, each finding is a warning and the exit code is 0. Without it, a finding gives exit code 1. A usage error or a bad `PR_LABELS` value gives exit code 2.
- Use the `verify` skill (`.claude/skills/verify/SKILL.md`) before any done claim. Use the `e2e-verify` skill (`.claude/skills/e2e-verify/SKILL.md`) for the running app.
- Setup steps for a new machine are in [onboarding.md](../onboarding.md).
