# Plan: Agent-Safe Rush Monorepo (copy)

Copy of the approved plan from `~/.claude/plans/i-want-to-build-inherited-starfish.md`, kept in the repo so a new session can resume. Section 13 holds the status at the Wave 2 pause. The live resume guide is [status.md](status.md).

## Context

The repo `projects-monorepo` is empty. It has no commits. The branch is `master`.

Agents will write most of the code in this repo. Humans will not read each diff. The gates must keep the code quality high. The gates must also be hard to weaken.

This plan applies the layered flow from the article "Solving code review at Anthropic":

1. Verify work before the PR.
2. Run AI review and security review on each PR.
3. Run blocking CI.
4. Set human approval by risk.
5. Use a merge queue.
6. Use flags and staged release.
7. Make rollback fast.

User decisions:

- Monorepo tool: **Rush.js**, with pnpm.
- Layout: `projects/<name>/`. Each project has its own `contracts`, plus **Next.js** (web), **Fastify** (api), or both, plus its own CDK `infra`.
- Infrastructure as code: **AWS CDK**.
- CI: **GitHub + GitHub Actions**.
- Scope: full scaffold. It includes two sample projects, and they pass all gates.

Rule for all phases: **each phase leaves the repo green.** Make a commit at the end of each phase.

---

## 1. Repo layout

```
.claude/
  settings.json            # hooks + permissions (gate file)
  hooks/                   # hook scripts (gate files)
  skills/                  # project skills
  agents/                  # fresh-context reviewer subagents
.github/
  workflows/               # CI (gate files, always-human)
  CODEOWNERS
  pull_request_template.md
  rulesets/                # JSON for the gh api script
projects/
  <project-name>/          # one product. Each part below is one Rush project.
    contracts/             # Zod schemas + types for THIS project only (always present)
    web/                   # Next.js (App Router) – optional
    api/                   # Fastify – optional
    infra/                 # AWS CDK app for THIS project (stacks for its web/api)
  sample-fullstack/        # sample: contracts + web + api + infra
  sample-api-only/         # sample: contracts + api + infra
packages/                  # shared, project-neutral code
  flags/                   # feature flag client (typed flag names)
  logger/                  # pino wrapper
  result/                  # Result<T, E> + AppError base
  cdk-constructs/          # shared, cdk-nag-clean L3 constructs (api service, web site)
tooling/
  eslint-config/           # flat config (gate file)
  tsconfig/                # base tsconfigs (gate file)
  vitest-config/           # shared config + coverage thresholds (gate file)
common/
  config/rush/             # rush configs, command-line.json, pnpm-lock (gate files)
  git-hooks/               # pre-commit, commit-msg, pre-push
  autoinstallers/          # lint-staged, commitlint, prettier
evals/reviewer/            # incident cases for the reviewer
scripts/                   # gate scripts (check-gates, classify-risk, gh-setup)
CLAUDE.md  REVIEW.md  AGENTS.md -> CLAUDE.md symlink
docs/  (adr/, standards/, runbooks/)
rush.json
```

Rush project names: `@<project>/contracts`, `@<project>/web`, `@<project>/api`, `@<project>/infra`, `@shared/<pkg>`, `@tooling/<pkg>`.

Rush tags: `project:<name>`, `kind:web|api|contracts|infra`, `shared`, `tooling`. Use `rush build --only tag:project:<name>` to build one product.

A project has `contracts` + at least one of `web` / `api`. The `new-project` skill makes the folders and adds the Rush entries.

Only `packages/*` get `shouldPublish: true`. Project parts and tooling do not publish. This stops change-file noise. `rush change --verify` only checks projects that publish.

Import rules (enforced in §2.2):

- `web` → own `contracts` + `packages/*`. Never `api`.
- `api` → own `contracts` + `packages/*`. Never `web`.
- `contracts` → only `zod`. No imports from `web`, `api`, `infra`.
- `infra` → own `contracts` (types only) + `packages/cdk-constructs`.
- A project never imports another project. Shared code goes to `packages/*` (needs a human, see CODEOWNERS).
- `packages/*` never import from `projects/*`.

Next.js uses shared packages through **built `dist` output**. It does not use `transpilePackages`. Reason: each package then has one build path, and the Rush build cache works.

---

## 2. Standards (TypeScript-first)

### 2.1 TypeScript (`tooling/tsconfig`)

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`.
- ESM only. Use project references for type checks.

### 2.2 ESLint flat config (`tooling/eslint-config`)

- Base: `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`.
- Plugins:
  - `eslint-plugin-boundaries`: the import rules in §1 (element types from the `projects/<name>/<kind>` path; cross-project imports are errors).
  - `eslint-plugin-import-x`: no cycles, no extraneous deps.
  - `eslint-plugin-unicorn`: subset.
  - `eslint-plugin-sonarjs`: cognitive complexity ≤ 15.
  - `eslint-plugin-security`.
  - `@eslint-community/eslint-plugin-eslint-comments`: `require-description`, `no-unlimited-disable`.
  - `eslint-plugin-vitest`: `no-focused-tests`, `no-disabled-tests`, `expect-expect`.
  - `eslint-plugin-react`, `react-hooks`, `jsx-a11y`, `@next/eslint-plugin-next` (web only).
  - `eslint-plugin-n` (api only).
  - `eslint-plugin-awscdk` or custom rules (infra): no hard-coded account IDs, no `RemovalPolicy.DESTROY` on stateful resources outside `dev`.
- Key rules: `no-explicit-any`, `ban-ts-comment` (no `@ts-ignore`; `@ts-expect-error` needs a description), `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, `no-console` (use logger), `max-lines` 400 per file, `max-lines-per-function` 80, `no-restricted-imports` (no `lodash` full import, no `moment`, no direct `process.env` outside `config.ts`).
- `linterOptions.reportUnusedDisableDirectives: "error"`.
- Inline disables: each disable needs a description. CI counts disables. CI fails if the count goes up and the PR has no `lint-exception` label from a human.
- Run with `--max-warnings 0`.

### 2.3 Format and commits

- Prettier (autoinstaller). Rush runs `rush prettier` through lint-staged.
- Conventional Commits through commitlint.

### 2.4 Coding conventions (`docs/standards/coding-conventions.md`, linked from CLAUDE.md)

Rule: **each convention has a tool that enforces it.** A convention with no enforcer goes in REVIEW.md, so the AI reviewer checks it. Format of each entry in the doc: rule → good example → bad example → enforcer.

**A. Naming**

