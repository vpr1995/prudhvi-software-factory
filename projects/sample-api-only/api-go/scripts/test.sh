#!/usr/bin/env bash
# _phase:test for api-go: go test -race with a coverage profile over all packages except the generated ones,
# then the coverage threshold (80%).
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p coverage
packages="$(go list ./... | grep -v '/internal/gen$' | paste -sd, -)"
# The sed shortens the "coverage: x% of statements in <all packages>" suffix of each line.
go test -race -cover -coverpkg="$packages" -coverprofile=coverage/coverage.out ./... | sed -E 's/ of statements in .*$/ of statements/'
scripts/check-coverage.sh coverage/coverage.out 80
