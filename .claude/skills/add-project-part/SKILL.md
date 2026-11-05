---
name: add-project-part
description: Add a web or api (TypeScript) part as a folder (web, src/api) to an existing single-package project under projects/<name>, wired into the one package.json phases, with its Bruno collection or Playwright spec and its compute wiring in lib/ (CDK) when lib/ exists. Use when asked to add a web app, an API, a frontend, a backend to an existing project. Triggers include add web to project, add api to project, add a frontend, add a backend, add-project-part.
---

# add-project-part

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

File contents are in `../new-project/reference.md`.

## Steps

1. Ask which part to add: `web` or `api` (TypeScript). Wait for the answer.
2. Check the project exists, and the part is missing:
   - `ls projects/<name>/package.json` exists, and `ls projects/<name>/src/contracts` lists files.
   - The part folder is missing or empty: `web` or `src/api`.
   - `ls platform/infra` lists files.
3. Create the folder for the part, using the `mkdir` lines in `new-project` step 3. For an API part, also create `projects/<name>/bruno/` if it does not exist. Do not add a `package.json` in the part folder.
4. Write the files from `../new-project/reference.md` for that part. The "Config files" list below names the config files. The project `package.json` gets the new part in each `_phase:*` script, and in `_phase:e2e`. Keep the existing part commands.
   - api: write the `bruno/health/get-health.bru` request if the collection has no health request yet. Otherwise add the new route's request with `new-api-route`. Write the e2e helper in `scripts/`. Write `bruno/bruno.json` too, if the collection is new.
   - web: write `web/e2e/home.spec.ts`. Write `playwright.config.ts` (project root) too. Playwright is mandatory for web.
   - Write the scripts in `scripts/` folders (`.sh`, `.mjs`).
5. Infra wiring. A project made by `new-project` already has a stub CDK app in `bin/` and `lib/`. If `projects/<name>/lib` does not exist (an old project), skip this step and report it as an open item. Otherwise add the part's compute construct to the stack in `projects/<name>/lib/`. `bin/**` and `lib/**` are medium-risk paths (`docs/standards/risk-tiers.md`). CDK bundles the code at synth (see `docs/guides/infra.md`).
   - api: `NodejsFunction` with `src/api/lambda.ts` as the entry, behind an API Gateway HTTP API.
   - web: the OpenNext build through local bundling.
   - Write the construct file with `new-cdk-construct`. Platform values come from `use-platform-resource`.
   - If the stack already has the construct for this part, do not add it twice.
6. Telemetry. Read `docs/standards/observability.md`. If `packages/telemetry` does not exist, skip this step and report it as an open item (section 2 of that document).
   - web: `web/instrumentation.ts` registers telemetry with `@vprprudhvi/shared-telemetry`. The Playwright spec asserts the `traceparent` header only when a client component calls the api from the browser. For a server fetch, add a Vitest test of `web/lib/<resource>-client.ts`.
   - api: `src/api/lambda.ts` calls `initTelemetry({ serviceName })` first. Use `wrapLambdaHandler`. Add a handler test with a fake HTTP API v2 event that has a `traceparent` header.
   - The compute construct uses the shared Lambda construct (ADOT layer and `OTEL_*` variables). Add a `Template.fromStack` assertion.
   - The Bruno health request asserts the `traceparent` header.
   - New dependencies go in the dependency step below.
7. Write the config files from the "Config files" list below. For `REVIEW.md`, keep the existing sections.
8. Check the files exist, and the project `package.json` runs the new part in each phase.
9. Add dependencies. List each new package with its version and license in your report.

- TypeScript parts: run `rush add -p <pkg> [--dev]` yourself from `projects/<name>`. Never run `npm`, `pnpm` or `yarn` to add a package.
- web: `@playwright/test` and `@axe-core/playwright` (dev). Then run `npx playwright install chromium`.

10. If you ran `rush add`, commit `projects/<name>/package.json` and each file that the command changed under `common/config/rush/` (for example `pnpm-lock.yaml` and `repo-state.json`), together with the change that needs them. Check with `git status --short`.
11. Run `rush build --only @vprprudhvi/<name>` and paste the output.
12. Run `rush e2e --only @vprprudhvi/<name>` and paste the output.
13. Run the `verify` skill, then `e2e-verify`.

## Config files

Write each file below to its target path.

- `projects/<name>/package.json`: the full new content.
- `projects/<name>/tsconfig.json`, `projects/<name>/eslint.config.js`, `projects/<name>/vitest.config.ts`: only when the part needs a change (for example, a `web/` block: set `createAppVitestConfig({ web: true })` in `vitest.config.ts`). `web/tsconfig.json` extends `@vprprudhvi/tooling-tsconfig/web.json`. Set only allowed options (coding-conventions.md, B.18).
- `projects/<name>/REVIEW.md`: add the matching template from `docs/templates/` (`REVIEW.web.md` for web, `REVIEW.api.md` for the API part).
- `projects/<name>/bruno/bruno.json`: only when the Bruno collection is new.
- `projects/<name>/playwright.config.ts`: web.
- `projects/<name>/scripts/*.sh`: the helpers for the part.
- `projects/<name>/lib/<name>-stack.ts`: the updated stack, when `lib/` exists.

Commands write these files. Do not write them by hand:

- `common/config/rush/pnpm-lock.yaml` and the other files under `common/config/rush/`: `rush add -p`.

## Done when

- [ ] The part folder exists. The one `package.json` runs it in `_phase:build`, `_phase:lint`, `_phase:typecheck`, `_phase:test`, and `_phase:e2e`.
- [ ] The api part has a Bruno request with docs and assertions. Web has a Playwright spec that calls `page.goto`.
- [ ] If `lib/` exists, the stack gets one compute construct for the part.
- [ ] The build, `rush e2e`, the `verify` skill, and `e2e-verify` pass. Outputs are pasted.
- [ ] The part has telemetry wired, and a trace propagation test.
- [ ] The part has no `package.json` of its own.

## Do not

- Add a second `package.json` or a second Rush project for the part.
- Overwrite existing sections of `REVIEW.md`.
- Make the new part import from another project.
- Put a secret value in a Bruno environment file. Use `{{process.env.X}}`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`. Use `rush add -p` to add a dependency.
- Run `cdk deploy`.
- Use `--no-verify`.
