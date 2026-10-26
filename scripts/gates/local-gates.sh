#!/usr/bin/env bash
# Local gate runner: the pre-push suite in one place. Callers:
#   node common/scripts/install-run-rush.js gates   (Rush global command, for humans)
#   common/git-hooks/pre-push                       (when a remote exists)
#   bash scripts/gates/local-gates.sh --audit-only  (all the audits: CI nightly later, or by hand)
# It runs the steps cheap first and stops at the first failure with "gates: FAIL <step>".
# Base for the diff checks: scripts/gates/gates-base.mjs (GATES_BASE, origin/main, the upstream,
# .claude/state/gates-base, then the root commit). With the root commit, `rush verify` runs in full.
# Otherwise `rush build --from git:<base>` (the impacted projects and all their dependencies) runs
# before `rush verify --impacted-by git:<base>` (the changed projects and their dependents only), the
# same split as .github/workflows/ci.yml. A fresh clone has no dist/ in packages/* and tooling/*.
# Before Rush: `uv sync --locked` in each projects/*/src/api-py and `go mod download` in each
# projects/*/src/api-go. Rush fails a phase that writes to stderr, and a cold uv environment or Go
# module cache writes to stderr ("Creating virtual environment", "go: downloading").
# Before rush verify: Prettier on the files changed since the base
# (scripts/gates/prettier-check.mjs). After rush verify: cdk synth for the CDK apps whose infra
# changed (scripts/gates/synth-changed.mjs).
# Dependency checks (scripts/gates/dep-checks.mjs): license checks run when a lock or the license
# policy changed since the base. The typosquat check (scripts/gates/typosquat-check.mjs) runs when a
# package.json gained a dependency name, or gained or changed a dependency version, since the base: a
# new name that looks like a known package name, or a version that is a URL, git, tarball or npm:
# alias source, fails the run (stop and ask the human). An audit runs when its lock changed since the base:
# rush audit for common/config/rush/pnpm-lock.yaml, pip-audit for a uv.lock, govulncheck for a
# go.sum. The audits of unchanged locks belong to the nightly run.
# A failed step keeps its logs (scripts/gates/keep-failure-logs.mjs): the rush-logs and test-results
# folders go to .claude/state/failure-logs/<UTC time>-<step>/, so a rerun does not erase them.
# Env: GATE_LABELS  PR labels for check-gates, separated by commas (no PR exists locally).
#      GATES_FULL=1 every check: all license checks, the typosquat check, the audits, all gate
#                   tests, Prettier on every tracked file, the full rush verify, cdk synth of every
#                   app.
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

# step <name> <command...>: runs the command (stdin closed). A failure keeps the logs and stops the
# run. A failure to keep the logs never changes the result.
step() {
  local name="$1"
  shift
  echo "gates: RUN $name"
  if "$@" </dev/null; then
    echo "gates: PASS $name"
  else
    local status=$?
    echo "gates: FAIL $name (exit $status)" >&2
    node scripts/gates/keep-failure-logs.mjs --step "$name" --note "exit $status" </dev/null >&2 ||
      echo "gates: the failure logs were not kept (see the message above)" >&2
    exit 1
  fi
}

# dep_checks <dep-checks.mjs arguments...>: runs the plan of the license checks, the typosquat check
# and the audits.
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

# warm_parts: fills the uv environment of each Python part and the Go module cache of each Go part
# with the same commands as the warm steps of .github/workflows/ci.yml. Their output goes to the
# runner, where stderr does not fail anything. Then the Rush phases ("uv run --locked", "go build",
# "go tool ...") find everything and print nothing to stderr. Every project, not only the impacted
# ones: a warm run is fast, and the full runs need all of them. uv and Go are optional on a machine
# (docs/onboarding.md). Without the tool, the part is not warmed, and rush verify still fails when
# it runs that part.
warm_parts() {
  local folder
  for folder in projects/*/src/api-py; do
    [ -f "$folder/uv.lock" ] || continue
    if ! command -v uv >/dev/null 2>&1; then
      echo "no uv on the PATH: $folder is not warmed"
      continue
    fi
    echo "uv sync --locked in $folder"
    (cd "$folder" && uv sync --locked) || return 1
  done
  for folder in projects/*/src/api-go; do
    [ -f "$folder/go.mod" ] || continue
    if ! command -v go >/dev/null 2>&1; then
      echo "no go on the PATH: $folder is not warmed"
      continue
    fi
    echo "go mod download in $folder"
    (cd "$folder" && go mod download) || return 1
  done
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

# b. Licenses when a lock or the policy changed. The typosquat check when a package.json gained a
# dependency name. The audit of each lock that changed. Every check with GATES_FULL=1.
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

# g2. Format: Prettier on the files that committed changes since the base touched (GATES_FULL=1:
# all tracked files). The pre-commit hook formats staged code. This step finds the files that
# reached a commit without it.
step "prettier check" node scripts/gates/prettier-check.mjs --base "$base"

# g3. Warm the Python and Go parts before Rush (see warm_parts).
step "warm uv and go" warm_parts

# h. Build, lint, typecheck, test and e2e. The impacted run builds first with --from: the impacted
# projects, their dependents, and all the dependencies of that set. --impacted-by alone does not
# build the dependencies, so on a fresh clone the impacted build cannot find their dist/.
if [ "$full" = "1" ]; then
  step "rush verify (full: GATES_FULL=1)" rush verify
elif [ "$source" = "root" ]; then
  step "rush verify (full: the base is the root commit)" rush verify
else
  step "rush build --from git:$base" rush build --from "git:$base"
  step "rush verify --impacted-by git:$base" rush verify --impacted-by "git:$base"
fi

# h2. Offline cdk synth for each CDK app whose infra changed since the base (after verify, because
# the apps import the built shared packages). GATES_FULL=1 synths every app.
step "cdk synth (changed infra)" node scripts/gates/synth-changed.mjs --base "$base"

# i. API and page coverage.
step "bruno coverage" node scripts/gates/bruno-coverage.mjs
step "playwright coverage" node scripts/gates/playwright-coverage.mjs

echo "gates: pass (base $base, $source)"
