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
   If the plan changes `platform/infra` or `packages/*`, stop and ask the human before you write code. A new dependency needs no approval when `rush audit` passes (see step 6).
4. If the change is user-visible, put it behind a flag. Define the flag in the project with `defineFlags` from `@vprprudhvi/shared-flags` (`packages/flags/src/flags.ts`).
5. Write a failing test first. Run it: `rush test --only @vprprudhvi/<name>`. Paste the failing output.
6. Write the code. Use the matching skill for the part you change:
   - `new-api-route` for an API route.
   - `new-web-page` for a page.
   - `new-cdk-construct` for an infra construct.
   - `use-platform-resource` when the change reads a platform value.
   - Direct edits for small changes.
     Add a Node dependency with `rush add -p <pkg>` from the project folder. The pre-push hook runs `rush audit` when the lockfile changes. If the audit fails, stop and ask the human. Then stage `package.json` and each file that the command changed under `common/config/rush/`.
     Keep one change per PR.
7. Run the `verify` skill. Fix each failure. Run it again until it passes.
8. If web, api, or infra changed, run the `e2e-verify` skill.
9. Commit before review. Stage explicit paths only: `git add <path> ...`. Never run `git add -A`.
   Run `git commit -m "<type>(<scope>): <summary>"`. Keep the Co-Authored-By trailer that Claude Code adds.
10. Run the `pre-pr` skill. It needs a clean tree, so it runs after step 9. Fix all open Important findings.
11. Run the `pr-description` skill. It pushes, opens the PR, and sets one `risk:*` label (the highest tier that matches a changed path).
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
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`. Use `rush install`. Use `rush add -p` to add a dependency.
- Never run `cdk deploy` or `cdk destroy` (root CLAUDE.md rule 4).
- Use `--no-verify`.
