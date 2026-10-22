#!/usr/bin/env bash
# Usage: rush commitlint --message-file <file>
# commitlint comes from the rush-commitlint autoinstaller (already on PATH under Rush).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

message_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --message-file) message_file="${2:?--message-file needs a path}"; shift 2 ;;
    --message-file=*) message_file="${1#*=}"; shift ;;
    *) echo "commitlint.sh: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$message_file" ] || { echo "commitlint.sh: --message-file is required" >&2; exit 2; }

exec commitlint --config commitlint.config.cjs --edit "$message_file"
