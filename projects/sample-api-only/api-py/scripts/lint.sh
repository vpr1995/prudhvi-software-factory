#!/usr/bin/env bash
# _phase:lint for api-py: ruff check, ruff format --check, bandit, and the generated-model drift check.
set -euo pipefail
cd "$(dirname "$0")/.."

uv run --locked ruff check .
uv run --locked ruff format --check .
uv run --locked bandit --configfile pyproject.toml -q -r src scripts
scripts/generate-models.sh --check
