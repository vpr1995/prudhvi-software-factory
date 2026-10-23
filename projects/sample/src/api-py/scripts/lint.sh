#!/usr/bin/env bash
# _phase:lint for api-py: ruff check, ruff format --check and bandit. The generated-model drift check runs in _phase:test, after the build wrote dist/openapi.json.
set -euo pipefail
cd "$(dirname "$0")/.."

uv run --locked ruff check .
uv run --locked ruff format --check .
uv run --locked bandit --configfile pyproject.toml -q -r src scripts
