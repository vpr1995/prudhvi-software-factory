---
name: add-project-part
description: Add a web, api (TypeScript), api-py or api-go part as a folder (web, src/api, src/api-py, src/api-go) to an existing single-package project under projects/<name>, wired into the one package.json phases, with its Bruno collection or Playwright spec and its compute wiring in lib/ (CDK) when lib/ exists. Writes non-gate files directly and writes gate-file contents to a handoff folder for a human to apply. Use when asked to add a web app, an API, a frontend, a backend, a Python or Go service to an existing project. Triggers include add web to project, add api to project, add python api, add go api, add a frontend, add a backend, add-project-part.
---

# add-project-part

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Phase A writes files. Phase B runs after the human applies the gate files. File contents are in `../new-project/reference.md`. Gate files never go to their real paths. The "Handoff files" section lists them.

## Phase A

1. Ask which part to add: `web`, `api` (TypeScript), `api-py`, or `api-go`. Wait for the answer.
2. Check the project exists, and the part is missing:
   - `ls projects/<name>/package.json` exists, and `ls projects/<name>/src/contracts` lists files.
   - The part folder is missing or empty: `web`, `src/api`, `src/api-py`, or `src/api-go`.
   - `ls platform/infra` lists files.
3. Create the folder for the part, using the `mkdir` lines in `new-project` step 3. For an API part, also create `projects/<name>/bruno/` if it does not exist. Do not add a `package.json` in the part folder.
4. Write the non-gate files from `../new-project/reference.md` for that part. Follow the "Handoff files" list, not the labels in `reference.md`. The project `package.json` gets the new part in each `_phase:*` script, and in `_phase:e2e`. Write the full new `package.json` to the handoff folder. Keep the existing part commands.
   - api, api-py, api-go: write the `bruno/health/get-health.bru` request if the collection has no health request yet. Otherwise add the new route's request with `new-api-route` or `new-api-route-py` or `new-api-route-go`. The e2e helper in `scripts/` goes to the handoff folder. A Bruno `bruno/bruno.json` goes there too, if the collection is new.
   - web: write `web/e2e/home.spec.ts`. `playwright.config.ts` (project root) goes to the handoff folder. Playwright is mandatory for web.
   - Scripts in `scripts/` folders (`.sh`, `.mjs`, `.py`) go to the handoff folder.
5. Infra wiring. A project made by `new-project` already has a stub CDK app in `bin/` and `lib/`. If `projects/<name>/lib` does not exist (an old project), skip this step and report it as an open item. Otherwise add the part's compute construct to the stack in `projects/<name>/lib/`. `bin/**` and `lib/**` are high-risk paths (`docs/standards/gates.md`, section 2.3). Write the new stack file to the handoff folder, not to its real path. CDK bundles the code at synth (see `docs/guides/infra.md`).
   - api: `NodejsFunction` with `src/api/lambda.ts` as the entry, behind an API Gateway HTTP API.
   - api-go: `Code.fromAsset` with local bundling (`go build`, `linux/arm64`, file name `bootstrap`). Docker is the fallback.
   - api-py: `Code.fromAsset` with local bundling (`uv`). Docker is the fallback.
   - web: the OpenNext build through local bundling.
   - Write the construct file with `new-cdk-construct`. Platform values come from `use-platform-resource`.
   - If the stack already has the construct for this part, do not add it twice.
6. Telemetry. Read `docs/standards/observability.md`. If `packages/telemetry` does not exist, skip this step and report it as an open item (section 2 of that document).
   - web: `web/instrumentation.ts` registers telemetry with `@vprprudhvi/shared-telemetry`. The Playwright spec asserts the `traceparent` header only when a client component calls the api from the browser. For a server fetch, add a Vitest test of `web/lib/<resource>-client.ts`.
   - api: `src/api/lambda.ts` calls `initTelemetry({ serviceName })` first. Use `wrapLambdaHandler`. Add a handler test with a fake HTTP API v2 event that has a `traceparent` header.
   - api-py and api-go: add OpenTelemetry setup and a test that the log record has the trace id.
   - The compute construct uses the shared Lambda construct (ADOT layer and `OTEL_*` variables). Add a `Template.fromStack` assertion.
   - The Bruno health request asserts the `traceparent` header.
   - New dependencies go in the Phase B list.
7. Write each gate file to the handoff folder `.claude/state/handoff/<name>-<part>/`. Use the Write tool. Use the `.txt` suffix on every file. Name each file `NN-<target path with / replaced by __>.txt`. The first line is `TARGET: <path>`. The list is in "Handoff files" below. For `REVIEW.md`, write the full new content. Keep the existing sections.
8. Stop. Tell the human: "Copy each handoff file to its TARGET path. Reply 'gates applied'."

## Phase B (only after the human says "gates applied")

9. Check the files exist, and the project `package.json` runs the new part in each phase.
10. Add dependencies. No human approval is needed. The dependency policy runs at pre-push (`docs/standards/gates.md`, section 6.6). List each new package with its version and license in your report.

