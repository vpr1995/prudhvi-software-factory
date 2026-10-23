#!/usr/bin/env bash
# Security scans for api-py. `rush audit` covers JavaScript only, so this part runs its own scans:
#   bandit    static analysis of src/ and scripts/
#   pip-audit known vulnerabilities of the locked dependencies (runtime first, then all groups)
set -euo pipefail
cd "$(dirname "$0")/.."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "security: bandit"
uv run --locked bandit --configfile pyproject.toml -q -r src scripts

echo "security: pip-audit (runtime dependencies)"
uv export --locked --no-dev --no-emit-project --no-hashes --format requirements-txt >"$work/runtime.txt" 2>/dev/null
uv run --locked pip-audit --requirement "$work/runtime.txt" --no-deps --disable-pip --strict

echo "security: pip-audit (all dependency groups)"
uv export --locked --no-emit-project --no-hashes --format requirements-txt >"$work/all.txt" 2>/dev/null
uv run --locked pip-audit --requirement "$work/all.txt" --no-deps --disable-pip --strict
echo "security: pass"
