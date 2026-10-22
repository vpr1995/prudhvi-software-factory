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

There are three kinds of protected path. Each kind has a different rule for agents.

| Kind | Agent may edit? | Who approves | Section |
|---|---|---|---|
| Hook-blocked gate file | No. The hook blocks the edit. | A human, outside the agent session. | 2.1 |
| Human-reviewed document | Yes, as a proposal. The hook does not block it. | CODEOWNERS (`@vprprudhvi`). | 2.2 |
| Always-human path (high risk) | Yes, as a proposal. The hook does not block it. | CODEOWNERS and `risk:high`. | 2.3 |

### 2.1 Hook-blocked gate files

A gate file controls quality, security, or release. Agents must not edit gate files. The list below matches the protected paths in the `protect-gates.sh` hook, the `permissions.deny` list in `.claude/settings.json`, and `CODEOWNERS`.

| Path pattern | Why it is a gate |
|---|---|
| `.github/**` | CI workflows, PR template, rulesets. |
| `CODEOWNERS` | Owner rules for review. |
| `.claude/settings.json` | Agent permissions and hooks. |
| `.claude/hooks/**` | Hook scripts that block agent actions. |
| `tooling/**` | ESLint, TypeScript, Vitest, Opengrep rules, license allowlist. |
| `.gitleaks.toml` | Secret scan rules and allowlist. |
| `audit-ci.jsonc` | Dependency audit allowlist. |
| `.checkov.yaml` | IaC scan settings and skips. |
| `docs/standards/coding-conventions.md` | Coding rules that reviewers and linters use. |
| `common/config/rush/**` | Rush config, command list, and `pnpm-lock.yaml`. |
| `common/git-hooks/**` | Git hook scripts. |
| `common/autoinstallers/**` | Tool versions for hooks and CI. |
| `rush.json` | Rush project list and tool versions. |
| `scripts/check-gates.ts` | Gate integrity check. |
| `scripts/classify-risk.ts` | Risk tier classifier. |
| `**/rush-project.json` | Per-project Rush build settings. |
| `eslint.config.*` | ESLint entry point. |
| `tsconfig*.json` | TypeScript settings. |
| `vitest.config.*` | Test runner settings and coverage thresholds. |
| `.dependency-cruiser.*` | Import boundary rules. |
| `**/cdk.json` | CDK app settings. |
| `**/playwright.config.*` | Playwright settings: browsers, retries, and test match rules. |
| `tooling/python/**` | Shared Python tool settings (ruff, mypy, pytest). |
| `tooling/go/**` | Shared Go tool settings (golangci-lint, gofumpt). |
| `**/pyproject.toml` | Python project and tool settings. The whole file is a gate file. |
| `**/.golangci.yml` | Go lint rules. |
| `**/uv.lock` | Python dependency lock. |
| `**/go.sum` | Go dependency checksums. |

