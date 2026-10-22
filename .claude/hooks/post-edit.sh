#!/usr/bin/env bash
# Gate file. Thin wrapper: the logic is in scripts/gates/hooks/post-edit.mjs.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "post-edit: node is not on PATH." >&2; exit 1; }
exec node "$here/../../scripts/gates/hooks/post-edit.mjs" "$@"
