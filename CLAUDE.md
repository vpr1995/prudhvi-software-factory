# CLAUDE.md

Agent entry point for this Rush monorepo (TypeScript, Python, Go, AWS CDK). This file is a table of contents. Read the rules below. Then use the routing table to find the document or skill for your task.

## Repo conventions

1. Show the real command output before you say a task is done. Never say "done" without output from `verify` or the named command.
2. Never skip, delete, or weaken a test, a lint rule, a threshold, or a gate. If a check fails, fix the cause.
3. Never edit a gate file. A gate file needs a human. See [gates.md](docs/standards/gates.md).
4. Run Rush only through the wrapper. `rush <cmd>` in the docs is an alias of the wrapper command. Never run `npm install`, `pnpm install`, or `pnpm add`. Use `rush add -p <pkg>`.
5. Never use `--no-verify`, `git push --force`, `cdk deploy`, or `cdk destroy`.
6. One change for each PR. Keep the diff small. Each bug fix adds a test that fails before the fix.
7. Put each new user-visible behavior behind a flag from `packages/flags` (planned). If a package marked planned does not exist, see [packages/CLAUDE.md](packages/CLAUDE.md).
8. Contracts (Zod, one package for each project) are the single source of the API shape. Never edit generated Python or Go code.
9. Read config only in `config.ts`. Validate input with the project's contracts.
10. Log only with `@vprprudhvi/shared-logger` (planned). Each log line carries OpenTelemetry trace ids. Never log secrets or personal data.
11. Each API route has a Bruno request with docs and assertions. Each web page has a Playwright spec with an axe check.
12. `platform/**`, `packages/**`, and `projects/*/infra/**` are high risk. A human approves them.
13. After 3 failed review rounds, stop and ask the human about the approach.

## Routing table

| When you... | Read | Use skill |
|---|---|---|
| Start any task | [repo-overview](docs/guides/repo-overview.md), [onboarding](docs/onboarding.md) | [implement-feature](.claude/skills/implement-feature/SKILL.md) |
| Implement a feature or fix | [coding-conventions](docs/standards/coding-conventions.md) | [implement-feature](.claude/skills/implement-feature/SKILL.md) |
| Add an API route (TS, Python, Go) | [api](docs/guides/api.md), [api-py](docs/guides/api-py.md), [api-go](docs/guides/api-go.md), [contracts](docs/guides/contracts.md) | [new-api-route](.claude/skills/new-api-route/SKILL.md), [-py](.claude/skills/new-api-route-py/SKILL.md), [-go](.claude/skills/new-api-route-go/SKILL.md) |
| Add a web page | [web](docs/guides/web.md) | [new-web-page](.claude/skills/new-web-page/SKILL.md) |
| Create a project or add a part | [projects/CLAUDE.md](projects/CLAUDE.md) | [new-project](.claude/skills/new-project/SKILL.md), [add-project-part](.claude/skills/add-project-part/SKILL.md) |
| Add a shared package | [packages/CLAUDE.md](packages/CLAUDE.md) | [new-shared-package](.claude/skills/new-shared-package/SKILL.md) |
| Change infra or CDK | [infra](docs/guides/infra.md) | [new-cdk-construct](.claude/skills/new-cdk-construct/SKILL.md) |
| Use or request a platform resource | [platform/CLAUDE.md](platform/CLAUDE.md) | [use-platform-resource](.claude/skills/use-platform-resource/SKILL.md) |
| Add logging or tracing | [observability](docs/standards/observability.md) | [new-api-route](.claude/skills/new-api-route/SKILL.md), [-py](.claude/skills/new-api-route-py/SKILL.md), [-go](.claude/skills/new-api-route-go/SKILL.md), [new-web-page](.claude/skills/new-web-page/SKILL.md) |
| Write or run tests | [testing](docs/standards/testing.md) | [verify](.claude/skills/verify/SKILL.md), [e2e-verify](.claude/skills/e2e-verify/SKILL.md), [api-docs](.claude/skills/api-docs/SKILL.md) |
| Get a security finding | [security](docs/standards/security.md) | [pre-pr](.claude/skills/pre-pr/SKILL.md) |
| Add a dependency | [gates](docs/standards/gates.md) (section 6.6), [security](docs/standards/security.md) | None. Ask the human, then `rush add -p` |
| Review a change or open a PR | [REVIEW.md](REVIEW.md), [risk-tiers](docs/standards/risk-tiers.md) | [pre-pr](.claude/skills/pre-pr/SKILL.md), [bug-hunt](.claude/skills/bug-hunt/SKILL.md), [pr-description](.claude/skills/pr-description/SKILL.md) |
| Commit or name a branch | [git-workflow](docs/standards/git-workflow.md) | [pr-description](.claude/skills/pr-description/SKILL.md) |
| Hit a gate failure or Stop hook block | [gates](docs/standards/gates.md) (sections 6, 7) | [verify](.claude/skills/verify/SKILL.md) |
| Handle an incident or a revert | [rollback](docs/runbooks/rollback.md) | [incident-to-eval](.claude/skills/incident-to-eval/SKILL.md) |
| Explain or document code | [docs/CLAUDE.md](docs/CLAUDE.md) | [explain-area](.claude/skills/explain-area/SKILL.md) |

## Area guides

- [projects/CLAUDE.md](projects/CLAUDE.md): project anatomy, kinds, contracts flow, import rules.
- [platform/CLAUDE.md](platform/CLAUDE.md): shared AWS resources, SSM contract. High risk.
- [packages/CLAUDE.md](packages/CLAUDE.md): shared code rules. High risk.
- [tooling/CLAUDE.md](tooling/CLAUDE.md): gate area. Agents do not edit it.
- [docs/CLAUDE.md](docs/CLAUDE.md): writing rules (ASD-STE100), doc locations, ADR format.
- [.github/CLAUDE.md](.github/CLAUDE.md): gate area. Workflows are always human.
- Stack, layout, non-goals: [repo-overview.md](docs/guides/repo-overview.md). Review rules: [REVIEW.md](REVIEW.md).

## Commands (all of them: [commands.md](docs/guides/commands.md))

```
node common/scripts/install-run-rush.js verify      # build, lint, typecheck, test, e2e (alias: rush verify)
node common/scripts/install-run-rush.js e2e         # Bruno and Playwright
node common/scripts/install-run-rush.js add -p <pkg> # the only way to add a dependency
```
