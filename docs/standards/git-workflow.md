# Git workflow

This document sets the rules for branches, commits, hooks, and pull requests.

## 1. Branches

- The default branch is `main`.
- Do not commit to `main`. Create a branch.
- Branch names use this format: `<type>/<short-kebab>`.
- The `<type>` is one of the types in section 2.
- The `<short-kebab>` part uses lowercase words and hyphens. Keep it short.

| Good                  | Bad                   | Why                                  |
| --------------------- | --------------------- | ------------------------------------ |
| `feat/order-export`   | `Feature/OrderExport` | Use a type and lowercase kebab-case. |
| `fix/null-user-email` | `fix_user`            | Use hyphens, not underscores.        |
| `chore/bump-rush`     | `my-branch`           | The branch needs a type.             |

## 2. Commit messages

Commit messages use Conventional Commits. The `commit-msg` hook runs commitlint.

Format:

```
<type>(<scope>): <short summary>

<optional body: why the change is needed>

<optional footer>
```

Allowed types:

| Type       | Use for                                |
| ---------- | -------------------------------------- |
| `feat`     | A new behavior.                        |
| `fix`      | A bug fix.                             |
| `docs`     | Documentation only.                    |
| `refactor` | A code change with no behavior change. |
| `perf`     | A performance change.                  |
| `test`     | Tests only.                            |
| `build`    | Build or dependency change.            |
| `ci`       | CI workflow change.                    |
| `chore`    | Other maintenance.                     |
| `revert`   | Reverts an earlier commit.             |

The scope is the Rush project name or the project name. Examples: `sample`, `cdk-constructs`, `shared-logger`.

Good:

```
feat(sample): add order export route

Users need a CSV export for their orders. The route sits behind the orders-export flag.
```

Bad:

```
update stuff
```

The `Co-Authored-By` footer stays in the message. Do not remove it.

## 3. Git hooks

Git hooks install on `rush install`. Each hook runs a script or a Rush command.

| Hook                          | Runs                                                                                                         | Blocks when                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `pre-commit`                  | gitleaks on staged files, then lint-staged: Prettier and ESLint on staged files                              | Any step fails.              |
| `prepare-commit-msg`          | Adds the branch ticket ID to the message, if one exists.                                                     | Never blocks.                |
| `commit-msg`                  | commitlint with the type list and scope rule                                                                 | The message format is wrong. |
| `pre-push`                    | `rush audit`, only when `common/config/rush/pnpm-lock.yaml` changed since `origin/main`. Otherwise it skips. | The audit fails.             |
| `post-checkout`, `post-merge` | Prints `run rush install` when the lockfile changed.                                                         | Never blocks.                |

Hooks install only on `rush install`. If a hook is missing, run `node common/scripts/install-run-rush.js install`.

Hooks come from `common/git-hooks/`.

## 4. Bypass rules

- Do not use `--no-verify`. This includes `git commit -n`.
- Do not use `git push --force` or `git push --force-with-lease`.
- A hook failure is a signal. Fix the cause and run the command again.

## 5. Commits in a pull request

- Each PR changes one thing.
- Keep each commit small and complete. Each commit must pass the checks.
- Do not rewrite the history of a PR after review starts. Add a new commit.
- Choose the merge method when the PR is ready to merge.

## 6. Pull requests

- Use `.github/pull_request_template.md`.
- Fill in each section. Paste the real command output in the Testing section.
- Set the risk tier. See `docs/standards/risk-tiers.md`.
- Write the revert steps. See `docs/runbooks/rollback.md`.
- Name the feature flag. Write `none` if the change has no new behavior.
- Link the issue.

## 7. Merge

- The `main` ruleset requires a pull request, the checks `ci-result` and `gitleaks` (see [testing.md](testing.md) section 6), and an up-to-date branch. It blocks deletion and force push.
- The ruleset requires 0 approvals. It has no code-owner rule, no review-thread rule, no linear-history rule, and no merge queue.
- Merge, squash, and rebase are all allowed.
- The owner reviews and merges each PR. This is a convention. See `docs/standards/risk-tiers.md`.

## 8. Protected operations

These operations are blocked for agents. A human does them.

| Operation                           | Why                          |
| ----------------------------------- | ---------------------------- |
| Force push to any branch            | Rewrites shared history.     |
| Delete `main` or a protected branch | Removes the release history. |
| `git reset --hard` on `main`        | Loses local work.            |
| Merge a PR with failing checks      | Breaks the merge rule.       |
| Change a branch ruleset             | Changes the merge rule.      |
