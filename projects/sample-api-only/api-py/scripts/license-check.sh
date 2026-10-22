#!/usr/bin/env bash
# Checks Python dependency licenses against tooling/license-allowlist.json (read only).
# Runtime packages must match the strict "runtime" list. Dev packages can also match the "tooling" list.
set -euo pipefail
cd "$(dirname "$0")/.."

allowlist="../../../tooling/license-allowlist.json"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

uv export --locked --no-dev --no-emit-project --no-hashes --format requirements-txt >"$work/runtime.txt" 2>/dev/null
uv run --locked pip-licenses --format=json --from=mixed >"$work/licenses.json"
uv run --locked python scripts/license_check.py "$allowlist" "$work/runtime.txt" "$work/licenses.json" "api-py"
