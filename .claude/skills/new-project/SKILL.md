---
name: new-project
description: Scaffold a new product under projects/<name> with a contracts package, any mix of web, api (TypeScript), api-py and api-go parts, a Bruno API collection, Playwright for web, and infra wired to the platform. Writes non-gate files directly, and writes gate-file contents to a handoff folder for a human to apply. Use when asked to create, scaffold, or start a new project, product, app, or service. Triggers include new project, scaffold a project, create a product, start a new app, new service, python api project, go api project.
---

# new-project

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Phase A writes files. Phase B runs after the human applies the gate files. File contents are in `reference.md` in this folder.

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
4. Write the non-gate files. Use `reference.md` for the content. Every `package.json` is private and has the `_phase:*` scripts, plus `_phase:e2e` for each api and web part. No dependencies yet.
   - Bruno (any api part): `bruno/bruno.json`, `bruno/environments/local.bru`, `dev.bru`, `staging.bru` (non-secret values only), and `bruno/health/get-health.bru` with docs and assertions.
   - web: `web/e2e/home.spec.ts` (calls `page.goto('/')`, runs axe) and `web/playwright.config.ts`. Playwright is mandatory for web.
5. Infra wiring (`projects/<name>/infra`):
   - `src/config/dev.ts`: env name, region, and the project subdomain label. No account IDs, no pool or zone IDs.
   - `src/stacks/<name>-stack.ts`: reads platform values through the SSM helper of `@vprprudhvi/shared-cdk-constructs`. Read that package's exports first. Use `use-platform-resource`.
   - Creates, through project constructs: `AppClient` (its own Cognito app client on the platform pool), `ProjectDomain` (DNS record in the platform zone and a custom domain with the platform wildcard certificate), one `ApiLambdaHttp` per API part (Lambda behind an API Gateway HTTP API), and `WebOpenNext` for web.
   - Write each construct file in `src/constructs/` with `new-cdk-construct`.
6. Write the gate files to `.claude/state/handoff/<name>/`. Use the `.txt` suffix on every file. Name each file `NN-<target path with / replaced by __>.txt`. The first line is `TARGET: <path>`.
   - `rush.json` entries, one snippet for the `projects` array. Tags: `project:<name>` and `kind:contracts|web|api|api-py|api-go|infra`. Do not set `shouldPublish`.
   - `<part>/config/rush-project.json` for each part. Outputs: contracts, api, api-py `["dist"]`; web `[".next"]`; api-go `["bin"]`; infra `["cdk.out","dist"]`.
   - TypeScript parts (contracts, web, api, infra): `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`. Each extends the base in `tooling/`. Read the exact file names in `tooling/` first.
   - `api-py/pyproject.toml` (ruff, mypy, pytest, bandit settings). `api-go/.golangci.yml`.
   - `infra/cdk.json`.
   - `projects/<name>/REVIEW.md`: one heading per part. Use `docs/templates/REVIEW.web.md` for web, `REVIEW.api.md` for any API part, and `REVIEW.infra.md` for infra. If a template is missing, stop.
7. Stop. Tell the human: "Copy each handoff file to its TARGET path. Add the rush.json entries. Reply 'gates applied', and approve the dependency list for phase B."

## Phase B (only after the human says "gates applied")

8. Check the files exist, and `grep '"@vprprudhvi/<name>-' rush.json` finds the entries.
9. Dependencies. Show each list and wait for approval first. Lockfiles are gate files.
   - TypeScript parts: `rush add -p <pkg> [--dev]` from the part folder.
   - web: `@playwright/test` and `@axe-core/playwright` (dev). Then run `npx playwright install chromium` from the web folder.
   - any api part: `@usebruno/cli` (dev, pinned) in one TypeScript part, so `bru` is available.
   - api-py and api-go: `rush add -p @vprprudhvi/<name>-contracts --dev` first, so Rush builds contracts first. Then `uv add --dev <pkg>` (api-py, writes `uv.lock`) or `go get <module>` followed by `go mod tidy` (api-go, writes `go.sum`).
10. Check the platform values exist (read-only): `aws ssm get-parameters-by-path --path /platform/dev --recursive --query 'Parameters[].Name' --output text`. If credentials are missing, say so.
11. Run `rush build --only tag:project:<name>` and paste the output. Then run `rush verify --only tag:project:<name>` and paste the output. Then run the `verify` skill.

## Done when

- [ ] Every chosen part has a `package.json` with the `_phase:*` scripts. Api and web parts have `_phase:e2e`.
- [ ] Any api part has a Bruno collection with docs and assertions. Web has a Playwright spec that calls `page.goto`.
- [ ] The infra stack wires platform values through SSM, and creates its own app client and domain.
- [ ] The handoff folder has every gate file, each with a `TARGET:` line.
- [ ] After approval: the build, the verify output, and the `verify` skill pass. Outputs are pasted.

## Do not

- Write a gate file to its real path. Write it to the handoff folder only.
- Edit `rush.json` yourself.
- Add a dependency or a lockfile change without human approval.
- Hard-code account IDs, pool IDs, zone IDs, or certificate ARNs.
- Put a secret value in a Bruno environment file. Use `{{process.env.X}}`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`. Use `rush add` after approval.
- Run `cdk deploy`.
- Use `--no-verify`.
