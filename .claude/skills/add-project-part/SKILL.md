---
name: add-project-part
description: Add a web, api (TypeScript), api-py or api-go part to an existing project under projects/<name>, with its Bruno collection or Playwright spec and its compute wiring in the project infra stack. Writes non-gate files directly and writes gate-file contents to a handoff folder for a human to apply. Use when asked to add a web app, an API, a frontend, a backend, a Python or Go service to an existing project. Triggers include add web to project, add api to project, add python api, add go api, add a frontend, add a backend, add-project-part.
---

# add-project-part

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Phase A writes files. Phase B runs after the human applies the gate files. File contents are in `../new-project/reference.md`. Gate files never go to their real paths. The "Handoff files" section lists them.

## Phase A

1. Ask which part to add: `web`, `api` (TypeScript), `api-py`, or `api-go`. Wait for the answer.
2. Check the project exists, and the part is missing:
   - `ls projects/<name>` shows `contracts` and `infra`.
   - `ls projects/<name>/<part>` prints nothing.
   - `ls platform/infra` lists files.
3. Create the folders for the part, using the `mkdir` lines in `new-project` step 3. For an API part, also create `projects/<name>/bruno/` if it does not exist.
4. Write the non-gate files from `../new-project/reference.md` for that part. Some `reference.md` sections label a file as non-gate. Follow the "Handoff files" list, not those labels. Name the package `@vprprudhvi/<name>-<part>`. Its `package.json` goes to the handoff folder, and it must include `_phase:e2e`.
   - api, api-py, api-go: write the `bruno/health/get-health.bru` request if the collection has no health request yet. Otherwise add the new route's request with `new-api-route` or `new-api-route-py` or `new-api-route-go`. The e2e script `scripts/run-e2e.sh` goes to the handoff folder. A Bruno `bruno/bruno.json` goes there too, if the collection is new.
   - web: write `web/e2e/home.spec.ts`. `web/playwright.config.ts` goes to the handoff folder. Playwright is mandatory for web.
   - Scripts in `scripts/` folders (`.sh`, `.mjs`, `.py`) go to the handoff folder.
5. Infra wiring. Add the part's compute construct to `projects/<name>/infra/src/stacks/<name>-stack.ts`. The stack is a high-risk path (`docs/standards/gates.md`, section 2.3). Write the new stack file to the handoff folder, not to its real path.
   - api, api-py, api-go: one `ApiLambdaHttp` construct (Lambda behind an API Gateway HTTP API) that points at the part's build output. For api-go, the asset is the `bin/` binary built for `linux/arm64` and named `bootstrap`. For api-py, the asset is the built `src/` package.
   - web: one `WebOpenNext` construct that points at the OpenNext output.
   - Write the construct file with `new-cdk-construct`. Platform values come from `use-platform-resource`.
   - If the stack already has the construct for this kind, do not add it twice.
6. Telemetry. Read `docs/standards/observability.md`. If `packages/telemetry` does not exist, skip this step and report it as an open item (section 2 of that document).
   - web: `src/instrumentation.ts` registers telemetry with `@vprprudhvi/shared-telemetry`. The Playwright spec asserts the `traceparent` header only when a client component calls the api from the browser. For a server fetch, add a Vitest test of `lib/<resource>-client.ts`.
   - api: `src/lambda.ts` calls `initTelemetry({ serviceName })` first. Use `wrapLambdaHandler`. Add a handler test with a fake HTTP API v2 event that has a `traceparent` header.
   - api-py and api-go: add OpenTelemetry setup and a test that the log record has the trace id.
   - The compute construct uses the shared Lambda construct (ADOT layer and `OTEL_*` variables). Add a `Template.fromStack` assertion.
   - The Bruno health request asserts the `traceparent` header.
   - New dependencies go in the Phase B approval list.
7. Write each gate file to the handoff folder `.claude/state/handoff/<name>-<part>/`. Use the Write tool. Use the `.txt` suffix on every file. Name each file `NN-<target path with / replaced by __>.txt`. The first line is `TARGET: <path>`. The list is in "Handoff files" below. For `REVIEW.md`, write the full new content. Keep the existing sections.
8. Stop. Tell the human: "Copy each handoff file to its TARGET path. Add the rush.json entry. Reply 'gates applied', and approve any new dependency."

## Phase B (only after the human says "gates applied")

