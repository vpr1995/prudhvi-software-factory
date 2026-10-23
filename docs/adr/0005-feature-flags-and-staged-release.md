# ADR 0005: Use feature flags and a staged release

- Status: Accepted. The deploy order is superseded by ADR 0011
- Date: 2026-10-22

## Context

Agents write many changes. A change can fail in production even after it passes the tests. The team needs a way to turn off a new behavior without a new deploy. The team also needs to test a release in a lower environment first.

## Decision

- Put each new user-visible behavior behind a flag from `packages/flags`.
- Flag names are typed. Each flag name is a member of one union type. An unknown name fails to compile.
- The first flag source reads from environment variables or JSON files. A vendor flag service can replace it later. Only `packages/flags` knows the source.
- Deploy in this order: `dev`, then `staging`, then `prod`. Each step uses GitHub Environments. `prod` needs a required reviewer.
- Turning off a flag is the first rollback step. A revert is the second. See `docs/runbooks/rollback.md`.
- A flag is removed after the behavior is stable. The removal is a separate PR.

## Consequences

- Positive: A new behavior can be turned off in minutes.
- Positive: Each release passes through `dev` and `staging` first.
- Negative: Code paths exist for both flag states until the flag is removed. Track flags and remove them.
- Negative: The first flag source does not support per-user rollout. Add it with a vendor service when needed.
- Out of scope for now: real `latest` and `stable` channels, incident dashboards, circuit breakers on the revert rate, and metrics on human review time.
