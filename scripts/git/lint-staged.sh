#!/usr/bin/env bash
# Runs lint-staged (config: .lintstagedrc.cjs). Called by `rush prettier` and the pre-commit hook.
# lint-staged comes from the rush-lint-staged autoinstaller (already on PATH under Rush).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec lint-staged --config .lintstagedrc.cjs "$@"
