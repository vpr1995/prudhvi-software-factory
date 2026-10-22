#!/usr/bin/env bash
# Fails when the total statement coverage of a Go coverage profile is below the threshold.
#   scripts/check-coverage.sh <profile> [threshold-percent]
set -euo pipefail
cd "$(dirname "$0")/.."

profile="${1:?usage: check-coverage.sh <profile> [threshold]}"
threshold="${2:-80}"

total="$(go tool cover -func="$profile" | awk '/^total:/ { sub("%", "", $3); print $3 }')"
echo "coverage: total ${total}% (threshold ${threshold}%)"
awk -v total="$total" -v threshold="$threshold" 'BEGIN { exit (total + 0 >= threshold + 0) ? 0 : 1 }' \
  || { echo "ERROR: coverage ${total}% is below ${threshold}%." >&2; exit 1; }
