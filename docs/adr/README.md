# ADR index

This folder holds the architecture decision records (ADRs). The format and the rules are in [docs/CLAUDE.md](../CLAUDE.md), section "ADR format".

## ADRs

| ADR  | Title                                                                                                           | Status                                               |
| ---- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 0001 | [Use Rush with pnpm for the monorepo](0001-rush-monorepo.md)                                                    | Accepted. Partly replaced                            |
| 0002 | [Use a projects layout with per-project contracts and import boundaries](0002-projects-layout-and-contracts.md) | Superseded by ADR 0010                               |
| 0003 | [Build shared packages to `dist` and consume the output](0003-shared-packages-built-to-dist.md)                 | Accepted                                             |
| 0004 | [Use open-source security tools only](0004-open-source-security-tooling.md)                                     | Accepted. Partly replaced                            |
| 0005 | [Use feature flags and a staged release](0005-feature-flags-and-staged-release.md)                              | Accepted. The deploy order is superseded by ADR 0011 |
| 0006 | [Shared platform infrastructure and Lambda-first compute](0006-platform-infra-shared-resources.md)              | Accepted. Partly replaced                            |
| 0007 | Not in use                                                                                                      | Removed                                              |
| 0008 | [Bruno for API requests and tests, Playwright for web](0008-bruno-and-playwright.md)                            | Accepted. Partly replaced                            |
| 0009 | [OpenTelemetry for end-to-end tracing and log correlation](0009-opentelemetry-tracing.md)                       | Accepted. Partly replaced                            |
| 0010 | [Single-package projects](0010-single-package-projects.md)                                                      | Accepted                                             |
| 0011 | [Local and prod environments](0011-local-and-prod-environments.md)                                              | Accepted                                             |

"Partly replaced" means a later change replaced a part of the ADR. The status line of the ADR gives the details.

## ADR 0007

ADR 0007 (polyglot backends) is not in use. Commit `e94328b` (remove gates and Python/Go support) deleted the file. Do not reuse the number 0007 for a new ADR. The next new ADR uses 0012.