Security rule files are also gate files. They include `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `tooling/opengrep/**`, and `tooling/license-allowlist.json`.

Hook-blocked gate files do not include the files in sections 2.2 and 2.3 (one exception follows the table in 2.2). The reason: an agent can propose a fix to a review rule or to project documentation, and a human approves that fix.

### 2.2 Human-reviewed documents (not hook-blocked)

Agents can propose edits to these files. The article practice is to fix a recurring review finding at its source. A human must approve each edit through CODEOWNERS.

| Path pattern | Why it is reviewed |
|---|---|
| `CLAUDE.md` | Agent instructions. |
| `AGENTS.md` | Symlink to `CLAUDE.md`. |
| `**/CLAUDE.md`, `**/AGENTS.md` | Nested agent instructions. Each `AGENTS.md` is a symlink to the `CLAUDE.md` beside it. |
| `docs/guides/**` | Per-kind how-to guides that the `CLAUDE.md` files link to. |
| `REVIEW.md` | Root review rules for the AI reviewer. |
| `projects/*/REVIEW.md` | Review rules for one project. |
| `platform/REVIEW.md` | Review rules for the platform. |
| `docs/templates/**` | Per-kind review templates. |
| `docs/standards/**` (except `coding-conventions.md`) | Standards documents. |

`tooling/CLAUDE.md` and `.github/CLAUDE.md` match the patterns `tooling/**` and `.github/**` in section 2.1. Section 2.1 wins. The hook blocks agent edits to these two files. An agent writes the proposed text in its final message.

CODEOWNERS status: `.github/CODEOWNERS` lists only `/CLAUDE.md` and `/AGENTS.md` for the agent documents. No line covers nested `**/CLAUDE.md`, `**/AGENTS.md`, or `/docs/guides/`. Until a human adds those lines, CODEOWNERS does not enforce approval for them. Needed lines: `**/CLAUDE.md @vprprudhvi`, `**/AGENTS.md @vprprudhvi`, `/docs/guides/ @vprprudhvi`. `.github/CODEOWNERS` is a gate file (section 2.1).

### 2.3 Always-human paths (high risk)

Agents may propose edits to these paths. Each change is `risk:high`. A human approves each change. See `docs/standards/risk-tiers.md`.

| Path pattern | Why it is always human |
|---|---|
| `platform/**` | Shared AWS resources (Cognito user pool, hosted zone, certificate, SSM parameters). Every project depends on them. |
| `packages/**` | Shared code. A change has a wide effect. |
| `projects/*/infra/**` | Cloud resources and IAM for one project. |

## 3. Layers that protect the gates

| Layer | Where | What it does |
|---|---|---|
| 1. Agent hook | `.claude/hooks/protect-gates.sh` | Blocks an agent edit to a gate file. Exit code 2. |
| 2. Permission rules | `.claude/settings.json` `deny` | Blocks agent writes to gate files. Second layer. |
| 3. Code owners | `CODEOWNERS` | A code owner must approve a gate file change. |
| 4. Risk label | CI `check-gates` job | Sets `risk:high` when a gate file changes. |
| 5. Lint rules | `tooling/eslint-config` | Blocks `any`, `@ts-ignore`, focused or skipped tests, and disables without a description. |
| 6. Ruleset | GitHub `main` ruleset | No bypass for administrators on `main`. |

## 4. Checks by stage

### 4.1 Agent edit time

| Check | Trigger | Result |
|---|---|---|
| Gate file block | Edit to a gate file | Edit blocked. |
| Secret block | Edit that adds a secret pattern | Edit blocked. |
| Format and lint | Edit to a source file | Prettier and ESLint fix the file. Errors return to the agent. |
| Typecheck | Edit to a source file | `tsc --noEmit` on the owning project. |

### 4.2 Agent stop time

The Stop hook runs these checks on the session diff. It blocks the stop when a check fails. The test checks are described in `docs/standards/testing.md`.

| Check | Result when it fails |
|---|---|
| Build, typecheck, lint, test on impacted projects | Stop blocked. |
| Anti-skip scan | Stop blocked. The diff adds a skip, a disable, or a deleted test. Python, Go, Bruno, and Playwright patterns are listed in `docs/standards/testing.md`, section 4. |
| Gitleaks on the diff | Stop blocked. |
| Opengrep on changed files | Stop blocked on `ERROR` findings. |
| `cdk synth` and cdk-nag when `infra` changed | Stop blocked. |
| `rush e2e` for impacted web and api parts (Bruno, Playwright, axe) | Stop blocked. |

### 4.3 Commit and push time

| Hook | Check | Blocks when |
|---|---|---|
| `pre-commit` | `lint-staged`, Prettier, ESLint with `--max-warnings 0`, gitleaks on staged files, gate-file warning, large-file check, conflict markers, `.env*` | Any step fails. |
| `commit-msg` | commitlint | Commit message is not Conventional Commits. |
| `pre-push` | `rush change --verify`, impacted build and test, typecheck, `audit-ci`, license check, Opengrep, Checkov when infra changed | Any step fails. |
| `post-checkout`, `post-merge` | Lockfile changed | Never blocks. Prints `rush install`. |

Git hooks install on `rush install`. See `docs/onboarding.md`.

### 4.4 Pull request time (required CI checks)

| Workflow | Checks |
|---|---|
| `ci.yml` | `rush install` with frozen lockfile, `rush check`, `rush change --verify`, impacted build, lint, typecheck, tests with coverage, diff coverage, `rush e2e` (Bruno and Playwright with axe), gate integrity (`check-gates`, including `bruno-coverage` and `playwright-coverage`), dependency-cruiser. |
| `sast.yml` | Opengrep, njsscan, gitleaks (PR range), TruffleHog (verified only), zizmor, pinact. |
| `deps.yml` | audit-ci, OSV-Scanner on `common/config/rush/pnpm-lock.yaml`, license check, new-dependency report. |
| `infra.yml` | Per impacted project: `cdk synth`, cdk-nag, Checkov, `cdk diff` posted as a PR comment. |
| `claude-review.yml` | AI review with severity tags. Open review threads block merge. Security review action. |
| `risk-classify.yml` | Sets `risk:low`, `risk:medium`, or `risk:high`. Ruleset checks approvals for the tier. |

### 4.5 Scheduled checks

| Workflow | Check |
|---|---|
| `nightly.yml` | Stryker mutation tests, nightly review of old code, reviewer evals in `evals/reviewer/`, outdated and audit report. |
| `scorecard.yml` | OpenSSF Scorecard and SHA pin check, weekly. |

### 4.6 Release time

| Workflow | Check |
|---|---|
| `release.yml` | Deploy to `dev`, then `staging`, then `prod`. `prod` needs a GitHub Environment approval. SBOM and container scan. |
| `rollback.yml` | Re-deploy the last good build or turn off a flag. |

## 5. Labels

A label is a signal from a human or from a workflow. Only the listed setter can add the label.

| Label | Set by | Meaning |
|---|---|---|
| `risk:low` | `risk-classify.yml` | Docs, copy, tests only, or additive change behind a flag. |
| `risk:medium` | `risk-classify.yml` | Normal code change. |
| `risk:high` | `risk-classify.yml` or `check-gates` | Auth, billing, infra, `platform/**`, shared packages, dependencies, `.github/**`, or a gate file. |
| `lint-exception` | Human only | Allows the lint disable count to rise. |
| `test-removal` | Human only | Allows a PR to delete a test file or a test case. |
| `large-pr` | Human only | Allows a PR above 1000 changed lines. |

Agents must not add or remove these labels.

## 6. How a human passes a blocked check

Use the matching procedure. Do not use a procedure that is not listed.

### 6.1 A gate file must change

1. Read the agent request and the reason for the change.
2. Make the change on a branch. Or ask the code owner to make it.
3. Open a PR. Check that the risk label is `risk:high`.
4. Get approval from a code owner. The tier needs the approvals in `docs/standards/risk-tiers.md`.
5. Merge only after all required checks pass.

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

1. The agent runs `rush add -p <package>`. Do not use `npm` or `pnpm` directly.
2. Read the new-dependency report in the PR comment.
3. Check the license, the age, and the maintainers.
4. Approve as a code owner. The lockfile change needs a human.

### 6.7 A release must stop

Use `docs/runbooks/rollback.md`.

## 7. Rules for agents

- Do not edit a gate file. The hook blocks the edit.
- Open a PR for a change to a file in section 2.2 or 2.3. Do not merge it.
- Do not add `--no-verify` to a git command.
- Do not add a skip, a focused test, or a disable comment to pass a check.
- Do not lower a coverage threshold.
- Do not add or remove a label.
- Do not add an allowlist entry.
- If a gate blocks you, read the message. Fix the cause. Then run the check again.
- If a gate looks wrong, stop. Tell the human what is wrong and why.

## 8. End-to-end gates (Bruno and Playwright)

| Gate | What it checks | Where it runs | Blocks when |
|---|---|---|---|
| `bruno-coverage` | Each route in the `<project>-contracts` OpenAPI output has a `.bru` request with the same method and path, and at least one assertion. | `check-gates`, `ci.yml` | A route has no such request. |
| `playwright-coverage` | Each `app/**/page.tsx` route has a spec with `page.goto` and an axe check. A web part needs an `e2e/` folder. | `check-gates`, `ci.yml` | A page has no such spec, or the folder is missing. |
| Anti-skip (e2e) | No `test.skip`, `test.fixme`, `test.fail`, `test.only`, `skip-request`, or a `.bru` request with no assertion, in the diff. | Stop hook, CI | The diff adds one of these patterns. |
| `rush e2e` | Bruno collection and Playwright suite run against a started server. | Stop hook, `ci.yml`, merge queue | A request or a spec fails. |

