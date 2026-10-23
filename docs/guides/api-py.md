# Guide: api-py (Python)

Part: `projects/<name>/src/api-py`. Package: `@vprprudhvi/<name>` (one package for the whole project). Python on Lambda with `aws-lambda-powertools`. Read the root `CLAUDE.md` and `projects/CLAUDE.md` first.

## Folder layout

- `src/api-py/src/<package>/handler.py`: routes on the Powertools `APIGatewayHttpResolver`.
- `src/api-py/src/<package>/domain/`: pure logic. No Powertools import. It returns a `Result`. Errors are values.
- `src/api-py/src/<package>/generated/`: Pydantic v2 models. Generated. Never edit.
- `src/api-py/tests/`: pytest files named `test_*.py`.
- `src/api-py/scripts/`: `generate-models.sh`. The project `scripts/e2e.mjs` runs the e2e phase.
- `src/api-py/pyproject.toml`: tool settings. It is a gate file.

## Rules

- The schema source is Zod in `src/contracts`. Never write a model by hand.
- Follow PEP 8: snake_case functions, PascalCase classes, UPPER_SNAKE_CASE constants.
- Write full type hints and Google-style docstrings. No `Any`. No bare `except`.
- Validate the body with the generated model: `Model.model_validate(app.current_event.json_body)`. Return 400 and the envelope on `ValidationError`.
- Log with the Powertools logger. Do not use `print`.
- Import only generated models and own code. Never import TypeScript packages.
- Use `uv` only. Never run `pip install`. `uv.lock` is a gate file.
- Gates: `ruff`, `mypy --strict`, `bandit`, `pip-audit`, `pip-licenses`. Complexity at most 15.

## Tests

- pytest with a fake API Gateway HTTP API v2 event. Call `handler(event, context)`.
- Cover success, each error path, and an invalid body. Coverage at least 80%.
- Add a round-trip test for each generated model.
- Add a Bruno request for each route. Use the `api-docs` skill.
- Rules: `docs/standards/testing.md`, sections 8.1, 9.

## Telemetry

- Missing package rule: if the OpenTelemetry packages are not available, skip this section and list it as an open item. See `docs/standards/observability.md`, section 2.
- Use `opentelemetry-sdk` and `opentelemetry-instrumentation-*`. Do not use the Powertools Tracer. It wraps the X-Ray SDK, not OpenTelemetry.
- Extract the context from `event["headers"]` (`opentelemetry-instrumentation-aws-lambda`, or `propagation.extract`). Set `traceparent` in the response headers. Call `force_flush()` at the end of the handler.
- Add a custom Powertools formatter in the part. It writes `trace_id`, `span_id`, `trace_flags`, `msg`, `time`, `service.name`, and a lower-case `level`. See `docs/standards/observability.md`, section 3.
- Add a unit test: the log record has the trace id.
- The ADOT layer comes from the shared Lambda construct. See `docs/guides/infra.md`.
- Rules: `docs/standards/observability.md`.

## Links

- Conventions: `docs/standards/coding-conventions.md`, section G.
- Skills: `.claude/skills/new-api-route-py/SKILL.md`, `.claude/skills/api-docs/SKILL.md`.
- ADR: `docs/adr/0007-polyglot-backends.md`. Review template: `docs/templates/REVIEW.api-py.md`.
