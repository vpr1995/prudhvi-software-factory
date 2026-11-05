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

1. **Deterministic gates beat prompts.** "If a CLAUDE.md line keeps being ignored, move it to a hook." [P] https://code.claude.com/docs/en/best-practices. OpenAI "harness engineering": lints whose error messages tell the agent the fix [S].
2. **Fresh-context review finds hidden assumptions.** Elephant/Goldfish: a comprehension test, a critic, a readiness test [P] (Rensin essay, google/elephant-goldfish-model). Claude Code docs: interview to SPEC.md, then a fresh session builds [P].
3. **Too much spec hurts.** Kiro turned a small bug into "4 user stories with 16 acceptance criteria". Spec Kit files are "verbose and tedious to review" [P] https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html. Size tiers are the fix [P] (BMAD, Kiro Quick Spec).
4. **Testable requirements with IDs.** EARS form: "WHEN <event> THE SYSTEM SHALL <behavior>" [P] https://kiro.dev/docs/specs/feature-specs/. Each ID maps to a test.
5. **`[NEEDS CLARIFICATION]` markers and a read-only consistency check** between spec, plan, and tasks [P] https://github.com/github/spec-kit.
6. **Agents game tests.** They hard-code results and edit tests [P] https://arxiv.org/html/2511.21654v1. An LLM judge with fresh context was the best detector there. CI must also block deleted tests and weakened thresholds.
7. **Self-contained tickets.** An ExecPlan has acceptance, exact commands, a progress section, and a decision log [P] https://developers.openai.com/cookbook/articles/codex_exec_plans.
8. **Two review passes:** spec compliance first, code quality second [P] https://github.com/obra/superpowers.
9. **Caps and an escape hatch.** Stripe caps CI fix rounds at 2 [P] https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents. Headless runs have `--max-turns` and `--max-budget-usd`, and the JSON output has `total_cost_usd` [P] https://code.claude.com/docs/en/headless.
10. **Prompt injection through issue text** is the main risk of an autonomous loop [P] https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/. Containment beats detection.
11. **Docs drift unless CI checks them.** A doc lint fails when a doc names a missing path, script, or command [S] https://understandingdata.com/posts/doc-drift-detection-ci/.
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
 7 CI deploy       changed project stacks via OIDC, then Bruno smoke
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
- `pre-pr` gets a first pass: spec compliance against the R-IDs (fresh agent with the issue, diff, and tests; it flags hard-coded or special-cased logic). The existing quality pass runs second.
- Each run appends one JSON line to `metrics/runs.jsonl`: issue, PR, cost, turns, review rounds, CI rounds, outcome.
- Phase 2 (later, opt-in): `claude-code-action` on `issues: labeled` (`agent:ready`), concurrency 1, `--max-turns`, `--max-budget-usd`, `timeout-minutes`. Needs a GitHub App token, because commits made with `GITHUB_TOKEN` do not trigger CI [P]. Only issues by the owner run. No `--bare` mode: it disables hooks [P].

### 6.6 Gates (deterministic)

| Gate          | Where                                                                      | Catches                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Doc lint      | CI                                                                         | Doc names a missing path, script, Rush command, skill, or agent. Broken links.                                                                         |
| Test guard    | CI                                                                         | Deleted test files, deleted `it`/`test` blocks, lowered thresholds, new `eslint-disable`, changed lint or Vitest config without the `risk:high` label. |
| Verify gate   | Stop hook (`command`, `onFailure: "block"`, checks `stop_hook_active`) [P] | "Done" with no verify output in the session.                                                                                                           |
| Commit gate   | PreToolUse hook, `if: "Bash(git commit *)"` [P]                            | Commit before lint and typecheck pass on staged files.                                                                                                 |
| Mutation test | CI, Stryker incremental on changed files [P]                               | Weak assertions that coverage cannot see. Later stage (effort M).                                                                                      |

