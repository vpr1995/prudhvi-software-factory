# CLAUDE.md

Agent entry point for this Rush monorepo (TypeScript, AWS CDK). This file is a table of contents. Read the rules below. Then use the routing table to find the document or skill for your task.

## Repo conventions

1. Show the real command output before you say a task is done. Never say "done" without output from `verify` or the named command.
2. Never skip, delete, or weaken a test, a lint rule, or a threshold. If a check fails, fix the cause.
3. Run Rush only through the wrapper. `rush <cmd>` in the docs is an alias of the wrapper command. Never run `npm install`, `pnpm install`, or `pnpm add`. Use `rush add -p <pkg>` from the project folder.
4. Never use `--no-verify`, `git push --force`, `cdk deploy`, or `cdk destroy`. `.claude/settings.json` denies them. Agents do not deploy. Test locally: Fastify `inject`, the Next.js dev server, Bruno against localhost. The owner deploys.
5. One change for each PR. Keep the diff small. Each bug fix adds a test that fails before the fix.
6. Put each new user-visible behavior behind a flag from `packages/flags`.
7. Contracts (Zod, in `src/contracts` of each project) are the single source of the API shape.
8. Read config only in `config.ts`. Validate input with the project's contracts.
9. Log only with `@vprprudhvi/shared-logger`. Each log line carries OpenTelemetry trace ids. Never log secrets or personal data.
10. Each API route has a Bruno request with docs and assertions. Each web page has a Playwright spec with an axe check.
11. `platform/**`, `packages/**`, `tooling/**` and `.github/**` are high risk. The owner reviews them (see CODEOWNERS). `projects/*/bin/**` and `projects/*/lib/**` are medium risk: the infra reviewer agent checks them locally, cdk-nag runs in the infra unit tests, and the PR review covers them.
12. After 3 failed review rounds, stop and ask the human about the approach.
13. Work only in this repository and its git worktrees. Do not clone it, copy it outside git, or build in a scratch folder and bring the result back. CI checkouts are fine.

## Agent roles

- The main session is the orchestrator. It plans, delegates work to subagents, verifies the result, and commits. Its job ends there. Subagents write the code and the documents.
- Choose the subagent model by task difficulty:
  - Opus: the most complex work. For example, hook logic, security, architecture, and hard bugs.
  - Sonnet: the all-rounder. For example, normal features, tests, and reviews.
  - Haiku: the cheapest. For large amounts of simple writing. For example, Markdown documents, data files, boilerplate, and mechanical edits.
- Use a workflow (multi-agent script) or orchestrate step by step. Choose what fits the task.
- The orchestrator verifies each result with real command output before it commits (rule 1).
- After each edit of a source file, a hook gives ESLint and tsc findings for that file's project. Fix them before you continue. A stop hook blocks until `rush test` passes for the edited projects. Writer subagents run one at a time. Only read-only subagents run in parallel. See [commands.md](docs/guides/commands.md).

## Routing table