| Thing                      | Convention                                                                | Example                             | Enforcer                                               |
| -------------------------- | ------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| Variables, parameters      | camelCase                                                                 | `orderTotal`, `userId`              | `@typescript-eslint/naming-convention`                 |
| Functions, methods         | camelCase, verb first                                                     | `getUser()`, `calculateTax()`       | naming-convention                                      |
| Booleans                   | camelCase with `is/has/should/can` prefix                                 | `isActive`, `hasAccess`             | naming-convention (`types: ['boolean']`)               |
| Types, interfaces, classes | PascalCase, no `I`/`T` prefix                                             | `UserProfile`, not `IUserProfile`   | naming-convention                                      |
| React components           | PascalCase                                                                | `OrderSummary`                      | naming-convention + `react/jsx-pascal-case`            |
| React hooks                | camelCase with `use` prefix                                               | `useOrderTotal`                     | `react-hooks/rules-of-hooks`                           |
| Module-level constants     | UPPER_SNAKE_CASE (primitives only)                                        | `MAX_RETRY_COUNT`                   | naming-convention                                      |
| Zod schemas                | PascalCase + `Schema`; inferred type has the same name without `Schema`   | `CreateOrderSchema` → `CreateOrder` | custom lint rule in `tooling/eslint-config`            |
| Generic type params        | PascalCase, descriptive, `T` prefix allowed                               | `TItem`, `TResponse`                | naming-convention                                      |
| Files and folders          | kebab-case                                                                | `order-summary.tsx`, `get-user.ts`  | `unicorn/filename-case`                                |
| Test files                 | `<file>.test.ts(x)` next to the source; e2e in `e2e/*.spec.ts`            | `get-user.test.ts`                  | vitest `include` glob + `check-gates.ts`               |
| Env vars                   | UPPER_SNAKE_CASE, prefixed per project                                    | `SAMPLE_API_DB_URL`                 | Zod env schema in `config.ts`                          |
| API paths                  | kebab-case, plural nouns, versioned                                       | `/v1/order-items/:orderItemId`      | custom lint rule on route registration + contract test |
| JSON fields in API         | camelCase                                                                 | `{ "createdAt": ... }`              | Zod schemas in `contracts`                             |
| CDK construct IDs          | PascalCase                                                                | `new Bucket(this, 'AssetsBucket')`  | custom lint rule (infra)                               |
| AWS resource names         | do not set; let CDK generate                                              | —                                   | cdk-nag + custom rule                                  |
| Branches                   | `<type>/<short-kebab>`                                                    | `feat/order-export`                 | `commit-msg`/CI branch-name check                      |
| Abbreviations              | Write full words. Allowed list: `id`, `url`, `api`, `db`, `env`, `config` | `userId`, not `uid`                 | `unicorn/prevent-abbreviations` with allowlist         |

**B. Types and language**

- Use `type`, not `interface` (one way). Enforcer: `consistent-type-definitions: type`.
- No TS `enum`. Use `as const` objects + union types. Enforcer: `no-restricted-syntax` on `TSEnumDeclaration`.
- No `any`. Use `unknown` and narrow. No non-null `!`. Enforcer: `no-explicit-any`, `no-non-null-assertion`.
- No type casts with `as` except `as const`. Enforcer: `consistent-type-assertions: never` (allow `as const`).
- Explicit return types on exported functions. Enforcer: `explicit-module-boundary-types`.
- `import type` for type-only imports. Enforcer: `consistent-type-imports`.
- Named exports only. No default exports, except where Next.js requires them (`page.tsx`, `layout.tsx`, `route.ts`, config files). Enforcer: `import-x/no-default-export` with overrides.
- No barrel files (`index.ts` that re-exports) inside a project; one `index.ts` only at the package root. Enforcer: custom rule / `no-restricted-imports`.
- Import order: node built-ins → external → `@shared/*` → own project → relative. Enforcer: `import-x/order`.
- `const` by default. No `let` unless reassigned. No `var`. Enforcer: `prefer-const`, `no-var`.
- `async/await`, not `.then()` chains. Enforcer: `promise/prefer-await-to-then`.
- Immutable data: `readonly` on props and arrays in exported types. Enforcer: `prefer-readonly-parameter-types` (off for React props types; warn level in review).
- Use `===` only. Enforcer: `eqeqeq`.
- No magic numbers outside tests. Enforcer: `no-magic-numbers` (ignore 0, 1, -1).
- Max 3 function parameters; use an options object above that. Enforcer: `max-params: 3`.
- Max nesting depth 3. Use early returns. Enforcer: `max-depth`, `no-else-return`.

**C. Errors and logging**

- Domain functions return `Result<T, E>` (small helper in `packages/result`). Throw only for bugs (invariants). Enforcer: REVIEW.md + `no-throw-literal`.
- Error classes extend `AppError` with a `code` string in UPPER_SNAKE_CASE. Enforcer: custom rule.
- API errors use one envelope: `{ error: { code, message, requestId } }`. Enforcer: contract schema + Fastify error handler test.
- Log with `@shared/logger` only. Structured fields, no string concatenation. Never log secrets or PII fields (redact list in logger). Enforcer: `no-console`, Opengrep custom rule.

**D. Folder layout per kind**

- `api/src/`: `routes/<resource>/` (handler + schema wiring), `domain/` (pure logic, no Fastify), `adapters/` (DB, HTTP clients), `config.ts`, `server.ts`. `domain` cannot import `adapters` or `fastify`. Enforcer: boundaries rule.
- `web/src/`: `app/` (Next.js routes), `components/`, `features/<feature>/`, `lib/` (api client from `contracts`). Server Components by default; `"use client"` only in leaf components. Enforcer: boundaries + REVIEW.md.
- `contracts/src/`: one file per resource. Only Zod + types. No runtime logic. Enforcer: boundaries + dependency-cruiser.
- `infra/src/`: `stacks/`, `constructs/` (project-only), `config/<env>.ts`. Enforcer: boundaries.

**E. Comments and docs**

- Comments say _why_, not _what_. TSDoc on each exported function, type, and construct. Enforcer: `jsdoc/require-jsdoc` for exports.
- `TODO` needs an issue link: `TODO(#123): ...`. Enforcer: `no-warning-comments` + custom regex rule.
- No commented-out code. Enforcer: `sonarjs/no-commented-code`.

**F. Size and change rules**

- Validate all input at boundaries with Zod from the project's own `contracts`. API routes use `fastify-type-provider-zod`. Web uses the same schemas to parse responses.
- Read config once in `config.ts` through a Zod-parsed env. Do not read `process.env` elsewhere.
- Put each new user-visible behavior behind a flag from `packages/flags`.
- Each bug fix adds a test that fails before the fix.
- Each PR changes one thing. Soft limit: 400 changed lines. CI warns above 400 and needs a `large-pr` label from a human above 1000.

The conventions doc is a gate file. Agents propose changes in a PR; humans approve.

### 2.5 Tests

