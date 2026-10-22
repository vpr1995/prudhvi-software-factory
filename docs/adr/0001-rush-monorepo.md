# ADR 0001: Use Rush with pnpm for the monorepo

- Status: Accepted
- Date: 2026-10-22

## Context

The repository holds several products. Each product has a web app, an API, contracts, and infrastructure code. Agents write most of the code. The build must be fast, repeatable, and safe to run in CI.

The team needs:

- One install and one lockfile for all projects.
- Build order across projects, with a build cache.
- A way to build and test only the projects that a change affects.
- Strict dependency rules between projects.

## Decision

- Use Rush (version 5.181) as the monorepo tool.
- Use pnpm 10 as the package manager. Rush installs its own copy of pnpm.
- Use Node 24. The version is in `.nvmrc` and `rush.json`.
- Install packages only with `rush add -p <package>` and `rush install`. Do not use `npm` or `pnpm` directly.
- Use `rush build --impacted-by` and `rush verify --impacted-by` in CI and in the hooks.
- Enable `strictPeerDependencies` and `ensureConsistentVersions`.

## Consequences

- Positive: One lockfile. Consistent versions. Build cache. Impacted-only builds.
- Positive: Rush blocks direct installs in each project folder.
- Negative: Rush is less common than npm workspaces. New team members need onboarding (see `docs/onboarding.md`).
- Negative: Rush config files are gate files. Changes need a human approval (see `docs/standards/gates.md`).