9. Check the files exist, and `rush.json` has the new entry.
10. Add dependencies. Show the list and wait for approval first. Do not run these commands yourself. They change lockfiles, `go.mod`, and `go.sum`, which are gate files. Write the commands to `.claude/state/handoff/<name>-<part>/NN-commands.txt`, one per line, with the folder for each. A human runs them, then replies "deps applied".
   - TypeScript parts: `rush add -p <pkg> [--dev]` from the part folder.
   - web: `@playwright/test` and `@axe-core/playwright` (dev), then `npx playwright install chromium`.
   - api-py and api-go: `rush add -p @vprprudhvi/<name>-contracts --dev` first. Then `uv add --dev <pkg>` (api-py) or `go get <module>` and `go mod tidy` (api-go).
11. Run `rush build --only @vprprudhvi/<name>-<part>` and paste the output.
12. Run `rush e2e --only @vprprudhvi/<name>-<part>` and paste the output.
13. Run the `verify` skill, then `e2e-verify`.

## Handoff files

Write each file below to `.claude/state/handoff/<name>-<part>/`. Each file starts with a `TARGET:` line. A human copies each file to its target path (`docs/standards/gates.md`, section 2.4). Each path below matches a glob in the gate list, which is the file scripts/gates/gate-files.json, unless the line says otherwise.

Gate-glob files (target paths):
- `rush.json`: the entry for the `projects` array. Use `{ "packageName": "@vprprudhvi/<name>-<part>", "projectFolder": "projects/<name>/<part>", "tags": ["project:<name>", "kind:<part>"] }`.
- `projects/<name>/<part>/config/rush-project.json`: outputs from `new-project`.
- `projects/<name>/<part>/tsconfig.json`, `projects/<name>/<part>/eslint.config.mjs`, `projects/<name>/<part>/vitest.config.ts`: TypeScript parts.
- `projects/<name>/api-py/pyproject.toml`: api-py.
- `projects/<name>/api-go/.golangci.yml`: api-go.
- `projects/<name>/REVIEW.md`: the full new content. Add the matching template from `docs/templates/` (`REVIEW.web.md` for web, `REVIEW.api.md` for any API part).
- `projects/<name>/bruno/bruno.json`: only when the Bruno collection is new.
- `projects/<name>/web/playwright.config.ts`: web.
- `projects/<name>/<part>/scripts/run-e2e.sh`: each api part.
- `projects/<name>/api-py/scripts/generate-models.sh`: api-py.
- `projects/<name>/api-go/scripts/generate-types.sh`: api-go.

Package files with `_phase:*` scripts (counted as gate changes by content, not by glob):
- `projects/<name>/<part>/package.json`: the new part.

High-risk file (not a gate glob, sent to handoff for the human review in gates.md section 2.3):
- `projects/<name>/infra/src/stacks/<name>-stack.ts`: the updated infra stack.

Lockfiles and Go module files (not copied from handoff. A human runs the commands in `NN-commands.txt`, and the package manager writes these files):
- `common/config/rush/pnpm-lock.yaml`, `projects/<name>/<part>/uv.lock`, `projects/<name>/<part>/go.mod`, `projects/<name>/<part>/go.sum`.

## Done when

- [ ] `projects/<name>/<part>` exists with `package.json`, the `_phase:*` scripts, and `_phase:e2e`.
- [ ] Api parts have a Bruno request with docs and assertions. Web has a Playwright spec that calls `page.goto`.
- [ ] The infra stack gets one compute construct for the part. It is in the handoff folder, not the real path.
- [ ] The handoff folder has every gate file, each with a `TARGET:` line.
- [ ] After approval: the build, `rush e2e`, the `verify` skill, and `e2e-verify` pass. Outputs are pasted.
- [ ] The part has telemetry wired, and a trace propagation test.

## Do not

- Write a gate file to its real path. Write it to the handoff folder only.
- Edit `rush.json`, `REVIEW.md`, or the infra stack directly.
- Overwrite existing sections of `REVIEW.md`.
- Add a dependency or a lockfile change without human approval.
- Run `rush add`, `uv add`, `go get`, or `go mod tidy` yourself. Write the command to `NN-commands.txt`.
- Make the new part import from another project.
- Put a secret value in a Bruno environment file. Use `{{process.env.X}}`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings*.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `**/go.mod`, `**/bruno.json`, `**/playwright.config.*`, `**/scripts/*.sh`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`. Use `rush add` only when a human runs it.
- Run `cdk deploy`.
- Use `--no-verify`.