- Vitest for all TS projects. Coverage thresholds in `tooling/vitest-config`: lines 80, branches 75. CI also checks **diff coverage ≥ 90%** for changed lines (`diff-cover` style script on lcov).
- API: `fastify.inject()` integration tests. Contract tests check that routes match the project's `contracts`.
- Web: Testing Library for components. Playwright for e2e and screenshot checks. `axe` checks in Playwright.
- Infra: CDK assertions (`Template.fromStack`), snapshot tests, and `cdk-nag` (AwsSolutions pack). Unresolved nag errors fail synth.
- Mutation testing (Stryker) on each `contracts` and api domain code. Nightly only, not on each PR.
- A test-deletion check: CI fails if the PR removes a test file or a test case and has no `test-removal` label from a human.

---

## 2A. Git hooks (`common/git-hooks/`)

Rush copies these files to `.git/hooks` on `rush install`. Each hook calls a Rush command, so the same logic runs in CI. Tools come from autoinstallers (no global installs).

| Hook                           | Runs                                                                                                                                                                                                                                                            | Blocks when    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `pre-commit`                   | `lint-staged`: Prettier, `eslint --max-warnings 0` on staged files, `gitleaks protect --staged`, gate-file check (warn the human; agent edits are blocked earlier by the Claude hook), large-file check (> 1 MB), no merge-conflict markers, `.env*` not staged | Any step fails |
| `prepare-commit-msg`           | Add the branch ticket id to the message, if present                                                                                                                                                                                                             | Never blocks   |
| `commit-msg`                   | `commitlint` (Conventional Commits, type list, scope = Rush project or project name), `Co-Authored-By` kept                                                                                                                                                     | Bad format     |
| `pre-push`                     | `rush change --verify`, `rush build -t` + `rush test` for impacted projects (`--impacted-by git:origin/main`), `rush typecheck`, `audit-ci`, license check, Opengrep on changed files, Checkov if infra changed                                                 | Any step fails |
| `post-checkout` / `post-merge` | If the lockfile changed: print "run `rush install`"                                                                                                                                                                                                             | Never blocks   |

Notes:

- Git hooks install only on `rush install`. `docs/onboarding.md` and the SessionStart Claude hook say this.
- `--no-verify` skips git hooks. The Claude `guard-bash.sh` hook blocks `--no-verify` for agents. CI runs all checks again for humans.

---

## 2B. Security gates: SAST, secrets, licenses, dependency audit

Rule: **use only open-source tools that run locally and in CI with no paid license.** Each tool runs the same command in the git hook and in CI (one script in `scripts/security/`, called from both).

Each control runs in three places where it is possible: **agent edit time** (Claude hook), **commit/push time** (git hook), **PR time** (CI, required check). CI is the real gate.

| Control                         | Open-source tool (license)                                                                                                                                                                                          | Agent edit                                       | Git hook                                 | CI (required)                                                  | Nightly             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------- | ------------------- |
| Secret scan                     | **gitleaks** (MIT), custom rules: AWS keys, JWT, private keys, `.env` values                                                                                                                                        | `block-secrets.sh` (gitleaks on the new content) | pre-commit (`gitleaks protect --staged`) | `sast.yml`: scan PR commit range                               | full git history    |
| Verified-secret scan            | **TruffleHog** OSS (AGPL, used as a CLI only) `--only-verified`                                                                                                                                                     | —                                                | —                                        | `sast.yml`                                                     | full git history    |
| SAST (rules + taint)            | **Opengrep** (LGPL-2.1, open fork of Semgrep CE). Rulesets vendored into `tooling/opengrep/` (TS, Node, React, Next.js, Express/Fastify, JWT, SSRF, path traversal) + our custom rules                              | —                                                | pre-push (changed files)                 | `sast.yml`, SARIF to PR annotations; any `ERROR` finding fails | full repo           |
| SAST (lint)                     | `eslint-plugin-security`, `eslint-plugin-no-unsanitized` (MPL-2.0), `eslint-plugin-xss`                                                                                                                             | PostToolUse lint                                 | pre-commit                               | lint job                                                       | —                   |
| SAST (Node specific)            | **njsscan** (LGPL-3.0)                                                                                                                                                                                              | —                                                | —                                        | `sast.yml`                                                     | —                   |
| AI security review              | `anthropics/claude-code-security-review` action (MIT), `/security-review`                                                                                                                                           | `pre-pr` skill                                   | —                                        | `claude-review.yml`; open findings block merge                 | —                   |
| IaC scan                        | **cdk-nag** (Apache-2.0) at synth (AwsSolutions pack); **Checkov** (Apache-2.0) on `cdk.out` templates; **cfn-lint** (MIT-0)                                                                                        | —                                                | pre-push (infra changed)                 | `infra.yml`                                                    | —                   |
| Dependency audit                | **audit-ci** (Apache-2.0) with `--pnpm`, `high: true`, allowlist in `audit-ci.jsonc` (each entry has a reason + expiry date)                                                                                        | `guard-bash.sh` blocks raw `npm/pnpm install`    | pre-push                                 | `deps.yml`                                                     | report + open issue |
| Dependency audit (2nd source)   | **OSV-Scanner** (Apache-2.0) on `common/config/rush/pnpm-lock.yaml`                                                                                                                                                 | —                                                | —                                        | `deps.yml`                                                     | yes                 |
| License check                   | **license-checker-rseidelsohn** (BSD-3) with allowlist (MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, MPL-2.0 for tools only); deny GPL/AGPL/SSPL/unknown in runtime deps                                                    | —                                                | pre-push                                 | `deps.yml`                                                     | —                   |
| New dependency control          | `rush add` only; `strictPeerDependencies`; Rush `ensureConsistentVersions`; lockfile = gate file; `scripts/security/new-deps.ts` lists new deps in a PR comment (name, license, weekly downloads, age, maintainers) | hook                                             | —                                        | `rush check` + CODEOWNERS on lockfile → new deps need a human  | —                   |
| Malicious / typo-squat packages | `pnpm` `minimumReleaseAge` (block versions < 3 days old) + `onlyBuiltDependencies` allowlist (no unknown install scripts)                                                                                           | —                                                | —                                        | `rush install` fails                                           | —                   |
| Supply chain (CI)               | Actions pinned by SHA, checked by **pinact** (MIT); **zizmor** (MIT) audits workflow files; **OpenSSF Scorecard** (Apache-2.0)                                                                                      | —                                                | —                                        | `sast.yml` (zizmor, pinact)                                    | Scorecard weekly    |
| SBOM                            | **cdxgen** / `@cyclonedx/cyclonedx-npm` (Apache-2.0) per deployable                                                                                                                                                 | —                                                | —                                        | `release.yml` artifact                                         | —                   |
| Container scan (if Fargate)     | **Trivy** (Apache-2.0) image + filesystem                                                                                                                                                                           | —                                                | —                                        | `release.yml`                                                  | yes                 |

GitHub-only features (CodeQL on private repos, secret-scanning push protection, dependency-review action) need GitHub Advanced Security on private repos. Plan: do not depend on them. If the repo is public or has GHAS, turn them on as an extra layer in `gh-setup.sh`.

