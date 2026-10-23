# REVIEW.md

This file sets the rules for AI code review in this repository. The `fresh-reviewer` agent and the `claude-review.yml` workflow read it.

Read `CLAUDE.md` first. Read the part template for each changed part: `docs/templates/REVIEW.web.md`, `REVIEW.api.md`, or `REVIEW.infra.md`.

Project files `projects/<name>/REVIEW.md` and `platform/REVIEW.md` add rules for their area. They do not remove rules from this file.

## 1. Output format

- Start the summary with a count. Example: `3 findings: 1 Important, 1 Nit, 1 Pre-existing.`
- If there are no findings, write exactly: `No issues found.` Then list the files you checked.
- Tag each finding with one severity: `Important`, `Nit`, or `Pre-existing`.
- Give each finding a file and a line. Example: `projects/sample/src/api/routes/order/create-order.ts:42`.
- Quote the line or the expression that fails.
- Name the bug class, not only the line. Example: "missing authorization check on a route that reads another user's data".
- Say what fails and when. Say how to fix it in one sentence.
- Write each finding once. Do not repeat a finding in later rounds unless the code changed.

## 2. Severity

| Tag | Use when |
|---|---|
| `Important` | The change breaks behavior, security, data, cost, or a gate. The author must fix it before merge. |
| `Nit` | Style or clarity. The change works. Report at most 3 Nits per review. |
| `Pre-existing` | The problem exists in code that the diff does not change. Report it, but it does not block merge. |

Report every `Important` finding. Do not hide a real problem to keep the count low.

## 3. Evidence rules

- Each finding needs file and line evidence. Read the code at that line before you report.
- Do not report a finding from memory or from a pattern alone.
- If you are not sure, read more code first. If you are still not sure, do not report it.
- A claim about a library needs a version or a docs reference from the repo.

## 4. Paths to skip

Do not review these paths. Do not report findings in them.

- `common/config/rush/pnpm-lock.yaml` and any other lockfile.
- `**/cdk.out/**`.
- `**/dist/**`, `**/.next/**`, `**/coverage/**`, `common/temp/**`.
- Generated files. Look for a `// generated` or `@generated` header.
- Snapshot files (`**/__snapshots__/**`, `*.snap`). Review a snapshot change only when the PR says the change is intended.

## 5. Bug fixes

- Find the root cause. A fix that changes one line at the symptom is not enough.
- Flag the bug class, not one line. Ask: where else does the same mistake exist?
- The fix must add a test that fails before the fix and passes after it. If the PR has no such test, report an `Important` finding.
- Do not accept a fix that adds a skip, a disable, a `try/catch` that swallows the error, or a weaker assertion.

## 6. What failure looks like in this repo

Check these failure types on each change.

### 6.1 Boundaries and structure

- A project imports another project. Example: `projects/a/web` imports `projects/b/src/contracts`.
- `web` imports `src/api`, or `src/api` imports `web`, inside one project.
- `packages/*` imports from `projects/*`.
- `src/contracts` imports from `web`, `src/api`, `bin`, or `lib`.
- Domain code under `src/api/domain/` imports Fastify or an adapter.
- A new folder or file does not follow the layout in `docs/standards/coding-conventions.md`, section D.

### 6.2 Config and environment

- Code reads `process.env` outside `config.ts`.
- A new env var has no Zod entry in `config.ts`.
- A secret is read, logged, returned, or placed in a client bundle.

### 6.3 Errors and logging

- A domain function throws for an expected case. Expected cases return `Result<T, E>`.
- An error response does not use the envelope `{ error: { code, message, requestId } }`.
- A catch block hides the error. Example: an empty `catch {}`.
- A log line has secret or personal fields, or uses string concatenation.
- The new user-visible behavior has no feature flag from `packages/flags`.

### 6.4 Tests

- A test has no assertion.
- A test skips, focuses, or disables a check.
- A test depends on time, network, or order and can fail at random.
- A test removes a case that the code still needs.
- A changed line has no test.
- A route changed with no change to its Bruno request. A page changed with no change to its Playwright spec.
- A Bruno request or a Playwright test skipped with `skip`, `fixme`, or `skip-request`.

### 6.5 Security

- A route has no authorization check on data that belongs to a user.
- An input reaches a query, a file path, a URL, or HTML without validation.
- An `as` cast or `any` hides an unchecked input.
- Use of `dangerouslySetInnerHTML`, `eval`, or `new Function` with input.

### 6.6 Infrastructure

