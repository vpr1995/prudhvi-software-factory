---
name: add-project-part
description: Add a web, api (TypeScript), api-py or api-go part to an existing project under projects/<name>, with its Bruno collection or Playwright spec and its compute wiring in the project infra stack. Writes non-gate files directly and writes gate-file contents to a handoff folder for a human to apply. Use when asked to add a web app, an API, a frontend, a backend, a Python or Go service to an existing project. Triggers include add web to project, add api to project, add python api, add go api, add a frontend, add a backend, add-project-part.
---

# add-project-part

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Phase A writes files. Phase B runs after the human applies the gate files. File contents are in `../new-project/reference.md`.

## Phase A

1. Ask which part to add: `web`, `api` (TypeScript), `api-py`, or `api-go`. Wait for the answer.
2. Check the project exists, and the part is missing:
   - `ls projects/<name>` shows `contracts` and `infra`.
   - `ls projects/<name>/<part>` prints nothing.
   - `ls platform/infra` lists files.
3. Create the folders for the part, using the `mkdir` lines in `new-project` step 3. For an API part, also create `projects/<name>/bruno/` if it does not exist.
4. Write the non-gate files from `../new-project/reference.md` for that part. Name the package `@vprprudhvi/<name>-<part>`. Include `_phase:e2e`.
   - api, api-py, api-go: write the `bruno/health/get-health.bru` request if the collection has no health request yet. Otherwise add the new route's request with `new-api-route` or `new-api-route-py` or `new-api-route-go`. Write the e2e script `scripts/run-e2e.sh`.
   - web: write `web/e2e/home.spec.ts` and `web/playwright.config.ts`. Playwright is mandatory for web.
5. Infra wiring. Add the part's compute construct to `projects/<name>/infra/src/stacks/<name>-stack.ts`:
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
7. Write the gate files to `.claude/state/handoff/<name>-<part>/`. Use the `.txt` suffix on every file. Name each file `NN-<target path with / replaced by __>.txt`. The first line is `TARGET: <path>`.
   - `rush.json` entry: `{ "packageName": "@vprprudhvi/<name>-<part>", "projectFolder": "projects/<name>/<part>", "tags": ["project:<name>", "kind:<part>"] }`
   - `<part>/config/rush-project.json` with the outputs from `new-project`.
   - TypeScript parts: `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`. api-py: `pyproject.toml`. api-go: `.golangci.yml`.
   - `projects/<name>/REVIEW.md`: the full new content. Keep the existing sections. Add the matching template from `docs/templates/` (`REVIEW.web.md` for web, `REVIEW.api.md` for any API part).
   - The updated infra stack file. It is a gate file (`projects/<name>/infra/**`, risk high). Write it to the handoff folder, not to its real path.
8. Stop. Tell the human: "Copy each handoff file to its TARGET path. Add the rush.json entry. Reply 'gates applied', and approve any new dependency."

## Phase B (only after the human says "gates applied")

9. Check the files exist, and `rush.json` has the new entry.
10. Add dependencies. Show the list and wait for approval first. Lockfiles are gate files.
   - TypeScript parts: `rush add -p <pkg> [--dev]` from the part folder.
   - web: `@playwright/test` and `@axe-core/playwright` (dev), then `npx playwright install chromium`.
   - api-py and api-go: `rush add -p @vprprudhvi/<name>-contracts --dev` first. Then `uv add --dev <pkg>` or `go get <module>` and `go mod tidy`.
11. Run `rush build --only @vprprudhvi/<name>-<part>` and paste the output.
12. Run `rush e2e --only @vprprudhvi/<name>-<part>` and paste the output.
13. Run the `verify` skill, then `e2e-verify`.

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
- Make the new part import from another project.
- Put a secret value in a Bruno environment file. Use `{{process.env.X}}`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`. Use `rush add` after approval.
- Run `cdk deploy`.
- Use `--no-verify`.