Allowlists and rule files (`.gitleaks.toml`, `tooling/opengrep/**`, `audit-ci.jsonc`, `tooling/license-allowlist.json`, `.checkov.yaml`) are gate files.

False positives: a human adds an entry to the allowlist with a reason. The agent cannot (gate file).

---

## 3. Claude Code hooks (`.claude/settings.json`)

Hooks read JSON from stdin. Exit code 2 blocks the action and sends stderr back to Claude.

| Event            | Matcher                             | Script                 | Action                                                                                                                                                                                                                                                     |
| ---------------- | ----------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SessionStart     | —                                   | `session-start.sh`     | Print the branch, the gate summary, and "run `rush install` if `common/temp` is missing".                                                                                                                                                                  |
| PreToolUse       | `Edit\|Write\|MultiEdit`            | `protect-gates.sh`     | Block edits to gate files (list in §6). Message: "Gate file. Ask the human."                                                                                                                                                                               |
| PreToolUse       | `Edit\|Write\|MultiEdit`            | `block-secrets.sh`     | Block content that matches secret patterns (AWS keys, private keys, `.env` values).                                                                                                                                                                        |
| PreToolUse       | `Bash`                              | `guard-bash.sh`        | Block `git push --force`, `--no-verify`, `git commit -n`, `rm -rf` outside `temp`, direct `npm`/`pnpm install` (use `rush add`/`rush install`), `cdk deploy`/`cdk destroy`, `aws` write commands, edits to lockfile by hand, `git reset --hard` on `main`. |
| PostToolUse      | `Edit\|Write\|MultiEdit`            | `post-edit.sh`         | Prettier + `eslint --fix` on the changed file. Then `eslint` on the file. On error, exit 2 with the errors.                                                                                                                                                |
| PostToolUse      | `Edit\|Write\|MultiEdit`            | `typecheck-project.sh` | `tsc --noEmit` for the owning Rush project (fast, incremental).                                                                                                                                                                                            |
| PostToolUse      | `Bash`                              | `post-bash.sh`         | If a test/build/lint command exits non-zero, add context: "This command failed. Fix it. Do not skip, delete, or weaken the test."                                                                                                                          |
| PreToolUse       | `Bash` (`gh pr create`, `git push`) | `require-verify.sh`    | Block unless `.claude/state/last-verify.json` matches the current tree hash and says `pass`.                                                                                                                                                               |
| Stop             | —                                   | `stop-gate.sh`         | See §3.1.                                                                                                                                                                                                                                                  |
| SubagentStop     | —                                   | `stop-gate.sh --fast`  | Lint + types on changed files only.                                                                                                                                                                                                                        |
| UserPromptSubmit | —                                   | `prompt-context.sh`    | Add the current risk tier of the diff to context.                                                                                                                                                                                                          |

### 3.1 Stop hook: the agent cannot stop while something is broken

`stop-gate.sh` runs each time the agent tries to finish. Goal: the agent learns what broke, and it cannot skip it.

Steps:

1. If no files changed since the session start (`git diff` + untracked files), exit 0.
2. Find the impacted Rush projects from the changed files.
3. Run, in order, and capture output:
   - `rush build --to <impacted>`
   - `rush typecheck --only <impacted>`
   - `rush lint --only <impacted>`
   - `rush test --impacted-by <changed>` (with coverage)
   - `cdk synth` (+ cdk-nag) if any `infra` changed
   - gitleaks on the diff, Opengrep on changed files
