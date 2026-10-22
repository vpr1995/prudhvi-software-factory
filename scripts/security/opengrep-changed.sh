#!/usr/bin/env bash
# Runs Opengrep with tooling/opengrep rules on changed files.
#   --staged   scan staged files (pre-commit use)
#   default    scan files changed against origin/main (all tracked files if origin/main is missing)
# In CI (CI=true) a missing opengrep binary is an error. Locally it is a loud warning.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if ! command -v opengrep >/dev/null 2>&1; then
  if [ "${CI:-}" = "true" ]; then
    echo "ERROR: opengrep is not installed in CI." >&2
    exit 1
  fi
  echo "########################################################################" >&2
  echo "# WARNING: opengrep is NOT installed. SAST scan SKIPPED locally.        #" >&2
  echo "# CI will run it and fail the PR on findings. Install: see opengrep.dev #" >&2
  echo "########################################################################" >&2
  exit 0
fi

pattern='\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml)$'
if [ "${1:-}" = "--staged" ]; then
  changed="$(git diff --cached --name-only --diff-filter=ACMR)"
elif git rev-parse --verify --quiet origin/main >/dev/null; then
  changed="$(git diff --name-only --diff-filter=ACMR "$(git merge-base origin/main HEAD)")"
else
  changed="$(git ls-files)"
fi

files=()
while IFS= read -r file; do
  [ -n "$file" ] && [ -f "$file" ] && [[ "$file" =~ $pattern ]] && [[ "$file" != tooling/opengrep/* ]] && files+=("$file")
done <<< "$changed"

if [ "${#files[@]}" -eq 0 ]; then
  echo "opengrep: no changed files to scan"
  exit 0
fi

echo "opengrep: scanning ${#files[@]} file(s)"
exec opengrep scan --config tooling/opengrep --error --quiet "${files[@]}"
