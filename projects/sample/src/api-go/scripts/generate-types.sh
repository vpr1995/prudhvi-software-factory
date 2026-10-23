#!/usr/bin/env bash
# Generates the Go types from the OpenAPI document in dist/openapi.json (built from src/contracts) with oapi-codegen.
#   scripts/generate-types.sh           write internal/gen/types.gen.go
#   scripts/generate-types.sh --check   regenerate into a temp folder and fail when it differs (drift check)
# The temp folder is outside the repo, so the check does not depend on git state.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="write"
[ "${1:-}" = "--check" ] && mode="check"

spec="../../dist/openapi.json"
target="internal/gen"
[ -f "$spec" ] || { echo "ERROR: $spec is missing. Run the build phase of the project first (it writes dist/openapi.json)." >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/gen"

go tool oapi-codegen -config oapi-codegen.yaml -o "$work/gen/types.gen.go" "$spec"
go tool gofumpt -w "$work/gen/types.gen.go"

if [ "$mode" = "write" ]; then
  mkdir -p "$target"
  cp "$work/gen/types.gen.go" "$target/types.gen.go"
  echo "generate-types: wrote $target/types.gen.go"
else
  drift=0
  diff_output="$(diff -r "$work/gen" "$target" 2>&1)" || drift=$?
  if [ "$drift" -eq 0 ]; then
    echo "generate-types: no drift"
  else
    echo "ERROR: $target differs from the generated output. Never edit generated files. Run 'scripts/generate-types.sh' and commit the result." >&2
    printf '%s\n' "$diff_output" >&2
    exit 1
  fi
fi
