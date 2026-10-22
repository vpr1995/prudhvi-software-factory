import path from 'node:path';

import { exists, writeText } from './fs-io.mjs';
import { gateEntries } from './gate-list.mjs';
import { currentBranch, headSha, rushInstalled, statePaths } from './git-state.mjs';
import { which } from './proc.mjs';

const RISK_HIGH_PATHS = [/^platform\//, /^packages\//, /^projects\/[^/]+\/infra\//, /^\.github\//];
const RISK_LOW_PATHS = [
  /^docs\//,
  /\.md$/,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.go$/,
  /\.bru$/,
];
const OPTIONAL_TOOLS = [
  { name: 'gitleaks', purpose: 'secret scan' },
  { name: 'opengrep', purpose: 'security rules scan' },
  { name: 'uv', purpose: 'Python projects' },
  { name: 'go', purpose: 'Go projects' },
];

/**
 * Saves the HEAD commit as the base of this session (the stop gate checks changes since it).
 *
 * @param {string} root - Repo root.
 * @param {string} source - SessionStart source: startup, resume, clear, compact or fork.
 * @param {boolean} keepExisting - True to keep a saved base (resume and compact).
 * @returns {void}
 */
export function recordSessionBase(root, source, keepExisting) {
  const file = statePaths(root).sessionBase;
  const head = headSha(root);
  if (head === '' || (keepExisting && exists(file) && source !== 'startup' && source !== 'clear')) {
    return;
  }
  writeText(file, `${head}\n`);
}

/**
 * Builds the session start text: branch, gates and setup problems.
 *
 * @param {string} root - Repo root.
 * @returns {string} Text for Claude (printed on stdout).
 */
export function sessionSummary(root) {
  const branch = currentBranch(root) || '(detached HEAD)';
  const lines = [
    `Repo: ${path.basename(root)}, branch ${branch}, HEAD ${headSha(root).slice(0, 12) || '(no commits)'}.`,
    `Gate files: ${String(gateEntries().length)} patterns are blocked for edits (scripts/gates/gate-files.json). If a gate blocks you, stop and tell the human the exact diff you propose.`,
    'Run Rush only as `node common/scripts/install-run-rush.js <command>`. Never use npm, pnpm or yarn to install.',
  ];
  if (!rushInstalled(root)) {
    lines.push(
      'SETUP: common/temp is missing. Run `node common/scripts/install-run-rush.js install` before you build or test.',
    );
  }
  if (!exists(path.join(root, '.git', 'hooks', 'pre-commit'))) {
    lines.push(
      'SETUP: the git pre-commit hook is not installed. Run `node common/scripts/install-run-rush.js install` (Rush installs the hooks).',
    );
  }
  const missing = OPTIONAL_TOOLS.filter((tool) => which(tool.name) === null);
  if (missing.length > 0) {
    lines.push(
      `Missing tools: ${missing.map((tool) => `${tool.name} (${tool.purpose})`).join(', ')}. Related checks are skipped with a notice.`,
    );
  }
  return lines.join('\n');
}

/**
 * Guesses the risk tier of the work from the changed paths.
 *
 * @param {string[]} changed - Changed paths from the repo root.
 * @param {(file: string) => boolean} isGate - Tells whether a path is a gate file.
 * @returns {{ tier: 'low' | 'medium' | 'high', reason: string }} The guess and why.
 */
export function guessRiskTier(changed, isGate) {
  if (changed.length === 0) {
    return { tier: 'low', reason: 'no changes yet' };
  }
  const gate = changed.find((file) => isGate(file));
  if (gate !== undefined) {
    return { tier: 'high', reason: `gate file changed: ${gate}` };
  }
  const high = changed.find((file) => RISK_HIGH_PATHS.some((pattern) => pattern.test(file)));
  if (high !== undefined) {
    return { tier: 'high', reason: `shared or infra path changed: ${high}` };
  }
  return changed.every((file) => RISK_LOW_PATHS.some((pattern) => pattern.test(file)))
    ? { tier: 'low', reason: 'only docs and tests changed' }
    : { tier: 'medium', reason: 'project source changed' };
}
