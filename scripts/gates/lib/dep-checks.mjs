// Decides which dependency checks the local gate run (scripts/gates/local-gates.sh) runs.
//
// License checks depend on the locks and the license policy, so they run when one of those changed
// since the base:
//   rush license-check (Node)   common/config/rush/pnpm-lock.yaml, tooling/license-allowlist.json,
//                               scripts/security/license-check.sh
//   api-py / api-go licenses    these run in `_phase:lint` of the project (rush verify), so a change to
//                               uv.lock, go.mod, go.sum or the project license scripts is checked there.
//                               Rush cannot see tooling/license-allowlist.json (it is in no project), so
//                               a change to it runs the project license scripts here.
// Audits run when their lock changed since the base, so a new dependency with a known advisory fails
// the push (owner decision, 2026-10-23: agents run `rush add -p` themselves):
//   rush audit                  common/config/rush/pnpm-lock.yaml
//   pip-audit (security.sh)     projects/<name>/src/api-py/uv.lock, for that project
//   govulncheck (security.sh)   projects/<name>/src/api-go/go.sum, for that module
// A new advisory for a lock that did not change is found by the nightly run in CI (not set up yet),
// by `local-gates.sh --audit-only`, or by GATES_FULL=1. GATES_FULL=1 runs every check.
import path from 'node:path';

import { gitOrThrow } from './proc.mjs';
import { projectsWithParts } from './projects.mjs';
import { resolveCommit } from './revisions.mjs';

const RUSH = ['node', 'common/scripts/install-run-rush.js'];

export const PNPM_LOCK = 'common/config/rush/pnpm-lock.yaml';
export const LICENSE_POLICY = 'tooling/license-allowlist.json';
export const NODE_LICENSE_INPUTS = Object.freeze([
  PNPM_LOCK,
  LICENSE_POLICY,
  'scripts/security/license-check.sh',
]);
export const AUDIT_ENTRY_POINT = 'bash scripts/gates/local-gates.sh --audit-only';
/** The end of the reason of a skipped audit: where the audit of an unchanged lock runs. */
export const AUDIT_LATER = `nightly in CI, not set up yet; run ${AUDIT_ENTRY_POINT} or GATES_FULL=1`;

/**
 * @typedef {object} PlanInput
 * @property {readonly string[]} changed - Paths changed since the base (from the repo root).
 * @property {readonly string[]} pyProjects - Project folder names that have src/api-py.
 * @property {readonly string[]} goProjects - Project folder names that have src/api-go.
 * @property {boolean} full - GATES_FULL=1: run every check.
 * @property {boolean} auditOnly - Run the audits and nothing else (the entry point for CI and humans).
 * @property {string} base - The base commit (for the log lines). Not used with `auditOnly`.
 */

/**
 * @typedef {object} PlanEntry
 * @property {'run' | 'skip'} action - Run the check or skip it.
 * @property {string} label - The check name in the log lines.
 * @property {string} reason - Why it runs or skips.
 * @property {string[]} command - The command (empty for a skip).
 */

/**
 * Describes the files of a list that changed.
 *
 * @param {readonly string[]} files - Changed files.
 * @returns {string} `a changed`, `a and b changed` or `a, b and 1 more changed`.
 */
function changedText(files) {
  const names = files.map((file) => path.posix.basename(file));
  if (names.length <= 2) {
    return `${names.join(' and ')} changed`;
  }
  return `${names.slice(0, 2).join(', ')} and ${String(names.length - 2)} more changed`;
}

/**
 * Plans the license checks.
 *
 * @param {PlanInput} input - The change, the projects and the flags.
 * @returns {PlanEntry[]} The entries.
 */
function licenseEntries(input) {
  const changedSet = new Set(input.changed);
  const short = input.base.slice(0, 12);
  const nodeInputs = NODE_LICENSE_INPUTS.filter((file) => changedSet.has(file));
  const policyChanged = changedSet.has(LICENSE_POLICY);
  const entries = [];
  if (input.full || nodeInputs.length > 0) {
    entries.push({
      action: 'run',
      label: 'license-check',
      reason: input.full ? 'GATES_FULL=1' : changedText(nodeInputs),
      command: [...RUSH, 'license-check'],
    });
  } else {
    entries.push({
      action: 'skip',
      label: 'license-check',
      reason: `no lock or policy change since ${short}`,
      command: [],
    });
  }
  const parts = [
    ...input.pyProjects.map((project) => ({ project, part: 'api-py', lock: 'uv.lock' })),
    ...input.goProjects.map((project) => ({ project, part: 'api-go', lock: 'go.mod and go.sum' })),
  ];
  for (const { project, part, lock } of parts) {
    const label = `license-check ${part} (projects/${project})`;
    if (input.full || policyChanged) {
      entries.push({
        action: 'run',
        label,
        reason: input.full ? 'GATES_FULL=1' : changedText([LICENSE_POLICY]),
        command: ['bash', `projects/${project}/src/${part}/scripts/license-check.sh`],
      });
    } else {
      entries.push({
        action: 'skip',
        label,
        reason: `${lock} changes run in _phase:lint of rush verify; no policy change since ${short}`,
        command: [],
      });
    }
  }
  return entries;
}

