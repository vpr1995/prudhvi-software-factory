#!/usr/bin/env bash
# Gate file. Thin wrapper: the logic is in scripts/gates/hooks/stop-gate.mjs.
# Exit codes: 0 pass, 2 block. Any other node exit (a crash, a syntax error in a gate lib, a kill
# by signal) becomes 2 with a message, so a broken gate never lets a stop pass. The exception is
# --write-state-only (the verify skill), where exit 1 means "the checks failed".
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "stop-gate: node is not on PATH." >&2; exit 2; }
node "$here/../../scripts/gates/hooks/stop-gate.mjs" "$@"
code=$?
case "$code" in
  0 | 2) exit "$code" ;;
esac
for arg in "$@"; do
  if [ "$arg" = "--write-state-only" ]; then
    exit "$code"
  fi
done
echo "stop-gate: the gate crashed (node exit code $code). The stop is blocked until a human fixes scripts/gates." >&2
exit 2
