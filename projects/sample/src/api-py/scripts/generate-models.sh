#!/usr/bin/env bash
# Generates the Pydantic v2 models from the OpenAPI document in dist/openapi.json (built from src/contracts).
#   scripts/generate-models.sh           write src/sample_api/generated/
#   scripts/generate-models.sh --check   regenerate into a temp folder and fail when it differs (drift check)
# The temp folder is outside the repo, so the check does not depend on git state.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="write"
[ "${1:-}" = "--check" ] && mode="check"

spec="../../dist/openapi.json"
target="src/sample_api/generated"
[ -f "$spec" ] || { echo "ERROR: $spec is missing. Run the build phase of the project first (it writes dist/openapi.json)." >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/generated"

uv run --locked python scripts/prepare_schema.py "$spec" "$work/openapi.json"
(cd "$work" && cat /dev/null > generated/__init__.py)
uv run --locked datamodel-codegen \
  --input "$work/openapi.json" --input-file-type openapi \
  --output "$work/generated/models.py" \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.14 \
  --disable-timestamp \
  --use-annotated \
  --formatters ruff-check ruff-format

if [ "$mode" = "write" ]; then
  rm -rf "$target"
  mkdir -p "$target"
  cp "$work/generated/__init__.py" "$work/generated/models.py" "$target/"
  echo "generate-models: wrote $target"
else
  drift=0
  diff_output="$(diff -r -x __pycache__ "$work/generated" "$target" 2>&1)" || drift=$?
  if [ "$drift" -eq 0 ]; then
    echo "generate-models: no drift"
  else
    echo "ERROR: $target differs from the generated output. Never edit generated files. Run 'scripts/generate-models.sh' and commit the result." >&2
    printf '%s\n' "$diff_output" >&2
    exit 1
  fi
fi
