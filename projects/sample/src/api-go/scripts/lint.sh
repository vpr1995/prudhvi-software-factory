#!/usr/bin/env bash
# _phase:lint for api-go: gofumpt (fail on any output) and golangci-lint. The generated-type drift check runs in _phase:test, after the build wrote dist/openapi.json.
set -euo pipefail
cd "$(dirname "$0")/.."

unformatted="$(go tool gofumpt -l .)"
if [ -n "$unformatted" ]; then
  echo "ERROR: gofumpt would change these files. Run 'go tool gofumpt -w .':" >&2
  echo "$unformatted" >&2
  exit 1
fi
go tool golangci-lint run
