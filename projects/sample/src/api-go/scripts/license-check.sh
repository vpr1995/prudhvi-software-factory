#!/usr/bin/env bash
# Checks Go dependency licenses against the runtime list of tooling/license-allowlist.json (read only).
# go-licenses checks the packages that the binary imports. The tool dependencies (go.mod tool directives)
# are not part of the binary, so they are not checked here.
set -euo pipefail
cd "$(dirname "$0")/.."

allowlist="$(cd ../../../../tooling && pwd)/license-allowlist.json"
allowed="$(node -e 'console.log(require(process.argv[1]).runtime.join(","))' "$allowlist")"

# go-licenses warns about assembly files in dependencies. Those lines are noise, so they are dropped.
status=0
output="$(go tool go-licenses check ./cmd/... --allowed_licenses="$allowed" --ignore github.com/vprprudhvi/sample 2>&1)" || status=$?
printf '%s\n' "$output" | awk '!/contains non-Go code/ && !/\.s$/'
if [ "$status" -ne 0 ]; then
  echo "ERROR: a Go dependency has a license that is not in the runtime list." >&2
  exit "$status"
fi
echo "license-check (api-go): all licenses allowed"
