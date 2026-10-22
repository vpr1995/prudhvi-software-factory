#!/usr/bin/env bash
# Checks dependency licenses against tooling/license-allowlist.json.
# Policy (human decision 2026-10-22, see _reasons in the allowlist):
#   production deps of shipping projects (packages/, projects/, platform/) -> strict "runtime" list only
#   dev-only deps of shipping projects                                     -> "runtime" + "tooling" lists
#   tooling/* projects never ship, so all their deps                       -> "runtime" + "tooling" lists
# Run through `rush license-check` (license-checker-rseidelsohn comes from the rush-security autoinstaller).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

allowlist="tooling/license-allowlist.json"
[ -d common/temp/node_modules ] || { echo "ERROR: run 'node common/scripts/install-run-rush.js install' first." >&2; exit 1; }

runtime_list="$(node -e 'const a=require("./'"$allowlist"'");console.log(a.runtime.join(";"))')"
all_list="$(node -e 'const a=require("./'"$allowlist"'");console.log([...a.runtime,...a.tooling].join(";"))')"
exclude_list="$(node -e 'const a=require("./'"$allowlist"'");console.log(a.excludePackages.join(";"))')"

status=0
while IFS= read -r package_json; do
  project_dir="$(dirname "$package_json")"
  echo "license-check: $project_dir"
  exclude_args=()
  [ -n "$exclude_list" ] && exclude_args=(--excludePackages "$exclude_list")
  case "$project_dir" in
    tooling/*)
      # Non-shipping: every dependency (even one listed under "dependencies") may use a tooling license.
      license-checker-rseidelsohn --start "$project_dir" --onlyAllow "$all_list" \
        ${exclude_args[@]+"${exclude_args[@]}"} --excludePrivatePackages --summary >/dev/null || { echo "FAIL (tooling, runtime+tooling list): $project_dir" >&2; status=1; }
      ;;
    *)
      license-checker-rseidelsohn --start "$project_dir" --production --onlyAllow "$runtime_list" \
        ${exclude_args[@]+"${exclude_args[@]}"} --excludePrivatePackages --summary >/dev/null || { echo "FAIL (production deps, strict runtime list): $project_dir" >&2; status=1; }
      license-checker-rseidelsohn --start "$project_dir" --development --onlyAllow "$all_list" \
        ${exclude_args[@]+"${exclude_args[@]}"} --excludePrivatePackages --summary >/dev/null || { echo "FAIL (dev deps, runtime+tooling list): $project_dir" >&2; status=1; }
      ;;
  esac
done < <(find tooling packages projects platform -maxdepth 3 -name package.json -not -path '*/node_modules/*' 2>/dev/null | sort)

[ "$status" -eq 0 ] && echo "license-check: all licenses allowed"
exit "$status"
