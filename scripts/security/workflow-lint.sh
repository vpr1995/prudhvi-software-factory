#!/usr/bin/env bash
# Checks GitHub workflow and action files. Used by the pre-commit hook (lint-staged) and by CI.
# Usage: workflow-lint.sh [file...]. No file: all files in .github/workflows and .github/actions.
# 1. actionlint on all workflows (a changed action can break the workflows that use it).
# 2. zizmor --offline on the files.
# 3. pinact: each `uses:` has a full commit SHA and a version comment. With GITHUB_TOKEN set (CI),
#    pinact also checks that the comment names the version of the SHA (GitHub API).
# The binaries come from scripts/security/install-tools.mjs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PATH="${INSTALL_TOOLS_DIR:-$HOME/.local/bin}:$PATH"

for tool in actionlint zizmor pinact; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: $tool is not installed. Run: node scripts/security/install-tools.mjs" >&2
    echo "The workflow check must not be skipped." >&2
    exit 1
  fi
done

# Bash 3.2 (macOS) has no mapfile, so the lists are read line by line.
workflows=()
while IFS= read -r file; do workflows+=("$file"); done < <(git ls-files '.github/workflows/*.yml' '.github/workflows/*.yaml')
files=()
if [ "$#" -gt 0 ]; then
  files=("$@")
else
  while IFS= read -r file; do files+=("$file"); done < <(git ls-files '.github/workflows/*.yml' \
    '.github/workflows/*.yaml' '.github/actions/*.yml' '.github/actions/*.yaml')
fi
if [ "${#workflows[@]}" -eq 0 ] || [ "${#files[@]}" -eq 0 ]; then
  echo "ERROR: no workflow files found" >&2
  exit 1
fi

echo "actionlint: ${#workflows[@]} workflows"
actionlint "${workflows[@]}"

echo "zizmor: ${#files[@]} files"
zizmor --offline "${files[@]}"

echo "pinact: ${#files[@]} files"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  pinact run --check --verify-comment "${files[@]}"
else
  pinact run --fix=false --no-api "${files[@]}"
fi
