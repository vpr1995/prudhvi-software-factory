---
name: new-project
description: Scaffold a new product as ONE package under projects/<name> (one package.json, CDK layout: bin, lib, src, web), with src/contracts, any mix of web, src/api (TypeScript), src/api-py and src/api-go parts, a Bruno API collection, and Playwright for web. Writes non-gate files directly, and writes gate-file contents to a handoff folder for a human to apply. Use when asked to create, scaffold, or start a new project, product, app, or service. Triggers include new project, scaffold a project, create a product, start a new app, new service, python api project, go api project.
---

# new-project

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Phase A writes files. Phase B runs after the human applies the gate files. File contents are in `reference.md` in this folder. Gate files never go to their real paths. The "Handoff files" section lists them.

## Phase A

1. Ask the user: "Which parts: web, api (TypeScript), api-py, api-go? Any mix. Contracts are always included." Wait for the answer. Use kebab-case for `<name>`. A project is one folder with one `package.json`. Never create a package for each part.
2. Preflight:
   - `ls platform/infra` must list files. If not, stop. The platform must exist first. A human sets it up.
   - `ls projects/<name> 2>/dev/null` must print nothing.
   - `grep -c '"@vprprudhvi/<name>"' rush.json` must print 0.
3. Create the folders for the chosen parts. Do not create `bin/` or `lib/` yet. Wave 3 adds the CDK app (see `docs/guides/infra.md`) and the human reviews it.
   - `mkdir -p projects/<name>/{src/contracts,scripts,config,test/contracts}`
   - web: `mkdir -p projects/<name>/web/{app,components,lib,e2e} projects/<name>/test/web`
   - api: `mkdir -p projects/<name>/src/api/{routes,domain,adapters} projects/<name>/test/api`
   - api-py: `mkdir -p projects/<name>/src/api-py/{src,tests,scripts}`
   - api-go: `mkdir -p projects/<name>/src/api-go/{cmd,internal,scripts}`
   - any api part: `mkdir -p projects/<name>/bruno/{environments,health}`
4. Write the non-gate files. Use `reference.md` for the content. Follow the "Handoff files" list, not the labels in `reference.md`. The one `package.json` is private. It is named `@vprprudhvi/<name>` and has the `_phase:*` scripts. Each phase runs every chosen part and fails fast with the part name. `_phase:e2e` runs Bruno for each API part and Playwright for web. Write `package.json` to the handoff folder (step 7). No dependencies yet.
   - Bruno (any api part): `bruno/environments/local.bru`, `prod.bru` (non-secret values only), and `bruno/health/get-health.bru` with docs and assertions. `bruno/bruno.json` goes to the handoff folder.
   - web: `web/e2e/home.spec.ts` (calls `page.goto('/')`, runs axe). `playwright.config.ts` (project root) goes to the handoff folder. Playwright is mandatory for web.
   - Scripts in `scripts/` folders (`.sh`, `.mjs`, `.py`) go to the handoff folder.
5. Telemetry. Read `docs/standards/observability.md`. If `packages/telemetry` does not exist, skip this step and report it as an open item (section 2 of that document).
   - web: `web/instrumentation.ts` registers telemetry with `@vprprudhvi/shared-telemetry`. The Playwright spec asserts the `traceparent` header only when a client component calls the api from the browser. For a server fetch, add a Vitest test of `web/lib/<resource>-client.ts`.
   - api: `src/api/lambda.ts` calls `initTelemetry({ serviceName })` first. Use `wrapLambdaHandler`. Add a handler test with a fake HTTP API v2 event that has a `traceparent` header.
   - api-py and api-go: add OpenTelemetry setup and a test that the log record has the trace id.
   - The Bruno health request asserts the `traceparent` header.
   - When the package exists, new dependencies go in the Phase B approval list.
6. Infra is a later step. Do not write `bin/` or `lib/` now. When the human asks for it, use `new-cdk-construct`. The CDK app lives in `projects/<name>/bin` and `projects/<name>/lib` and uses the same `package.json`.
7. Write each gate file to the handoff folder `.claude/state/handoff/<name>/`. Use the Write tool. Use the `.txt` suffix on every file. Name each file `NN-<target path with / replaced by __>.txt`. The first line is `TARGET: <path>`. The list is in "Handoff files" below.
8. Stop. Tell the human: "Copy each handoff file to its TARGET path. Reply 'gates applied', and approve the dependency list for phase B."

## Phase B (only after the human says "gates applied")

9. Check that each handoff file is at its target path.
10. Register the project. Run `node scripts/gates/register-project.mjs <name>`. The script adds the entry to the project list of the Rush config in sorted order, and keeps the comments (`docs/standards/gates.md`, section 6.8). Do not edit the Rush config in another way.
    - Exit code 0: the entry is added. Then run `rush update`.
    - Exit code 1 or 2: the script did not change the file. Stop. Tell the human the message of the script.
    - Check the entry: `grep '"@vprprudhvi/<name>"' rush.json` must find it.
