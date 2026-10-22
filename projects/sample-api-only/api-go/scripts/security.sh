#!/usr/bin/env bash
# Security scans for api-go. `rush audit` covers JavaScript only, so this part runs its own scans:
#   govulncheck  known vulnerabilities that the code can reach
#   gosec        static analysis, through golangci-lint (the gosec linter is on in .golangci.yml)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "security: govulncheck"
go tool govulncheck ./...

echo "security: gosec (golangci-lint, gosec only)"
go tool golangci-lint run --default none --enable gosec
echo "security: pass"
