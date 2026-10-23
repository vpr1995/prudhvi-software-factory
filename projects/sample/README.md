# sample

`sample` is one product in one Rush project. The Rush name is `@vprprudhvi/sample`. It has one `package.json`. It holds the contracts, three APIs (TypeScript, Python, Go), a web app, and a Bruno collection. It is the model for each new project.

Read [projects/CLAUDE.md](../CLAUDE.md) and [REVIEW.md](REVIEW.md) before you change it.

## Folders

| Folder           | What it is                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/contracts/` | Zod schemas. They are the only source of the API shape. `fixtures/create-note-cases.json` holds edge cases that all three APIs must pass.                                                                                                     |
| `src/api/`       | The TypeScript API (Fastify). It runs on Lambda (`lambda.ts`) or on your machine (`main.ts`). `domain/` holds pure code. `adapters/` holds storage. `routes/` holds the HTTP routes. `config.ts` is the only file that reads the environment. |
| `src/api-py/`    | The Python API (Powertools). It has its own `pyproject.toml` and `uv.lock`. `src/sample_api/generated/` is generated code. Do not edit it.                                                                                                    |
| `src/api-go/`    | The Go API. The module is `github.com/vprprudhvi/sample/api-go`. `internal/gen/` is generated code. Do not edit it.                                                                                                                           |
| `web/`           | The Next.js app. `app/` holds the pages. `components/` and `lib/` hold the parts of the pages. `e2e/` holds the Playwright specs. `proxy.ts` sets the security headers.                                                                       |
| `bruno/`         | One Bruno collection. It documents and tests every API route. The same collection runs against the three APIs.                                                                                                                                |
| `scripts/`       | Helpers for the phases: `phase.mjs` (runs a phase for every part), `emit-openapi.mjs` (writes the OpenAPI document), `e2e.mjs` (starts an API and runs Bruno).                                                                                |
| `config/`        | The Rush settings (`rush-project.json`): which folders are build outputs.                                                                                                                                                                     |
| `test/`          | The unit tests. The path under `test/` mirrors the source path. `test/web/setup.ts` sets up the web tests.                                                                                                                                    |
| `dist/`          | Build output. It is not in git. `dist/openapi.json` is the OpenAPI 3.1 document that the build emits from `src/contracts`.                                                                                                                    |
| `bin/`, `lib/`   | The CDK app and stacks. They do not exist yet. Wave 3 adds them.                                                                                                                                                                              |

## Files in the project root

- `tsconfig.json`: type check of `src/` and the config files.
- `tsconfig.build.json`: build of `src/contracts` and `src/api` to `dist/`.
- `eslint.config.js`: one ESLint config. `web/**` gets the Next.js rules. The other folders get the Node.js rules.
- `vitest.config.ts`: one Vitest config with two projects. `node` runs `test/api/**` and `test/contracts/**`. `web` runs `test/web/**` in jsdom.
- `playwright.config.ts`: Playwright for `web/e2e`.

## Imports

- Imports inside the project are relative.
- `web` imports `src/contracts` and `packages/*`. It never imports `src/api`.
- `src/api` imports `src/contracts` and `packages/*`. It never imports `web`.
- The files in `src/contracts` import each other with the `.ts` extension. Turbopack (Next.js) cannot map a `.js` import to a `.ts` file. TypeScript rewrites the extension to `.js` in `dist/`.
- `src/contracts` imports only `zod`.

## Phases

Rush runs each phase through the `_phase:*` script of `package.json`. Each script runs `scripts/phase.mjs`. The script runs every part one after the other. When a part fails, the phase stops and the message names the part.

| Phase       | TypeScript and web                                                               | Python                                                              | Go                                                                           |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `build`     | `tsc` builds `dist/`, then `dist/openapi.json`. `next build` builds `web/.next`. | `compileall`                                                        | `go build` writes `dist/api-go/sample-api`                                   |
| `lint`      | `eslint --max-warnings 0`                                                        | `ruff`, `bandit`, then `pip-licenses` against the license allowlist | `gofumpt`, `golangci-lint`, then `go-licenses` against the license allowlist |
| `typecheck` | `tsc --noEmit`, `next typegen` and `tsc` for `web`                               | `mypy --strict`                                                     | `go vet`, `go build`                                                         |
| `test`      | `vitest run --coverage` (lines, statements, functions 80, branches 75)           | drift check, then `pytest` (80)                                     | drift check, then `go test -race` (80)                                       |
| `e2e`       | Bruno against the TypeScript API. Playwright and axe against the web app.        | Bruno against the Python API                                        | Bruno against the Go API                                                     |

The drift checks regenerate the Python models and the Go types from `dist/openapi.json`. They fail when the committed generated code is different. They run in the `test` phase because that phase waits for the `build` phase of this project. The `lint` phase does not.

Run the phases from the repo root:

```sh
node common/scripts/install-run-rush.js verify
```

## Run the project on your machine

1. Run `node common/scripts/install-run-rush.js install`.
2. Run `node common/scripts/install-run-rush.js build`. This writes `dist/`.
3. Start the TypeScript API: `cd projects/sample && node dist/api/main.js`. It listens on port 3000.
4. Start the web app in a second terminal: `cd projects/sample/web && ../node_modules/.bin/next dev`.
5. For traces, run `docker compose up -d` in the repo root. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`. Open `http://localhost:16686`.

Start the Python API: `cd projects/sample/src/api-py && uv run python -m sample_api`. Start the Go API: `projects/sample/dist/api-go/sample-api`.

## Environment variables

Each API reads its own prefix. Only `config.ts` (TypeScript), `config.py` (Python), and `config.go` (Go) read them.

| Part         | Prefix           | Service name    |
| ------------ | ---------------- | --------------- |
| `src/api`    | `SAMPLE_API_`    | `sample-api`    |
| `src/api-py` | `SAMPLE_API_PY_` | `sample-api-py` |
| `src/api-go` | `SAMPLE_API_GO_` | `sample-api-go` |
| `web`        | `SAMPLE_WEB_`    | `sample-web`    |

## Regenerate the generated code

1. Change the Zod schema in `src/contracts`.
2. Run the `build` phase. It writes `dist/openapi.json`.
3. Run `npm run gen:py` and `npm run gen:go` in this folder.
4. Commit the result. Never edit the generated files by hand.
