# prudhvi-software-factory

An agent-driven software factory:

**task → Claude Code agents → gated pipeline (hooks, CI, rulesets) → reviewed PR**

The human gives a task. Claude Code agents plan it, write the code, tests and docs, and open a pull request. Gates check every step: edit-time hooks, git hooks, the local gate runner, CI and the `main` ruleset. The human sets the direction, approves gate changes and merges.

The factory builds products on AWS in one Rush monorepo: TypeScript, Python and Go APIs on Lambda, Next.js web apps and AWS CDK infrastructure.

## Stack

- Rush 5.181.0 with pnpm 10.34.7. Node 24.11.1 (see `.nvmrc`).
- TypeScript in ESM mode with `strict` on. Fastify APIs, Zod contracts.
- Python 3.14 with uv. Pydantic v2 models, generated from the contracts.
- Go 1.27.3 (the `toolchain` line in `projects/sample/src/api-go/go.mod`). Types generated with oapi-codegen.
- Next.js (App Router) web apps, deployed through OpenNext.
- AWS CDK for all infrastructure.

## Layout

| Path             | What it holds                                                  |
| ---------------- | -------------------------------------------------------------- |
| `projects/`      | One folder for each product. Each product is one Rush project. |
| `packages/`      | Shared code with no project logic.                             |
| `platform/infra` | Shared AWS resources, such as the Cognito user pool.           |
| `tooling/`       | Shared config for ESLint, TypeScript, Vitest and Opengrep.     |
| `scripts/gates/` | The local gate runner and the checks that run in it.           |
| `common/`        | Rush config, git hooks and autoinstallers.                     |
| `docs/`          | Standards, guides, ADRs, runbooks and templates.               |
| `.claude/`       | Agent settings, hooks and skills.                              |

The repository has two projects:

- `projects/sample` is the reference project. It has every part: contracts, a TypeScript API, a Python API, a Go API, a web app, a Bruno collection and CDK.
- `projects/national-parks-tracker` is a static Next.js website. It has a map and a page for each of the 64 US national parks, and it marks the parks that the owner visited. There is no backend.

## Quick start

1. Install the prerequisites:
   - Node 24.11.1. Use nvm, fnm or nvs with `.nvmrc`.
   - For Python APIs: uv and Python 3.14.
   - For Go APIs: Go. The `toolchain` line in `go.mod` selects the version. The Go tools (golangci-lint, gofumpt, oapi-codegen) run through `go tool`.
   - For the CDK Python bundle: Docker.
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

## Quality gates

- Local git hooks run on commit and on push. The pre-push hook runs the local gate runner. Run the same runner with `node common/scripts/install-run-rush.js gates`.
- The `ci` workflow (`.github/workflows/ci.yml`) runs on every pull request to `main`. It checks only the changed projects, from install to `cdk synth`.
- The `main` ruleset requires a pull request and the `ci` check. It blocks force pushes and has no bypass.
- Gate files need a human. An agent cannot change them. See [gates.md](docs/standards/gates.md), sections 1 and 2.
- CI runs the main checks again, so a local hook bypass does not pass CI. The security scans and audits (Opengrep, gitleaks, `rush audit`) run only locally until `sast.yml` and `deps.yml` exist.
- Dependabot alerts and security updates are on.

The full list of checks is in [gates.md](docs/standards/gates.md), sections 4.3.1 and 4.4.

## Working with agents

Agents write most of the code in this repository. [CLAUDE.md](CLAUDE.md) is the agent entry point. It lists the rules and a routing table to the guides and skills. The skills for common tasks are in [.claude/skills/](.claude/skills/). Each skill has a `SKILL.md` file with the steps for one task, for example adding an API route or a web page.

## Docs

- [Repo overview](docs/guides/repo-overview.md): stack, layout, import rules and non-goals.
- [Commands](docs/guides/commands.md): every Rush command.
- [Onboarding](docs/onboarding.md): setup on a new machine.
- [Quality gates](docs/standards/gates.md): every gate and how a human passes a blocked check.
- [Risk tiers](docs/standards/risk-tiers.md): the review level for each kind of change.
- [Git workflow](docs/standards/git-workflow.md): branches, commits and hooks.
- [ADRs](docs/adr/): the decisions and their reasons.
