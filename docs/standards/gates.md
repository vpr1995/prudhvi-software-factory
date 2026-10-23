# Gates

This document describes each gate in the repository. It lists the gate files, the checks, where each check runs, and how a human passes a blocked check.

A gate is a control that stops a change. Gates protect code quality, security, and release safety.

## 1. Principles

- Each check runs in more than one place. The CI check is the final gate.
- Local hooks can be bypassed. CI runs every check again.
- An agent cannot change a gate file. Only a human can change a gate file.
- A human unlocks a blocked check with a label or an approval. An agent does not.
- Do not weaken a check to make a change pass. Fix the change.

## 2. Gate files

`scripts/gates/gate-files.json` is the single source for the gate files. The agent hook, the deny rules in `.claude/settings.pending.json`, and the CI check read that file. The table in section 2.1 lists each glob in that file. The test `scripts/gates/test/docs-sync.test.js` fails when the table and the file differ.

There are three kinds of protected path. Each kind has a different rule for agents.

| Kind                          | Agent may edit?                                                                | Who approves                        | Section |
| ----------------------------- | ------------------------------------------------------------------------------ | ----------------------------------- | ------- |
| Hook-blocked gate file        | No. The hook blocks the edit. The agent uses the handoff folder (section 2.4). | A human, outside the agent session. | 2.1     |
| Human-reviewed document       | Yes, as a proposal. The hook does not block it.                                | CODEOWNERS (`@vprprudhvi`).         | 2.2     |
| Always-human path (high risk) | Yes, as a proposal. The hook does not block it.                                | CODEOWNERS and `risk:high`.         | 2.3     |

### 2.1 Hook-blocked gate files

A gate file controls quality, security, or release. Agents must not edit a gate file. Each row below is one glob from `scripts/gates/gate-files.json`.

| Path pattern                           | Why it is a gate                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `.github/**`                           | CI workflows, PR template, rulesets and CODEOWNERS.                                                               |
| `CODEOWNERS`                           | Owner rules for review.                                                                                           |
| `.claude/settings*.json`               | Agent permissions and hook wiring.                                                                                |
| `.claude/hooks/**`                     | Hook scripts that block agent actions.                                                                            |
| `tooling/**`                           | ESLint, TypeScript, Vitest (coverage thresholds), Opengrep rules and the license allowlist.                       |
| `.gitleaks.toml`                       | Secret scan rules and allowlist.                                                                                  |
| `audit-ci.jsonc`                       | Dependency audit allowlist.                                                                                       |
| `.checkov.yaml`                        | IaC scan settings and skips.                                                                                      |
| `docs/standards/coding-conventions.md` | Coding rules that reviewers and linters use.                                                                      |
| `common/config/rush/**`                | Rush config, command list and `pnpm-lock.yaml`.                                                                   |
| `common/git-hooks/**`                  | Git hook scripts.                                                                                                 |
| `common/autoinstallers/**`             | Tool versions for hooks and CI.                                                                                   |
| `rush.json`                            | Rush project list and tool versions.                                                                              |
| `**/REVIEW.md`                         | Review rules for the AI reviewer. This covers the root, project and platform files.                               |
| `platform/infra/**`                    | Shared AWS resources for every project.                                                                           |
| `**/rush-project.json`                 | Per-project Rush build settings and cache rules.                                                                  |
| `eslint.config.*`                      | ESLint entry point.                                                                                               |
| `tsconfig*.json`                       | TypeScript strictness settings.                                                                                   |
| `vitest.config.*`                      | Test runner settings and coverage thresholds.                                                                     |
| `.dependency-cruiser.*`                | Import boundary rules.                                                                                            |
| `**/cdk.json`                          | CDK app settings.                                                                                                 |
| `**/playwright.config.*`               | Playwright settings: browsers, retries and test match rules.                                                      |
| `**/pyproject.toml`                    | Python project and tool settings.                                                                                 |
| `**/.golangci.yml`                     | Go lint rules.                                                                                                    |
| `**/uv.lock`                           | Python dependency lock.                                                                                           |
| `**/go.sum`                            | Go dependency checksums.                                                                                          |
| `**/pnpm-lock.yaml`                    | Dependency lockfile. Use `rush add -p <pkg>`, then a human commits the change.                                    |
| `**/package-lock.json`                 | Dependency lockfile. Use `rush add -p <pkg>`, then a human commits the change.                                    |
| `**/yarn.lock`                         | Dependency lockfile. Use `rush add -p <pkg>`, then a human commits the change.                                    |
| `scripts/gates/**`                     | Gate scripts: the shared gate list, anti-skip scanner, coverage gates, check-gates, classify-risk and hook logic. |
| `scripts/security/**`                  | Security scan scripts that git hooks and CI call.                                                                 |
| `scripts/git/**`                       | Git hook helper scripts.                                                                                          |
| `.lintstagedrc.cjs`                    | Pre-commit check list.                                                                                            |
| `commitlint.config.cjs`                | Commit message rules.                                                                                             |
| `.git/hooks/**`                        | Installed git hooks.                                                                                              |
| `.gitattributes`                       | Git attributes can hide changed test files from the anti-skip diff.                                               |
| `common/scripts/**`                    | Rush launcher scripts. Every verify runs `install-run-rush.js`.                                                   |
| `**/scripts/*.sh`                      | Project scripts that the `_phase:*` commands run.                                                                 |
| `**/scripts/*.mjs`                     | Project scripts that the `_phase:*` commands run.                                                                 |
| `**/scripts/*.py`                      | Project scripts that the `_phase:*` commands run.                                                                 |
| `**/.gitignore`                        | A `.gitignore` can hide a new gate file from git.                                                                 |
| `**/pytest.toml`                       | pytest reads this file before `pyproject.toml`. A new one can lower the coverage floor.                           |
| `**/go.mod`                            | Go module settings, including the Go version and toolchain.                                                       |
| `**/bruno.json`                        | Bruno collection settings.                                                                                        |
| `**/pytest.ini`                        | pytest reads this file before `pyproject.toml`. A new one can lower the coverage floor.                           |
| `**/ruff.toml`                         | ruff reads this file before `pyproject.toml`. A new one can turn rules off.                                       |
| `**/.ruff.toml`                        | ruff reads this file before `pyproject.toml`. A new one can turn rules off.                                       |
| `**/mypy.ini`                          | mypy reads this file before `pyproject.toml`. A new one can loosen type checks.                                   |
| `**/.coveragerc`                       | coverage.py reads this file before `pyproject.toml`. A new one can lower the floor.                               |
| `**/setup.cfg`                         | Legacy tool settings that shadow `pyproject.toml`.                                                                |
| `**/tox.ini`                           | Legacy tool settings that shadow `pyproject.toml`.                                                                |
| `.claude/state/last-verify.json`       | The verify result that `git push` and `gh pr create` trust. Only the Stop hook writes it.                         |
| `.claude/state/session-base`           | The commit that the anti-skip scan compares with. Only the SessionStart hook writes it.                           |
| `.claude/state/stop-attempts`          | The loop guard counter of the Stop hook. Only the Stop hook writes it.                                            |
| `.claude/state/subagent-stop-attempts` | The loop guard counter of the SubagentStop hook. Only the Stop hook writes it.                                    |

