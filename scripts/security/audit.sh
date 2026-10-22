#!/usr/bin/env bash
# Runs audit-ci (config: audit-ci.jsonc) against the pnpm lockfile Rush generates in common/temp.
# Run through `rush audit` (audit-ci comes from the rush-security autoinstaller).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

pnpm_bin="common/temp/pnpm-local/node_modules/.bin"
[ -x "$pnpm_bin/pnpm" ] || { echo "ERROR: run 'node common/scripts/install-run-rush.js install' first." >&2; exit 1; }
[ -f common/temp/pnpm-lock.yaml ] || { echo "ERROR: common/temp/pnpm-lock.yaml is missing. Run rush install." >&2; exit 1; }

PATH="$PWD/$pnpm_bin:$PATH" exec audit-ci --config "$PWD/audit-ci.jsonc" --directory common/temp
