#!/usr/bin/env bash
# Scans staged changes for secrets. Used by the pre-commit hook.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "ERROR: gitleaks is not installed. Install it (macOS: brew install gitleaks) and retry." >&2
  echo "The secret scan must not be skipped." >&2
  exit 1
fi

exec gitleaks git --staged --config .gitleaks.toml --redact --no-banner --verbose
