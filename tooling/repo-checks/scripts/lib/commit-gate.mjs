// Commit gate (design 6.6). PreToolUse hook on Bash: deny `git commit` while a staged source file
// has no passing typecheck for its staged content. Proof: lib/stop-gate-core.mjs stores the
// sha256 of each changed source file after a passing `rush typecheck` or `rush verify`
// (typechecked.json). The gate hashes the staged content (the index blob) and compares.
// The gate runs no tsc and no Rush command. It needs no session state.
import path from 'node:path';

import { findGitCommits } from './commit-gate-command.mjs';
import { readOptional, realPath } from './fs-io.mjs';
import { showFiles } from './stop-gate-messages.mjs';
import {
  gitNames,
  isSourceFile,
  loadProjects,
  owningProject,
  stagedHashes,
} from './stop-gate-repo.mjs';

const PROOF = '.claude/state/gate/typechecked.json';

/**
 * @param {string} reason - Deny reason for the agent.
 * @returns {string} PreToolUse output (JSON) that denies the command.
 */
function deny(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

/**
 * @param {string} root - Real repo root.
 * @param {unknown} cwd - `cwd` of the hook input.
 * @param {string[]} directories - `-C` folders of the commit.
 * @returns {boolean} True when the commit runs in this repo.
 */
function inRepository(root, cwd, directories) {
  const folder = realPath(path.resolve(typeof cwd === 'string' ? cwd : root, ...directories));
  const relative = path.relative(root, folder);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * @param {string} root - Real repo root.
 * @returns {string | undefined} Deny reason, or undefined when each staged source file has proof.
 */
function checkIndex(root) {
  const staged = gitNames(root, [
    'diff',
    '--cached',
    '--name-only',
    '-z',
    '--diff-filter=ACMR',
  ]).filter((file) => isSourceFile(file));
  if (staged.length === 0) {
    return;
  }
  const unstaged = new Set(gitNames(root, ['diff', '--name-only', '-z']));
  const hashes = stagedHashes(root, staged);
  const proofText = readOptional(path.join(root, PROOF));
  /** @type {Record<string, string>} */
  const proof = proofText ? JSON.parse(proofText) : {};
  const projects = loadProjects(root);
  /** @type {Map<string, string[]>} */
  const missing = new Map();
  /** @type {string[]} */
  const partial = [];
  /** @type {string[]} */
  const orphans = [];
  for (const file of staged) {
    const project = owningProject(projects, file);
    if (!project) {
      orphans.push(file);
    } else if (proof[file] !== hashes.get(file)) {
      missing.set(project.packageName, [...(missing.get(project.packageName) ?? []), file]);
      if (unstaged.has(file)) {
        partial.push(file);
      }
    }
  }
  if (missing.size === 0 && orphans.length === 0) {
    return;
  }
  return denyReason(missing, partial, orphans);
}

/**
 * @param {Map<string, string[]>} missing - Package name to its staged files with no proof.
 * @param {string[]} partial - Files whose work tree content differs from the staged content.
 * @param {string[]} orphans - Staged source files outside each Rush project.
 * @returns {string} The deny reason.
 */
function denyReason(missing, partial, orphans) {
  const lines = [
    'Commit gate: these staged source files have no passing typecheck for the staged content.',
  ];
  for (const [name, list] of missing) {
    lines.push(`- ${name}: ${showFiles(list)}`);
  }
  if (orphans.length > 0) {
    lines.push(
      `- No Rush project: ${showFiles(orphans)}. Register the project in rush.json, then run its typecheck.`,
    );
  }
  if (partial.length > 0) {
    lines.push(
      `Partly staged (the work tree differs from the index): ${showFiles(partial)}. The typecheck proof is for the work tree content. Stage the whole file with "git add", or typecheck the staged content: run "git stash --keep-index", run the typecheck, commit, then run "git restore --source=stash@{0} --worktree -- ." and "git stash drop". Do not use "git stash pop": it gives a merge conflict.`,
    );
  }
  if (missing.size > 0) {
    const only = [...missing.keys()].map((name) => `--only ${name}`).join(' ');
    lines.push(
      `Run: node common/scripts/install-run-rush.js typecheck ${only}`,
      'Run it as the last command, with no pipe, "||", ";", "&" or "&&" after it. A passing "rush verify" also counts.',
    );
  }
  return lines.join('\n');
}

/**
 * Handles one PreToolUse hook input for Bash.
 *
 * @param {string} text - Hook input (JSON from stdin).
 * @param {{ root: string, env: Record<string, string | undefined> }} options - Repo root and env.
 * @returns {string | undefined} Deny output (JSON), or undefined to let the command run.
 */
export function commitGate(text, options) {
  if (options.env.FACTORY_STOP_GATE === 'off') {
    return;
  }
  /** @type {Record<string, unknown>} */
  const input = JSON.parse(text);
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') {
    return;
  }
  const toolInput = /** @type {Record<string, unknown>} */ (input.tool_input ?? {});
  const command = typeof toolInput.command === 'string' ? toolInput.command : '';
  const { commits, parsed } = findGitCommits(command);
  if (!parsed) {
    return deny(
      'Commit gate: cannot parse this git commit command. Use git commit -m "<message>" (one -m for each paragraph) or git commit -F <file>.',
    );
  }
  const root = realPath(options.root);
  const ours = commits.filter((commit) => inRepository(root, input.cwd, commit.directories));
  if (ours.length === 0) {
    return;
  }
  const problems = ours.flatMap((commit) => (commit.problem ? [commit.problem] : []));
  if (problems.length > 0) {
    return deny(
      `Commit gate: the gate checks only the staged content, so it does not allow ${problems.join(', ')}. Stage the files with "git add <path>", then run git commit -m "<message>" with no paths and no -a, -i, -o or -p.`,
    );
  }
  const reason = checkIndex(root);
  return reason === undefined ? undefined : deny(reason);
}
