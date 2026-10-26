# Build status and resume guide

Last update: 2026-10-25. Current state: **Wave 3 in progress. Step 1: restructure to single-package projects.** CI: `ci.yml` is live (PR #8).

Read this file before you continue the build of this repo. It tells you what is done, what is open, and how to start Wave 3.

The owner started Wave 3 on 2026-10-22.

## 1. Sources of truth

| What                                                               | Where                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Approved plan (sections 1 to 12) and the pause status (section 13) | [plan.md](plan.md). The original file is `~/.claude/plans/i-want-to-build-inherited-starfish.md`. |
| This resume guide                                                  | `docs/build/status.md`                                                                            |
| Task tracker (web page, auto-refresh)                              | `~/Desktop/Dev/monorepo-tracker/index.html`. Data: `tasks.json`.                                  |
| Code and decisions                                                 | Git history on `main`, and `docs/adr/`                                                            |
| Gate list and known limits                                         | [gates.md](../standards/gates.md)                                                                 |

Tracker commands:

```sh
u(){ node ~/Desktop/Dev/monorepo-tracker/update.mjs "$@" >/dev/null; }
u set <task-id> <pending|in_progress|verifying|done|blocked> [--note "..."] [--commits h1,h2]
u add <phase-id> <task-id> "<title>" --owner <Sonnet|Haiku|Orchestrator|Human> --status pending
u log "<message>"
```

Phase ids: `plan`, `w1`, `w2`, `w3`, `w4`.

## 2. How the build works

### 2.1 Roles

- The main session is the orchestrator. It plans, delegates, verifies each claim with real output, and commits.
- Sonnet agents write code and gates. Haiku agents write Markdown.
- Fresh-context reviewer agents and skeptic agents check the work. A skeptic must reproduce a failure with a real command.
- After 3 failed review rounds on one item, stop and ask the owner (root `CLAUDE.md`, rule 13).

### 2.2 Rules for commits

- Make small commits with one meaning each. Use Conventional Commits. Body lines must be 100 characters or less.
- End each commit message with the attribution lines that the session gives.
- Commit only through the git hooks. Never use `--no-verify`.
- Each bug fix gets its own `fix(...)` commit and a test that fails before the fix.
- A gate-file change needs the owner. Record the owner decision in the commit body ("Repo owner decision.").

### 2.3 Commands

- Run Rush only through `node common/scripts/install-run-rush.js <cmd>`. The global `rush` is old.
- Full check: `node common/scripts/install-run-rush.js verify`. For no build cache, set `RUSH_BUILD_CACHE_ENABLED=0`.
- Gate tests: `node scripts/gates/test-impacted.mjs` runs only the gate tests that the change can affect (add `--base <ref>` for a range, `--list` to see the files). Run the full suite (`--all`, about 5 minutes) only when it tells you to or before a pause.
- Gate lint: `tooling/eslint-config/node_modules/.bin/eslint --max-warnings 0 scripts/gates`.
- Coverage gates: `node scripts/gates/bruno-coverage.mjs` and `node scripts/gates/playwright-coverage.mjs`.
- Anti-skip on a range: `node scripts/gates/anti-skip.mjs --range <base>...HEAD`.
- Gate integrity: `node -e 'import("./scripts/gates/lib/gate-integrity.mjs").then(m=>console.log(m.uncommitted(process.cwd())))'`.
- Only one Rush command can run at a time. Do not let two agents run Rush at the same time.

### 2.4 Lessons from Waves 1 and 2

- Split agent work by file ownership before you start. Two agents must not edit the same file.
- Builders check their own part with `verify --only <package>`. Run one full verify at integration.
- One agent with many serial tasks is slow. Split the tasks when the files do not overlap.
- Keep review rounds bounded. Give skeptics a fixed list of pass criteria, not an open bug hunt.
- Run the anti-skip scan over the full range before a pause. It found a `# noqa` comment that an agent added.
- The root `.gitignore` ignores every `lib/` folder. A new source folder named `lib` needs an un-ignore line. Before a commit, run `git status --short --untracked-files=all <folder>` and `git check-ignore -v` on new folders. Verify passes on files that git does not track.
- Work in small chunks: one agent builds one chunk, the orchestrator re-runs the check and commits, then sends the next chunk.

## 3. What is done

### 3.1 Wave 1: foundation, docs, skills (done)

- Rush 5.181.0, pnpm 10.34.7, Node 24.11.1. Phases: `_phase:build`, `_phase:lint`, `_phase:typecheck`, `_phase:test`, `_phase:e2e`. Commands: `build`, `rebuild`, `lint`, `typecheck`, `test`, `e2e`, `verify`, `prettier`, `commitlint`, `license-check`, `audit`.
- Tooling: `tooling/tsconfig`, `tooling/eslint-config`, `tooling/vitest-config`, Prettier, commitlint, lint-staged.
- Security configs: gitleaks, Opengrep rules, audit-ci (split: runtime high, all-deps critical), license allowlist (strict runtime list, tooling-only list).
- Git hooks: `pre-commit`, `commit-msg`, `pre-push`, `prepare-commit-msg`, `post-checkout`, `post-merge`.
- Docs: root and nested `CLAUDE.md` (table of contents), standards, guides, ADR 0001 to 0008, REVIEW files, runbooks, CODEOWNERS, PR template.
- Skills and agents: `.claude/skills/*`, `.claude/agents/{fresh-reviewer,security-reviewer,infra-reviewer}`.

### 3.2 Wave 2: code (done)

| Area                                                                       | Commits                                                          |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Shared packages: `result`, `telemetry`, `logger`, `flags`                  | `1f7e4ee`, `0b7b59e`, `0aea4f1`, `5e28715`                       |
| Contracts (sample-fullstack, sample-api-only)                              | `9a1ee7e`, `46dc66f`                                             |
| Fastify APIs on Lambda                                                     | `51f9afd`, `87a1ae3`                                             |
| Next.js web with Playwright and axe                                        | `1f6e0a2`                                                        |
| Bruno collections                                                          | `0fb077e`, `599c0ec`                                             |
| Python API (Powertools) and Go API                                         | `477aa4f`, `e26bc2e`                                             |
| Local Jaeger, Rush registration, `.gitignore`                              | `2e38a14`, `ddee99b`, `3916f30`                                  |
| App bug fixes (bounded span flush, redaction, Go NaN, no `noqa`)           | `8fed9b0`, `1e32bc1`, `f248859`, `508bdfc`, `0f118fa`            |
| Gate scripts                                                               | `2bd4b86`, `83e91fe`, `4e76d8d`, `6ebd994`, `30812db`, `5e9c15b` |
| Hook wrappers and pending settings (not active)                            | `57ede5a`                                                        |
| Gate table, skills handoff, docs-sync test                                 | `92506b5`                                                        |
| Git hooks call autoinstaller binaries (orchestrator edit, owner to review) | `ccf4b41`                                                        |
| Owner-approved gate edits                                                  | `cbba49a`, `240f632`, `b4a1291`                                  |

Proof at the pause:

- `rush verify` with no build cache: 58 operations, exit 0. After the round 3 fixes: 70 operations, exit 0.
- Gate tests: 675 of 675 pass.
- `rush audit`: pass A (runtime, high) 201 dependencies, 0 high. Pass B (all, critical) 0 critical.
- `rush license-check`: pass.
- Anti-skip over `82e9388...HEAD`: pass, 378 files.

### 3.3 Owner decisions

| Decision                                                                                                                                                                                                                                                                                                                                                                   | Where                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Rush.js, Next.js, Fastify, GitHub Actions, AWS CDK, Lambda first                                                                                                                                                                                                                                                                                                           | plan sections 1 to 12                      |
| npm scope `@vprprudhvi/`                                                                                                                                                                                                                                                                                                                                                   | plan section 12.1                          |
| Audit: split runtime and dev policy                                                                                                                                                                                                                                                                                                                                        | commit `6c5b2c6`                           |
| Licenses: extra licenses for tooling only                                                                                                                                                                                                                                                                                                                                  | commit `6d74f28`                           |
| `caniuse-lite@1` is a named runtime license exception (expires 2027-10-22)                                                                                                                                                                                                                                                                                                 | `cbba49a`                                  |
| `security/detect-non-literal-fs-filename` is off for `scripts/gates/lib/fs-io.mjs` only                                                                                                                                                                                                                                                                                    | `240f632`                                  |
| `pre-push` runs the coverage gates and anti-skip                                                                                                                                                                                                                                                                                                                           | `b4a1291`                                  |
| Coverage stays at 80 lines, statements, functions and 75 branches (TS), 80 (Python, Go)                                                                                                                                                                                                                                                                                    | this file                                  |
| The 90 percent diff-coverage check is a separate task after all waves. It is not in Wave 3.                                                                                                                                                                                                                                                                                | this file                                  |
| Single-package projects: one `package.json` for each project. Layout: `bin/`, `lib/` (CDK), `src/contracts`, `src/api`, `src/api-py`, `src/api-go`, `web/`, `bruno/`.                                                                                                                                                                                                      | ADR 0010 (`edd2627`, `fcd311a`, `8dfece4`) |
| One sample project, `projects/sample`, with every part. It replaces `sample-fullstack` and `sample-api-only`.                                                                                                                                                                                                                                                              | ADR 0010 (`edd2627`, `fcd311a`, `8dfece4`) |
| AWS region: `us-east-1` only. One wildcard certificate serves CloudFront and the HTTP API.                                                                                                                                                                                                                                                                                 | Wave 3                                     |
| CDK bundles the Lambda code at synth with the CDK constructs: `NodejsFunction` (TS), `GoFunction` (`@aws-cdk/aws-lambda-go-alpha`), `PythonFunction` (`@aws-cdk/aws-lambda-python-alpha`). No custom bundler. Shared constructs: `TracedNodeFunction`, `TracedGoFunction`, `TracedPythonFunction`. Unit tests turn bundling off. Supersedes the `Code.fromAsset` decision. | Wave 3, owner 2026-10-22                   |
| API gateway: HTTP API. No catch-all route (`{proxy+}`, `$default`). Each route (method + path) is written by hand in the project CDK stack. A route has the JWT authorizer unless the stack marks it public. Routes are not built from the OpenAPI spec. The Zod contracts and `dist/openapi.json` stay (Python and Go codegen).                                           | Wave 3, owner 2026-10-22                   |
| No Swagger UI and no docs Lambda. The Zod OpenAPI spec (`dist/openapi.json`) and the Bruno collection are the API documentation.                                                                                                                                                                                                                                           | Wave 3, owner 2026-10-22                   |
| Python 3.14 everywhere: Lambda runtime, `.python-version`, mypy, ruff.                                                                                                                                                                                                                                                                                                     | Wave 3, owner 2026-10-22                   |
| Alpha CDK packages pinned to the `aws-cdk-lib` version (`2.273.0-alpha.0`). `PythonFunction` needs Docker for a real synth. Unit tests skip bundling.                                                                                                                                                                                                                      | Wave 3                                     |
| TS and JS unit tests live in `test/` at the package root and mirror the source path (`test/api/...`, `test/web/...`, `test/infra/...`). Python keeps `tests/`. Go keeps `_test.go` in the package. Playwright stays in `web/e2e/`. A `test-location` check enforces it.                                                                                                    | Wave 3, owner 2026-10-22                   |
| CI waits. First every gate runs and works on the local machine (Claude hooks, git hooks, Rush phases), with gate fixtures as proof. CI workflows start after that, to avoid integration problems.                                                                                                                                                                          | Wave 3, owner 2026-10-22                   |
| CI starts now (2026-10-25). It replaces the 2026-10-22 note "CI waits". `ci.yml` runs only on pull requests and checks only the diff with `main`.                                                                                                                                                                                                                          | PR #8                                      |
| Imports stay as they are: `module: NodeNext`, ESM, relative imports with the `.js` extension. Extension-free imports need Bundler resolution or CommonJS output; the owner keeps the current setup. The `.ts` extension change is cancelled.                                                                                                                               | Wave 3, owner 2026-10-22                   |
| cdk-nag rules that cannot be met go in one acknowledgments file for each stack (cdk-nag 3 `Validations.of().acknowledge`), with a reason. The owner approves each entry. Approved: 2 IAM5 in `TracedFunctionBase` (X-Ray `Resource: *`, log streams).                                                                                                                      | Wave 3                                     |
| OpenNext: own minimal construct in `shared-cdk-constructs`. No third-party construct.                                                                                                                                                                                                                                                                                      | Wave 3                                     |
| CDK versions (3-day release age): `aws-cdk-lib` 2.273.0, `aws-cdk` 2.1145.0, `constructs` 10.8.1, `cdk-nag` 3.0.2, `@opennextjs/aws` 4.1.11. License check and audit passed.                                                                                                                                                                                               | Wave 3                                     |

### 3.4 Facts that differ from the first plan

- Rush tags use a slash: `project/<name>`, `kind/<kind>`. Rush does not allow a colon.
- The Result failure helper is `fail`, `Fail`, `isFail`. The lint rules reject the name `err`.
- The local compose file is `docker-compose.yml`.
- Browser tracing is a small traced `fetch` in `shared-telemetry/browser`.
- Web security headers and CSP are set in `src/proxy.ts` for each request.
- The hooks are in `.claude/settings.pending.json`. They are not active. Wave 4 moves them to `.claude/settings.json`.

## 4. Open follow-ups

Fix these as the work continues. Tracker ids are in brackets.

1. [`w2-fu-reset`] Gate integrity does not find a `git reset` that moves HEAD back past a human gate commit. Compare the trees directly. Do not use a merge base.
2. [`w2-fu-state-copy`] A recursive `cp` or `rsync` into the repo root or `.claude` can write a fake `.claude/state/last-verify.json`.
3. [`w2-fu-noassert`] Anti-skip does not flag a test with no assertion.
4. [`w2-fu-redact`] The Go API has no log redact list. TS redaction stops at depth 3. Secrets in URL query strings are logged.
5. [`w2-fu-deferred`] Nonce-based CSP (web uses `'unsafe-inline'`), Docker image digest pins, BOM and NEL title handling, sha256 object-format repos.
6. [`w2-fu-docs`] Done in `8dfece4`.
7. [`fu-diffcov`] Separate task: the 90 percent diff-coverage check.
8. `rush change --verify` cannot run until the repo has a real `origin` remote.
9. guard-bash reads command text, so some commands get past it. See "Known limits" in [gates.md](../standards/gates.md). Gate integrity, CODEOWNERS and CI are the real controls.
10. [`bl-dns`] Backlog (owner, 2026-10-22): the domain is in Cloudflare. Decide later to import or create a Route53 zone, then add the ACM wildcard certificate. Until then, platform writes no `dns` or `acm` parameters, and projects use the default API and CloudFront URLs.
11. [`bl-cognito-triggers`] Backlog: Cognito trigger Lambdas create each new user in the users table.
12. [`bl-users-table`] Backlog: one shared DynamoDB users table (single-table design) in `platform/infra`. Projects read it. They do not keep their own user tables.
13. [`bl-dynamodb-standard`] Backlog standard (owner, 2026-10-22), for the end of the build: DynamoDB is the default database because of its price. Each DB item has a Zod schema. Mapper functions convert the input (contracts) to the DB item and back, and the types match on both sides. The key attributes (partition key, sort key, index keys) and their formats are defined once in the schema, so no code writes a free-form key. Write it as a standard in `docs/standards/` with an enforcer (types plus tests, or a lint rule).
14. [`bl-envs`] Done (2026-10-23, 9e2db15 and 8ac6749): owner chose `local` + `prod` only, no plug and play, one AWS account, one user pool (platform deploys only `prod`), one client for each env, nothing deployed. Original note: Owner (2026-10-22), after Wave 3: bring a short plan first, no edits before the owner agrees. Goal: fewer environments for a personal project, for example `local` (the app runs on the Mac, `localhost:3000`, and can use cloud resources such as Cognito and DynamoDB tables) and `prod` (deployed). Environments must be plug and play: adding an environment is one config file and no code change. Today the code has `dev`, `staging` and `prod`.
15. `dependency-cruiser` is not installed and no command runs it. `ci.yml` does not run it either. Wire it in and add it to CI.
16. `test-location` runs in CI now, through `check-gates` in `ci.yml` (PR #8). Decide if pre-push runs `test-location` too.
17. [`p-national-parks`] Site done (2026-10-23, 19 commits 0e17ae9..b27de44). `projects/national-parks-tracker` is a static Next.js export. It has a Leaflet and OpenStreetMap map of all 64 parks (Chiricahua, AZ, is a park from 2026-10-20), a park list with search, filter and sort, and one page for each park. The park data and the Wikimedia photo credits are in `web/data/parks.json` and `web/data/photos.json`. The owner edits `web/data/visits.json`, which ships empty. Zod contracts validate it at build time. A data test fails when an owner photo has EXIF or XMP data. No feature flag: the owner decided this exception, because the project is new and not deployed. Open items:
    - The hosting PR (S3 and CloudFront in `bin/` and `lib/`). It sets the CSP and the Referrer-Policy from the project README.
    - A faint tile seam on high-density phones (a Leaflet issue).
    - `bl-new-project-unlock`: see item 28.
18. [`bl-opengrep-py-go`] Owner (2026-10-23): add the Opengrep rules for Python and Go when work on the Python and Go services starts, not now. Scope of that work:
    - Rules: eval and exec, `subprocess` with `shell=True`, SQL built from strings, secret fields in log calls, Go `exec.Command` with `sh -c`, `fmt.Sprintf` SQL.
    - Widen the file patterns to `.py` and `.go` in `scripts/security/opengrep-changed.sh` and in `OPENGREP_FILES` in `scripts/gates/lib/stop-checks.mjs`.
    - Make a missing `opengrep` binary fail. Today `opengrep-changed.sh` exits 0 when the binary is missing.
    - Fix the false match of `monorepo.no-logging-secret-fields`: the regex matches `tokenCount` in `packages/logger/test/logger.test.ts:228`. The gate fails when that file changes. Narrow the regex (for example `token` only at the end of a key), with rule tests that still catch `accessToken`, `clientSecret` and `password`.
19. [`bl-nightly-audit`] Partly done (2026-10-23, 5098052): a lockfile change now runs its audit in `rush gates` and at pre-push (`rush audit`, pip-audit, govulncheck), from `scripts/gates/lib/dep-checks.mjs`. Open: the nightly audit of all lockfiles. No workflow runs it yet (`ci.yml` does not, and `nightly.yml` and `deps.yml` are planned).
20. [`bl-gate-test-load`] The gate tests flake under heavy machine load (load average about 10). In the full suite, a hook step ran past the 120 s limit in `scripts/gates/lib/proc.mjs`, and `gate-integrity-hooks.test.js:206` failed with status 2. The file passed alone (17 of 17). Options: fewer test files at the same time, or a longer `proc.mjs` limit in tests only.
21. [`bl-spawn-timeouts`] `scripts/gates/test-impacted.mjs` and the `scripts/gates/lib/*.mjs` modules that tests call in-process use `spawnSync` with no timeout. The test harness `exec` has a 180 s timeout (c0af0e7), but these calls do not.
22. [`bl-md-lint-staged`] Owner (2026-10-23): Markdown is not in `.lintstagedrc.cjs`. A Markdown edit passes pre-commit and fails the prettier step at push. Kept as is by owner decision.
23. [`bl-gates-base-guard`] Done in the gates-relax-2 handoff (2026-10-25): file 01 adds `.claude/state/gates-base` to `gate-files.json`, and the Bash rule (files 30 and 31) blocks `GATES_BASE` and writes to that file. The change takes effect when a human applies the handoff. Was: `GATES_BASE` and `.claude/state/gates-base` move the base for every diff check, and no gate protects them.
24. [`bl-gate-fixtures`] Owner (2026-10-23): build the gate fixtures with CI, not now. A fixtures script plants one bad change for each fixture in plan section 11 in a temp clone and expects the gate to fail. Results go to `docs/standards/gate-fixtures.md`. The nightly job runs it. The script path in the plan is a gate file, so it goes through the handoff folder (`gates.md` 2.4).
25. [`bl-authorizer-client-check`] Closed (2026-10-23), no work needed. The authorizer already sets its JWT audience to the app client of its own stack (`packages/cdk-constructs/src/http-api.ts:266`, asserted in `projects/sample/test/infra/sample-api-stack.test.ts:202`). The `prod` API rejects tokens from the `local` client.
26. [`bl-stop-synth-env`] Done (2026-10-23, d15a4c4, docs 98bfa15). Was: The Stop gate runs `cdk synth --quiet` with no `-c env` (`scripts/gates/lib/stop-checks.mjs`, `cdkSynthCheck`). An app that reads the `env` context always fails there. The pre-push synth (`synth-changed`) passes each env. Fix: loop over `discoverEnvironments` from `lib/synth-changed.mjs` and add a test for an app that reads `env`. Gate file, so a human applies it.
27. [`bl-cdk-test-load`] Done (2026-10-23): `createVitestConfig` has a `testTimeout` option; `shared-cdk-constructs` uses 30000 ms. Was: Under the full Stop-gate verify, 7 `shared-cdk-constructs` tests time out at 5000 ms (for example `http-api.test.ts:116`, `traced-python-function.test.ts:42`). They pass alone (`rush test -o @vprprudhvi/shared-cdk-constructs`, 11 s). Same class as `bl-gate-test-load`. A fix sets `testTimeout` for CDK tests in a gate file, so a human decides.
28. [`bl-new-project-unlock`] Owner (2026-10-23) chose option 2: a gate exemption for a new project folder that is not on `origin/main` yet. Partly done in 5098052: `node scripts/gates/register-project.mjs <name>` adds the project to `rush.json`. Open: the other new-project gate files (`tsconfig*.json`, `eslint.config.js`, `vitest.config.ts`, `playwright.config.ts`, `config/rush-project.json`, `REVIEW.md`, the phase script) still go through the handoff folder.
29. [`bl-stop-clip-tail`] The Stop hook shows the first lines of a failed check (`clipLines` in `scripts/gates/lib/stop-checks.mjs`). The error is often at the end, so the hook hides it. Fix: show the last lines. Gate file, so a human applies it.
30. [`bl-skills-rush-add`] Partly done (2026-10-25): the Node dependency wording in the skills now follows the owner decision of 2026-10-25 (`docs/standards/gates.md`, section 6.6). Open: three lines are not changed, because the edit tool was denied by the auto-mode classifier. They are `implement-feature/SKILL.md` lines 25 and 32, and the `new-project/SKILL.md` "do not" line "Add a dependency or a lockfile change without human approval." `new-shared-package` still needs a `rush.json` handoff, because `register-project.mjs` covers only `projects/`.
31. [`bl-pyg-deps-push`] Backlog (owner, 2026-10-25): give Python and Go dependencies the same push rule as Node. Add a section-level check for dependency changes: the dependency tables in `pyproject.toml` and the `require` block in `go.mod`. Until then, Python and Go stay with the handoff commands (`NN-commands.txt`) and a human. Scope: the push exemption (`pushExempt` in `scripts/gates/gate-files.json`), the audit on `uv.lock` and `go.sum`, and a license and age policy.
32. [`bl-lock-install-check`] Partly done (CI, PR #8): `ci.yml` runs `rush install` on every pull request, so a lock that does not match `repo-state.json` or `package.json` fails CI. Open: the local check. Nothing runs `rush install` when the lock changes on the local machine. Proposed fix: in `dep-checks.mjs` or `local-gates.sh`, when `pnpm-lock.yaml`, `repo-state.json` or `rush.json` changed since the base, run `rush install` (not `rush update`). Add the same step to `deps.yml` when that workflow is built (`gates.md` section 4.4). CI workflows are human-only.
33. [`bl-rushjson-shape`] Done in the gates-relax-2 handoff (2026-10-25, file 03): each added `rush.json` entry must match the `register-project.mjs` text, its folder must be `projects/<name>` with the package `@vprprudhvi/<name>`, and the reserved names `dist`, `node_modules` and `.next` are rejected. The change takes effect when a human applies the handoff. Was: the push exemption checked only that the `projects` list changed, so an agent could register any `projectFolder`.
34. [`bl-gates-relax`] Done (2026-10-23, 5098052): `register-project.mjs`, the audit on a lockfile change, failure logs in `.claude/state/failure-logs/` (the newest 10 stay), and the pr-size limits (warn above 2000 lines, fail above 10000).
35. [`ci-local-gates-from`] `local-gates.sh` runs `rush verify --impacted-by`. On a fresh clone the dependencies have no `dist/`, so the build fails (CI run 1, TS2307). Done (2026-10-26, PR #12): `local-gates.sh` builds with `--from` first, as `ci.yml` does, and warms uv and Go before Rush (the CI run 2 failure). Follow-up (owner, 2026-10-26): `local-gates.sh` runs Bruno coverage only on the impacted API projects, as `ci.yml` does (handoff `local-gates-bruno-impacted`). PR #13 installs gitleaks and opengrep in `ci.yml`, because the gate tests need them.
36. [`ci-go-cache-partial`] The Go cache entry was saved by a failed run before the warm steps existed, so it lacks the tool modules. Exact keys never refresh it until `go.sum` changes. Fix: save each cache right after the step that fills it, and delete the partial entry once.
37. [`ci-flaky-axe`] `projects/sample/web/e2e/home.spec.ts:27` failed once in CI (run 40264530454, attempt 1): axe found no `<title>` after a note is saved. The rerun passed. Find the root cause.
38. [`ci-synth-arm64`] The `env=prod` synth takes 227 s, because the arm64 Python bundle runs under QEMU. Option: an `ubuntu-24.04-arm` runner for synth.
39. [`ci-required-check`] Done (2026-10-25): the `main` ruleset requires a pull request and the `ci` check, and has no bypass. The owner applied it. The `risk:low`, `risk:medium`, `risk:high`, `lint-exception`, `test-removal` and `large-pr` labels exist (2026-10-26).

## 5. How to start Wave 3

Start only when the owner says so.

1. Read this file, [plan.md](plan.md) sections 1 to 13, and the root `CLAUDE.md`.
2. Run `git status` and `git log --oneline -5`. The tree must be clean.
3. Run `node common/scripts/install-run-rush.js install`, then `node common/scripts/install-run-rush.js verify`. It must pass.
4. Set the tracker tasks for Wave 3 to `in_progress` as each one starts.

Wave 3 scope:

| Task id               | Work                                                                                                                                                                                                                                                                                             | Owner of files                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `w3-platform-cognito` | `platform/infra`: one Cognito user pool with Google sign-in (client id and secret in Secrets Manager `/platform/<env>/cognito/google-oauth`, created by the owner), a Cognito prefix domain, and the SSM parameters under `/platform/<env>/cognito/...`. Route53 and ACM are backlog (`bl-dns`). | `platform/**`                                                                                 |
| `w3-project-infra`    | `packages/cdk-constructs` (Lambda construct with the ADOT layer, tracing on, SSM read helpers) and `projects/sample/bin` + `lib` (API Gateway HTTP API, Lambda, OpenNext for web, own Cognito app client, DNS records). cdk-nag, assertion tests, snapshots.                                     | `packages/cdk-constructs/**`, `projects/*/bin/**`, `projects/*/lib/**`, `projects/*/cdk.json` |
| `w3-ci`               | `.github/workflows`: `ci`, `sast`, `deps`, `infra`, `claude-review`, `risk-classify`, `nightly`, `release`, `rollback`, `scorecard`. Actions pinned by SHA. Least-privilege permissions. OIDC for AWS.                                                                                           | `.github/**`                                                                                  |
| `w3-gates-scripts`    | `scripts/check-gates` (reuse `scripts/gates/lib/gate-integrity.mjs`; disable count, test deletion, PR size) and `scripts/classify-risk`. No diff coverage yet.                                                                                                                                   | `scripts/gates/check-gates.mjs`, `scripts/gates/classify-risk.mjs`                            |
| `w3-gh-setup`         | `scripts/gh-setup.sh`: ruleset, merge queue, environments. The owner runs it.                                                                                                                                                                                                                    | `scripts/gh-setup.sh`                                                                         |

Wave 3 rules:

- Never run `cdk deploy` or `cdk destroy`. Use `cdk synth` and a read-only `cdk diff` only.
- Split the agents by the file owners in the table above. They can run in parallel.
- Each builder runs `verify --only` for its own packages. The orchestrator runs one full verify at integration.
- Use a bounded review: one review per area, then skeptics with fixed pass criteria.

Wave 4 (after Wave 3): the gate fixtures script (plan section 11), activation of `.claude/settings.pending.json` as `.claude/settings.json`, and a final check.
