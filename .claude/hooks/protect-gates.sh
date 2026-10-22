#!/usr/bin/env bash
# Gate file. Thin wrapper: the logic is in scripts/gates/hooks/protect-gates.mjs.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "protect-gates: node is not on PATH." >&2; exit 2; }
exec node "$here/../../scripts/gates/hooks/protect-gates.mjs" "$@"