/**
 * Lists the audits with the lock that each one reads.
 *
 * @param {PlanInput} input - The projects.
 * @returns {{ label: string, lock: string, command: string[] }[]} The audits in run order.
 */
function audits(input) {
  const security = (project, part) => [
    'bash',
    `projects/${project}/src/${part}/scripts/security.sh`,
  ];
  return [
    { label: 'rush audit', lock: PNPM_LOCK, command: [...RUSH, 'audit'] },
    ...input.pyProjects.map((project) => ({
      label: `pip-audit (projects/${project}, security.sh)`,
      lock: `projects/${project}/src/api-py/uv.lock`,
      command: security(project, 'api-py'),
    })),
    ...input.goProjects.map((project) => ({
      label: `govulncheck (projects/${project}, security.sh)`,
      lock: `projects/${project}/src/api-go/go.sum`,
      command: security(project, 'api-go'),
    })),
  ];
}

/**
 * Plans the audits. Each audit runs when its lock changed since the base. All of them run with
 * GATES_FULL=1 or `auditOnly`.
 *
 * @param {PlanInput} input - The change, the projects and the flags.
 * @returns {PlanEntry[]} One entry for each audit.
 */
function auditEntries(input) {
  const changedSet = new Set(input.changed);
  const short = input.base.slice(0, 12);
  return audits(input).map(({ label, lock, command }) => {
    if (input.full || input.auditOnly) {
      return { action: 'run', label, reason: input.full ? 'GATES_FULL=1' : 'audit only', command };
    }
    if (changedSet.has(lock)) {
      return { action: 'run', label, reason: changedText([lock]), command };
    }
    const name = path.posix.basename(lock);
    return {
      action: 'skip',
      label,
      reason: `no ${name} change since ${short}; ${AUDIT_LATER}`,
      command: [],
    };
  });
}

/**
 * Plans the dependency checks. Pure: it reads nothing.
 *
 * @param {PlanInput} input - The change, the projects and the flags.
 * @returns {PlanEntry[]} The entries in run order: license checks, then the audits.
 */
export function planDependencyChecks(input) {
  return [...(input.auditOnly ? [] : licenseEntries(input)), ...auditEntries(input)];
}

/**
 * Writes the plan for the runner: one line for each entry, fields split by tabs.
 * `run<TAB>label<TAB>reason<TAB>command words...` or `skip<TAB>label<TAB>reason`.
 *
 * @param {readonly PlanEntry[]} entries - The plan.
 * @returns {string} The text, with a newline after each line.
 */
export function formatPlan(entries) {
  return entries
    .map((entry) => `${[entry.action, entry.label, entry.reason, ...entry.command].join('\t')}\n`)
    .join('');
}

/**
 * Lists the paths that changed since the base: committed, staged, unstaged and untracked.
 *
 * @param {string} root - Repo root.
 * @param {string} base - Base commit.
 * @returns {string[]} Paths from the repo root. It throws when the base is not a commit or git fails.
 */
export function changedSinceBase(root, base) {
  const tracked = gitOrThrow(root, [
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    '--no-ext-diff',
    resolveCommit(root, base),
    '--',
  ]);
  const untracked = gitOrThrow(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  return [...tracked.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(
    (file) => file !== '',
  );
}

/**
 * Reads the repo and plans the checks.
 *
 * @param {string} root - Repo root.
 * @param {{ base: string, full: boolean, auditOnly: boolean }} options - The base and the flags.
 * @returns {PlanEntry[]} The plan.
 */
export function planForRepository(root, options) {
  return planDependencyChecks({
    changed: options.auditOnly ? [] : changedSinceBase(root, options.base),
    pyProjects: projectsWithParts(root, ['api-py']),
    goProjects: projectsWithParts(root, ['api-go']),
    full: options.full,
    auditOnly: options.auditOnly,
    base: options.base,
  });
}