### 6.7 Deploy on merge

- GitHub Actions on push to `main`. OIDC role that only assumes the CDK bootstrap roles. Trust policy pinned to the repo, `main`, and environment `prod`.
- Deploys only the changed project stacks (`rush list --impacted-by`). Never `platform/infra`.
- After deploy: run the Bruno collection against prod on safe routes. On failure: open a revert PR (one revert per commit, never revert a revert).
- `cdk diff` comment on infra PRs (read-only role).
- Later: Lambda alias with CodeDeploy canary and alarm rollback, CloudWatch Synthetics canary.

### 6.8 Drift (`/drift-report`)

- Weekly. Compares `docs/designs/*`, `docs/**`, area CLAUDE.md files, and the wiki Status page with the code.
- Opens one `drift` issue for each finding. The owner chooses: fix the doc or fix the code.
- Runs locally first. Later: a scheduled `claude-code-action` job.

## 7. Conflicts with current rules (owner decisions needed)

1. **D0 and docs/CLAUDE.md vs designs.** "Docs reflect only what is implemented" (2026-11-05), and `docs/CLAUDE.md` puts plans in the wiki. A design describes future work. Proposal: exempt `docs/designs/` only. Each design has `status: draft | approved | implemented | superseded`. Doc lint skips designs that are not `implemented`.
2. **Rule 13 vs worktrees and runners.** Rule 13 forbids work in a copy. Proposal: rule 13 bans copies outside git. A git worktree and a CI checkout are allowed.
3. **Test deploys vs CI deploys.** One account, one `prod` stage. An agent's test `cdk deploy` of a project stack changes prod, and the next CI deploy overwrites it. Options: (a) CI is the only prod deployer; agents test locally only; (b) test stacks get a suffix (needs cleanup, and `cdk destroy` is denied).
4. **No bot vs Actions runner.** Phase 2 needs a GitHub App token. Phase 1 (local) does not.
5. **Spec-compliance judge: local or CI.** The owner chose local review. Proposal: local in `pre-pr` first.

## 8. Build order

One PR per step. Each step is checked before the next.

| #   | PR                                                                                                                                     | Effort |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Doc lint + test guard in CI                                                                                                            | M      |
| 2   | Verify Stop hook + commit gate (probe hook fields live first)                                                                          | S      |
| 3   | `/brainstorm` + 8 lens agents                                                                                                          | M      |
| 4   | `/design` + template + `/design-review` (5 stages)                                                                                     | M      |
| 5   | `/plan-tickets`                                                                                                                        | S      |
| 6   | `/work-ticket` (local, caps, metrics line, spec-compliance pass in `pre-pr`)                                                           | M      |
| 7   | Deploy on merge (OIDC role in `platform/infra`, owner deploys it once; workflow; Bruno smoke). First feature through the new pipeline. | L      |
| 8   | `/drift-report` + weekly run                                                                                                           | S      |
| 9   | Stryker incremental on changed files                                                                                                   | M      |
| 10  | Phase 2 runner (`claude-code-action`, App token)                                                                                       | M      |

## 9. Risks

- Too much ceremony. Mitigation: size tiers, one `design.md`, lens prompts that skip style.
- Token cost: lens and review fan-outs multiply tokens [P] (Anthropic multi-agent post). Mitigation: Haiku for lint-type checks, Sonnet for lenses, Opus for critic and security; metrics line per run.
- Prompt injection through issue text. Mitigation: only owner-authored issues run; no secrets beyond what the task needs; read-only reviewers.
- Hook gates fail open on timeout. Mitigation: `onFailure: "block"` [P].
- A judge can be fooled. Mitigation: the judge is one gate of several. CI test guard and mutation tests stay.

## 10. Decision log

- 2026-11-05: designs live in `docs/designs/<slug>/`. CI deploys on merge. 8 lenses. Small fixes skip design. Reviewers run locally. No bot account. Tickets start by hand.