| When you...                        | Read                                                                            | Use skill                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start any task                     | [repo-overview](docs/guides/repo-overview.md), [onboarding](docs/onboarding.md) | [implement-feature](.claude/skills/implement-feature/SKILL.md)                                                                                                           |
| Brainstorm an M or L feature       | [docs/CLAUDE.md](docs/CLAUDE.md)                                                | [brainstorm](.claude/skills/brainstorm/SKILL.md)                                                                                                                         |
| Implement a feature or fix         | [coding-conventions](docs/standards/coding-conventions.md)                      | [implement-feature](.claude/skills/implement-feature/SKILL.md)                                                                                                           |
| Add an API route                   | [api](docs/guides/api.md), [contracts](docs/guides/contracts.md)                | [new-api-route](.claude/skills/new-api-route/SKILL.md)                                                                                                                   |
| Add a web page                     | [web](docs/guides/web.md)                                                       | [new-web-page](.claude/skills/new-web-page/SKILL.md)                                                                                                                     |
| Create a project or add a part     | [projects/CLAUDE.md](projects/CLAUDE.md)                                        | [scaffold](.claude/skills/scaffold/SKILL.md)                                                                                                                             |
| Add a shared package               | [packages/CLAUDE.md](packages/CLAUDE.md)                                        | [scaffold](.claude/skills/scaffold/SKILL.md)                                                                                                                             |
| Change infra or CDK                | [infra](docs/guides/infra.md)                                                   | [new-cdk-construct](.claude/skills/new-cdk-construct/SKILL.md)                                                                                                           |
| Use or request a platform resource | [platform/CLAUDE.md](platform/CLAUDE.md)                                        | [use-platform-resource](.claude/skills/use-platform-resource/SKILL.md)                                                                                                   |
| Add logging or tracing             | [observability](docs/standards/observability.md)                                | [new-api-route](.claude/skills/new-api-route/SKILL.md), [new-web-page](.claude/skills/new-web-page/SKILL.md)                                                             |
| Write or run tests                 | [testing](docs/standards/testing.md)                                            | [verify](.claude/skills/verify/SKILL.md), [e2e-verify](.claude/skills/e2e-verify/SKILL.md), [api-docs](.claude/skills/api-docs/SKILL.md)                                 |
| Get a security finding             | [security](docs/standards/security.md)                                          | [pre-pr](.claude/skills/pre-pr/SKILL.md)                                                                                                                                 |
| Add a dependency                   | [security](docs/standards/security.md)                                          | None. Run `rush add -p` yourself from the project folder. The pre-push hook runs `rush audit` when the lockfile changes. A failed audit means you stop and ask the human |
| Review a change or open a PR       | [REVIEW.md](REVIEW.md), [risk-tiers](docs/standards/risk-tiers.md)              | [pre-pr](.claude/skills/pre-pr/SKILL.md), [bug-hunt](.claude/skills/bug-hunt/SKILL.md), [pr-description](.claude/skills/pr-description/SKILL.md)                         |
| Commit or name a branch            | [git-workflow](docs/standards/git-workflow.md)                                  | [pr-description](.claude/skills/pr-description/SKILL.md)                                                                                                                 |
| Handle an incident or a revert     | [rollback](docs/runbooks/rollback.md)                                           | [incident-to-eval](.claude/skills/incident-to-eval/SKILL.md)                                                                                                             |
| Explain or document code           | [docs/CLAUDE.md](docs/CLAUDE.md)                                                | [explain-area](.claude/skills/explain-area/SKILL.md)                                                                                                                     |

## Area guides

- [projects/CLAUDE.md](projects/CLAUDE.md): project anatomy (one package for each project), contracts flow, import rules.
- [platform/CLAUDE.md](platform/CLAUDE.md): shared AWS resources, SSM contract. High risk.
- [packages/CLAUDE.md](packages/CLAUDE.md): shared code rules. High risk.
- [tooling/CLAUDE.md](tooling/CLAUDE.md): shared lint (with security rules), TypeScript, and test config. High risk. A human reviews it.
- [docs/CLAUDE.md](docs/CLAUDE.md): writing rules (ASD-STE100), doc locations, ADR format.
- [.github/CLAUDE.md](.github/CLAUDE.md): CI workflows, CODEOWNERS, PR template. High risk. A human reviews it.
- Stack, layout, non-goals: [repo-overview.md](docs/guides/repo-overview.md). Review rules: [REVIEW.md](REVIEW.md).

## Commands (all of them: [commands.md](docs/guides/commands.md))

```
node common/scripts/install-run-rush.js verify      # build, lint, typecheck, test, e2e (alias: rush verify)
node common/scripts/install-run-rush.js e2e         # Bruno and Playwright
node common/scripts/install-run-rush.js add -p <pkg> # the only way to add a dependency
```
