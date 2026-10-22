---
name: new-api-route-py
description: Add a route to a project Python api (api-py) that runs on Lambda with aws-lambda-powertools. The schema starts in Zod contracts, models are regenerated as Pydantic v2, then the domain function, the handler, pytest tests, and a Bruno request with docs and assertions. Use when asked to add a Python endpoint, route, or handler. Triggers include new python endpoint, add a route in python, api-py route, pydantic model, powertools handler.
---

# new-api-route-py

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rules:
- The schema source is Zod in `projects/<name>/contracts`. Never write the Python model by hand.
- Generated code is in `src/<pkg>/_generated/`. Do not edit it.
- Path is kebab-case, plural, versioned: `/v1/<resources>`.
- Errors use the envelope `{"error": {"code", "message", "requestId"}}`. Codes are UPPER_SNAKE_CASE.
- Public functions and classes have Google-style docstrings and full type hints.

## Steps

1. Read `projects/<name>/api-py/src/<pkg>/` (handler, domain, `_generated/`), `tests/`, and `projects/<name>/bruno/`. Copy their style.
2. Add the schema in `projects/<name>/contracts/src/<resource>.ts` (`XSchema` and type `X`). Then build contracts so JSON Schema is emitted: `rush build --only @vprprudhvi/<name>-contracts`.
3. Regenerate the models: `rush build --only @vprprudhvi/<name>-api-py`. The `_phase:build` script runs `scripts/generate-models.sh` and writes `src/<pkg>/_generated/<resource>.py`. Check the new file exists.
4. Add the domain function in `src/<pkg>/domain/<resource>.py`. It is pure: no powertools import. It returns a `Result` from `src/<pkg>/result.py`. Each domain error is a value, not a raised exception.
5. Add the route to `src/<pkg>/handler.py` on the `APIGatewayHttpResolver`. Validate the body with the generated model: `Model.model_validate(app.current_event.json_body)`. On `ValidationError`, return 400 with the envelope. Map each `Result` error to its status and envelope.
6. Write tests in `tests/test_<resource>.py`. Call `handler(event, context)` with a fake API Gateway HTTP API v2 event. Cover success, each error path, and an invalid body.
7. Write the Bruno request at `projects/<name>/bruno/<resource>/<action>.bru`. Use the `api-docs` skill for the format.
8. Run `uv run pytest tests/test_<resource>.py -q` and paste the output. Then run `rush test --only @vprprudhvi/<name>-api-py`.
9. Run `rush e2e --only @vprprudhvi/<name>-api-py` and paste the output.
10. Run the `verify` skill.

## Done when

- [ ] The Python model came from `_generated/`. No hand-written copy of a contract.
- [ ] `ruff`, `mypy --strict`, and `bandit` pass in `_phase:lint` and `_phase:typecheck`. Output is pasted.
- [ ] pytest covers success, errors, and invalid input. Coverage stays at or above 80%.
- [ ] The `.bru` file has docs, at least one assertion, and a tests block. `rush e2e` output is pasted.
- [ ] The `verify` skill passes.

## Do not

- Edit files in `_generated/`, or change them to pass a lint rule.
- Use `model_construct` or skip validation to pass a test.
- Catch broad `Exception` and return 200.
- Use `eval`, `pickle`, `yaml.load` without `SafeLoader`, or `subprocess` with `shell=True`.
- Add a dependency by hand. Use `uv add --dev <pkg>` only after the human approves. `uv.lock` is a gate file.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `# noqa`, `# type: ignore`, `# nosec`, or `# pragma: no cover`. Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Lower `--cov-fail-under` or the ruff rule list in `pyproject.toml`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Run `npm install`, `pnpm install`, or a raw `pip install`. Use `uv` only.
- Run `cdk deploy`.
- Use `--no-verify`.
