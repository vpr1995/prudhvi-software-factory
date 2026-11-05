# prudhvi-software-factory

An agent-driven software factory:

**task → Claude Code agents → checks (git hooks, CI, rulesets) → reviewed PR**

The human gives a task. Claude Code agents plan it, write the code, tests and docs, and open a pull request. Checks run at each step: git hooks, CI and the `main` ruleset. The human sets the direction, reviews high-risk changes and merges.

The factory builds products on AWS in one Rush monorepo: TypeScript APIs on Lambda, Next.js web apps and AWS CDK infrastructure.

## Stack

- Rush 5.181.0 with pnpm 10.34.7. Node 24.11.1 (see `.nvmrc`).
- TypeScript in ESM mode with `strict` on. Fastify APIs, Zod contracts.
- Next.js (App Router) web apps, deployed through OpenNext.
- AWS CDK for all infrastructure.

## Layout

| Path             | What it holds                                                  |
| ---------------- | -------------------------------------------------------------- |
| `projects/`      | One folder for each product. Each product is one Rush project. |
| `packages/`      | Shared code with no project logic.                             |
| `platform/infra` | Shared AWS resources, such as the Cognito user pool.           |
| `tooling/`       | Shared config for ESLint, TypeScript, Vitest and Opengrep.     |
| `common/`        | Rush config, git hooks and autoinstallers.                     |
| `docs/`          | Standards, guides, ADRs, runbooks and templates.               |
| `.claude/`       | Agent settings and skills.                                     |

The repository has two projects:

- `projects/sample` is the reference project. It has every part: contracts, a TypeScript API, a web app, a Bruno collection and CDK.
- `projects/national-parks-tracker` is a static Next.js website. It has a map and a page for each of the 64 US national parks, and it marks the parks that the owner visited. There is no backend.

## Quick start

1. Install the prerequisites:
   - Node 24.11.1. Use nvm, fnm or nvs with `.nvmrc`.
2. Install the packages and git hooks:

   ```
   node common/scripts/install-run-rush.js install
   ```

3. Run the full check:

   ```
   node common/scripts/install-run-rush.js verify
   ```

4. Run the end-to-end checks (Bruno and Playwright):

   ```
   node common/scripts/install-run-rush.js e2e
   ```

Always run Rush through `node common/scripts/install-run-rush.js <cmd>`. Do not run `npm install` or `pnpm install`. Use `node common/scripts/install-run-rush.js add -p <pkg>` to add a dependency. See [commands.md](docs/guides/commands.md) and [onboarding.md](docs/onboarding.md).

## Quality checks

- The pre-commit hook runs a gitleaks scan of staged files, then lint-staged (Prettier and ESLint). The commit-msg hook runs commitlint. The pre-push hook runs `rush audit` only when `common/config/rush/pnpm-lock.yaml` changed. Otherwise it skips.
- The pre-commit hook also runs actionlint, zizmor and pinact on staged `.github/workflows` and `.github/actions` files.
- The `ci` workflow (`.github/workflows/ci.yml`) runs on every pull request. Job `plan` runs `rush check`, the tsconfig check, and `rush audit` when `pnpm-lock.yaml` changed. Then it lists the impacted projects. Job `project` runs build, lint, typecheck, test and e2e for each impacted project. Job `ci-result` is the required check. Job `workflow-lint` runs actionlint, zizmor and pinact. Details: [testing.md](docs/standards/testing.md) section 6.
- The `secrets` workflow (`.github/workflows/secrets.yml`) runs gitleaks on the commits of each pull request.
- The `warm-cache` workflow (`.github/workflows/warm-cache.yml`) builds all projects on each push to `main` and saves the caches for pull requests.
- The `main` ruleset requires a pull request and a passing required check. It blocks force pushes and has no bypass. Make `ci-result` and `gitleaks` the required checks.
- Dependabot alerts and security updates are on.

## Working with agents

Agents write most of the code in this repository. [CLAUDE.md](CLAUDE.md) is the agent entry point. It lists the rules and a routing table to the guides and skills. The skills for common tasks are in [.claude/skills/](.claude/skills/). Each skill has a `SKILL.md` file with the steps for one task, for example adding an API route or a web page.

## Docs

- [Repo overview](docs/guides/repo-overview.md): stack, layout, import rules and non-goals.
- [Commands](docs/guides/commands.md): every Rush command.
- [Onboarding](docs/onboarding.md): setup on a new machine.
- [Risk tiers](docs/standards/risk-tiers.md): the review level for each kind of change.
- [Git workflow](docs/standards/git-workflow.md): branches, commits and hooks.
- [ADRs](docs/adr/): the decisions and their reasons.
