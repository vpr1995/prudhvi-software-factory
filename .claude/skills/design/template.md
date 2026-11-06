---
status: draft
---

# Design: <title>

Brief: `docs/designs/<slug>/brief.md`

## 1. Problem, Goals, Non-goals

<!-- State the problem in 2 sentences. List goals and non-goals. Take them from the brief. -->

## 2. Requirements

<!-- One line each: R-<n>: WHEN <trigger> THE SYSTEM SHALL <response>. Each R-ID is testable. -->

### Unchanged behavior

<!-- List what must not change. -->

## 3. Critical user journeys

<!-- Number the steps for each journey. Include the failure path. -->

## 4. Contracts, data, infra

<!-- Zod schemas and routes (contracts in src/contracts). Data shape. Infra parts and platform values. -->

## 5. Alternatives considered

<!-- One line each: option, why not. -->

## 6. Flag, observability, cost, security, migration

<!-- Flag: name from packages/flags. -->
<!-- Logs and traces: per docs/standards/observability.md. -->
<!-- Cost: dollars per month. -->
<!-- Security: per docs/standards/security.md. -->
<!-- Migration: data and old clients. -->

## 7. Deploy and rollback

<!-- Deploy target: factory.deploy is cloudflare, aws, none, or an array of cloudflare and aws. -->
<!-- Hostname for each part: <project>.vprprudhvi.dev (web), <project>-api.vprprudhvi.dev (API). -->
<!-- Rollback steps: per docs/runbooks/rollback.md. -->

## 8. Implementation plan

<!-- Each R-ID must appear in at least one row. No code. Verify: rush test --to <pkg>, rush e2e. -->
<!-- Each API route needs a Bruno request. Each web page needs a Playwright spec with an axe check. -->
<!-- Risk tier for each task: per docs/standards/risk-tiers.md. -->

| Task | Files | R-IDs | Risk | Verify |
| ---- | ----- | ----- | ---- | ------ |

## 9. Decision log

<!-- - YYYY-MM-DD: <decision> (<who>) -->
