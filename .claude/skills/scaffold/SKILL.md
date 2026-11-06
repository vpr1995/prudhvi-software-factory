---
name: scaffold
description: Create a shared library (packages/<pkg>), create a bare project (projects/<name>), or add a part (node, web, infra) to a project. Runs rush new --library, rush new --project and rush add-part, then covers the follow-up work (contracts for endpoints, routes, pages, constructs). Use when asked to create a shared package, a new project, product, app or service, or to add a web app, an API, a backend, a frontend or infra to a project. Triggers include new shared package, shared library, new project, scaffold a project, start a new app, add web to project, add api to project, add a backend, add a frontend, add infra, add-part, scaffold.
---

# scaffold

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

The commands write the files. Never write the scaffold files by hand. The templates are in `tooling/templates` (`library/`, `project/`, `parts/<part>/`). Each command checks everything first. On a problem, it stops, writes nothing and prints the reason. At the end, it runs `rush update` and prints the next steps.

## Choose the command

| The user wants                            | Command                                                        |
| ----------------------------------------- | -------------------------------------------------------------- |
| Code that more than one project uses      | `rush new --library <pkg>` (section A)                         |
| A new product                             | `rush new --project <name>`, then `rush add-part` (B)          |
| A server, web app or CDK app in a project | `rush add-part --project <name> --part <node\|web\|infra>` (C) |

Names are kebab-case. Ask the user what the code does before you run a command. Wait for the answer.

## A. Shared library

Rules: `packages/*` never import from `projects/*`. Shared packages publish (`shouldPublish: true`). Do not set `"private": true`. Changes to `packages/*` are high risk, so a human reviews them.

1. Ask why the code must be shared. If only one project needs it, stop. Put it in that project.
2. Run `rush new --library <pkg>`. It makes `packages/<pkg>` (`@vprprudhvi/shared-<pkg>`), takes the dependency versions from `packages/result/package.json`, adds the `rush.json` entry (tag `shared`) and a change file under `common/changes/@vprprudhvi/shared-<pkg>/`.
3. Write the code in `src/`. Export the public API from `src/index.ts` only. Replace the sample function.
4. Write tests in `test/`. The path mirrors `src/`. See `docs/standards/testing.md`, section 1.
5. Edit the description in `package.json` and `README.md`, and the comment in the change file.
6. Run `rush change --verify` after the commit. It reads only committed change files.

## B. New project

1. Ask which parts the project needs: `node` (Fastify server), `web` (Next.js), `infra` (CDK). A project can have no part, one part, or all parts.
2. Run `rush new --project <name>`. It makes a bare `projects/<name>` (`@vprprudhvi/<name>`, tag `project/<name>`, `shouldPublish: false`, no change file). The bare project has the five `_phase:*` scripts, `projects/<name>/scripts/phase.mjs`, ESLint, Vitest (`createAppVitestConfig`), `tsconfig.json`, `config/rush-project.json`, `README.md`, `REVIEW.md` and one test. It has no contracts and no parts.
3. Run section C once for each part.
4. Edit the description in `package.json` and `README.md`.

## C. Add a part

Run `rush add-part --project <name> --part <part>`. Add the parts in any order. The command fails when the part exists, when the project is not in `rush.json`, or when `rush new --project` did not make the project (for example `projects/sample`).

The command writes the part files, adds the part scripts and dependencies to `package.json` (versions from `projects/sample/package.json`), adds the part section of `docs/templates/REVIEW.<part>.md` to `REVIEW.md`, and runs `rush update`. `projects/<name>/scripts/phase.mjs` finds each part by its folder, so each phase runs the new part with no other change.

| Part    | Folders and files                                                                                                                            | Phases                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `node`  | `src/api` (config, server, health route, run, main), `test/api`, `bruno/`, `projects/<name>/scripts/e2e.mjs`, `tsconfig.build.json`          | build: `tsc`. e2e: starts the server and runs `bru`.    |
| `web`   | `web/` (layout, page, `next.config.ts`), `test/web`, `web/e2e/home.spec.ts`, `playwright.config.ts`. Sets `web: true` in `vitest.config.ts`. | build and typecheck: `next`. e2e: Playwright and axe.   |
| `infra` | `bin/app.ts`, `lib/<name>-app.ts` (cdk-nag `AwsSolutionsChecks`), `lib/<name>-stack.ts`, `test/infra`, `cdk.json`, `tsconfig.cdk.json`       | typecheck and test. Check with `npx cdk synth --quiet`. |

## Follow-up work

- Endpoint: the project owns its contracts. When a route has a request or a response body, write the Zod schema in `src/contracts/<resource>.ts` (see `docs/guides/contracts.md`). Then add the route with `new-api-route`. Each route gets a Bruno request with docs and assertions (`api-docs`).
- Page: add it with `new-web-page`. Each page gets a Playwright spec with `page.goto` and an axe check.
- Infra: add constructs with `new-cdk-construct`. Platform values come from `use-platform-resource`. To run the server on Lambda, add `src/api/lambda.ts` (see `projects/sample`) and a `NodejsFunction` construct. Deploy rules: root CLAUDE.md rule 4.
- Dependency: run `rush add -p <pkg> [--dev]` from the project folder. List each new package with its version and license in your report.
- Telemetry: the node part starts OpenTelemetry in `src/api/run.ts` and echoes `traceparent`. See `docs/standards/observability.md` for the other parts.

## Check

1. Run `rush build --to <package>`. `verify --only` does not build the dependencies.
2. Run `rush verify --only <package>` and paste the output. It runs the e2e phase too.
3. For infra, run `npx cdk synth --quiet` in the project folder. It must exit with 0 and print no cdk-nag error.
4. Commit the new folder, `rush.json`, the change file (library only), and each file under `common/config/rush/` that `rush update` changed (for example `pnpm-lock.yaml`). Check with `git status --short`.
5. Run the `verify` skill.

## Do not

- Write the scaffold files by hand, or add a `package.json` to a part folder.
- Hand-edit `pnpm-lock.yaml` or `repo-state.json`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`. Use `rush add -p`.
- Hard-code account IDs, pool IDs, zone IDs, or certificate ARNs. Put a secret in a Bruno environment file.
- Never run `cdk deploy` or `cdk destroy` (root CLAUDE.md rule 4).
- Use `--no-verify`.
