# Commands

Always run Rush through the wrapper. Do not install packages any other way. Python and Go parts use the same commands, through their `_phase:*` scripts.

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
node common/scripts/install-run-rush.js prettier     # alias: rush prettier
node common/scripts/install-run-rush.js audit        # alias: rush audit
node common/scripts/install-run-rush.js license-check
```

Never run `npm install`, `pnpm install`, or `pnpm add`. Use `rush add -p <pkg>`.

## Notes

- Use `rush verify --to <pkg>` to check one package and its dependencies.
- To check only the parts that your branch changes, run `rush build --from git:origin/main`, then `rush verify --impacted-by git:origin/main`. `--impacted-by` selects the changed projects and the projects that depend on them, but not their dependencies. `rush build --from` builds the dependencies too, so they have a `dist/` folder, also on a fresh clone. `scripts/gates/local-gates.sh` and `.github/workflows/ci.yml` use the same two commands.
- `--only <pkg>` also selects no dependencies. Use it only when the dependencies are already built.
- Use the `verify` skill (`.claude/skills/verify/SKILL.md`) before any done claim. Use the `e2e-verify` skill (`.claude/skills/e2e-verify/SKILL.md`) for the running app.
- Setup steps for a new machine are in [onboarding.md](../onboarding.md).
