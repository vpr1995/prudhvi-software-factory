#!/usr/bin/env bash
# Local gate runner: the pre-push suite in one place. Callers:
#   node common/scripts/install-run-rush.js gates   (Rush global command, for humans)
#   common/git-hooks/pre-push                       (when a remote exists)
# It runs the steps cheap first and stops at the first failure with "gates: FAIL <step>".
# Base for the diff checks: scripts/gates/gates-base.mjs (GATES_BASE, origin/main, the upstream,
# .claude/state/gates-base, then the root commit). With the root commit, `rush verify` runs in full.
# Env: GATE_LABELS  PR labels for check-gates, separated by commas (no PR exists locally).
# The one allowed skip: `rush change --verify` needs a remote. It prints SKIP with the reason.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

rush() {
  node common/scripts/install-run-rush.js "$@"
}

# step <name> <command...>: runs the command. A failure stops the run.
step() {
  local name="$1"
  shift
  echo "gates: RUN $name"
  if "$@"; then
    echo "gates: PASS $name"
  else
    local status=$?
    echo "gates: FAIL $name (exit $status)" >&2
    exit 1
  fi
}

if ! base_output="$(node scripts/gates/gates-base.mjs)"; then
  echo "gates: FAIL base (no base commit, see the message above)" >&2
  exit 1
fi
read -r base source <<<"$base_output"
labels="${GATE_LABELS:-}"

# a. Change files. Rush compares with the remote branch, so it cannot run without a remote.
# --no-fetch: compare with the local origin/main, the same ref the base comes from. The gates never
# fetch; a human fetches.
if git remote get-url origin >/dev/null 2>&1; then
  step "rush change --verify" rush change --verify --no-fetch
else
  echo "gates: SKIP rush change --verify (no origin remote; rush change needs a remote)"
fi

# b. Dependency audit and licenses.
step "rush audit" rush audit
step "rush license-check" rush license-check

# c. SAST. The script picks its own file list (L2 changes it).
step "opengrep" bash scripts/security/opengrep-changed.sh

# d-g. Diff checks against the base, then the gate scripts themselves.
step "anti-skip" node scripts/gates/anti-skip.mjs --range "$base...HEAD"
step "check-gates" node scripts/gates/check-gates.mjs --base "$base" --head HEAD --labels "$labels"
step "gate tests" node scripts/gates/test-impacted.mjs --base "$base"
step "gate lint" tooling/eslint-config/node_modules/.bin/eslint --max-warnings 0 scripts/gates

# h. Build, lint, typecheck, test and e2e.
if [ "$source" = "root" ]; then
  step "rush verify (full: the base is the root commit)" rush verify
else
  step "rush verify --impacted-by git:$base" rush verify --impacted-by "git:$base"
fi

# i. API and page coverage.
step "bruno coverage" node scripts/gates/bruno-coverage.mjs
step "playwright coverage" node scripts/gates/playwright-coverage.mjs

echo "gates: pass (base $base, $source)"
