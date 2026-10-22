---
name: new-project
description: Scaffold a new product under projects/<name> with a contracts package, any mix of web, api (TypeScript), api-py and api-go parts, a Bruno API collection, Playwright for web, and infra wired to the platform. Writes non-gate files directly, and writes gate-file contents to a handoff folder for a human to apply. Use when asked to create, scaffold, or start a new project, product, app, or service. Triggers include new project, scaffold a project, create a product, start a new app, new service, python api project, go api project.
---

# new-project

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Phase A writes files. Phase B runs after the human applies the gate files. File contents are in `reference.md` in this folder. Gate files never go to their real paths. The "Handoff files" section lists them.

## Phase A

1. Ask the user: "Which parts: web, api (TypeScript), api-py, api-go? Any mix. Contracts and infra are always included." Wait for the answer. Use kebab-case for `<name>`.
2. Preflight:
   - `ls platform/infra` must list files. If not, stop. The platform must exist first. A human sets it up.
   - `ls projects/<name> 2>/dev/null` must print nothing.
   - `grep -c '"@vprprudhvi/<name>-' rush.json` must print 0.
3. Create the folders for the chosen parts. Do not create `projects/<name>/config`.
   - `mkdir -p projects/<name>/contracts/{src,scripts}`
   - `mkdir -p projects/<name>/infra/src/{stacks,constructs,config}`
   - web: `mkdir -p projects/<name>/web/{src/{app,components,features,lib},e2e}`
   - api: `mkdir -p projects/<name>/api/{src/{routes,domain,adapters},scripts}`
   - api-py: `mkdir -p projects/<name>/api-py/{src,tests,scripts}`
   - api-go: `mkdir -p projects/<name>/api-go/{cmd,internal,scripts}`
   - any api part: `mkdir -p projects/<name>/bruno/{environments,health}`
4. Write the non-gate files. Use `reference.md` for the content. Some `reference.md` sections label a file as non-gate. Follow the "Handoff files" list, not those labels. Every `package.json` is private and has the `_phase:*` scripts, plus `_phase:e2e` for each api and web part. Write each `package.json` to the handoff folder (step 7). No dependencies yet.
   - Bruno (any api part): `bruno/environments/local.bru`, `dev.bru`, `staging.bru` (non-secret values only), and `bruno/health/get-health.bru` with docs and assertions. `bruno/bruno.json` goes to the handoff folder.
   - web: `web/e2e/home.spec.ts` (calls `page.goto('/')`, runs axe). `web/playwright.config.ts` goes to the handoff folder. Playwright is mandatory for web.
   - Scripts in `scripts/` folders (`.sh`, `.mjs`, `.py`) go to the handoff folder.
5. Infra wiring (`projects/<name>/infra`):
   - `src/config/dev.ts`: env name, region, and the project subdomain label. No account IDs, no pool or zone IDs.
   - `src/stacks/<name>-stack.ts`: reads platform values through the SSM helper of `@vprprudhvi/shared-cdk-constructs`. Read that package's exports first. Use `use-platform-resource`.
   - Creates, through project constructs: `AppClient` (its own Cognito app client on the platform pool), `ProjectDomain` (DNS record in the platform zone and a custom domain with the platform wildcard certificate), one `ApiLambdaHttp` per API part (Lambda behind an API Gateway HTTP API), and `WebOpenNext` for web.
   - Write each construct file in `src/constructs/` with `new-cdk-construct`.
6. Telemetry. Read `docs/standards/observability.md`. If `packages/telemetry` does not exist, skip this step and report it as an open item (section 2 of that document).
   - web: `src/instrumentation.ts` registers telemetry with `@vprprudhvi/shared-telemetry`. The Playwright spec asserts the `traceparent` header only when a client component calls the api from the browser. For a server fetch, add a Vitest test of `lib/<resource>-client.ts`.
   - api: `src/lambda.ts` calls `initTelemetry({ serviceName })` first. Use `wrapLambdaHandler`. Add a handler test with a fake HTTP API v2 event that has a `traceparent` header.
   - api-py and api-go: add OpenTelemetry setup and a test that the log record has the trace id.
   - infra: each Lambda uses the shared Lambda construct (ADOT layer and `OTEL_*` variables). Add a `Template.fromStack` assertion.
   - The Bruno health request asserts the `traceparent` header.
   - When the package exists, new dependencies (`@vprprudhvi/shared-telemetry` and the language packages) go in the Phase B approval list.