- An IAM policy uses `*` for an action or a resource.
- A stateful resource is replaced in `cdk diff`. Example: a database with a new logical ID.
- `RemovalPolicy.DESTROY` is set on a stateful resource outside `dev`.
- A resource is public without a reason in the PR.
- A change adds a cost driver with no reason. Example: a NAT gateway or a large instance.

### 6.7 Python and Go backends

- Generated code (`generated/` in Python, `internal/gen/` in Go) changed by hand. The drift check catches it. Report `Important` if the check does not fail.
- Python: `except:`, `except Exception` that swallows the error, `assert` in `src/`, `print` for logs, `Any` in a signature.
- Go: an error return that is dropped or not wrapped with `%w`, a `panic` in a handler, a `nolint` without a linter name and a reason.
- A Python or Go backend imports a TypeScript package from `packages/*`. Report `Important`.

### 6.8 Performance

- A loop calls the database or an API for each item (N+1).
- A call to an external service has no timeout.
- A list endpoint has no limit.

## 7. Conventions with no tool enforcer

No tool checks these rules. The reviewer checks them by reading the code. Report each violation as `Important` unless the table says `Nit`.

| Rule | Source | Severity |
|---|---|---|
| Functions use a verb first. Example: `getUser()`. | `coding-conventions.md`, A.2 | Nit |
| Env var names use the project prefix. Example: `SAMPLE_API_DB_URL`. | `coding-conventions.md`, A.12 | Nit |
| JSON fields in API responses use camelCase. | `coding-conventions.md`, A.14 | Important |
| Properties in exported types are `readonly`. | `coding-conventions.md`, B.13 | Nit |
| Domain functions return `Result<T, E>`. Throw only for a bug. | `coding-conventions.md`, C.1 | Important |
| `"use client"` appears only in leaf components. | `coding-conventions.md`, D.2 | Important |
| `contracts` has no runtime logic. Only Zod schemas and types. | `coding-conventions.md`, D.3 | Important |
| Comments explain why, not what. | `coding-conventions.md`, E.1 | Nit |
| Input is validated at each boundary with Zod from the project's `contracts`. | `coding-conventions.md`, F.1 | Important |
| Each new user-visible behavior sits behind a flag from `packages/flags`. | `coding-conventions.md`, F.3 | Important |
| Each bug fix adds a test that fails before the fix. | `coding-conventions.md`, F.4 | Important |
| Each PR changes one thing. | `coding-conventions.md`, F.5 | Important |
| Python: code sits in `src/<package>/` as in G.1. | `coding-conventions.md`, G.1 | Nit |
| Go: each package sits under `cmd/` or `internal/` as in H.1. | `coding-conventions.md`, H.1 | Nit |
| Go: a handler returns an error. It does not call `panic`. | `coding-conventions.md`, H.6 | Important |
| Server span names use `<METHOD> <route template>`. A span name never contains an id value. | `observability.md`, section 4 | Important |
| Internal span names use `<domain>.<action>` in lower case. Do not rename auto-instrumented client spans. | `observability.md`, section 4 | Nit |
| Span attribute keys use `snake_case` with a dot namespace. Example: `app.order_id`. | `observability.md`, section 5 | Nit |
| A span attribute holds no personal data, secret, request or response body, or unbounded value. The Opengrep PII rule is planned, so check this by reading the code. | `observability.md`, section 5 | Important |
| Record an exception once, at the boundary that handles it, with `recordException` and an error status. | `observability.md`, section 6 | Important |
| A log `msg` is fixed text. Put variable data and the error object in structured fields. | `observability.md`, sections 3 and 6 | Important |
| Call the tracer provider flush (`forceFlush`, `force_flush()`, `ForceFlush(ctx)`) before a Lambda handler returns. | `observability.md`, section 2 | Important |

If a rule in `coding-conventions.md` names `REVIEW.md` as its enforcer, check it here. If a rule is missing from this table, check the rule in the doc.

## 8. Do not report

- Style that Prettier or ESLint already checks. The hooks report it.
- A missing comment on a private function.
- A personal preference that the docs do not state.
- A problem that the lint, typecheck, or security run in the same PR already reports.
- More than 3 Nits.

## 9. Process

- Read the diff. Then read the surrounding code for each changed symbol.
- Check each changed file against section 6.
- Check each changed behavior against section 5 when the change is a bug fix.
- Write the summary first, with the count.
- Stop after the findings. Do not suggest a rewrite of unchanged code.
