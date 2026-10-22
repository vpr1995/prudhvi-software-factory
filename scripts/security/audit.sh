#!/usr/bin/env bash
# Runs audit-ci (config: audit-ci.jsonc) against the pnpm lockfile Rush generates in common/temp.
# Run through `rush audit` (audit-ci comes from the rush-security autoinstaller).
#
# Split policy (human decision 2026-10-22, see audit-ci.jsonc):
#   Pass A  runtime deps only (shipping projects: everything except tooling/*)  fail on HIGH or CRITICAL
#   Pass B  all deps incl. dev and tooling                                      fail on CRITICAL only
# Both passes must pass. The script prints which pass failed.
#
# Why pass A prunes tooling/*: tooling/* projects never ship, but they list their lint plugins under
# "dependencies". audit-ci --skip-dev would count those as runtime. Pass A therefore audits a pruned
# copy of the lockfile that has no tooling/* importers, then applies --skip-dev to the rest.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

pnpm_bin="common/temp/pnpm-local/node_modules/.bin"
[ -x "$pnpm_bin/pnpm" ] || { echo "ERROR: run 'node common/scripts/install-run-rush.js install' first." >&2; exit 1; }
[ -f common/temp/pnpm-lock.yaml ] || { echo "ERROR: common/temp/pnpm-lock.yaml is missing. Run rush install." >&2; exit 1; }

repo_root="$PWD"
export PATH="$repo_root/$pnpm_bin:$PATH"

# Pass A input. Layout: <tmp>/common/temp/{pnpm-lock.yaml,package.json,.npmrc} plus <tmp>/<importer>/package.json,
# so the lockfile's relative importer paths (../../packages/x) resolve the same way as in the repo.
# AUDIT_WORKSPACE_DIR lets a test point at a throwaway copy of common/temp (default: the real one).
src_dir="${AUDIT_WORKSPACE_DIR:-common/temp}"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/audit-runtime.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/common/temp"

node - "$src_dir" "$tmp_dir" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [srcDir, tmpDir] = process.argv.slice(2);
const srcAbs = path.resolve(srcDir);
const repoRoot = path.resolve(srcAbs, "..", ".."); // common/temp -> workspace root
const outTemp = path.join(tmpDir, "common", "temp");

const lines = fs.readFileSync(path.join(srcAbs, "pnpm-lock.yaml"), "utf8").split("\n");
const kept = [];
const keptImporters = [];
let inImporters = false;
let skipping = false;
for (const line of lines) {
  if (/^\S/.test(line)) { inImporters = line.startsWith("importers:"); skipping = false; kept.push(line); continue; }
  const m = inImporters && /^ {2}(['"]?)([^\s'"]+)\1:\s*(\{\})?\s*$/.exec(line);
  if (m) {
    const rel = path.relative(repoRoot, path.resolve(srcAbs, m[2]));
    skipping = rel === "tooling" || rel.startsWith("tooling" + path.sep);
    if (!skipping) keptImporters.push(m[2]);
  }
  if (!skipping) kept.push(line);
}
fs.writeFileSync(path.join(outTemp, "pnpm-lock.yaml"), kept.join("\n"));
for (const f of ["package.json", ".npmrc"]) {
  if (fs.existsSync(path.join(srcAbs, f))) fs.copyFileSync(path.join(srcAbs, f), path.join(outTemp, f));
}
let manifests = 0;
for (const imp of keptImporters) {
  const abs = path.resolve(srcAbs, imp);
  if (path.relative(srcAbs, abs) === "") continue; // "." is the common/temp package.json itself
  const dest = path.resolve(outTemp, imp);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(abs, "package.json"), path.join(dest, "package.json"));
  manifests++;
}
console.log(`audit: pass A audits ${manifests} non-tooling project(s); tooling/* is dev-only.`);
if (manifests === 0) console.log("audit: no shipping projects yet, so pass A has nothing to audit.");
NODE

run_audit() {
  # $1 = directory, remaining = audit-ci flags. --high=false resets the high default from audit-ci.jsonc.
  local dir="$1"; shift
  audit-ci --config "$repo_root/audit-ci.jsonc" --directory "$dir" "$@"
}

status=0

echo "audit: PASS A (runtime dependencies only, fail on high or critical)"
run_audit "$tmp_dir/common/temp" --skip-dev --high || { echo "audit: FAILED pass A (runtime dependencies, high or critical)" >&2; status=1; }

echo "audit: PASS B (all dependencies incl. dev and tooling, fail on critical only)"
run_audit "$src_dir" --high=false --critical || { echo "audit: FAILED pass B (all dependencies, critical)" >&2; status=1; }

[ "$status" -eq 0 ] && echo "audit: pass A (runtime, high+) and pass B (all deps, critical) both passed"
exit "$status"