4. Run the **anti-skip scan** on `git diff` from the session start. Fail if the diff adds any of:
   - `.skip`, `.only`, `.todo`, `xit`, `xdescribe`, `test.fails`
   - `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `as any`, `as unknown as`
   - deleted test files or fewer `it(`/`test(` calls than before
   - lower numbers in coverage config, `--passWithNoTests`, `|| true` in scripts
   - `nosemgrep` / `nosec` / `gitleaks:allow` / `checkov:skip` comments
   - empty `catch {}` blocks
5. Write the result to `.claude/state/last-verify.json` (tree hash, pass/fail, per-check status). `require-verify.sh` reads this file.
6. On fail: exit 2. Stderr gives a short report Claude reads:
   ```
   STOP BLOCKED: 2 checks failed.
   1. rush test (@sample-fullstack/api): 1 failed – get-user.test.ts:42 expected 200, got 500
   2. anti-skip: diff added `it.skip` at projects/sample-fullstack/api/src/routes/user/get-user.test.ts:40
   Fix the cause. Do not skip, delete, or weaken tests or rules. Run the `verify` skill, then stop again.
   ```
   Only the first ~40 lines of each failing output, so context stays small.
7. Loop guard: read `stop_hook_active` and a counter in `.claude/state/stop-attempts`. After 3 blocked stops, exit 0 **but** print: "Checks still fail. Tell the user exactly which checks fail and why. Do not say the task is done." The final message must list the failures. The PR still cannot pass CI.
8. On pass: exit 0 and print a one-line summary (counts of checks + tests), so the final answer can quote real output.

Permissions in `settings.json`: allow `rush *`, `git status/diff/log`, test commands. Deny reads of `.env*`, `~/.aws/**`. Deny writes to gate files (second layer next to the hook).

Note: local hooks can be bypassed. **CI runs every check again.** CI is the real gate.

---

## 4. Skills and agents

### 4.1 Skills (`.claude/skills/<name>/SKILL.md`)

| Skill                | Purpose                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `implement-feature`  | The main flow: read CLAUDE.md + area REVIEW.md → write the plan → write a failing test → write code → run `verify` → run `pre-pr` → open the PR.                                                                                                  |
| `verify`             | Run build, lint, types, tests for impacted projects. Show the real output. Do not say "done" without the output.                                                                                                                                  |
| `e2e-verify`         | Start the api + web. Run Playwright. Take screenshots. For api: curl the changed routes. For infra: `cdk synth` + `cdk diff` against the dev stack (read-only).                                                                                   |
| `pre-pr`             | Run `bug-hunt`, then `/simplify`, then `/code-review`, then `/security-review`. Fix findings. Cap at 3 rounds. After round 3, stop and ask the human about the approach.                                                                          |
| `bug-hunt`           | Spawn the `fresh-reviewer` agent on the diff. Look for the root cause on bug fixes. Flag the bug class, not one line.                                                                                                                             |
| `pr-description`     | Write the PR body: Summary, Testing (commands + output), Risk tier + reason, How to revert, Flag name.                                                                                                                                            |
| `new-project`        | Scaffold `projects/<name>/` with `contracts` + chosen parts (`web`, `api`, or both) + `infra`. Adds Rush entries, tags, tsconfig, eslint, vitest, `rush-project.json`, area `REVIEW.md`. (`rush.json` is a gate file, so the PR goes to a human.) |
| `add-project-part`   | Add `web` or `api` to an existing project.                                                                                                                                                                                                        |
| `new-shared-package` | Scaffold a `packages/*` package.                                                                                                                                                                                                                  |
| `new-api-route`      | Schema in the project's `contracts` → route → inject test → contract test.                                                                                                                                                                        |
| `new-web-page`       | Page → component tests → Playwright test → a11y check.                                                                                                                                                                                            |
| `new-cdk-construct`  | Construct → assertion tests → cdk-nag clean → snapshot.                                                                                                                                                                                           |
| `explain-area`       | Write an explainer for one slice of code (article: shared context).                                                                                                                                                                               |
| `incident-to-eval`   | Turn a revert or incident into a case in `evals/reviewer/`.                                                                                                                                                                                       |

### 4.2 Agents (`.claude/agents/`)

- `fresh-reviewer`: read-only. Gets only the diff, CLAUDE.md, REVIEW.md. Must give file + line evidence. Output starts with a count.
- `security-reviewer`: read-only. Auth, input validation, secrets, IAM in CDK.
- `infra-reviewer`: read-only. IAM least privilege, stateful resources, cost, `cdk diff` replacements.

---

## 5. CI (GitHub Actions)

Pin all actions by SHA. Set `permissions:` to least privilege on each workflow. Use OIDC for AWS (no long-lived keys).

### `ci.yml` (on `pull_request` and `merge_group`)

1. `rush install` (frozen lockfile), `rush check` (consistent versions).
2. `rush change --verify` (published packages only).
3. `rush build --impacted-by git:origin/main` (Rush build cache in S3 or GitHub cache).
4. `rush lint`, `rush typecheck`, `rush test` (coverage), diff-coverage check.
5. Matrix: ubuntu + macOS for packages; Node LTS pinned in `rush.json`.
6. Playwright e2e for web (on impacted).
7. Gate-integrity job: `scripts/check-gates.ts` – disable-count, test-deletion, PR size, gate-file change detection.
8. `dependency-cruiser` graph check (second layer for boundaries, incl. no cross-project imports).

### Security workflows (all required checks; detail in §2B)

- `sast.yml` – Opengrep, njsscan, gitleaks, TruffleHog (PR range), zizmor, pinact.
- `deps.yml` – audit-ci, OSV-Scanner, license check, new-deps report.
- `infra.yml` – per impacted project: `cdk synth` + cdk-nag + Checkov + `cdk diff` posted as a PR comment (OIDC read-only role).
- `scorecard.yml` – weekly OpenSSF Scorecard + SHA-pin check.

### `claude-review.yml`

- Claude Code GitHub Action with `/code-review` behavior. Reads CLAUDE.md + REVIEW.md. Posts inline findings tagged **Important / Nit / Pre-existing**. Re-review is diff-only after round 2. No repeated findings.
- `anthropics/claude-code-security-review` action.
- Open review threads block merge (ruleset: "require conversation resolution").

### `risk-classify.yml`

- `scripts/classify-risk.ts`: path rules + a Claude classifier. Sets label `risk:low|medium|high`. Low = docs, copy, tests only, additive behind a flag. High = auth, billing, `projects/*/infra/**`, `packages/cdk-constructs/**`, `packages/*` (shared blast radius), new dependencies, `.github/**`, gate files.
- A required status check reads the label and checks approvals: low = 0, medium = 1, high = 2 humans. Bot approvals do not count. The person who prompted the agent counts as a required reviewer.

### Other workflows

- `nightly.yml`: Stryker mutation tests, nightly review agent over old code, reviewer eval run on `evals/reviewer/`, `rush-pnpm outdated` + audit report (Renovate's Rush support is partial; verify before use, else use this job).
- `release.yml`: deploy `dev` on merge → `staging` → `prod` with GitHub Environment approval. CDK deploy through OIDC role.
- `rollback.yml`: one-step: re-deploy the last good build, or turn off a flag.

---

## 6. Protect the gates

Gate files:
`.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `tooling/**` (incl. opengrep rules, license allowlist), `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `docs/standards/coding-conventions.md`, `common/config/rush/**` (incl. `pnpm-lock.yaml`), `common/git-hooks/**`, `common/autoinstallers/**`, `rush.json`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `**/REVIEW.md`, `**/rush-project.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `**/cdk.json`.

Layers:

1. `protect-gates.sh` hook blocks the agent edit.
2. `settings.json` deny rules.
3. CODEOWNERS: gate files need a code owner (always-human, high tier).
4. CI `check-gates` job marks the PR `risk:high` if a gate file changes.
5. ESLint: no `any`, no `ts-ignore`, no focused or skipped tests, disables need descriptions and are counted.
6. Ruleset: no bypass for admins on `main`.

---

## 7. GitHub settings (not in files; scripted in `scripts/gh-setup.sh` with `gh api`)

- Ruleset on `main`: PR needed, required checks (all §5 jobs), require conversation resolution, dismiss stale approvals on push, require approval of the most recent push, linear history, no force push, no deletion, signed commits.
- Merge queue on `main` (CI runs on `merge_group`).
- Environments: `dev`, `staging`, `prod` with required reviewers on `prod`.
- AWS OIDC IAM roles (read-only for diff, deploy role per env) – created by a bootstrap CDK stack, run once by a human.
- Secret scanning + push protection, CodeQL, dependency review: on only if the repo is public or has GHAS (extra layer, not required).

---

## 8. Docs (STE100 style)

- `CLAUDE.md` (short, ≤ 100 lines): stack, commands (`rush install`, `rush build`, `rush test`, `rush lint`), rules, non-goals, links to `docs/standards/*`. "Show output. Do not say done without output."
- `REVIEW.md` (root) + per-project `projects/<name>/REVIEW.md` + per-kind templates for web, api, infra: what failure looks like here, paths to skip, cap nits at 3, need file + line evidence, summary starts with a count.
- `.github/pull_request_template.md`: Summary, Testing, Risk, How to revert, Flag.
- `docs/adr/0001-*.md`: record the choices (Rush, dist builds, boundaries, flags).
- `docs/runbooks/rollback.md`, `docs/onboarding.md` (says: git hooks install only on `rush install`).

---

## 9. Article → artifact map (the outcome)

| Article practice                                        | Artifact                                                                                                                         | Where                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Agent runs tests/build/lint before PR                   | Stop hook, `verify` skill                                                                                                        | repo                      |
| Fresh-context diff review                               | `fresh-reviewer` agent, `bug-hunt` skill                                                                                         | repo                      |
| Bug-hunt / simplify / e2e skills                        | `pre-pr`, `/simplify`, `e2e-verify`                                                                                              | repo                      |
| Hooks run formatters + linters                          | PostToolUse hooks                                                                                                                | repo                      |
| CLAUDE.md + REVIEW.md                                   | root + per-area files                                                                                                            | repo                      |
| Fix recurring flags at the source                       | `incident-to-eval` skill, lint rules                                                                                             | repo                      |
| Required CI (lint, types, tests, build, multi-platform) | `ci.yml`                                                                                                                         | repo                      |
| AI review on each PR, severity tags                     | `claude-review.yml`                                                                                                              | repo                      |
| Security review that blocks                             | security action + conversation resolution                                                                                        | repo + GitHub setting     |
| SAST, secrets, licenses, dep audit (beyond article)     | §2B: Opengrep, njsscan, gitleaks, TruffleHog, audit-ci, OSV-Scanner, license-checker, Checkov, cdk-nag, zizmor (all open source) | repo                      |
| Hooks run checks before commit/push                     | git hooks §2A                                                                                                                    | repo                      |
| PR template (testing, revert)                           | `pull_request_template.md`, `pr-description`                                                                                     | repo                      |
| Risk tiers set by the change                            | `classify-risk.ts`, `risk-classify.yml`                                                                                          | repo                      |
| Always-human paths (CI, auth, infra)                    | CODEOWNERS + gate protection                                                                                                     | repo + GitHub setting     |
| Bot approval does not count; re-approve on new commits  | ruleset                                                                                                                          | GitHub setting (scripted) |
| Merge queue                                             | ruleset + `merge_group` trigger                                                                                                  | GitHub setting (scripted) |
| Feature flags                                           | `packages/flags` (env/JSON-backed; swap for a vendor later)                                                                      | repo                      |
| Staged release                                          | `release.yml` dev → staging → prod                                                                                               | repo + GitHub envs        |
| Fast rollback                                           | `rollback.yml`, flag kill switch, runbook                                                                                        | repo                      |
| Round cap, diff-only re-review                          | `pre-pr` skill, review workflow prompt                                                                                           | repo                      |
| Incidents become evals; nightly review                  | `evals/reviewer/`, `nightly.yml`                                                                                                 | repo                      |
| Trusted-author list                                     | CODEOWNERS teams + classifier input                                                                                              | repo (needs GitHub teams) |
| **Stubbed / out of scope**                              | Real `latest`/`stable` channels, incident dashboards, circuit breakers on revert rate, metrics on human time                     | later                     |

---

## 10. Phases (each ends green, with a commit on a new branch from `main`)

1. **Bootstrap**: create `main`, `rush init`, pin Node + pnpm + Rush in `rush.json`, `.nvmrc`, autoinstallers (lint-staged, commitlint, prettier, gitleaks wrapper, license-checker), git hooks (§2A), Prettier, commitlint.
2. **Tooling**: `tooling/tsconfig`, `tooling/eslint-config`, `tooling/vitest-config`, `tooling/opengrep`, `audit-ci.jsonc`, license allowlist, `.gitleaks.toml`, `dependency-cruiser`.
3. **Shared packages**: `logger` → `flags`.
4. **Sample projects**: `projects/sample-fullstack/{contracts,api,web}` (health + one route + one page that calls it) and `projects/sample-api-only/{contracts,api}`.
5. **Tests**: unit, inject, Playwright, coverage thresholds.
6. **Infra**: `packages/cdk-constructs` + `projects/*/infra` (api on Lambda or ECS Fargate, web on CloudFront + S3/Lambda via OpenNext), cdk-nag, Checkov, assertion tests. Confirm compute choice with the user at this phase.
7. **Claude hooks** + `settings.json`.
8. **Skills + agents**.
9. **CI workflows** (ci, security, infra, review, risk) + `check-gates.ts` + `classify-risk.ts`.
10. **`gh-setup.sh`** (the human runs it after pushing to GitHub).
11. **Docs**: CLAUDE.md, REVIEW.md files, ADRs, runbooks, PR template.
12. **Gate fixtures** script (§11) – run it and record the results.

---

## 11. Verification

Happy path:

- `rush install && rush build && rush lint && rush test` pass at the root.
- `rush build --impacted-by @sample-fullstack/contracts` builds its contracts, api, web, infra – and nothing from `sample-api-only`.
- `git commit` with a bad message fails (commit-msg). `git push` with a failing test fails (pre-push).
- Run api + web. Playwright passes. `cdk synth` passes with zero nag errors.

**Gate fixtures** – each bad change must be rejected. If one is not rejected, that gate does not exist.

| Bad change                                                     | Rejected by                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Add `any`                                                      | PostToolUse lint hook; CI lint                                            |
| Add `it.only` / `it.skip`                                      | lint (vitest plugin); CI                                                  |
| Add `// eslint-disable` without description                    | lint (eslint-comments); CI disable-count                                  |
| Add `@ts-ignore`                                               | lint `ban-ts-comment`                                                     |
| Edit `.github/workflows/ci.yml`                                | `protect-gates.sh`; CODEOWNERS; `risk:high`                               |
| Edit `tooling/eslint-config`                                   | `protect-gates.sh`; CODEOWNERS                                            |
| Import `api` from `web` in one project                         | eslint-plugin-boundaries; dependency-cruiser                              |
| Import `sample-api-only/contracts` from `sample-fullstack/web` | eslint-plugin-boundaries; dependency-cruiser                              |
| `eval(userInput)` / `dangerouslySetInnerHTML` with input       | Opengrep; njsscan; eslint-plugin-security / no-unsanitized                |
| SQL string built from request input                            | Opengrep (taint rule)                                                     |
| Add a dep with a known high CVE                                | pre-push audit; `deps.yml` (audit-ci, OSV-Scanner)                        |
| Add a GPL-licensed dep                                         | pre-push license check; `deps.yml`                                        |
| Add a new dep at all                                           | lockfile is a gate file → CODEOWNERS + `risk:high`                        |
| Bad commit message                                             | commit-msg (commitlint)                                                   |
| IAM policy with `*` action in CDK                              | cdk-nag; Checkov                                                          |
| Delete a test                                                  | `check-gates` test-deletion check                                         |
| Change a published package with no change file                 | `rush change --verify`                                                    |
| Lower coverage on changed lines                                | diff-coverage check                                                       |
| Put an AWS key in code                                         | `block-secrets.sh`; pre-commit gitleaks; `sast.yml` gitleaks + TruffleHog |
| `git commit --no-verify` / `git push --force`                  | `guard-bash.sh`; ruleset                                                  |
| Run `cdk deploy` locally                                       | `guard-bash.sh`                                                           |
| S3 bucket without encryption in CDK                            | cdk-nag                                                                   |
| `process.env.X` in a route file                                | `no-restricted-syntax` rule                                               |
| Stop with a failing test                                       | Stop hook (exit 2) with the failing test name + line                      |
| Stop after adding `it.skip` to make tests pass                 | Stop hook anti-skip scan                                                  |
| Stop after lowering a coverage threshold                       | `protect-gates.sh` (gate file); Stop hook anti-skip scan                  |
| `gh pr create` without a passing verify on the current tree    | `require-verify.sh`                                                       |
| Variable `user_name`, type `IUser`, file `UserService.ts`      | naming-convention; `unicorn/filename-case`                                |
| `enum Status {}` / `export default` in a non-Next file         | `no-restricted-syntax`; `import-x/no-default-export`                      |
| `TODO` without an issue link                                   | custom `no-warning-comments` rule                                         |

Run each fixture on a throwaway branch. Record the result in `docs/standards/gate-fixtures.md`. Keep the fixtures as a script (`scripts/gate-fixtures.sh`) so the nightly job runs them again.

---

## 12. Amendments (user, during build)

1. **npm scope `@vprprudhvi/`.** Names: `@vprprudhvi/tooling-<x>`, `@vprprudhvi/shared-<x>` (`packages/<x>`), `@vprprudhvi/<project>-<kind>` (`projects/<project>/<kind>`), `@vprprudhvi/platform-infra` (`platform/infra`). CODEOWNERS owner: `@vprprudhvi`.
2. **Lambda-first compute.** api = Fastify on Lambda (`@fastify/aws-lambda`) + API Gateway HTTP API. web = Next.js via OpenNext (CloudFront + S3 + Lambda).
3. **Platform infra** (`platform/infra`): one Cognito user pool, imported Route53 hosted zone, ACM wildcard cert. IDs go to SSM `/platform/<env>/...`. Project infra reads them via SSM helpers in `shared-cdk-constructs`, and makes its own Cognito app client, DNS records, Lambdas. No code imports `platform/infra`. Changes there are high risk.
4. **Single-maintainer repo.** GitHub blocks self-approval. Agents open PRs from a bot account / GitHub App. The 2-approval tier becomes 1 human + all automated reviews until a second maintainer exists.
5. **Orchestration.** Sonnet: code and gates. Haiku: markdown. Main session: verify + small commits.
6. **Python + Go backends (occasional).** Same gate layers as TS.
   - Layout: kinds `api-py` (Python) and `api-go` (Go) next to `api` (TS): `projects/<name>/api-py`, `projects/<name>/api-go`. Package names `@vprprudhvi/<project>-api-py|api-go`.
   - Rush integration: each has a thin `package.json` whose `_phase:*` scripts call the native tools, so `rush verify`, `--impacted-by`, build cache, Stop hook, CI all work unchanged.
   - Contracts stay single-source in Zod: `<project>-contracts` emits JSON Schema / OpenAPI (`z.toJSONSchema`) in `_phase:build`. Python models generated with `datamodel-code-generator` (Pydantic v2); Go types with `oapi-codegen`. Generated code is committed; CI fails on drift.
   - Python gates: `uv` (locked, `uv.lock`), `ruff check` + `ruff format --check` (rules: E,F,W,I,N,UP,B,S,BLE,C4,SIM,PT,RET,ARG,PL,RUF,ANN,D), `mypy --strict` (or `pyright` strict), `pytest` + `pytest-cov` (`--cov-fail-under=80`), `bandit`, `pip-audit`, `pip-licenses` allowlist. Lambda via `aws-lambda-powertools`.
   - Go gates: `gofumpt` + `goimports`, `go vet`, `golangci-lint` (errcheck, staticcheck, gosec, revive, govet, ineffassign, unused, gocritic, bodyclose, errorlint, exhaustive, gocyclo ≤ 15, nolintlint require-explanation), `go test -race -cover` (≥ 80%), `govulncheck`, `go-licenses check`. Lambda via `provided.al2023` + `aws-lambda-go`.
   - Opengrep, gitleaks, TruffleHog, OSV-Scanner already cover Python + Go (add rules/lockfiles).
   - Anti-skip scan adds: `@pytest.mark.skip|xfail`, `pytest.skip(`, `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `t.Skip(`, `//nolint`, `// #nosec`, `--cov-fail-under` lowered.
   - Conventions: Python = PEP 8 (snake_case funcs/vars, PascalCase classes, UPPER_SNAKE constants, full type hints, Google docstrings); Go = Effective Go (MixedCaps, exported = PascalCase, short receivers, errors wrapped with `%w`, no panics in handlers, context first param). Each rule has an enforcer.
   - Claude PostToolUse hook formats + lints `.py` (ruff) and `.go` (gofumpt, golangci-lint --fast) on edit.
   - Gate files add: `tooling/python/**`, `tooling/go/**`, `**/pyproject.toml` `[tool.*]` sections, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`.
   - Sample: `projects/sample-api-only/api-py` and `projects/sample-api-only/api-go` (health route each) prove the gates.
7. **Bruno for API docs + tests; Playwright mandatory for web.**
   - Bruno collection per project: `projects/<name>/bruno/` (`bruno.json`, `environments/local.bru|dev.bru|staging.bru`, one folder per resource, one `.bru` per route). Secrets only as `{{process.env.X}}`; never in env files (gitleaks + check-gates). Each request has `docs` block (purpose, auth, errors) and `tests`/`assert` blocks (status, error envelope shape, key fields).
   - Runner: `@usebruno/cli` (`bru run --env local --reporter-junit`), pinned in an autoinstaller or the project devDeps. Each api part's `_phase:e2e` starts the server on a free port (TS: Fastify listen; py: uvicorn; go: binary), runs the project's Bruno folder for that part, stops the server.
   - Gate `bruno-coverage` (in `check-gates.ts`): each route in `<project>-contracts` OpenAPI output has ≥ 1 `.bru` file with matching method + path and ≥ 1 assertion. Missing → fail.
   - Playwright: each `kind:web` project has `e2e/` with `@playwright/test` + `@axe-core/playwright`. `_phase:e2e` builds + starts Next (`next start`) and runs Playwright (chromium in PR; chromium+firefox+webkit nightly). Screenshots/trace on failure as CI artifacts.
   - Gate `playwright-coverage`: each `app/**/page.tsx` route has a spec that calls `page.goto('<route>')` and runs an axe check. Missing → fail. Web project without `e2e/` → fail.
   - Rush: new phase `_phase:e2e` (depends on self `_phase:build`), new command `e2e`, and `verify` includes it. Stop hook runs `e2e` for impacted web/api parts. CI runs it on PR + merge_group.
   - Anti-skip adds: `test.skip`/`test.fixme` in Playwright, `bru` requests with no assertions, `--bail` removal is fine, `skip-request` in Bruno scripts.
8. **OpenTelemetry end-to-end tracing.**
   - New shared package `packages/telemetry` (`@vprprudhvi/shared-telemetry`): one `initTelemetry({ serviceName })` for Node (OTel SDK, W3C tracecontext + baggage propagators, OTLP exporter, resource attrs `service.name`, `service.version`, `deployment.environment`, `cloud.*`), helpers `withSpan()`, `getTraceContext()`. Only this package imports `@opentelemetry/*` SDK packages (lint `no-restricted-imports`); app code may import `@opentelemetry/api` only via re-exports from shared-telemetry.
   - `shared-logger` (pino) injects `trace_id`, `span_id`, `trace_flags` into every log line (pino OTel mixin). Logs are JSON. Same field names in Python and Go.
   - Web: Next.js `instrumentation.ts` registers telemetry (server); browser fetch adds `traceparent` via `@opentelemetry/sdk-trace-web` + fetch instrumentation (sampled), so one trace spans browser → Next server → api.
   - API TS: `@fastify/otel` instrumentation; route spans named `<METHOD> <route>`; error spans record exceptions; response header `traceparent` echoed for debugging; error envelope `requestId` = trace id.
   - Python: `opentelemetry-sdk` + `opentelemetry-instrumentation-*` (or Powertools Tracer wired to OTel); log records include trace ids (`opentelemetry-instrumentation-logging`). Go: `go.opentelemetry.io/otel` + `otelhttp`/`otellambda`, `slog` handler adds trace ids.
   - Lambda: ADOT Lambda layer (collector) added by the shared Lambda construct in `shared-cdk-constructs`; env `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_PROPAGATORS=tracecontext,baggage,xray`; export to X-Ray + CloudWatch. API Gateway tracing on. Sampling: 100% non-prod, 10% prod + always errors (parent-based).
   - Local: `docker compose` with Jaeger (or otel-collector + Jaeger) for `rush e2e`/dev; `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.
   - Gates: (a) lint: no `console`, no direct OTel SDK imports outside shared-telemetry; (b) Opengrep: logger calls without structured object, PII keys in span attributes; (c) tests: an api inject test asserts incoming `traceparent` is continued (same trace id in response + log line); a Playwright test asserts the api call carries `traceparent`; Bruno asserts response `traceparent` header exists; (d) cdk assertions: every Lambda has the ADOT layer + tracing active; (e) Python/Go: unit test asserts trace id in log record.
   - Docs: `docs/standards/observability.md` (span naming, attribute rules, no PII, log fields, sampling, how to find a trace).
9. **Hierarchical agent docs (table of contents style).**
   - Root `CLAUDE.md` (≤ 60 lines) = repo-wide conventions (the non-negotiable rules) + a routing table: "If you do X → read doc Y / use skill Z". No deep detail. `AGENTS.md` stays a symlink.
   - Nested `CLAUDE.md` (Claude loads them when working in that tree), each ≤ 60 lines, each links to docs/skills: `projects/CLAUDE.md` (project anatomy, kinds, contracts flow), `projects/<kind>` guides live in `docs/guides/{web,api,api-py,api-go,contracts,infra}.md`; `platform/CLAUDE.md`; `packages/CLAUDE.md`; `tooling/CLAUDE.md` (gate area: read-only for agents); `docs/CLAUDE.md` (STE100 writing rules); `.github/CLAUDE.md` (gate area).
   - Each nested file has an `AGENTS.md` symlink for non-Claude agents.
   - Detail moves to `docs/` (standards, guides) and skills; nothing from the current CLAUDE.md is lost.

---

## 13. Status at Wave 2 pause (2026-10-22, 18:30 CDT)

**User instruction: do NOT start Wave 3 until the user says so.**

### Done (main, tree clean, 33 commits after 82e9388)

- Wave 1: docs, skills, agents, Rush foundation, tsconfig/ESLint/vitest/prettier/commitlint, security configs, git hooks, docs hierarchy, audit split, license policy.
- Wave 2:
  - Shared packages: result 1f7e4ee, telemetry 0b7b59e, logger 0aea4f1, flags 5e28715.
  - Contracts 9a1ee7e, 46dc66f. TS APIs 51f9afd, 87a1ae3. Web 1f6e0a2. Bruno 0fb077e, 599c0ec. api-py 477aa4f. api-go e26bc2e. Jaeger 2e38a14. rush.json ddee99b. .gitignore 3916f30.
  - Hook-lock fix ccf4b41 (orchestrator edit under plan, user to review).
  - User-approved gate edits: cbba49a (caniuse-lite@1 named runtime license exception, expires 2027-10-22), 240f632 (security/detect-non-literal-fs-filename off for scripts/gates/lib/fs-io.mjs only), b4a1291 (pre-push runs bruno-coverage, playwright-coverage, anti-skip).
  - App fixes: 8fed9b0, 1e32bc1 (bounded Lambda span flush, 2 s), f248859 (case-insensitive redaction), 508bdfc (Go NaN sampler), 0f118fa (removed noqa).
  - Gate code: 2bd4b86 helpers, 83e91fe guard-bash/protect-gates/block-secrets, 4e76d8d anti-skip, 6ebd994 coverage gates, 30812db gate-integrity, 5e9c15b Stop/require-verify/edit hooks, 57ede5a hook wrappers + settings.pending.json (NOT active), 92506b5 gates.md + skills handoff + docs-sync test.
- Proof: cache-free rush verify 58 ops exit 0; later verify 70 ops exit 0; gate tests 675/675; audit pass A 201 deps 0 high, pass B 0 critical; license-check pass; anti-skip over 82e9388...HEAD pass (378 files).

### Decisions

- Coverage stays at lines/statements/functions 80, branches 75 (TS), 80 (py, go).
- 90% diff coverage = a SEPARATE task after everything is complete. Do not put it in Wave 3.
- Rush tags use `/` (project/<name>, kind/<kind>); Result failure helper is fail/Fail/isFail.

### Open follow-ups (fix as we go)

1. gate-integrity misses `git reset` that moves HEAD back past a human gate commit (compare session-base/origin tree to HEAD directly, no merge-base).
2. `cp -r fake/.claude .` or rsync into repo root can plant .claude/state/last-verify.json (block recursive copy into repo root or .claude).
3. anti-skip lets a test with no assertion through.
4. Go api has no log redact list; TS redaction depth 3 levels; secrets in URL query strings.
5. Deferred: nonce-based CSP (web uses 'unsafe-inline'), Docker image digest pins, BOM/NEL title handling, sha256 object-format repos, py-collection-hook only in conftest/ini files.
6. guard-bash is heuristic (documented in gates.md "Known limits"); gate-integrity + CODEOWNERS + CI are the real controls.
7. docs still mention `tag:project:<name>`, `docker-compose.otel.yml`, `instrumentation-client.ts` in places; check before Wave 3.
8. `rush change --verify` cannot run until a real origin remote exists.

### Wave 3 (when user resumes)

platform/infra (Cognito, Route53 import, ACM wildcard, SSM /platform/<env>/...), packages/cdk-constructs (Lambda construct with ADOT layer), projects/*/infra, CI workflows (ci, sast, deps, infra, claude-review, risk-classify, nightly, release, rollback), check-gates (no diff coverage yet), classify-risk, gh-setup. Split agents by file ownership up front; builders verify with --only; one integrate verify; small review batches. Then Wave 4: gate fixtures script, activate settings.pending.json -> .claude/settings.json, final check.
