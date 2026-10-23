# Onboarding

This document gives the steps to set up a local copy of the repository. It also explains how agents work in this repository.

## 1. Requirements

- Git.
- Node 24. The exact version is in `.nvmrc`. Use nvm, fnm, or nvs to switch to it.
- Do not install pnpm globally. Rush installs the pnpm version it needs.
- Only if you work on a Python or Go backend: uv, Go 1.25 or later, and golangci-lint. See section 3.1.

## 2. Set up the repository

1. Clone the repository.
2. Change to the repository folder.
3. Switch to the Node version in `.nvmrc`. Example with nvm: `nvm use`.
4. Run the install command:

   ```
   node common/scripts/install-run-rush.js install
   ```

   This command installs packages from the lockfile. It also installs the git hooks in `.git/hooks`.

5. Run the full check. Keep the output:

   ```
   node common/scripts/install-run-rush.js verify
   ```

Git hooks install only when you run `rush install`. If a hook is missing, run the install command again. The `post-checkout` and `post-merge` hooks print a message when the lockfile changes. Run the install command when you see that message.

## 3. Install the security tools

The hooks call these tools. Install them on your `PATH`:

| Tool        | Used by                     | How to install                         |
| ----------- | --------------------------- | -------------------------------------- |
| gitleaks    | pre-commit, Stop hook       | `brew install gitleaks`                |
| Opengrep    | pre-push, Stop hook         | Download from its GitHub release page. |
| Checkov     | pre-push when infra changed | `pip install checkov`                  |
| osv-scanner | Dependency checks           | `brew install osv-scanner`             |

Check each tool with its version flag, for example `gitleaks version`. Use the versions that the team pins. CI runs the same checks, so a missing tool does not change the CI result. It does block the local hook.

### 3.1 Python and Go tools

Install these only if you work on `api-py` or `api-go`.

| Tool                  | Used for                                                              | How to install                                                                                |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| uv                    | Python packages from `uv.lock`, ruff, mypy, pytest, bandit, pip-audit | `brew install uv`                                                                             |
| Go 1.25 or later      | Go build, test, and module checks                                     | `brew install go`                                                                             |
| golangci-lint         | Go lint (gosec, errcheck, revive, and others)                         | `brew install golangci-lint`                                                                  |
| gofumpt and goimports | Go format                                                             | `go install mvdan.cc/gofumpt@latest` and `go install golang.org/x/tools/cmd/goimports@latest` |
| govulncheck           | Go vulnerability check                                                | `go install golang.org/x/vuln/cmd/govulncheck@latest`                                         |
| go-licenses           | Go license check                                                      | See its GitHub page.                                                                          |

Python tools come from `uv.lock`. Do not install ruff, mypy, pytest, or bandit globally. Run them through `uv run` or `rush`.

### 3.2 API requests and browser tests

- The Bruno CLI (`@usebruno/cli`) comes from the repository. Do not install it globally. The `e2e` phase runs it.
- The Bruno desktop app is optional. To use it, open the folder `projects/<name>/bruno` as a collection.
- Playwright and axe come from the repository. The `e2e` phase installs the browsers that it needs on first run.
- Run the end-to-end checks with `node common/scripts/install-run-rush.js e2e`. Show the output.
- Set environment values in the `environments/*.bru` files. Put secrets in your shell environment only. Do not write them in a `.bru` file.

## 4. Commit and push

- Create a branch. Use the format `<type>/<short-kebab>`. See `docs/standards/git-workflow.md`.
- Write a Conventional Commit message. Example: `feat(sample): add health route`.
- Do not use `--no-verify`.
- Open a PR. Fill in `.github/pull_request_template.md`.

## 5. Add a package

Use `rush add`. Do not use `npm` or `pnpm` directly.

```
node common/scripts/install-run-rush.js add -p <package> --to @vprprudhvi/sample
```

A new dependency needs a human approval. See `docs/standards/security.md`, section 4.

## 6. How agents work here

Agents write most of the code. Agents follow these files:

| File                    | What it sets                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`             | Repo conventions and a routing table to guides and skills. Read first. Nested `CLAUDE.md` files cover `projects/`, `platform/`, `packages/`, `tooling/`, `docs/`, and `.github/`. |
| `docs/guides/*.md`      | How to work in one part: contracts, web, api, api-py, api-go, infra.                                                                                                              |
| `REVIEW.md`             | Rules for the AI reviewer.                                                                                                                                                        |
| `docs/standards/*.md`   | Coding, testing, security, Git, gate, and risk rules.                                                                                                                             |
| `.claude/settings.json` | Agent hooks and permissions.                                                                                                                                                      |

The agent flow is:

1. Read `CLAUDE.md` and the area templates.
2. Write a failing test for a bug fix or a new behavior.
3. Write the code.
4. Run `verify`. Show the output.
5. Run `pre-pr` for the review and security checks. Fix the findings.
6. Open the PR with the template filled in.

The Stop hook blocks the agent from finishing while a check fails. The `require-verify` hook blocks `git push` and `gh pr create` until `verify` passes on the current tree.

## 7. Your role as a human

- Read the risk tier of each PR. The tier sets how many approvals you need.
- Approve gate file changes. See `docs/standards/gates.md`.
- Pass a blocked check with the steps in `docs/standards/gates.md`, section 6.
- Use `docs/runbooks/rollback.md` when a change causes harm.
