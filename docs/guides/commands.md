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
node tooling/tsconfig/scripts/check-tsconfigs.mjs     # tsconfig rules (CI runs it)
node scripts/security/install-tools.mjs              # pinned gitleaks, actionlint, zizmor, pinact (rush install runs it)
bash scripts/security/workflow-lint.sh               # actionlint, zizmor, pinact on .github (hook and CI run it)
```

Never run `npm install`, `pnpm install`, or `pnpm add`. Use `rush add -p <pkg>`.

## Notes

- Use `rush verify --to <pkg>` to check one package and its dependencies.
- `rush new --library <name>` makes a shared library from `tooling/templates/library`. It adds the `rush.json` entry and a change file, then runs `rush update`. On a bad name, it stops and writes nothing.
- `rush new --project <name>` makes a bare project from `tooling/templates/project`: the five phases, config and one test, with no parts. It adds the `rush.json` entry (no change file), then runs `rush update`.
- `rush add-part --project <name> --part <node|web|infra>` adds one part from `tooling/templates/parts/<part>` to a project that `rush new --project` made. It adds the part scripts and dependencies (versions from `projects/sample/package.json`), then runs `rush update`. It stops and writes nothing when the part exists, the project is missing, or the name is not valid.
- To check only the parts that your branch changes, run `rush build --from git:origin/main`, then `rush verify --impacted-by git:origin/main`. `--impacted-by` selects the changed projects and the projects that depend on them, but not their dependencies. `rush build --from` builds the dependencies too, so they have a `dist/` folder, also on a fresh clone.
- To run the CI checks for one project, run `rush build --to <pkg>`, then `rush lint --only <pkg>`, `rush typecheck --only <pkg>`, `rush test --only <pkg>` and `rush e2e --only <pkg>`. `.github/workflows/ci.yml` runs these commands, one job for each impacted project. `.github/workflows/warm-cache.yml` runs `rush build` for all projects on each push to `main`, so pull requests restore a full Rush build cache.
- `--only <pkg>` also selects no dependencies. Use it only when the dependencies are already built.
- Use the `verify` skill (`.claude/skills/verify/SKILL.md`) before any done claim. Use the `e2e-verify` skill (`.claude/skills/e2e-verify/SKILL.md`) for the running app.
- Setup steps for a new machine are in [onboarding.md](../onboarding.md).
