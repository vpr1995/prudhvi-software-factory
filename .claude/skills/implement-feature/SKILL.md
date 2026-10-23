---
name: implement-feature
description: Main flow for building a feature or fix in this monorepo. Reads CLAUDE.md and area REVIEW.md, plans, writes a failing test, writes code, runs verify and e2e-verify, commits, runs pre-pr, then opens the PR. Use when asked to implement, build, add or change a feature, endpoint, page, or infra piece. Triggers include implement, build a feature, add an endpoint, add a page, new feature, make this change.
---

# implement-feature

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

## Steps

1. Read `CLAUDE.md`, root `REVIEW.md`, and `projects/<name>/REVIEW.md` for each project you touch.
2. Create a branch from main: `git checkout -b <type>/<short-kebab>`. Use a type such as `feat`, `fix`, or `chore`. If main has unrelated changes, stop and ask.
3. Write a plan of 5 to 10 lines in chat. List the files, the tests, the flag, and the risk tier guess.
   If the plan changes a gate file, changes `platform/infra` or `packages/*`, or adds a dependency, stop and ask the human before you write code.
4. If the change is user-visible, put it behind a flag. Add the flag name to the typed list in `packages/flags`.
5. Write a failing test first. Run it: `rush test --only @vprprudhvi/<name>`. Paste the failing output.
6. Write the code. Use the matching skill for the part you change:
   - `new-api-route` for an API route.
   - `new-web-page` for a page.
   - `new-cdk-construct` for an infra construct.
   - `use-platform-resource` when the change reads a platform value.
   - Direct edits for small changes.
     A gate file, a lockfile, `go.mod`, or `go.sum` is never a direct edit. Write its new content to `.claude/state/handoff/<change>/` instead. Write a package manager command to a `NN-commands.txt` file there. See `docs/standards/gates.md`, section 2.4.
     Keep one change per PR. The soft limit is 400 changed lines.
7. Run the `verify` skill. Fix each failure. Run it again until it passes.
8. If web, api, or infra changed, run the `e2e-verify` skill.
9. Commit before review. Stage explicit paths only: `git add <path> ...`. Never run `git add -A`.
   Run `git commit -m "<type>(<scope>): <summary>"`. Keep the Co-Authored-By trailer that Claude Code adds.
10. Run the `pre-pr` skill. It needs a clean tree, so it runs after step 9. Fix all open Important findings.
11. Run the `pr-description` skill. It pushes and opens the PR. If the push is blocked because the range has gate changes, a human pushes the branch. Report that and stop.
12. Report. Give the branch name, the commit SHA, the PR URL, the verify result, and the number of pre-pr rounds used.

## Done when

- [ ] The failing test output and the passing test output are both pasted.
- [ ] The `verify` output shows pass.
- [ ] The work is committed, and `pre-pr` ended with no open Important finding, or the human was asked.
- [ ] The PR URL is shown.

## Do not

- Stage everything with `git add -A` or `git add .`.
- Commit on `main`.
- Open a PR while verify fails.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`. Use `rush install`, or `rush add` after approval.
- Run `cdk deploy`.
- Use `--no-verify`.
