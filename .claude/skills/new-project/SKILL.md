---
name: new-project
description: Scaffold a new product as ONE package under projects/<name> (one package.json, CDK layout: bin, lib, src, web), with src/contracts, web and src/api (TypeScript) parts, a Bruno API collection, and Playwright for web. Use when asked to create, scaffold, or start a new project, product, app, or service. Triggers include new project, scaffold a project, create a product, start a new app, new service.
---

# new-project

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

File contents are in `reference.md` in this folder.

## Steps

1. Ask the user: "Which parts: web, api (TypeScript), or both? Contracts are always included." Wait for the answer. Use kebab-case for `<name>`. A project is one folder with one `package.json`. Never create a package for each part.
2. Preflight:
   - `ls platform/infra` must list files. If not, stop. The platform must exist first. A human sets it up.
   - `ls projects/<name> 2>/dev/null` must print nothing.
   - `grep -c '"@vprprudhvi/<name>"' rush.json` must print 0.
3. Create the folders for the chosen parts. Every project is a CDK project from day one, so it always gets `bin/`, `lib/` and `test/infra`.
   - `mkdir -p projects/<name>/{src/contracts,scripts,config,bin,lib,test/contracts,test/infra}`
   - web: `mkdir -p projects/<name>/web/{app,components,lib,e2e} projects/<name>/test/web`
   - api: `mkdir -p projects/<name>/src/api/{routes,domain,adapters} projects/<name>/test/api`
   - api: `mkdir -p projects/<name>/bruno/{environments,health}`
4. Write the files. Use `reference.md` for the content. The "Config files" list below names the config files. The one `package.json` is private. It is named `@vprprudhvi/<name>` and has the `_phase:*` scripts. Each phase runs every chosen part and fails fast with the part name. `_phase:e2e` runs Bruno for each API part and Playwright for web. No dependencies yet.
   - Bruno (api): `bruno/environments/local.bru`, `prod.bru` (non-secret values only), and `bruno/health/get-health.bru` with docs and assertions. Write `bruno/bruno.json` too.
   - web: `web/e2e/home.spec.ts` (calls `page.goto('/')`, runs axe). Write `playwright.config.ts` (project root) too. Playwright is mandatory for web.
   - Write the scripts in `scripts/` folders (`.sh`, `.mjs`).
5. Telemetry. Read `docs/standards/observability.md`. If `packages/telemetry` does not exist, skip this step and report it as an open item (section 2 of that document).
   - web: `web/instrumentation.ts` registers telemetry with `@vprprudhvi/shared-telemetry`. The Playwright spec asserts the `traceparent` header only when a client component calls the api from the browser. For a server fetch, add a Vitest test of `web/lib/<resource>-client.ts`.
   - api: `src/api/lambda.ts` calls `initTelemetry({ serviceName })` first. Use `wrapLambdaHandler`. Add a handler test with a fake HTTP API v2 event that has a `traceparent` header.
   - The Bruno health request asserts the `traceparent` header.
   - When the package exists, new dependencies go in the dependency step below.
6. Write a stub CDK app. It has no app resources, only one placeholder. It makes later infra work need no change to `cdk.json`. Model it on `projects/sample` (`bin/app.ts`, `lib/sample-app.ts`, `cdk.json`, `tsconfig.cdk.json`, the `build:cdk` script). Use the contents in `reference.md`, section "infra (stub CDK app)". Do not deploy.
   - `bin/app.ts` creates the `App`, calls `add<Name>Stack`, and synthesizes.
   - `lib/<name>-app.ts` adds the cdk-nag `AwsSolutionsChecks` plugin the same way as the sample, and creates the stack.
   - `lib/<name>-stack.ts` is one empty stack class.
   - `test/infra/<name>-stack.test.ts` uses `Template.fromStack`. `test/infra/<name>-app.test.ts` tests `add<Name>Stack`. The CDK part has coverage from the start.
   - Write `cdk.json` and `tsconfig.cdk.json`.
   - When the human asks for infra, use `new-cdk-construct`. It adds constructs to `lib/`. It never creates `cdk.json`.
7. Write the config files from the "Config files" list below.
8. Register the project. Add an entry to the `projects` array in `rush.json`, in sorted order. Keep the comments. Use the same shape as the other project entries: `packageName`, `projectFolder`, `shouldPublish: false`, `tags: ["project/<name>"]`. Then run `rush update`.
   - Check the entry: `grep '"@vprprudhvi/<name>"' rush.json` must find it.
