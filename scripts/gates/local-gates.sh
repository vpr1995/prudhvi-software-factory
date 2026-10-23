#!/usr/bin/env bash
# Local gate runner: the pre-push suite in one place. Callers:
#   node common/scripts/install-run-rush.js gates   (Rush global command, for humans)
#   common/git-hooks/pre-push                       (when a remote exists)
#   bash scripts/gates/local-gates.sh --audit-only  (the audits only: CI nightly later, or by hand)
# It runs the steps cheap first and stops at the first failure with "gates: FAIL <step>".
# Base for the diff checks: scripts/gates/gates-base.mjs (GATES_BASE, origin/main, the upstream,
# .claude/state/gates-base, then the root commit). With the root commit, `rush verify` runs in full.
# After rush verify: cdk synth for the CDK apps whose infra changed (scripts/gates/synth-changed.mjs).
# Dependency checks (scripts/gates/dep-checks.mjs): license checks run when a lock or the license
# policy changed since the base. The audits do not run here: they belong to the nightly run.
# Env: GATE_LABELS  PR labels for check-gates, separated by commas (no PR exists locally).
#      GATES_FULL=1 every check: all license checks, the audits, all gate tests, the full rush verify,
#                   cdk synth of every app.
# Skips print "gates: SKIP <step> (<reason>)". `rush change --verify` skips only without a remote.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

audit_only=false
case "${1:-}" in
  "") ;;
  --audit-only) audit_only=true ;;
  *)
    echo "usage: bash scripts/gates/local-gates.sh [--audit-only]" >&2
    exit 2
    ;;
esac
full="${GATES_FULL:-}"

rush() {
  node common/scripts/install-run-rush.js "$@"
}

# step <name> <command...>: runs the command (stdin closed). A failure stops the run.
step() {
  local name="$1"
  shift
  echo "gates: RUN $name"
  if "$@" </dev/null; then
    echo "gates: PASS $name"
  else
    local status=$?
    echo "gates: FAIL $name (exit $status)" >&2
    exit 1
  fi
}

# dep_checks <dep-checks.mjs arguments...>: runs the plan of the license checks and the audits.
dep_checks() {
  local plan action label reason
  local -a fields
  if ! plan="$(node scripts/gates/dep-checks.mjs "$@")"; then
    echo "gates: FAIL dependency check plan (see the message above)" >&2
    exit 1
  fi
  while IFS=$'\t' read -r -a fields; do
    [ "${#fields[@]}" -ge 3 ] || continue
    action="${fields[0]}"
    label="${fields[1]}"
    reason="${fields[2]}"
    if [ "$action" = "run" ]; then
      step "$label ($reason)" "${fields[@]:3}"
    else
      echo "gates: SKIP $label ($reason)"
    fi
  done <<<"$plan"
}

if [ "$audit_only" = true ]; then
  dep_checks --audit-only
  echo "gates: pass (audits only)"
  exit 0
fi

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

# b. Licenses when a lock or the policy changed. Audits only with GATES_FULL=1.
dep_checks --base "$base"

# c. SAST. The script picks its own file list (L2 changes it).
step "opengrep" bash scripts/security/opengrep-changed.sh

# d-g. Diff checks against the base, then the gate scripts themselves.
step "anti-skip" node scripts/gates/anti-skip.mjs --range "$base...HEAD"
step "check-gates" node scripts/gates/check-gates.mjs --base "$base" --head HEAD --labels "$labels"
if [ "$full" = "1" ]; then
  step "gate tests (all: GATES_FULL=1)" node scripts/gates/test-impacted.mjs --all
else
  step "gate tests" node scripts/gates/test-impacted.mjs --base "$base"
fi
step "gate lint" tooling/eslint-config/node_modules/.bin/eslint --max-warnings 0 scripts/gates

# h. Build, lint, typecheck, test and e2e.
if [ "$full" = "1" ]; then
  step "rush verify (full: GATES_FULL=1)" rush verify
elif [ "$source" = "root" ]; then
  step "rush verify (full: the base is the root commit)" rush verify
else
  step "rush verify --impacted-by git:$base" rush verify --impacted-by "git:$base"
fi

# h2. Offline cdk synth for each CDK app whose infra changed since the base (after verify, because
# the apps import the built shared packages). GATES_FULL=1 synths every app.
step "cdk synth (changed infra)" node scripts/gates/synth-changed.mjs --base "$base"

# i. API and page coverage.
step "bruno coverage" node scripts/gates/bruno-coverage.mjs
step "playwright coverage" node scripts/gates/playwright-coverage.mjs

echo "gates: pass (base $base, $source)"