A `package.json` that adds or changes a `_phase:*` script is also a gate change. The check reads the file text, not a glob. The folders `.claude/hooks`, `common/git-hooks` and `.git/hooks` also cannot be written with Bash.

Security rule files are gate files. They are `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, and the files under `tooling/**`, such as `tooling/opengrep/**` and `tooling/license-allowlist.json`.

### 2.2 Human-reviewed documents (not hook-blocked)

Agents can propose edits to these files. Fix a recurring review finding at its source. A human must approve each edit through CODEOWNERS.

| Path pattern                                         | Why it is reviewed                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                          | Agent instructions.                                                                    |
| `AGENTS.md`                                          | Symlink to `CLAUDE.md`.                                                                |
| `**/CLAUDE.md`, `**/AGENTS.md`                       | Nested agent instructions. Each `AGENTS.md` is a symlink to the `CLAUDE.md` beside it. |
| `docs/guides/**`                                     | Per-kind how-to guides that the `CLAUDE.md` files link to.                             |
| `docs/templates/**`                                  | Per-kind review templates.                                                             |
| `docs/standards/**` (except `coding-conventions.md`) | Standards documents.                                                                   |

Review rules are gate files. `REVIEW.md` files are in section 2.1. An agent writes a proposed review rule in its final message, or in the handoff folder. A human applies it.

`tooling/CLAUDE.md` and `.github/CLAUDE.md` are under `tooling/**` and `.github/**`. The hook blocks their edits (section 2.1).

`.github/CODEOWNERS` sets `* @vprprudhvi` as the default owner. It also lists `/CLAUDE.md` and `**/CLAUDE.md`. A path with no line of its own uses the default owner.

### 2.3 Always-human paths (high risk)

Agents may propose edits to these paths. Each change is `risk:high`. A human approves each change. See `docs/standards/risk-tiers.md`.

| Path pattern                                                | Why it is always human                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `platform/**` (except `platform/infra/**`, see section 2.1) | Shared AWS resources (Cognito user pool, hosted zone, certificate, SSM parameters). Every project depends on them. |
| `packages/**`                                               | Shared code. A change has a wide effect.                                                                           |
| `projects/*/bin/**` and `projects/*/lib/**`                 | The CDK app of one project: cloud resources and IAM.                                                               |

### 2.4 Handoff folder

An agent cannot change a gate file. When a task needs a gate file change, the agent writes the content to the handoff folder, `.claude/state/handoff/<name>/`. The handoff folder is not a gate file.

- Write one file for each target. Name it `NN-<target path with / replaced by __>.txt`.
- The first line of the file is `TARGET: <path>`. The rest of the file is the full new content.
- A human copies the file to its target path. The human reviews the change and commits it through a PR (section 6.1).
- Write each package manager command, such as `rush add -p`, `uv add`, `go get`, or `go mod tidy`, to a file named `NN-commands.txt`. A human runs the commands. These commands change lockfiles, `go.mod`, or `go.sum`, which are gate files.
- Do not write a gate file with `cp`, `mv`, or a shell redirect into `.claude/state`. Write the file with the Write tool.

## 3. Layers that protect the gates

| Layer                   | Where                            | What it does                                                                                                                                                       |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Agent hook           | `.claude/hooks/protect-gates.sh` | Blocks an agent edit to a gate file. Exit code 2.                                                                                                                  |
| 2. Permission rules     | `.claude/settings.json` `deny`   | Blocks agent writes to gate files. The rules come from `scripts/gates/gate-files.json`. A human copies `.claude/settings.pending.json` to `.claude/settings.json`. |
| 3. Code owners          | `CODEOWNERS`                     | A code owner must approve a gate file change.                                                                                                                      |
| 4. Risk label           | CI `check-gates` job             | Sets `risk:high` when a gate file changes.                                                                                                                         |
| 5. Lint rules           | `tooling/eslint-config`          | Blocks `any`, `@ts-ignore`, focused or skipped tests, and disables without a description.                                                                          |
| 6. Ruleset              | GitHub `main` ruleset            | No bypass for administrators on `main`.                                                                                                                            |
| 7. Gate integrity check | Stop hook and agent Bash guard   | Blocks a gate change made by any means. Section 3.1.                                                                                                               |

### 3.1 Gate integrity check

The gate integrity check reads the session diff, the index, and the commits. It finds each gate file that changed. It runs at three points.

| Point                                        | Result                                                                                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop hook, uncommitted change                | Blocks the stop. The block text is: `Gate file changed. Revert it (git checkout -- <file>) or ask the human.` The block applies to a full stop and to a `--fast` stop. It applies even when the saved verify state says pass. |
| Commits since the session base               | Warns. It does not block. The warning ends with: `Tell the user these commits change gate files.`                                                                                                                             |
| `git push` and `gh pr create` or `gh pr new` | Blocks when the range has gate changes. The block text starts with: `Gate changes are pushed by a human.`                                                                                                                     |

The range starts at `origin/main` when that branch exists. Without it, the range starts at the root commit.

A human pushes a branch that has gate changes. The agent does not push it.

### 3.2 Known limits

The agent Bash guard reads the text of a command. It does not run the command. A command can write a gate file in a way that the guard does not read. These forms are not fully covered:

- `xargs`, `find -exec`, and command substitution, such as `echo x > $(echo path)`.
- `env -C` and paths built from variables or from `HOME` or XDG config.
- Interpreters that run a script file. Inline code is checked for write APIs, but not every write API is known.
- Pathspec magic in `git` commands, such as `:(glob)`.
- Interpreter code with encoded or built-up paths, and some `perl` and `ruby` forms.
- `go mod edit` and `go get` through Bash.
- Pruned build folders, such as `dist`, are not scanned for untracked gate files.
- `git branch -u` changes the push base. A `hooksPath` in the `HOME` git config can turn git hooks off.

The gate integrity check, CODEOWNERS, and CI are the real controls. The Bash guard is a fast check. It does not replace them.

## 4. Checks by stage

### 4.1 Agent edit time

| Check           | Trigger                         | Result                                                        |
| --------------- | ------------------------------- | ------------------------------------------------------------- |
| Gate file block | Edit to a gate file             | Edit blocked.                                                 |
| Secret block    | Edit that adds a secret pattern | Edit blocked.                                                 |
| Format and lint | Edit to a source file           | Prettier and ESLint fix the file. Errors return to the agent. |
| Typecheck       | Edit to a source file           | `tsc --noEmit` on the owning project.                         |

### 4.2 Agent stop time

The Stop hook runs these checks on the session diff. It blocks the stop when a check fails. The test checks are described in `docs/standards/testing.md`.

| Check                                                              | Result when it fails                                                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gate integrity check (section 3.1)                                 | Stop blocked when a gate file has an uncommitted change.                                                                                                           |
| Build, typecheck, lint, test on impacted projects                  | Stop blocked.                                                                                                                                                      |
| Anti-skip scan                                                     | Stop blocked. The diff adds a skip, a disable, or a deleted test. Python, Go, Bruno, and Playwright patterns are listed in `docs/standards/testing.md`, section 4. |
| Gitleaks on the diff                                               | Stop blocked.                                                                                                                                                      |
| Opengrep on changed files                                          | Stop blocked on `ERROR` findings.                                                                                                                                  |
| `cdk synth` and cdk-nag when `infra` changed                       | Stop blocked.                                                                                                                                                      |
| `rush e2e` for impacted web and api parts (Bruno, Playwright, axe) | Stop blocked.                                                                                                                                                      |

### 4.3 Commit and push time

| Hook                          | Check                                                                                                                                             | Blocks when                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `pre-commit`                  | `lint-staged`, Prettier, ESLint with `--max-warnings 0`, gitleaks on staged files, gate-file warning, large-file check, conflict markers, `.env*` | Any step fails.                             |
| `commit-msg`                  | commitlint                                                                                                                                        | Commit message is not Conventional Commits. |
| `pre-push`                    | `rush change --verify`, impacted build and test, typecheck, `audit-ci`, license check, Opengrep, Checkov when infra changed                       | Any step fails.                             |
| `post-checkout`, `post-merge` | Lockfile changed                                                                                                                                  | Never blocks. Prints `rush install`.        |

Git hooks install on `rush install`. See `docs/onboarding.md`.

### 4.4 Pull request time (required CI checks)

| Workflow            | Checks                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`            | `rush install` with frozen lockfile, `rush check`, `rush change --verify`, impacted build, lint, typecheck, tests with coverage, diff coverage, `rush e2e` (Bruno and Playwright with axe), gate integrity (`check-gates`, including `test-location`, `bruno-coverage` and `playwright-coverage`), dependency-cruiser. |
| `sast.yml`          | Opengrep, njsscan, gitleaks (PR range), TruffleHog (verified only), zizmor, pinact.                                                                                                                                                                                                                                    |
| `deps.yml`          | audit-ci, OSV-Scanner on `common/config/rush/pnpm-lock.yaml`, license check, new-dependency report.                                                                                                                                                                                                                    |
| `infra.yml`         | Per impacted project: `cdk synth`, cdk-nag, Checkov, `cdk diff` posted as a PR comment.                                                                                                                                                                                                                                |
| `claude-review.yml` | AI review with severity tags. Open review threads block merge. Security review action.                                                                                                                                                                                                                                 |
| `risk-classify.yml` | Sets `risk:low`, `risk:medium`, or `risk:high`. Ruleset checks approvals for the tier.                                                                                                                                                                                                                                 |

The `test-location` check of `check-gates` fails when a unit test file is outside a `test/` folder. A unit test file is a `*.test.*` file, or a `*.spec.ts` or `*.spec.tsx` file. Vitest runs only the files in `test/`. A test in another folder never runs. The message names the path to use. The `test/` folder is at the root of the Rush project and has the same sub-folders as the source. Example: `packages/a/src/x.test.ts` goes to `packages/a/test/x.test.ts`. The check does not look at Playwright specs in `projects/<name>/web/e2e/`, Python tests, or Go tests. No label allows a test outside `test/`. Move the file to pass the check.

### 4.5 Scheduled checks

| Workflow        | Check                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `nightly.yml`   | Stryker mutation tests, nightly review of old code, reviewer evals in `evals/reviewer/`, outdated and audit report. |
| `scorecard.yml` | OpenSSF Scorecard and SHA pin check, weekly.                                                                        |

### 4.6 Release time

| Workflow       | Check                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `release.yml`  | Deploy to `dev`, then `staging`, then `prod`. `prod` needs a GitHub Environment approval. SBOM and container scan. |
| `rollback.yml` | Re-deploy the last good build or turn off a flag.                                                                  |

## 5. Labels

A label is a signal from a human or from a workflow. Only the listed setter can add the label.

| Label            | Set by                               | Meaning                                                                                           |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `risk:low`       | `risk-classify.yml`                  | Docs, copy, tests only, or additive change behind a flag.                                         |
| `risk:medium`    | `risk-classify.yml`                  | Normal code change.                                                                               |
| `risk:high`      | `risk-classify.yml` or `check-gates` | Auth, billing, infra, `platform/**`, shared packages, dependencies, `.github/**`, or a gate file. |
| `lint-exception` | Human only                           | Allows the lint disable count to rise.                                                            |
| `test-removal`   | Human only                           | Allows a PR to delete a test file or a test case.                                                 |
| `large-pr`       | Human only                           | Allows a PR above 1000 changed lines.                                                             |

Agents must not add or remove these labels.

## 6. How a human passes a blocked check

Use the matching procedure. Do not use a procedure that is not listed.

### 6.1 A gate file must change

1. Read the agent request and the reason for the change.
2. Read the handoff file in `.claude/state/handoff/<name>/`. Copy it to its `TARGET` path. Or ask the code owner to make the change.
3. Make the change on a branch.
4. Open a PR. Check that the risk label is `risk:high`.
5. Get approval from a code owner. The tier needs the approvals in `docs/standards/risk-tiers.md`.
6. Merge only after all required checks pass.

### 6.2 A lint disable count rises

1. Read the new disable comments. Each one needs a reason.
2. Remove the disable if the reason is weak. Ask the author to fix the cause.
3. If the disable is correct, add the `lint-exception` label.

### 6.3 A test is removed

1. Read the removed tests.
2. Restore the test if the behavior is still needed.
3. If the removal is correct, add the `test-removal` label. Write the reason in the PR.

### 6.4 A PR is larger than 1000 lines

1. Ask the author to split the PR into smaller PRs. Each PR must change one thing.
2. If the split is not possible, add the `large-pr` label. Write the reason in the PR.

### 6.5 A security finding is a false positive

1. Confirm that the finding is a false positive. Read the rule and the code.
2. Add an entry to the allowlist file. Use the file for the tool: `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, or `tooling/opengrep/**`.
3. Write the reason in the entry. For `audit-ci.jsonc`, also write an expiry date.
4. Get approval from `@vprprudhvi`.

Agents must not add an allowlist entry. See `docs/standards/security.md`.

### 6.6 A dependency must be added

1. The agent writes the `rush add -p <package>` command to a handoff file (`NN-commands.txt`, section 2.4). Use `rush add`, not `npm` or `pnpm` directly. The agent does not run the command.
2. A human runs the command after the human approves the dependency.
3. Read the new-dependency report in the PR comment.
4. Check the license, the age, and the maintainers.
5. Approve as a code owner. The lockfile change needs a human.

### 6.7 A release must stop

Use `docs/runbooks/rollback.md`.

## 7. Rules for agents

- Do not edit a gate file. The hook blocks the edit.
- Write the new content of a gate file to the handoff folder (section 2.4).
- Do not run a package manager command that changes a lockfile. Write the command to the handoff folder.
- Open a PR for a change to a file in section 2.2 or 2.3. Do not merge it.
- Do not add `--no-verify` to a git command.
- Do not add a skip, a focused test, or a disable comment to pass a check.
- Do not lower a coverage threshold.
- Do not add or remove a label.
- Do not add an allowlist entry.
- If a gate blocks you, read the message. Fix the cause. Then run the check again.
- If a gate looks wrong, stop. Tell the human what is wrong and why.

## 8. End-to-end gates (Bruno and Playwright)

| Gate                  | What it checks                                                                                                                                                        | Where it runs                    | Blocks when                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| `bruno-coverage`      | Each route in `projects/<name>/dist/openapi.json` has a `.bru` request in `projects/<name>/bruno` with the same method and path, and at least one assertion.          | `check-gates`, `ci.yml`          | A route has no such request.                       |
| `playwright-coverage` | Each `projects/<name>/web/app/**/page.tsx` route has a spec in `web/e2e` with `page.goto` and an axe check. A project with a `web/` folder needs a `web/e2e/` folder. | `check-gates`, `ci.yml`          | A page has no such spec, or the folder is missing. |
| Anti-skip (e2e)       | No `test.skip`, `test.fixme`, `test.fail`, `test.only`, `skip-request`, or a `.bru` request with no assertion, in the diff.                                           | Stop hook, CI                    | The diff adds one of these patterns.               |
| `rush e2e`            | Bruno collection and Playwright suite run against a started server.                                                                                                   | Stop hook, `ci.yml`, merge queue | A request or a spec fails.                         |
