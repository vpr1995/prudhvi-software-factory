# Onboarding

This document gives the steps to set up a local copy of the repository. It also explains how agents work in this repository.

## 1. Requirements

- Git.
- Node 24. The exact version is in `.nvmrc`. Use nvm, fnm, or nvs to switch to it.
- Do not install pnpm globally. Rush installs the pnpm version it needs.

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

The pre-commit hook calls gitleaks. Install it on your `PATH`. The other tools are for manual scans:

| Tool        | Used by                | How to install                         |
| ----------- | ---------------------- | -------------------------------------- |
| gitleaks    | pre-commit             | `brew install gitleaks`                |
| Opengrep    | Manual SAST scan       | Download from its GitHub release page. |
| Checkov     | Manual infra scan      | `pip install checkov`                  |
| osv-scanner | Manual dependency scan | `brew install osv-scanner`             |

Check each tool with its version flag, for example `gitleaks version`. Use the versions that the team pins. A missing gitleaks blocks the local commit.

### 3.1 API requests and browser tests

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
| `docs/guides/*.md`      | How to work in one part: contracts, web, api, infra.                                                                                                                              |
| `REVIEW.md`             | Rules for the AI reviewer.                                                                                                                                                        |
| `docs/standards/*.md`   | Coding, testing, security, Git, and risk rules.                                                                                                                                   |
| `.claude/settings.json` | Agent permissions.                                                                                                                                                                |

The agent flow is:

1. Read `CLAUDE.md` and the area templates.
2. Write a failing test for a bug fix or a new behavior.
3. Write the code.
4. Run `verify`. Show the output.
5. Run `pre-pr` for the review and security checks. Fix the findings.
6. Open the PR with the template filled in.

No hook forces `verify`. Run it by hand before you open a PR. The pre-push hook runs `rush audit` only when the lockfile changed.

## 7. Your role as a human

- Read the risk tier of each PR. The tier sets how many approvals you need.
- Review high-risk changes, such as `platform/**`, `packages/**`, `tooling/**` and `.github/**`. See `docs/standards/risk-tiers.md`.
- Use `docs/runbooks/rollback.md` when a change causes harm.