9. Dependencies. List each new package with its version and license in your report.
   - TypeScript parts: run `rush add -p <pkg> [--dev]` yourself from `projects/<name>`. Never run `npm`, `pnpm` or `yarn` to add a package.
   - web: `@playwright/test` and `@axe-core/playwright` (dev). Then `npx playwright install chromium` from `projects/<name>`.
   - api: `@usebruno/cli` (dev, pinned), so `bru` is available.
   - CDK (always): use the versions of `projects/sample/package.json`, pinned with `--exact`. Run `rush add -p aws-cdk-lib@<version> --exact`, `rush add -p constructs@<version> --exact`, `rush add -p cdk-nag@<version> --exact`, and `rush add -p aws-cdk@<version> --exact --dev`. Run `rush add -p @vprprudhvi/shared-cdk-constructs` too. The stub does not import it, but each later construct does, so `package.json` needs no change then. Read the versions from the sample each time. Do not copy them from this file.
   - Tooling (always): `@vprprudhvi/tooling-eslint-config`, `@vprprudhvi/tooling-tsconfig` and `@vprprudhvi/tooling-vitest-config` as dev dependencies with the version `workspace:*`, the same as `projects/sample/package.json`. The tsconfig, eslint and vitest files extend them.
10. Commit the project, the Rush config change, and each file that `rush update` or `rush add` changed under `common/config/rush/` in one commit. Check with `git status --short`.
11. Check the platform values exist (read-only): `aws ssm get-parameters-by-path --path /platform/prod --recursive --query 'Parameters[].Name' --output text`. If credentials are missing, say so.
12. Run `rush build --only @vprprudhvi/<name>` and paste the output. Then run `rush verify --only @vprprudhvi/<name>` and paste the output. Then run the `verify` skill. If a check fails, read the log before you run it again.

## Config files

Write each file below to its target path.

- `projects/<name>/config/rush-project.json`.
- `projects/<name>/tsconfig.json`, `projects/<name>/tsconfig.build.json`, `projects/<name>/eslint.config.js`, `projects/<name>/vitest.config.ts`. `tsconfig.json` includes `bin` and `lib`. `eslint.config.js` scopes `bin/**` and `lib/**` to the `cdk` config. `vitest.config.ts` is `export default createAppVitestConfig()` from `@vprprudhvi/tooling-vitest-config`. It runs every test in `test/` and covers `src`, `bin` and `lib`. Add `{ web: true }` for a project with a `web/` part. Write them with `bin` and `lib` from the start. Each tsconfig extends a `@vprprudhvi/tooling-tsconfig` preset (`web/tsconfig.json` uses `web.json`) and sets only allowed options (coding-conventions.md, B.18).
- `projects/<name>/cdk.json` and `projects/<name>/tsconfig.cdk.json`: the stub CDK app.
- `projects/<name>/REVIEW.md`: one heading per part.
- `projects/<name>/bruno/bruno.json`: api.
- `projects/<name>/playwright.config.ts`: web.
- `projects/<name>/scripts/*`: phase, e2e, and emit-openapi helpers.
- `projects/<name>/package.json`: the only one. It has the `build:cdk` and `synth` scripts from the start (see `reference.md`).

Commands write these files. Do not write them by hand:

- `common/config/rush/pnpm-lock.yaml`: `rush update` and `rush add -p`.

## Done when

- [ ] The project has one `package.json` with the `_phase:*` scripts. Each phase runs every chosen part.
- [ ] The api part has a Bruno collection with docs and assertions. Web has a Playwright spec that calls `page.goto`.
- [ ] The build, the verify output, and the `verify` skill pass. Outputs are pasted.
- [ ] The project has the stub CDK app (`bin/app.ts`, `lib/<name>-stack.ts`, its tests), and `cdk.json` and `tsconfig.cdk.json` exist.
- [ ] `rush verify --only @vprprudhvi/<name>` passes with the stub CDK app, and `npx cdk synth --quiet` passes in the project folder.
- [ ] Each part has telemetry wired, and a trace propagation test.
- [ ] No folder under the project has its own `package.json`.

## Do not

- Hand-edit `pnpm-lock.yaml` or `repo-state.json`. Change them only with `rush add` or `rush update`.
- Hard-code account IDs, pool IDs, zone IDs, or certificate ARNs.
- Put a secret value in a Bruno environment file. Use `{{process.env.X}}`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`. Use `rush add -p` to add a dependency.
- Run `cdk deploy`.
- Use `--no-verify`.