7. Write each gate file to the handoff folder `.claude/state/handoff/<name>/`. Use the Write tool. Use the `.txt` suffix on every file. Name each file `NN-<target path with / replaced by __>.txt`. The first line is `TARGET: <path>`. The list is in "Handoff files" below.
8. Stop. Tell the human: "Copy each handoff file to its TARGET path. Add the rush.json entries. Reply 'gates applied', and approve the dependency list for phase B."

## Phase B (only after the human says "gates applied")

9. Check the files exist, and `grep '"@vprprudhvi/<name>-' rush.json` finds the entries.
10. Dependencies. Show each list and wait for approval first. Do not run these commands yourself. They change lockfiles, `go.mod`, and `go.sum`, which are gate files. Write the commands to `.claude/state/handoff/<name>/NN-commands.txt`, one per line, with the folder for each. A human runs them, then replies "deps applied".
   - TypeScript parts: `rush add -p <pkg> [--dev]` from the part folder.
   - web: `@playwright/test` and `@axe-core/playwright` (dev). Then `npx playwright install chromium` from the web folder.
   - any api part: `@usebruno/cli` (dev, pinned) in one TypeScript part, so `bru` is available.
   - api-py and api-go: `rush add -p @vprprudhvi/<name>-contracts --dev` first, so Rush builds contracts first. Then `uv add --dev <pkg>` (api-py) or `go get <module>` followed by `go mod tidy` (api-go).
11. Check the platform values exist (read-only): `aws ssm get-parameters-by-path --path /platform/dev --recursive --query 'Parameters[].Name' --output text`. If credentials are missing, say so.
12. Run `rush build --only tag:project:<name>` and paste the output. Then run `rush verify --only tag:project:<name>` and paste the output. Then run the `verify` skill.

## Handoff files

Write each file below to `.claude/state/handoff/<name>/`. Each file starts with a `TARGET:` line. A human copies each file to its target path (`docs/standards/gates.md`, section 2.4). Each path below matches a glob in the gate list, which is the file scripts/gates/gate-files.json.

Gate-glob files (target paths):
- `rush.json`: entries for the `projects` array.
- `projects/<name>/<part>/config/rush-project.json`: one per part.
- `projects/<name>/<part>/tsconfig.json`, `projects/<name>/<part>/eslint.config.mjs`, `projects/<name>/<part>/vitest.config.ts`: each TypeScript part (contracts, web, api, infra).
- `projects/<name>/api-py/pyproject.toml`: api-py.
- `projects/<name>/api-go/.golangci.yml`: api-go.
- `projects/<name>/infra/cdk.json`: infra.
- `projects/<name>/REVIEW.md`: one heading per part.
- `projects/<name>/bruno/bruno.json`: any api part.
- `projects/<name>/web/playwright.config.ts`: web.
- `projects/<name>/api/scripts/run-e2e.sh`, `projects/<name>/api-py/scripts/run-e2e.sh`, `projects/<name>/api-go/scripts/run-e2e.sh`: each api part.
- `projects/<name>/api-py/scripts/generate-models.sh`: api-py.
- `projects/<name>/api-go/scripts/generate-types.sh`: api-go.

Package files with `_phase:*` scripts (counted as gate changes by content, not by glob):
- `projects/<name>/<part>/package.json`: one per part.

Lockfiles and Go module files (not copied from handoff. A human runs the commands in `NN-commands.txt`, and the package manager writes these files):
- `common/config/rush/pnpm-lock.yaml`, `projects/<name>/api-py/uv.lock`, `projects/<name>/api-go/go.mod`, `projects/<name>/api-go/go.sum`.

## Done when

- [ ] Every chosen part has a `package.json` with the `_phase:*` scripts. Api and web parts have `_phase:e2e`.
- [ ] Any api part has a Bruno collection with docs and assertions. Web has a Playwright spec that calls `page.goto`.
- [ ] The infra stack wires platform values through SSM, and creates its own app client and domain.
- [ ] The handoff folder has every gate file, each with a `TARGET:` line.
- [ ] After approval: the build, the verify output, and the `verify` skill pass. Outputs are pasted.
- [ ] Each part has telemetry wired, and a trace propagation test.

## Do not

- Write a gate file to its real path. Write it to the handoff folder only.
- Edit `rush.json` yourself.
- Add a dependency or a lockfile change without human approval.
- Run `rush add`, `uv add`, `go get`, or `go mod tidy` yourself. Write the command to `NN-commands.txt`.
- Hard-code account IDs, pool IDs, zone IDs, or certificate ARNs.
- Put a secret value in a Bruno environment file. Use `{{process.env.X}}`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings*.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `**/go.mod`, `**/bruno.json`, `**/playwright.config.*`, `**/scripts/*.sh`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`. Use `rush add` only when a human runs it.
- Run `cdk deploy`.
- Use `--no-verify`.