- TypeScript parts: run `rush add -p <pkg> [--dev]` yourself from `projects/<name>`. Never run `npm`, `pnpm` or `yarn` to add a package.
- web: `@playwright/test` and `@axe-core/playwright` (dev). Then run `npx playwright install chromium`.
- api-py: `uv add --dev <pkg>` from `projects/<name>/src/api-py`. api-go: `go get <module>` and `go mod tidy` from `projects/<name>/src/api-go`. Do not run these yourself. They change `uv.lock`, `go.mod`, and `go.sum`, which are gate files. Write the commands to `.claude/state/handoff/<name>-<part>/NN-commands.txt`, one per line, with the folder for each. A human runs them, then replies "deps applied".

11. If you ran `rush add`, commit `projects/<name>/package.json` and each file that the command changed under `common/config/rush/` (for example `pnpm-lock.yaml` and `repo-state.json`), together with the change that needs them. Check with `git status --short`. Push the commit when the push exemption applies (`docs/standards/gates.md`, section 4.3.1). Otherwise tell the human: "The push has a gate change outside the push exemption. Push the commit."
12. Run `rush build --only @vprprudhvi/<name>` and paste the output.
13. Run `rush e2e --only @vprprudhvi/<name>` and paste the output.
14. Run the `verify` skill, then `e2e-verify`.

## Handoff files

Write each file below to `.claude/state/handoff/<name>-<part>/`. Each file starts with a `TARGET:` line. A human copies each file to its target path (`docs/standards/gates.md`, section 2.4). Each path below matches a glob in the gate list, which is the file scripts/gates/gate-files.json, unless the line says otherwise.

Gate-glob files (target paths):

- `projects/<name>/package.json`: the full new content (package file with `_phase:*` scripts, counted as a gate change by content).
- `projects/<name>/tsconfig.json`, `projects/<name>/eslint.config.js`, `projects/<name>/vitest.config.ts`: only when the part needs a change (for example, a `web/` block).
- `projects/<name>/src/api-py/pyproject.toml`: api-py.
- `projects/<name>/src/api-go/.golangci.yml`: api-go.
- `projects/<name>/REVIEW.md`: the full new content. Add the matching template from `docs/templates/` (`REVIEW.web.md` for web, `REVIEW.api.md` for any API part).
- `projects/<name>/bruno/bruno.json`: only when the Bruno collection is new.
- `projects/<name>/playwright.config.ts`: web.
- `projects/<name>/scripts/*.sh`, `projects/<name>/src/api-py/scripts/generate-models.sh`, `projects/<name>/src/api-go/scripts/generate-types.sh`: the helpers for the part.

High-risk file (not a gate glob, sent to handoff for the human review in gates.md section 2.3):

- `projects/<name>/lib/<name>-stack.ts`: the updated stack, when `lib/` exists.

Lockfiles and Go module files (not copied from handoff):

- `common/config/rush/pnpm-lock.yaml` and the other files under `common/config/rush/`: `rush add -p` writes them. The agent runs it and commits them (Phase B, step 11).
- `projects/<name>/src/api-py/uv.lock`, `projects/<name>/src/api-go/go.mod`, `projects/<name>/src/api-go/go.sum`: a human runs the commands in `NN-commands.txt`, and the package manager writes these files.

## Done when

- [ ] The part folder exists. The one `package.json` runs it in `_phase:build`, `_phase:lint`, `_phase:typecheck`, `_phase:test`, and `_phase:e2e`.
- [ ] Api parts have a Bruno request with docs and assertions. Web has a Playwright spec that calls `page.goto`.
- [ ] If `lib/` exists, the stack gets one compute construct for the part. It is in the handoff folder, not the real path.
- [ ] The handoff folder has every gate file, each with a `TARGET:` line.
- [ ] After approval: the build, `rush e2e`, the `verify` skill, and `e2e-verify` pass. Outputs are pasted.
- [ ] The part has telemetry wired, and a trace propagation test.
- [ ] The part has no `package.json` of its own.

## Do not

- Write a gate file to its real path. Write it to the handoff folder only.
- Edit `package.json`, `REVIEW.md`, or the stack in `lib/` directly.
- Add a second `package.json` or a second Rush project for the part.
- Overwrite existing sections of `REVIEW.md`.
- Add a dependency that fails the dependency policy.
- Run `rush add -p` for a package that fails the dependency policy.
- Run `uv add`, `go get`, or `go mod tidy` yourself. Write the command to `NN-commands.txt`.
- Make the new part import from another project.
- Put a secret value in a Bruno environment file. Use `{{process.env.X}}`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings*.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `**/go.mod`, `**/bruno.json`, `**/playwright.config.*`, `**/scripts/*.sh`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`. One exception: `pnpm-lock.yaml` changes through `rush add -p` and `rush update`.
- Run `npm install` or `pnpm install`. Use `rush add -p` only through the dependency policy.
- Run `cdk deploy`.
- Use `--no-verify`.
