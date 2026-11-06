---
status: draft
owner: vpr1995
date: 2026-11-05
---

# Software factory: idea to production

## 1. Problem

The owner gives one feature idea. Today the path from idea to production has gaps:

- No skill turns an idea into a reviewed design.
- No skill turns a design into tickets.
- The owner starts each ticket by hand. Nothing caps the cost or the turns of a run.
- No CI job deploys a merged change.
- Docs drift from the code. On 2026-11-05 a manual audit found more than 100 stale lines (PR #58).
- Some rules are prose only. An agent can delete a test or weaken a threshold, and only a human reviewer can see it.

## 2. Goals

1. One pipeline: brainstorm, design, design review, tickets, implement, review, merge, deploy, drift check.
2. The owner decides at 4 gates only: brief, design PR, `agent:ready`, PR merge.
3. Deterministic checks enforce the rules. Prompts only guide.
4. Small changes skip the design stages.
5. Each run has a cost cap and a log line.

## 3. Non-goals

- Auto-merge. The owner merges each PR.
- A bot account. Agent PRs use the owner's GitHub user (owner decision 2026-11-05).
- Per-PR preview stacks. One AWS account makes them costly and hard to clean up.
- Multi-agent writers. Writers run one at a time. Reviewers are read-only and can run in parallel.

## 4. What the research says

Five research reports (2026-11-05) agree on these points. Tag: **[P]** = primary source read, **[S]** = secondary or unverified.

1. **Deterministic gates beat prompts.** "If a CLAUDE.md line keeps being ignored, move it to a hook." [P] <https://code.claude.com/docs/en/best-practices>. OpenAI "harness engineering": lints whose error messages tell the agent the fix [S].
2. **Fresh-context review finds hidden assumptions.** Elephant/Goldfish: a comprehension test, a critic, a readiness test [P] (Rensin essay, google/elephant-goldfish-model). Claude Code docs: interview to SPEC.md, then a fresh session builds [P].
3. **Too much spec hurts.** Kiro turned a small bug into "4 user stories with 16 acceptance criteria". Spec Kit files are "verbose and tedious to review" [P] <https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html>. Size tiers are the fix [P] (BMAD, Kiro Quick Spec).
4. **Testable requirements with IDs.** EARS form: `WHEN <event> THE SYSTEM SHALL <behavior>` [P] <https://kiro.dev/docs/specs/feature-specs/>. Each ID maps to a test.
5. **`[NEEDS CLARIFICATION]` markers and a read-only consistency check** between spec, plan, and tasks [P] <https://github.com/github/spec-kit>.
6. **Agents game tests.** They hard-code results and edit tests [P] <https://arxiv.org/html/2511.21654v1>. An LLM judge with fresh context was the best detector there. CI must also block deleted tests and weakened thresholds.
7. **Self-contained tickets.** An ExecPlan has acceptance, exact commands, a progress section, and a decision log [P] <https://developers.openai.com/cookbook/articles/codex_exec_plans>.
8. **Two review passes:** spec compliance first, code quality second [P] <https://github.com/obra/superpowers>.
9. **Caps and an escape hatch.** Stripe caps CI fix rounds at 2 [P] <https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents>. Headless runs have `--max-turns` and `--max-budget-usd`, and the JSON output has `total_cost_usd` [P] <https://code.claude.com/docs/en/headless>.
10. **Prompt injection through issue text** is the main risk of an autonomous loop [P] <https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/>. Containment beats detection.
11. **Docs drift unless CI checks them.** A doc lint fails when a doc names a missing path, script, or command [S] <https://understandingdata.com/posts/doc-drift-detection-ci/>.
12. **Measure the factory.** Cost per merged PR, review rounds, needs-human rate, change failure rate [S] DORA 2025.

## 5. Pipeline

```text
Size tier at intake:
  XS (doc, chore, dep bump)   -> ticket only
  S  (bug fix)                -> ticket + failing test first
  M/L (new route, page, stack, package, data shape) -> full pipeline

M/L:
 1 /brainstorm     owner + architect, open questions, 8 lens reviewers  -> brief.md        GATE 1: owner agrees
 2 /design         section by section with owner                        -> design.md
 3 /design-review  comprehension, critic, readiness, code fit, R-ID check -> fixes in design.md
                   design PR                                                                GATE 2: owner merges
 4 /plan-tickets   parent issue + sub-issues, R-IDs, deps, size score    -> GitHub issues   GATE 3: owner adds agent:ready
 5 /work-ticket N  branch, failing test, code, verify, pre-pr, PR, caps   -> PR + metrics line
 6 CI              build, lint, typecheck, test, coverage, e2e, doc-lint, test-guard        GATE 4: owner merges
 7 CI deploy       changed projects to their target (Cloudflare or AWS), then smoke test
 8 weekly          /drift-report -> drift issues
```

## 6. Stage details

### 6.1 Brainstorm (`/brainstorm`)

- The architect asks open questions over several turns: the problem, the users, constraints, edge cases, today's workaround, the success measure. No multiple choice in this phase (EGM rule).
- Readiness gate: the architect states the idea in 3 sentences. The owner confirms.
- Then 8 read-only lens agents run in parallel with fresh context. Each gets only the draft brief and the file paths it names:
  1. YAGNI / contrarian: can an existing library, AWS service, or repo package do 90%?
  2. Cost and quota: Lambda, DynamoDB, Cognito, and token cost at expected load.
  3. UX and developer ergonomics: is the API or page clear? Are errors actionable?
  4. Migration and backward compatibility: contract changes, data, rollback during migration.
  5. Observability: traces, logs, metrics. How do we debug at 3 AM?
  6. Tech debt: coupling, ownership in 2 years.
  7. Security and privacy: auth, input validation, PII in logs, IAM.
  8. Testing and rollout: unit, Bruno, Playwright, flag, rollback.
- Lens prompts say "skip style; report only findings that change the design" (best-practices guidance against invented findings).
- Output: `docs/designs/<slug>/brief.md` with problem, non-goals, chosen direction, lens findings and resolutions, open `[NEEDS CLARIFICATION]` items.

### 6.2 Design (`/design`)

`docs/designs/<slug>/design.md`. One file. Sections:

1. Problem, Goals, Non-goals.
2. Requirements with IDs: `R-1: WHEN … THE SYSTEM SHALL …`. Plus "Unchanged behavior".
3. Critical user journeys.
4. Contracts (Zod schemas, routes), data, infra.
5. Alternatives considered.
6. Flag, observability, cost, security, migration.
7. Deploy and rollback.
8. Implementation plan: tasks with files to create or change, R-IDs, verification commands. No code.
9. Decision log (dated).

Gate: zero `[NEEDS CLARIFICATION]` markers.

### 6.3 Design review (`/design-review`)

Read-only fresh agents, one per stage:

1. Comprehension: explain the design back. Gaps show missing context.
2. Critic: design flaws, risks, simpler options.
3. Code fit: does the design match the repo (contracts, packages, CDK constructs)?
4. Readiness: could an agent build each task in one pass?
5. Consistency: each R-ID maps to a task and a test, and each task maps to an R-ID.

The owner picks the findings to fix. Then a design PR with `risk:low`. The owner merges it.

### 6.4 Tickets (`/plan-tickets`)

- Reads the merged `design.md`. Creates one parent issue and sub-issues through the Ticket issue form fields.
- Each issue is self-contained: Context (link to the design section), Acceptance (R-IDs as checkboxes, Bruno or Playwright proof per R-ID), files, commands, size score 1 to 10, `blocked` links.
- Tasks above size 5 are split.
- The agent never adds `agent:ready`. The owner does (Ticket Workflow rule 3).

### 6.5 Implement (`/work-ticket <n>`)

- Phase 1 (local): the owner runs `/work-ticket <n>`. It claims the ticket (`agent:in-progress`), branches, runs `implement-feature`, and stops at the caps.
- Caps: 3 review rounds (rule 12), 2 CI fix rounds. At a cap: label `needs-human`, comment the blocker, stop.
- `pre-pr` gets a first pass: spec compliance against the R-IDs (the `spec-reviewer` agent, Opus, with the issue, diff, and tests; it flags hard-coded or special-cased logic). The existing quality pass runs second.
- Each run posts one `factory-metrics` comment on the PR (on the issue if no PR): issue, PR, cost, turns, review rounds, CI rounds, outcome. Cost and turns are null until Phase 2.
- Phase 2 (later, opt-in): `claude-code-action` on `issues: labeled` (`agent:ready`), concurrency 1, `--max-turns`, `--max-budget-usd`, `timeout-minutes`. Needs a GitHub App token, because commits made with `GITHUB_TOKEN` do not trigger CI [P]. Only issues by the owner run. No `--bare` mode: it disables hooks [P].

### 6.6 Gates (deterministic)

| Gate          | Where                                        | Catches                                                                                                                                                      |
| ------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Doc lint      | CI                                           | Doc names a missing path, script, Rush command, skill, or agent. Broken links.                                                                               |
| Test guard    | CI                                           | Deleted test files, deleted `it`/`test` blocks, lowered thresholds, new `eslint-disable`, changed lint or Vitest config without the `risk:high` label.       |
| Verify gate   | Stop and SubagentStop hooks (`command`) [P]  | Stop with source changes that no passing `rush test` covers. See 6.6.1.                                                                                      |
| Commit gate   | PreToolUse hook on each Bash command [P]     | Commit before a typecheck passes on the staged content of each staged source file. Proof by content hash, as in 6.6.1. Lint runs in the pre-commit git hook. |
| Mutation test | CI, Stryker incremental on changed files [P] | Weak assertions that coverage cannot see. Later stage (effort M).                                                                                            |

#### 6.6.1 Verify gate (Stop and SubagentStop hooks)

Lesson from the old `stop-gate` (removed in PR #43): it ran lint, typecheck, and tests inside the hook at each stop, and it blocked when it crashed. Each turn end was slow. This gate checks proof only. It runs no tests and no Rush command. Target run time: under 1 second.

**Writers.** Parallel subagents must be read-only (reviewers, lenses, research). Writer subagents run one at a time in the shared working tree. Reasons: Rush runs one command at a time, and the research says to keep writers single-threaded. Worktrees for parallel writers are out of scope.

**State.** The hooks write state under `.claude/state/` (gitignored). The live probe (2026-11-05) showed: subagent events have `agent_id`, main session events do not; a Bash command that exits 0 fires PostToolUse, and a non-zero exit fires PostToolUseFailure.

- PostToolUse on Edit, Write, MultiEdit and NotebookEdit: add the path to `agents/<agent_id>.jsonl`. The main session uses the id `main`.
- Session base: the first hook call of a session stores `HEAD`. A file is changed when it differs from the session base or is untracked. A commit does not hide an edit.
- PreToolUse on Bash: store the hash of each changed source file. PostToolUse and PostToolUseFailure on Bash: add each source file with a new or different hash to the list of the agent. Writers run one at a time, so the time window of the command tells which agent changed the file.
- PostToolUse on Bash: when `install-run-rush.js test` or `verify` is the last command and exits 0, store the hash of each covered changed file that the command did not change (`verified.json`, key: the path).
- PostToolUseFailure on Bash: store a failed `rush test` or `verify` of the agent, with the hashes of its unverified files.
- Permission rules deny the edit tools and Bash commands that name `.claude/state`. A script can still write the state.

**Logic at each stop:**

1. The agent edited no source files (`*.ts`, `*.tsx`, `*.mts`, `*.cts`, `*.js`, `*.jsx`, `*.mjs`, `*.cjs` under `projects/`, `packages/`, `platform/`, `tooling/`): allow. Q&A turns and doc-only turns pass.
2. Group the edited files by project (`rush.json`). For each project, compare the current hash with the stored "verified" hash.
3. All projects match: allow.
4. Else block. The message names each unverified project and its files, and gives the command: `rush test --only <project> …`. A source file outside each Rush project blocks: register the project in `rush.json`.

- SubagentStop checks only the files of that subagent. Another agent's files never block it.
- The main Stop checks all files that the session edited. The orchestrator owns the integration. It can stop when each unverified file belongs to a subagent that still runs in the background.

**Hard block.** A subagent cannot stop until its projects are verified, or until it ran the test and the test failed. For the second case, the gate needs a failed `rush test` or `verify` of that subagent that covers all its unverified projects, with no file change after it. The owner then sees `Subagent stopped with failing check: <command> (projects: …)`, and the subagent reports the failing check to the orchestrator in its final message. The main session cannot stop either, with one exception: a deferral.

**Deferral (main session only).** The agent runs `stop-gate defer "<reason>"`, for example to ask the owner a question. The deferral:

- covers only the current hashes. The next code change blocks again;
- shows the owner a system message: `Verify deferred: <reason> (projects: …)`;
- appends a line to `.claude/state/deferrals.log`. The drift report counts deferrals.

**Crash.** Any hook error blocks the stop and names the error. `onFailure: "block"` does not do this. The hooks doc says: "The field has no effect on these hooks: `Stop`, `SubagentStop`, `TaskCompleted`, and `TeammateIdle` hooks". The gate does it in two steps. The script catches each error and writes `decision: "block"` with the error text. The shell wrapper in `.claude/settings.json` exits 2 when `node` fails, for example when the script does not load. A hook timeout still lets the stop go on. No hook setting changes this. The owner can turn the gate off with `FACTORY_STOP_GATE=off` in user settings or the shell. This variable is not in repo settings, so an agent PR cannot turn the gate off. The gate script has unit tests in `tooling/`. Note: Claude Code releases a Stop hook after 8 blocks in a row with no tool call between them [P].

**Scale.** Proof costs grow with the changed projects, not with their dependents:

| Where                        | Command                                                                                                              | Scope                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Stop proof                   | `rush test --only <owning projects>`                                                                                 | Projects that own the changed files. A library change tests the library only.   |
| Before a PR (`verify` skill) | `rush verify --only <owning projects>`; when a shared package changed, also `rush typecheck --impacted-by <package>` | Typecheck finds breaks in dependents. The build cache skips unchanged projects. |
| CI                           | Matrix job per impacted project (exists)                                                                             | All dependents, in parallel, with the build cache.                              |

### 6.7 Deploy on merge

#### Targets

Each project names one target in its `package.json`:

```json
"factory": { "deploy": "cloudflare" }
```

| Target       | Use for                       | How CI deploys                                       | Smoke test         |
| ------------ | ----------------------------- | ---------------------------------------------------- | ------------------ |
| `cloudflare` | A static web part             | `wrangler deploy` (Cloudflare Workers static assets) | Playwright on prod |
| `aws`        | An API or other AWS resources | `cdk deploy` of the project stack                    | Bruno on prod      |
| `none`       | A library, or not ready yet   | No deploy                                            | None               |

A project with web and API uses both targets: `["cloudflare", "aws"]`. A CI check fails when a project has no `factory.deploy` field. `rush new --project` and `add-part` set the field.

#### Hostnames

- Domain: `vprprudhvi.dev`. Cloudflare holds the DNS zone. The root domain serves no page.
- Web: `<project>.vprprudhvi.dev`. Example: `national-parks.vprprudhvi.dev`.
- API: `<project>-api.vprprudhvi.dev`. Example: `national-parks-api.vprprudhvi.dev`.
- Each project writes its web hostname in `wrangler.jsonc` (`routes` with `custom_domain: true`). `wrangler deploy` creates the site, the DNS record and the certificate. No manual step for a new project.
- A CI check fails when two projects use the same hostname.
- API hostname: the project stack creates the ACM certificate and the API Gateway custom domain. CI adds the ACM validation record and the `CNAME` in Cloudflare DNS through the Cloudflare API. Build this with the first API project that ships, not in step 7.

#### Workflow

- `deploy.yml` runs on push to `main`. Job `plan` lists the changed projects (`rush list --impacted-by`) and reads each target.
- Job `cloudflare`: one run per changed web project. It builds the static export, adds the `_headers` file (security headers, CSP), runs `wrangler deploy`, then the Playwright smoke test.
- Job `aws`: one run per changed AWS project. OIDC role that only assumes the CDK bootstrap roles. Trust policy pinned to the repo, `main`, and environment `prod`. Never `platform/infra`. Then the Bruno collection on safe routes.
- Secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` live in the GitHub environment `prod`. Token scope: Workers Scripts Edit and DNS Edit on the `vprprudhvi.dev` zone only.
- Each project deploys alone. A failed build in one project does not block the others.
- On a smoke test failure: open a revert PR (one revert per commit, never revert a revert).
- `cdk diff` comment on infra PRs (read-only role).
- Later: Lambda alias with CodeDeploy canary and alarm rollback, CloudWatch Synthetics canary.

#### Owner setup (one time, before build step 7)

1. Buy `vprprudhvi.dev` (Cloudflare Registrar), or move its nameservers to Cloudflare.
2. Create the Cloudflare API token with the scope above.
3. Add the two secrets to the GitHub environment `prod`.

#### Cost

- Cloudflare: free plan. Static asset requests are free. Limits: about 20,000 files per site, 25 MiB per file. Verify these limits and the `custom_domain` behavior in the Cloudflare docs in build step 7.
- Domain: about USD 10 to 15 for each year.

#### First migration

`national-parks-tracker` is a static export on S3 and CloudFront today. It moves to `cloudflare` as the first feature through the new pipeline (build step 7). The design for it keeps the CloudFront security headers in `_headers`, then removes the S3 and CloudFront stack.

### 6.8 Drift (`/drift-report`)

- Weekly. Compares `docs/designs/*`, `docs/**`, area CLAUDE.md files, and the wiki Status page with the code.
- Opens one `drift` issue for each finding. The owner chooses: fix the doc or fix the code.
- Runs locally first. Later: a scheduled `claude-code-action` job.

## 7. Rule changes (owner decisions 2026-11-05)

1. **Designs can describe future work.** Only `docs/designs/` is exempt from "docs reflect only what is implemented" and from the `docs/CLAUDE.md` rule that puts plans in the wiki. Each design has `status: draft | approved | implemented | superseded`. Doc lint skips designs that are not `implemented`. Update `docs/CLAUDE.md` in build step 1.
2. **CI is the only prod deployer.** Agents test locally (Fastify `inject`, Next dev server, Bruno against localhost). Root `CLAUDE.md` rule 4 drops the test-deploy permission. `.claude/settings.json` denies `cdk deploy` again. The `e2e-verify` skill drops its deploy step. Build step 1.
3. **Rule 13 allows git worktrees and CI checkouts.** Rule 13 bans copies outside git (scratch folders, extra clones). Reword it in build step 1.
4. **No bot vs Actions runner.** Phase 2 needs a GitHub App token. Phase 1 (local) does not. Decide before build step 10.
5. **Spec-compliance judge runs locally** in `pre-pr`, before the quality pass. No CI judge.

## 8. Build order

One PR per step. Each step is checked before the next.

| #   | PR                                                                                                                                                                                    | Effort |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Rule changes from section 7 + doc lint + test guard in CI                                                                                                                             | M      |
| 2   | Verify gate (6.6.1): Stop + SubagentStop hooks, state hooks, deferral, unit tests; commit gate. Probe hook fields live first.                                                         | M      |
| 3   | `/brainstorm` + 8 lens agents                                                                                                                                                         | M      |
| 4   | `/design` + template + `/design-review` (5 stages)                                                                                                                                    | M      |
| 5   | `/plan-tickets`                                                                                                                                                                       | S      |
| 6   | `/work-ticket` (local, caps, metrics line, spec-compliance pass in `pre-pr`)                                                                                                          | M      |
| 7   | Deploy on merge (6.7): Cloudflare and AWS targets, hostname check, OIDC role in `platform/infra` (owner deploys it once). First feature: move `national-parks-tracker` to Cloudflare. | L      |
| 8   | `/drift-report` + weekly run                                                                                                                                                          | S      |
| 9   | Stryker incremental on changed files                                                                                                                                                  | M      |
| 10  | Phase 2 runner (`claude-code-action`, App token)                                                                                                                                      | M      |

## 9. Risks

- Too much ceremony. Mitigation: size tiers, one `design.md`, lens prompts that skip style.
- Token cost: lens and review fan-outs multiply tokens [P] (Anthropic multi-agent post). Mitigation: Haiku for lint-type checks, Sonnet for lenses, Opus for critic and security; metrics line per run.
- Prompt injection through issue text. Mitigation: only owner-authored issues run; no secrets beyond what the task needs; read-only reviewers.
- Hook gates fail open on timeout. `onFailure: "block"` has no effect on Stop and SubagentStop hooks [P]. Mitigation: the gate script catches each error and blocks, the shell wrapper exits 2 when `node` fails, and the gate runs in about 0.1 s against a 10 s timeout. A timeout still lets the stop go on.
- A crashing gate locks the session (the PR #43 lesson). Mitigation: unit tests for the gate script, and the owner-only `FACTORY_STOP_GATE=off` switch.
- Deferral abuse. Mitigation: each deferral shows a system message to the owner and goes to a log that the drift report counts.
- Cloudflare token leak. Mitigation: token scoped to Workers Scripts and one DNS zone; only the `prod` environment on `main` can read it.
- Two providers (Cloudflare, AWS). Mitigation: one `deploy.yml`, one target field, API DNS in Cloudflare through code only.
- A judge can be fooled. Mitigation: the judge is one gate of several. CI test guard and mutation tests stay.

## 10. Decision log

- 2026-11-05: designs live in `docs/designs/<slug>/`. CI deploys on merge. 8 lenses. Small fixes skip design. Reviewers run locally. No bot account. Tickets start by hand.
- 2026-11-05: `docs/designs/` exempt from the implemented-only rule. CI is the only prod deployer (reverses the test-deploy permission in rule 4). Git worktrees and CI checkouts do not break rule 13. Spec-compliance judge runs locally in `pre-pr`.
- 2026-11-05: verify gate (6.6.1). Writers run one at a time; only read-only subagents run in parallel. Proof is `rush test --only` on the owning projects; CI covers dependents. Hard block, with a visible and logged deferral for the main session. A gate crash blocks; the owner-only `FACTORY_STOP_GATE=off` turns the gate off.
- 2026-11-05: verify gate crash handling (6.6.1). `onFailure` has no effect on Stop and SubagentStop hooks. The gate script catches each error and blocks. The shell wrapper exits 2 when `node` fails. A hook timeout still lets the stop go on.
- 2026-11-05: verify gate fixes (6.6.1). The gate records Bash edits, uses a session base commit, gives credit only to files that the test command did not change, lets a subagent stop after a failed test run that covers its files, and blocks for a source file outside each Rush project.
- 2026-11-05: commit gate (6.6). Proof is a passing `rush typecheck` or `rush verify` (typecheck proof by file hash, stored apart from test proof). The gate hashes the index blob, so a partly staged file needs its own typecheck. It allows only commit options that commit the index. The hook has no `if` filter: `if` does not see `env git commit`, and the script takes about 0.04 s for other commands. A gate error denies the commit only. Lint stays in the pre-commit git hook. The hook runs before the Bash command, so only read-only commands can come before `git commit` in the same command (live test: `git add -A && … git commit` got past the gate).
- 2026-11-05: deploy targets (6.7). Static web goes to Cloudflare Workers static assets at `<project>.vprprudhvi.dev`. APIs go to AWS at `<project>-api.vprprudhvi.dev`. The root domain serves no page. One `deploy.yml` reads the `factory.deploy` field; no workflow for each project. `national-parks-tracker` moves to Cloudflare as the first feature in build step 7.
- 2026-11-06: tickets (6.4). The agent drafts the issues; the owner approves all text before creation. Native sub-issues and blocked-by links. Fixed size rubric. A task above 5 can stay whole when each split puts 2 tasks on one file; the owner gives the reason.
- 2026-11-06: work-ticket (6.5). The metrics line is a PR comment, not a committed file: a commit after CI starts CI again, and appends from 2 PRs conflict. Cost and turns are null until Phase 2. The spec reviewer runs on Opus.
