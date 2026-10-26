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
| Human-reviewed document       | Yes, as a proposal. The hook does not block it.                                | CODEOWNERS (`@vpr1995`).            | 2.2     |
| Always-human path (high risk) | Yes, as a proposal. The hook does not block it.                                | CODEOWNERS and `risk:high`.         | 2.3     |

### 2.1 Hook-blocked gate files

A gate file controls quality, security, or release. Agents must not edit a gate file. Each row below is one glob from `scripts/gates/gate-files.json`.

| Path pattern                           | Why it is a gate                                                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/**`                           | CI workflows, PR template, rulesets and CODEOWNERS.                                                                                                                                            |
| `CODEOWNERS`                           | Owner rules for review.                                                                                                                                                                        |
| `.claude/settings*.json`               | Agent permissions and hook wiring.                                                                                                                                                             |
| `.claude/hooks/**`                     | Hook scripts that block agent actions.                                                                                                                                                         |
| `tooling/**`                           | ESLint, TypeScript, Vitest (coverage thresholds), Opengrep rules and the license allowlist.                                                                                                    |
| `.gitleaks.toml`                       | Secret scan rules and allowlist.                                                                                                                                                               |
| `audit-ci.jsonc`                       | Dependency audit allowlist.                                                                                                                                                                    |
| `.checkov.yaml`                        | IaC scan settings and skips.                                                                                                                                                                   |
| `docs/standards/coding-conventions.md` | Coding rules that reviewers and linters use.                                                                                                                                                   |
| `common/config/rush/**`                | Rush config, command list and `pnpm-lock.yaml`.                                                                                                                                                |
| `common/git-hooks/**`                  | Git hook scripts.                                                                                                                                                                              |
| `common/autoinstallers/**`             | Tool versions for hooks and CI.                                                                                                                                                                |
| `rush.json`                            | Rush project list and tool versions. Add a project only with `register-project.mjs` (section 6.8). The push exemption (section 4.3.1) covers an added project entry only.                      |
| `**/REVIEW.md`                         | Review rules for the AI reviewer. This covers the root, project and platform files.                                                                                                            |
| `platform/infra/**`                    | Shared AWS resources for every project.                                                                                                                                                        |
| `**/rush-project.json`                 | Per-project Rush build settings and cache rules.                                                                                                                                               |
| `eslint.config.*`                      | ESLint entry point.                                                                                                                                                                            |
| `tsconfig*.json`                       | TypeScript strictness settings.                                                                                                                                                                |
| `vitest.config.*`                      | Test runner settings and coverage thresholds.                                                                                                                                                  |
| `.dependency-cruiser.*`                | Import boundary rules.                                                                                                                                                                         |
| `**/cdk.json`                          | CDK app settings.                                                                                                                                                                              |
| `**/playwright.config.*`               | Playwright settings: browsers, retries and test match rules.                                                                                                                                   |
| `**/pyproject.toml`                    | Python project and tool settings.                                                                                                                                                              |
| `**/.golangci.yml`                     | Go lint rules.                                                                                                                                                                                 |
| `**/uv.lock`                           | Python dependency lock.                                                                                                                                                                        |
| `**/go.sum`                            | Go dependency checksums.                                                                                                                                                                       |
| `**/pnpm-lock.yaml`                    | Dependency lockfile. The agent runs `rush add -p <pkg>` and commits the change. The push exemption (section 4.3.1) lets the agent push it when the lock lint passes.                           |
| `**/package-lock.json`                 | Dependency lockfile. The agent runs `rush add -p <pkg>` and commits the change. A human pushes it.                                                                                             |
| `**/yarn.lock`                         | Dependency lockfile. The agent runs `rush add -p <pkg>` and commits the change. A human pushes it.                                                                                             |
| `scripts/gates/**`                     | Gate scripts: the shared gate list, anti-skip scanner, coverage gates, check-gates, classify-risk and hook logic.                                                                              |
| `scripts/security/**`                  | Security scan scripts that git hooks and CI call.                                                                                                                                              |
| `scripts/git/**`                       | Git hook helper scripts.                                                                                                                                                                       |
| `.lintstagedrc.cjs`                    | Pre-commit check list.                                                                                                                                                                         |
| `commitlint.config.cjs`                | Commit message rules.                                                                                                                                                                          |
| `.git/hooks/**`                        | Installed git hooks.                                                                                                                                                                           |
| `.git/config`                          | Repo git config. A push refspec or `push.default` set here changes what a push with no refspec publishes. The Bash guard blocks `git config` for these keys. This entry closes the file write. |
| `.gitattributes`                       | Git attributes can hide changed test files from the anti-skip diff.                                                                                                                            |
| `common/scripts/**`                    | Rush launcher scripts. Every verify runs `install-run-rush.js`.                                                                                                                                |
| `**/scripts/*.sh`                      | Project scripts that the `_phase:*` commands run.                                                                                                                                              |
| `**/scripts/*.mjs`                     | Project scripts that the `_phase:*` commands run.                                                                                                                                              |
| `**/scripts/*.py`                      | Project scripts that the `_phase:*` commands run.                                                                                                                                              |
| `**/.gitignore`                        | A `.gitignore` can hide a new gate file from git.                                                                                                                                              |
| `**/pytest.toml`                       | pytest reads this file before `pyproject.toml`. A new one can lower the coverage floor.                                                                                                        |
| `**/go.mod`                            | Go module settings, including the Go version and toolchain.                                                                                                                                    |
| `**/bruno.json`                        | Bruno collection settings.                                                                                                                                                                     |
| `**/pytest.ini`                        | pytest reads this file before `pyproject.toml`. A new one can lower the coverage floor.                                                                                                        |
| `**/ruff.toml`                         | ruff reads this file before `pyproject.toml`. A new one can turn rules off.                                                                                                                    |
| `**/.ruff.toml`                        | ruff reads this file before `pyproject.toml`. A new one can turn rules off.                                                                                                                    |
| `**/mypy.ini`                          | mypy reads this file before `pyproject.toml`. A new one can loosen type checks.                                                                                                                |
| `**/.coveragerc`                       | coverage.py reads this file before `pyproject.toml`. A new one can lower the floor.                                                                                                            |
| `**/setup.cfg`                         | Legacy tool settings that shadow `pyproject.toml`.                                                                                                                                             |
| `**/tox.ini`                           | Legacy tool settings that shadow `pyproject.toml`.                                                                                                                                             |
| `.claude/state/last-verify.json`       | The verify result that `git push` and `gh pr create` trust. Only the Stop hook writes it.                                                                                                      |
| `.claude/state/session-base`           | The commit that the anti-skip scan compares with. Only the SessionStart hook writes it.                                                                                                        |
| `.claude/state/stop-attempts`          | The loop guard counter of the Stop hook. Only the Stop hook writes it.                                                                                                                         |
| `.claude/state/subagent-stop-attempts` | The loop guard counter of the SubagentStop hook. Only the Stop hook writes it.                                                                                                                 |
| `.claude/state/gates-base`             | The commit that the gate scripts use as the base of the diff when `GATES_BASE` is not set. Only a human writes it.                                                                             |

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

`.github/CODEOWNERS` sets `* @vpr1995` as the default owner. It also lists `/CLAUDE.md` and `**/CLAUDE.md`. A path with no line of its own uses the default owner.

### 2.3 Always-human paths (high risk)

Agents may propose edits to these paths. Each change is `risk:high`. A human approves each change. See `docs/standards/risk-tiers.md`.

| Path pattern                                                | Why it is always human                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `platform/**` (except `platform/infra/**`, see section 2.1) | Shared AWS resources (Cognito user pool, hosted zone, certificate, SSM parameters). Every project depends on them. |
| `packages/**`                                               | Shared code. A change has a wide effect.                                                                           |

The CDK app of one project (`projects/*/bin/**` and `projects/*/lib/**`) is `risk:medium`. The infra reviewer, cdk-nag and the synth gate check it. `projects/*/cdk.json` is a gate file (section 2.1) and stays high risk.

### 2.4 Handoff folder

An agent cannot change a gate file. When a task needs a gate file change, the agent writes the content to the handoff folder, `.claude/state/handoff/<name>/`. The handoff folder is not a gate file.

- Write one file for each target. Name it `NN-<target path with / replaced by __>.txt`.
- The first line of the file is `TARGET: <path>`. The rest of the file is the full new content.
- A human copies the file to its target path. The human reviews the change and commits it through a PR (section 6.1).
- The agent runs `rush add -p <pkg>` itself when the dependency policy passes (section 6.6). The agent runs `rush update` itself after `register-project.mjs` (section 6.8).
- Write each other package manager command, such as `uv add`, `go get`, or `go mod tidy`, to a file named `NN-commands.txt`. A human runs the commands. These commands change `uv.lock`, `go.mod`, or `go.sum`, which are gate files.
- To add a project to `rush.json`, run `node scripts/gates/register-project.mjs <name>` (section 6.8). Do not change `rush.json` in another way.
- Commit `rush.json` and each file that `rush add` or `rush update` changed under `common/config/rush/` (for example `pnpm-lock.yaml` and `repo-state.json`) together with the change that needs them. Check with `git status --short`. The Stop hook blocks a stop while a gate file has an uncommitted change (section 3.1). The agent pushes the commit when the push exemption applies (section 4.3.1). Otherwise a human pushes it.
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
| `git push` and `gh pr create` or `gh pr new` | Blocks when the range has a gate change that the push exemption (section 4.3.1) does not cover. The block text starts with: `Gate changes are pushed by a human.`                                                             |

The range starts at `origin/main` when that branch exists. Without it, the range starts at the root commit.

The range starts at the merge base. A `git reset` or a `git checkout` can move HEAD back past a human gate commit. The gate file then has the old content, and no commit in the range changes it. For this reason the check also uses the session base. Session start writes the HEAD commit to `.claude/state/session-base`. In this section, S is the session base and M is the merge base of HEAD and S.

When HEAD does not descend from S, the check reports a gate file when both of these are true:

- A commit from M to S changes the gate file.
- The content of the gate file at HEAD is different from the content at S. This includes a deleted file and an added file.

A `git rebase` keeps the content of S, so the check does not report a rebase. The check does not compare HEAD with `origin/main`. A branch that is behind `origin/main` does not revert a gate change of `origin/main` when a human merges it, squashes it, or rebases it. So the check does not report a branch that is behind `origin/main`.

| Point                                        | Result                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop hook                                    | Warns. The file shows with `differs from the session base`.                                                                                                                                                                                                                                                     |
| `git push` and `gh pr create` or `gh pr new` | Blocks. The block text has the line `HEAD was rewound past the session base: <files>.` No push exemption applies.                                                                                                                                                                                               |
| Push with no valid session base              | Blocks when `.claude/state/session-base` is missing or does not hold a full commit id that git has. The block text has `The session base is missing`. The check runs after the gate change check and the verify check. Only the agent hook `require-verify` runs it. A human push in a terminal is not blocked. |

A human pushes a branch that has a gate change outside the push exemption. The agent pushes a branch only when every gate change in the range is exempt (section 4.3.1).

### 3.2 Known limits

The agent Bash guard reads the text of a command. It does not run the command. A command can write a gate file in a way that the guard does not read. These forms are not fully covered:

- `xargs`, `find -exec`, and command substitution, such as `echo x > $(echo path)`.
- `env -C` and paths built from variables or from `HOME` or XDG config.
- Interpreters that run a script file. Inline code is checked for write APIs, but not every write API is known.
- Pathspec magic in `git` commands, such as `:(glob)`.
- Interpreter code with encoded or built-up paths, and some `perl` and `ruby` forms.
- `go mod edit` and `go get` through Bash.
- Pruned build folders, such as `dist`, are not scanned for untracked gate files.
- A `hooksPath` in the `HOME` git config can turn git hooks off.
- `cpio -i` and `pax -r` write to the working folder by default. The guard does not resolve a `cd` in the same command. So `cd /tmp/x && cpio -i < a` is blocked. This is a false positive.
- The guard does not cover these extractors: `7z`, `7za`, and `7zr` with `x -o`; `jar xf`; `bsdunzip`; `xar -x -C`; and `python3 -m zipfile -e`. It also does not cover a destination from command substitution, such as `cp -r x "$(pwd)"`.

The local gate runner (section 4.3.1) has these limits:

- The agent Bash guard blocks `GATES_BASE` (inline, exported, or in `env`) and writes to a file named `gates-base`. A script that sets `GATES_BASE` inside its own code is not read.
- The agent Bash guard blocks writes to `push.*` and to `remote.<name>.push`, `remote.<name>.pushurl`, `remote.<name>.url` and `remote.<name>.mirror`. It applies to `git config` (set, add, unset and replace-all, with `--file` or `--global`), to `-c`, and to `git config --edit`. Reads stay allowed.
- The agent Bash guard blocks `git remote add --mirror` (also `--mirror=<x>` and an abbreviation), `git remote set-url` and `git remote set-branches`. A plain `git remote add <name> <url>` stays allowed.
- An audit runs only when its lock changed since the base. A new advisory for a lock that did not change shows only in the planned nightly audit, or with `--audit-only`.
- The push exemption (section 4.3.1) reads the lock content. The lock lint checks each resolution and each source. It does not check every package the dependency policy (section 6.6) reviews.
- A chained shell command can create a branch and push it in one command. The guard reads the command text before the chain runs.
- `git update-ref` can move `refs/remotes/origin/main`, which moves the push base (section 4.3.1). No guard rule covers it yet.
- The session base check (section 3.1) reads `.claude/state/session-base`. The deny rules and the Bash guard block an agent write to that file, but a write form that the guard does not read can change it. A changed session base removes only this check. The range check from `origin/main` stays.
- Session start writes a new session base on `startup` and on `clear`. It keeps the old one on `resume` and on `compact`. So when an agent resets past a human gate commit and then a new session starts, the new session base is the reset HEAD. The check does not find that reset.
- The check does not find a reset to S, or to a commit below S, after a human gate commit H that came after S in the same session. After a reset to S, HEAD descends from S, so the check finds no change. After a reset below S, the commits from M to S do not include H, so the check does not report the gate file of H. Tests record both results. The risk is low: when H is not pushed, the push does not change H on `origin`. When H is pushed, the reset branch is behind `origin`. A push to the same branch is not a fast-forward, and `git push --force` is denied. A merge, a squash or a rebase of another branch does not revert H.
- The hooks use `CLAUDE_PROJECT_DIR` (else the folder of the session) as the repo root. When session start did not write a session base in the `.claude/state` of that root, the push check blocks every agent push with `The session base is missing`. This can occur in a new git worktree. A human pushes that branch, or a new session starts in that root.
- The Bash guard does not block `git reset` or `git checkout` to a commit that is not a descendant of the session base. The Stop hook warns and the push check blocks, but the history change itself is allowed.
- Push settings in `~/.gitconfig`, `.git/config.worktree`, or an `include` file are not blocked.

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
| `cdk synth` and cdk-nag for each environment of a changed CDK app  | Stop blocked.                                                                                                                                                      |
| `rush e2e` for impacted web and api parts (Bruno, Playwright, axe) | Stop blocked.                                                                                                                                                      |

A failed Stop hook run keeps the logs in `.claude/state/failure-logs/` and names the folder in the block message. A failed `verify` skill run (`stop-gate.mjs --write-state-only`) does the same. The SubagentStop hook (`--fast`) does not keep logs. See **Failure logs** in section 4.3.1.

### 4.3 Commit and push time

| Hook                          | Check                                                                                                                                                                                                                                                     | Blocks when                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `pre-commit`                  | `.env` file block, conflict markers, the 1 MB limit and gitleaks on staged changes. Then `node scripts/gates/anti-skip.mjs --staged`. Then a warning for staged gate files (`scripts/gates/gate-file-notice.mjs`). Then lint-staged: Prettier and ESLint. | Any step fails. The gate-file warning never blocks. |
| `commit-msg`                  | commitlint                                                                                                                                                                                                                                                | Commit message is not Conventional Commits.         |
| `pre-push`                    | Local gate runner `scripts/gates/local-gates.sh`. The steps are in section 4.3.1.                                                                                                                                                                         | Any step fails. A push rule in section 4.3.1 fails. |
| `post-checkout`, `post-merge` | Lockfile changed                                                                                                                                                                                                                                          | Never blocks. Prints `rush install`.                |

Markdown is not in lint-staged. A Markdown format error shows at push.

Git hooks install on `rush install`. See `docs/onboarding.md`.

### 4.3.1 Local gate runner (`rush gates`)

Two callers run the local gate runner, `scripts/gates/local-gates.sh`:

- `node common/scripts/install-run-rush.js gates`. This is the Rush global command `gates`.
- `common/git-hooks/pre-push`.

Each step prints `gates: RUN`, `gates: PASS`, `gates: FAIL`, or `gates: SKIP <step> (<reason>)`. The runner stops at the first failure. A failed step keeps its logs (see **Failure logs** below).

**Steps.** The steps run in this order.

| Step | Check                                                                                      | Runs when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a    | `rush change --verify --no-fetch`                                                          | Every run. SKIP only when no `origin` remote exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| b    | Node license check (`rush license-check`), from `scripts/gates/dep-checks.mjs`             | `common/config/rush/pnpm-lock.yaml`, `tooling/license-allowlist.json` or `scripts/security/license-check.sh` changed since the base.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| b    | Typosquat check (`scripts/gates/typosquat-check.mjs`), from `scripts/gates/dep-checks.mjs` | A `package.json` under `projects/`, `packages/`, `platform/` or `tooling/` gained a dependency name, or changed the version text of a dependency, since the base. All runs with `GATES_FULL=1`. Runs after the license checks and before the audits. The step fails when a new name looks like a known package name. It also fails a version text that is a URL, a git source, a tarball, an `npm:` alias, or a `file:` or `link:` path outside the repo. A `@vprprudhvi/*` dependency fails unless its version starts with `workspace:`. The ignored-folder filter (for example `node_modules`) applies only to the path below the manifest folder. The name list is small and static, so the PR review is the main control for new names (section 6.6). |
| b    | Python and Go license checks                                                               | Run in the `_phase:lint` of `rush verify` when `uv.lock`, `go.mod` or `go.sum` changed. The runner runs them directly only when `tooling/license-allowlist.json` changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| b    | Audits: `rush audit`, pip-audit and govulncheck                                            | Each audit runs when its lock changed since the base. Otherwise the runner prints a `gates: SKIP <audit>` line. A failed audit fails the run. See the audit text below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| c    | Opengrep on changed files (`scripts/security/opengrep-changed.sh`)                         | Changed files. JS and TS rules only. Python and Go rules are backlog item `bl-opengrep-py-go`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| d    | Anti-skip scan (`scripts/gates/anti-skip.mjs --range <base>...HEAD`)                       | Every run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| e    | Gate check (`scripts/gates/check-gates.mjs`)                                               | Every run. Checks pr-size, disable-count, gate-files, test-deletion and test-location.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| f    | Gate script tests (`scripts/gates/test-impacted.mjs --base <base>`)                        | Tests impacted by the change. All tests with `GATES_FULL=1`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| g    | Gate lint (`eslint --max-warnings 0 scripts/gates`)                                        | Every run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| h    | Prettier check (`scripts/gates/prettier-check.mjs`)                                        | Changed files since the base: the lint-staged types and Markdown. All tracked files with `GATES_FULL=1`. A missing binary fails.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| i    | `rush verify --impacted-by git:<base>`                                                     | Impacted projects. The full `rush verify` runs when the base is the root commit or with `GATES_FULL=1`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| j    | cdk synth (`scripts/gates/synth-changed.mjs`)                                              | Each CDK app that changed (see below). All apps with `GATES_FULL=1`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| k    | Bruno coverage and Playwright coverage                                                     | Last step. See section 8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Step e reads its labels from the `GATE_LABELS` variable, because no PR exists locally.

Step j runs a real offline `cdk synth` for every environment of each CDK app that changed. A change to any of these paths triggers it: the `bin/` folder, the `lib/` folder, `cdk.json`, `package.json` or the CDK `tsconfig` file of the app, `src/` (project apps), `packages/cdk-constructs/src/**` and `package.json`, and the Rush lock. The output goes to a temp directory. The step uses no AWS credentials.

**Base commit.** The script `scripts/gates/gates-base.mjs` picks the base commit. It uses the first source that applies, in this order:

1. The `GATES_BASE` environment variable.
2. The merge base of `origin/main` and `HEAD`.
3. The merge base of the upstream branch and `HEAD`.
4. `.claude/state/gates-base`.
5. The root commit.

The runner prints `gates: base <sha> (<source>: <detail>)`. A bad value fails the run. The script does not try the next source.

The push guard uses another base (section 4.3.1, push rules). Agents must not set `GATES_BASE` or write `.claude/state/gates-base`. The agent Bash guard blocks both (section 3.2).

**Full run.** `GATES_FULL=1` runs every check. No check skips. Set it for a manual full run:

```
GATES_FULL=1 node common/scripts/install-run-rush.js gates
```

**Audits.** Each audit runs when its lock changed since the base (owner decision, 2026-10-23):

- `rush audit` (`bash scripts/security/audit.sh`) runs when `common/config/rush/pnpm-lock.yaml` changed.
- pip-audit runs for one project when `projects/<name>/src/api-py/uv.lock` changed. The runner calls the `security.sh` script of that part.
- govulncheck runs for one module when `projects/<name>/src/api-go/go.sum` changed. The runner calls the `security.sh` script of that part.

A failed audit fails the run. The audit of a lock that did not change skips. Run every audit with `bash scripts/gates/local-gates.sh --audit-only`, or with `GATES_FULL=1`. The planned nightly CI job calls `--audit-only`.

**Failure logs.** A failed runner step, a failed Stop hook run, and a failed `verify` skill run copy the logs to `.claude/state/failure-logs/<UTC time>-<step>/`. The time has the form `yyyymmddThhmmssZ`. The step part is the step name in lower case, with a `-` for each run of other characters.

- The folder holds a copy of each `rush-logs` folder (in `projects/`, `packages/`, `platform/` and `tooling/`) and each `test-results` folder (in `projects/`). Each copy keeps its path from the repo root.
- The file `failure.txt` holds the step name, the time, the copied folders, and the report.
- Only the 10 newest folders stay. The script deletes older folders.
- The message is `Logs kept in <path>. Read them before you rerun.` Read the logs before you run the step again.
- A failure to keep the logs never changes the result of the step.

The code is `scripts/gates/lib/failure-logs.mjs`. The runner calls `scripts/gates/keep-failure-logs.mjs`. `.gitignore` covers `.claude/state/`, so git does not track the logs.

**Push exemption.** A push can carry gate changes that the agent may push. The push guard (`git push` and `gh pr create` or `gh pr new`, section 3.1) lets the push go when every gate change in the range is one of these:

- `common/config/rush/pnpm-lock.yaml`, when the file is modified and the lock lint passes. The lock lint (`scripts/gates/lib/lock-lint.mjs`) checks the old and new lock:
  - The header is unchanged.
  - Each `packages` and `snapshots` key has the form `name@semver`.
  - Each resolution holds only an `integrity` value that starts with `sha`.
  - No specifier or version uses a URL, a git source, a tarball, or an `npm:` source. A `link:` target must stay inside `projects/`, `packages/`, `platform/` or `tooling/`.
  - The integrity of each key that appears in both locks is unchanged.
  - No `@vprprudhvi/*` key appears in `packages` or `snapshots`. An `importers` entry for an own-scope dependency must be a `link:` target. An alias to an own-scope name is rejected, and so is an own-scope dependency name in `snapshots`.
- `common/config/rush/repo-state.json`, when it holds only the Rush hash keys with hex values, and the same push also changes a lock that passes the lock lint. A change to `repo-state.json` alone blocks the push.
- `rush.json`, when the change only adds project entries. Every byte outside the `projects` array must be unchanged. Every existing entry must be unchanged and in the same order. Each new entry must match the text that `register-project.mjs` writes. No package name or folder name can repeat. Each added project must have a `projects/<name>/package.json` at HEAD that names `@vprprudhvi/<name>`. Removals, repoints, and edits block the push. An added project named `dist`, `node_modules` or `.next` blocks the push (reserved names).

The list is `pushExempt` in `scripts/gates/gate-files.json`. The checks are in `scripts/gates/lib/push-exempt.mjs`, `scripts/gates/lib/lock-lint.mjs` and `scripts/gates/lib/rush-json-compare.mjs`.

- A deleted file, a file type change, a deleted or symlinked lock, or any other gate file blocks the push.
- An added `pnpm-lock.yaml` is not exempt. Only a modified lock is.
- `uv.lock`, `go.mod` and `go.sum` are not exempt. A human pushes them.
- Uncommitted changes still block. Only committed changes in the range are exempt.
- The refusal message adds a `Not counted (...)` line when it ignores exempt files.
- Merging still needs CODEOWNERS approval (section 6.1).

**Push rules.** The `pre-push` hook applies these rules:

- Every pushed ref must be the checked-out commit. Otherwise the push fails with `push the checked-out commit only (git push origin HEAD:main)`.
- Tracked files must have no uncommitted change.
- A ref delete is allowed by this hook. The agent command guard blocks a delete (see the agent refspec rule below).
- Push one commit at a time. check-gates counts all unpushed commits as one PR. The pr-size limit is 10000 lines.
- A gate change in the range must pass the push exemption above.

**Push base.** The push guard compares the range with the merge base of `HEAD` and `origin/main`. If `origin/main` does not exist, it uses `origin/master`. If neither exists, it uses the root commit. The upstream branch is not used. So `git branch -u` and `git push -u` cannot change the base.

**Agent refspec rule.** The agent command guard (`require-verify`) applies these rules to `git push`, `gh pr create` and `gh pr new`:

- Each refspec source must be `HEAD`, the current branch, or a commit that `HEAD` contains. An ancestor of `HEAD` is allowed. A source that git cannot resolve blocks. Otherwise the guard blocks with `Push the current branch only.`
- The guard blocks a ref delete, a glob, `--all`, `--branches`, `--delete`, `--tags`, `--follow-tags`, `--mirror` and `--prune`. It also blocks their abbreviations and any short flag cluster that holds `d` or `f`, such as `-qd`.
- A push with no refspec blocks in these cases:
  - `remote.<name>.push` is set. When the command names no remote, the guard checks every remote.
  - `remote.<name>.mirror` is set, with any value. The guard checks the same remotes.
  - `push.default` is set to a value other than `simple`, `current` or `upstream`.
  - `push.default` is `upstream` and the merge branch is not `refs/heads/<current branch>`.
- The guard blocks `gh pr create --head <other branch>`.
- The guard reads command aliases. For example, `git p` is checked the same way as `git push`.

**Remote.** The `origin` remote is a local bare repository at `/Users/PrudhviGenie/Desktop/Dev/projects-monorepo.git`. The `repository.url` in `rush.json` is that path. `git push origin HEAD:main` runs the pre-push hook. `origin/main` moves only when the gates pass. A GitHub URL replaces this remote later. Run `git remote set-url origin <url>`.

**Not installed.** The owner decided not to install these tools. They do not run locally:

- TruffleHog: gitleaks covers secrets.
- OSV-Scanner: audit-ci, pip-audit and govulncheck cover dependencies, on each lock change and nightly.
- Checkov and cfn-lint: cdk-nag runs at `cdk synth`.
- njsscan: `eslint-plugin-security` and Opengrep cover it.
- dependency-cruiser: ESLint boundaries cover it.

They are planned for the CI workflows (section 4.4).

### 4.4 Pull request time (required CI checks)

Planned. CI is not set up yet. The local runner covers these checks where section 4.3.1 says so.

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

Planned. CI is not set up yet. The local runner covers these checks where section 4.3.1 says so.

| Workflow        | Check                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `nightly.yml`   | Stryker mutation tests, nightly review of old code, reviewer evals in `evals/reviewer/`, outdated and audit report. |
| `scorecard.yml` | OpenSSF Scorecard and SHA pin check, weekly.                                                                        |

### 4.6 Release time

Planned. CI is not set up yet. The local runner covers these checks where section 4.3.1 says so.

| Workflow       | Check                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `release.yml`  | Deploy to `prod`, after `local` (ADR 0011). `prod` needs a GitHub Environment approval. SBOM and container scan. |
| `rollback.yml` | Re-deploy the last good build or turn off a flag.                                                                |

### 4.7 Gate fixtures

The gate fixtures script proves that the local gates reject bad changes. It plants one bad change for each row of the plan in a throwaway git worktree. Then it runs the gate that must reject the change. A control fixture is a clean change that the gate must accept.

Run it from the repo root:

- `node scripts/gates/gate-fixtures.mjs` runs all fast fixtures and writes the report to `docs/standards/gate-fixtures.md`.
- `node scripts/gates/gate-fixtures.mjs --slow` also runs the cdk-nag fixtures.
- `node scripts/gates/gate-fixtures.mjs --only <id,...>` runs some fixtures and prints the report. It does not write the file.
- `node scripts/gates/gate-fixtures.mjs --list` prints the fixture ids.

The exit code is 0 when every fixture that ran passed. It is 1 when a bad change was not rejected, a control was rejected, or a setup step failed. Rows that only CI can prove show `SKIP (CI, later)`.

The script does not change a tracked file of the main working tree, except the report. Git writes the worktree record to `.git/worktrees`. A tool, such as ESLint or Vitest, can write its cache to a `node_modules` folder of the main working tree, because the worktree links to these folders.

A control fixture must exit 0. The anti-skip, dependency, and Bash guard controls must also print a sentinel text. The sentinel proves that the gate read the clean change, or that the command ran.

Some fixtures test a rule that is in a handoff file of agent A, B, or C. The report marks these fixtures with `needs agent A`, `needs agent B`, or `needs agent C`. These fixtures fail until a human applies the matching handoff files.

Ctrl-C (`SIGINT`) or `SIGTERM` stops the run after the current gate command. The script removes the worktree and exits with 130 or 143.

## 5. Labels

A label is a signal from a human or from a workflow. Only the listed setter can add the label.

| Label            | Set by                               | Meaning                                                                                           |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `risk:low`       | `risk-classify.yml`                  | Docs, copy, tests only, or additive change behind a flag.                                         |
| `risk:medium`    | `risk-classify.yml`                  | Normal code change.                                                                               |
| `risk:high`      | `risk-classify.yml` or `check-gates` | Auth, billing, infra, `platform/**`, shared packages, dependencies, `.github/**`, or a gate file. |
| `lint-exception` | Human only                           | Allows the lint disable count to rise.                                                            |
| `test-removal`   | Human only                           | Allows a PR to delete a test file or a test case.                                                 |
| `large-pr`       | Human only                           | Allows a PR above 10000 changed lines.                                                            |

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

### 6.4 A PR is larger than 10000 lines

check-gates warns above 2000 changed lines and fails above 10000 changed lines. The limits are in `scripts/gates/lib/pr-size.mjs`. Lockfiles, generated code and snapshots do not count.

1. Ask the author to split the PR into smaller PRs. Each PR must change one thing.
2. If the split is not possible, add the `large-pr` label. Write the reason in the PR.

### 6.5 A security finding is a false positive

1. Confirm that the finding is a false positive. Read the rule and the code.
2. Add an entry to the allowlist file. Use the file for the tool: `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, or `tooling/opengrep/**`.
3. Write the reason in the entry. For `audit-ci.jsonc`, also write an expiry date.
4. Get approval from `@vpr1995`.

Agents must not add an allowlist entry. See `docs/standards/security.md`.

### 6.6 A dependency must be added

A new npm dependency needs no human approval. The automatic policy checks it. A failed check means the agent stops and asks the human.

1. The agent runs `node common/scripts/install-run-rush.js add -p <package>` in the project folder. Add `--dev` for a dev dependency. Use `rush add`, not `npm`, `pnpm` or `yarn` directly.
2. The policy checks the new package:
   - License check (`rush license-check`), from `scripts/gates/dep-checks.mjs`.
   - `rush audit`, because `pnpm-lock.yaml` changed (section 4.3.1).
   - No install scripts. Only the packages in `onlyBuiltDependencies` run them (`common/config/rush/pnpm-config.json`).
   - Typosquat check (`scripts/gates/typosquat-check.mjs`, section 4.3.1). It flags a new name that looks like a known name. The name list is small and static (`scripts/gates/data/popular-npm-packages.json`, about 300 names). It catches only close lookalikes of listed names. The PR review by a human is the main control for new names.
   - Dependency spec rules (section 4.3.1). A version text can be a plain registry range or tag. A URL, a git source, a tarball, an `npm:` alias, or `catalog:` fails. A `file:` or `link:` path passes only when it resolves inside the repo. A `@vprprudhvi/*` dependency must use a `workspace:` version.
3. If a check fails, the agent stops. The agent tells the human the package, the version and the failed check. The agent does not add an allowlist entry (section 6.5) and does not change a policy file.
4. If every check passes, the agent commits the `package.json` change and each file that the command changed under `common/config/rush/` (for example `pnpm-lock.yaml` and `repo-state.json`) together with the change that needs them. Check with `git status --short`.
5. The agent pushes the commit when the push exemption applies (section 4.3.1). If `rush add` changed another file under `common/config/rush/`, a human pushes the commit.
6. A reviewer reads the lockfile diff and the license, the age and the maintainers of the new package. Merging needs CODEOWNERS approval (section 6.1).
7. The agent lists each new package with its version and license in its final report.

For Python and Go, the agent writes the `uv add`, `go get` or `go mod tidy` command to a handoff file (`NN-commands.txt`, section 2.4). A human runs the command. The runner runs pip-audit or govulncheck when `uv.lock` or `go.sum` changed.

### 6.7 A release must stop

Use `docs/runbooks/rollback.md`.

### 6.8 A project must be added to `rush.json`

The agent adds a project with the script `scripts/gates/register-project.mjs`. The agent does not edit `rush.json` in another way.

1. Make `projects/<name>/package.json` with the name `@vprprudhvi/<name>`. The name must match `^[a-z][a-z0-9-]{1,40}$`.
2. Run `node scripts/gates/register-project.mjs <name>`.
3. The script adds `{ "packageName": "@vprprudhvi/<name>", "projectFolder": "projects/<name>", "shouldPublish": false, "tags": ["project/<name>"] }` to the `projects` list in sorted order. It keeps all comments. It reads the file again to check the result.
4. The script refuses a duplicate name or folder, a missing folder, a missing `package.json`, or a wrong package name. Then `rush.json` does not change. Exit code: 0 done, 1 refused, 2 bad usage or a bad name.
5. Run `node common/scripts/install-run-rush.js update`. The script prints this command as the next step.
6. Commit `rush.json` and each file that `rush update` changed under `common/config/rush/` together with the project. Check with `git status --short`. The agent pushes the commit when the push exemption applies (section 4.3.1). Otherwise a human pushes it.

To remove an entry, run `node scripts/gates/register-project.mjs --remove <name>`.

## 7. Rules for agents

- Do not edit a gate file. The hook blocks the edit.
- Write the new content of a gate file to the handoff folder (section 2.4).
- Run `rush add -p <pkg>` only through the dependency policy (section 6.6). Stop and ask the human when a policy check fails. Run `rush update` only after `register-project.mjs` (section 6.8). Write `uv add`, `go get` and `go mod tidy` to the handoff folder.
- Push a commit with a gate change only when the push exemption applies (section 4.3.1). A human pushes any other gate change.
- Push only the checked-out commit (`HEAD`) to the current branch. Do not use another refspec, a delete, a glob, `--all` or `--branches` (section 4.3.1).
- Do not set `GATES_BASE`. Do not write `.claude/state/gates-base` (section 3.2).
- Change `rush.json` only with `node scripts/gates/register-project.mjs` (section 6.8).
- When a gate fails, read the folder in the `Logs kept in <path>` line before you run the gate again.
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
