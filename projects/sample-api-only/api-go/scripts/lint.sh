#!/usr/bin/env bash
# _phase:lint for api-go: gofumpt (fail on any output), golangci-lint, and the generated-type drift check.
set -euo pipefail
cd "$(dirname "$0")/.."

unformatted="$(go tool gofumpt -l .)"
if [ -n "$unformatted" ]; then
  echo "ERROR: gofumpt would change these files. Run 'go tool gofumpt -w .':" >&2
  echo "$unformatted" >&2
  exit 1
fi
go tool golangci-lint run
scripts/generate-types.sh --check
