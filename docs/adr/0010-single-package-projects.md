# ADR 0010: Single-package projects

- Status: Accepted. Supersedes the layout decision of ADR 0002 and the package names of ADR 0007.
- Date: 2026-10-22

## Context

ADR 0002 made each part of a product a Rush project: `contracts`, `api`, `web`, `infra`, `api-py`, `api-go`. A product with every part had six `package.json` files, six Rush entries, and six sets of config files. The sample products repeated this twice (`sample-fullstack` and `sample-api-only`), with two copies of the contracts and of the TypeScript API. The owner wants one rule: name the project and the project has everything. An AWS CDK project already has the right shape: `bin`, `lib`, `src`.

## Decision

- A project is one folder `projects/<name>/` with ONE `package.json`. It is one Rush project: `@vprprudhvi/<name>`, tag `project/<name>`, `shouldPublish: false`.
- Layout: `bin/` and `lib/` (CDK app, stacks, constructs), `src/contracts`, `src/api` (TypeScript), `src/api-py` (Python), `src/api-go` (Go), `web/` (Next.js), `bruno/`, `scripts/`, `config/`. `src/contracts` is always present. The other parts are optional.
- The `package.json` has the phases `_phase:build`, `_phase:lint`, `_phase:typecheck`, `_phase:test`, and `_phase:e2e`. Each phase runs every part and fails fast with the part name. Coverage thresholds do not change.
- One config file of each type at the project root: `tsconfig.json`, `eslint.config.js` (path-scoped blocks), `vitest.config.ts`, `playwright.config.ts`. Python and Go keep their own tool files (`pyproject.toml`, `go.mod`) inside their folder.
- Imports inside a project are relative. The boundary rules keep their meaning and use folder patterns: `web` never imports `src/api`, `src/api` never imports `web`, `src/contracts` imports only `zod`, `bin` and `lib` import `src/contracts` (types only) and `packages/cdk-constructs`, and a project never imports another project. `eslint-plugin-boundaries` and `dependency-cruiser` enforce them.
- There is ONE sample: `projects/sample` with every part.
- CDK (Wave 3) bundles Lambda code at synth: `NodejsFunction` for TypeScript, `Code.fromAsset` with local bundling for Go (`go build`, `linux/arm64`) and Python (`uv`) with a Docker fallback, and local bundling for the OpenNext web build. Unit tests turn bundling off. Region is `us-east-1` only, with one wildcard certificate. A cdk-nag rule that cannot be met goes in one acknowledgments file for each stack (cdk-nag 3 `Validations.of().acknowledge`), with a reason for each entry, and the owner approves it.
- High-risk paths: `projects/*/bin/**` and `projects/*/lib/**`.
  - Update 2026-10-25: the owner moved `projects/*/bin/**` and `projects/*/lib/**` to medium risk. `platform/**`, `packages/**`, and `projects/*/cdk.json` stay high risk.

## Consequences

- Positive: A new project is one folder and one Rush entry. Adding a part adds a folder, not a package.
- Positive: One lint, type, and test config for the project. No duplicated sample code.
- Positive: The layout matches a normal CDK project.
- Negative: A project builds and tests as one unit. `rush verify --only @vprprudhvi/<name>` runs every part. The phase scripts must stay fast and name the failing part.
- Negative: Web and API dependencies share one `package.json`. The boundary rules, not the package graph, keep them apart.
- Negative: Old tags `project:<name>` and `kind:*` are gone. Use `project/<name>`.