11. Dependencies. Show each list and wait for approval first (`docs/standards/gates.md`, section 6.6).
    - TypeScript parts: after approval, run `rush add -p <pkg> [--dev]` yourself from `projects/<name>`. Never run `npm`, `pnpm` or `yarn` to add a package.
    - web: `@playwright/test` and `@axe-core/playwright` (dev). Then `npx playwright install chromium` from `projects/<name>`.
    - any api part: `@usebruno/cli` (dev, pinned), so `bru` is available.
    - api-py and api-go: do not run these commands yourself. They change `uv.lock`, `go.mod`, and `go.sum`, which are gate files. Write the commands to `.claude/state/handoff/<name>/NN-commands.txt`, one per line, with the folder for each: `uv add --dev <pkg>` from `projects/<name>/src/api-py`, and `go get <module>` then `go mod tidy` from `projects/<name>/src/api-go`. A human runs them, then replies "deps applied".
12. Commit the project, the Rush config change, and each file that `rush update` or `rush add` changed under `common/config/rush/` in one commit. Check with `git status --short`. The Stop hook blocks a stop while a gate file has an uncommitted change. The agent cannot push a gate change. Tell the human: "The commit changes the Rush project list and the lockfile. Read the lockfile diff and push the commit."
13. Check the platform values exist (read-only): `aws ssm get-parameters-by-path --path /platform/prod --recursive --query 'Parameters[].Name' --output text`. If credentials are missing, say so.
14. Run `rush build --only @vprprudhvi/<name>` and paste the output. Then run `rush verify --only @vprprudhvi/<name>` and paste the output. Then run the `verify` skill. If a gate fails, read the folder in the `Logs kept in <path>` line before you run it again.

## Handoff files

Write each file below to `.claude/state/handoff/<name>/`. Each file starts with a `TARGET:` line. A human copies each file to its target path (`docs/standards/gates.md`, section 2.4). Each path below matches a glob in the gate list, which is the file scripts/gates/gate-files.json.

Gate-glob files (target paths):

- `projects/<name>/config/rush-project.json`.
- `projects/<name>/tsconfig.json`, `projects/<name>/tsconfig.build.json`, `projects/<name>/eslint.config.js`, `projects/<name>/vitest.config.ts`.
- `projects/<name>/src/api-py/pyproject.toml`: api-py.
- `projects/<name>/src/api-go/.golangci.yml`: api-go.
- `projects/<name>/REVIEW.md`: one heading per part.
- `projects/<name>/bruno/bruno.json`: any api part.
- `projects/<name>/playwright.config.ts`: web.
- `projects/<name>/scripts/*.sh` and `projects/<name>/src/api-py/scripts/*.sh`, `projects/<name>/src/api-go/scripts/*.sh`: e2e, generate-models, generate-types.

Package file with `_phase:*` scripts (counted as gate changes by content, not by glob):

- `projects/<name>/package.json`: the only one.

Gate files that a command writes (never write them to the handoff folder):

- `rush.json`: the agent runs `node scripts/gates/register-project.mjs <name>` in Phase B (step 10).
- `common/config/rush/pnpm-lock.yaml`: the agent runs `rush update` and `rush add -p` in Phase B, after approval.
- `projects/<name>/src/api-py/uv.lock`, `projects/<name>/src/api-go/go.mod`, `projects/<name>/src/api-go/go.sum`: a human runs the commands in `NN-commands.txt`, and the package manager writes these files.

## Done when

- [ ] The project has one `package.json` with the `_phase:*` scripts. Each phase runs every chosen part.
- [ ] Any api part has a Bruno collection with docs and assertions. Web has a Playwright spec that calls `page.goto`.
- [ ] The handoff folder has every gate file, each with a `TARGET:` line.
- [ ] After approval: the build, the verify output, and the `verify` skill pass. Outputs are pasted.
- [ ] Each part has telemetry wired, and a trace propagation test.
- [ ] No folder under the project has its own `package.json`, except `src/api-py` and `src/api-go` tool files (`pyproject.toml`, `go.mod`).

## Do not

- Write a gate file to its real path. Write it to the handoff folder only.
- Edit `rush.json` by hand. Change it only with `node scripts/gates/register-project.mjs <name>`.
- Add a dependency or a lockfile change without human approval.
- Run `uv add`, `go get`, or `go mod tidy` yourself. Write the command to `NN-commands.txt`.
- Run `rush add -p` before the human approves the dependency list.
- Push a commit that changes a gate file. A human pushes it.
- Hard-code account IDs, pool IDs, zone IDs, or certificate ARNs.
- Put a secret value in a Bruno environment file. Use `{{process.env.X}}`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings*.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `**/go.mod`, `**/bruno.json`, `**/playwright.config.*`, `**/scripts/*.sh`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`. Two exceptions: `rush.json` changes through the register-project script, and `pnpm-lock.yaml` changes through `rush add -p` and `rush update`.
- Run `npm install` or `pnpm install`. Use `rush add -p` only after the human approves the dependency.
- Run `cdk deploy`.
- Use `--no-verify`.
