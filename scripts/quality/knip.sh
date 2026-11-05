#!/usr/bin/env bash
# Runs Knip (config: knip.jsonc): unused files, exports, types and dependencies, unlisted dependencies,
# unresolved imports and binaries. Called by `rush knip`. knip comes from the rush-knip autoinstaller.
# In GitHub Actions it also writes annotations (github-actions reporter). Exit: 0 clean, 1 issues, 2 error.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

reporters=(--reporter symbols)
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  reporters+=(--reporter github-actions)
fi
exec knip "${reporters[@]}"
