// Verify gate (design 6.6.1). One handler for four Claude Code hook events:
// - PostToolUse on Edit, Write, MultiEdit, NotebookEdit: record the edited file for the agent.
// - PostToolUse on Bash: after a passing `rush test` or `rush verify`, store the hash of each
//   changed source file in the covered projects. Also record a deferral of the main session.
// - Stop and SubagentStop: block while an edited source file has no stored hash that matches.
// The handler runs no tests and no Rush command. It reads state, runs `git status` and hashes files.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  appendText,
  exists,
  listFolder,
  readBytes,
  readOptional,
  readRepositoryFile,
  realPath,
  writeAtomic,
} from './fs-io.mjs';
import { parseJsonc } from './jsonc.mjs';
import { coveredProjects, findRushRuns } from './stop-gate-command.mjs';

export const GATE_SCRIPT = 'tooling/repo-checks/scripts/stop-gate.mjs';
export const DEFER_MARKER = 'stop-gate: deferral requested: ';
const STATE = '.claude/state';
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SOURCE_ROOTS = new Set(['projects', 'packages', 'platform', 'tooling']);
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', '.next', 'coverage', 'cdk.out']);
const SAFE_ID = /^[\w-]{1,128}$/;
const MAX_FILES_SHOWN = 10;

/**
 * @typedef {import('./stop-gate-command.mjs').Project} Project
 * @typedef {{ root: string, env: Record<string, string | undefined>, now?: () => Date }} Options
 * @typedef {{ path: string, project: Project, hash: string }} FileState
 * @typedef {Record<string, unknown>} HookInput
 */

/**
 * @param {string} file - Repo-relative path.
 * @returns {boolean} True for a source file that the gate checks.
 */
export function isSourceFile(file) {
  const parts = file.split('/');
  return (
    SOURCE_ROOTS.has(parts[0] ?? '') &&
    SOURCE_EXTENSIONS.has(path.extname(file)) &&
    !parts.some((part) => SKIPPED_FOLDERS.has(part))
  );
}

/**
 * @param {unknown} value - Id from the hook input.
 * @param {string} name - Field name, for the error.
 * @returns {string} The id. It is safe to use in a path.
 */
function safeId(value, name) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`hook input has no valid ${name}`);
  }
  return value;
}

/**
 * @param {string} root - Repo root.
 * @returns {Project[]} Rush projects with their workspace dependencies.
 */
export function loadProjects(root) {
  /** @type {{ projects?: { packageName: string, projectFolder: string }[] }} */
  const rush = parseJsonc(readRepositoryFile(root, 'rush.json'));
  const entries = rush.projects ?? [];
  const names = new Set(entries.map((entry) => entry.packageName));
  return entries.map(({ packageName, projectFolder }) => {
    const manifestText = readOptional(path.join(root, projectFolder, 'package.json'));
    /** @type {Record<string, Record<string, string> | undefined>} */
    const manifest = manifestText ? JSON.parse(manifestText) : {};
    const dependencies = [manifest.dependencies, manifest.devDependencies]
      .flatMap((group) => Object.keys(group ?? {}))
      .filter((name) => names.has(name));
    return { packageName, projectFolder, dependencies };
  });
}

/**
 * @param {Project[]} projects - Rush projects.
 * @param {string} file - Repo-relative path.
 * @returns {Project | undefined} The project with the longest folder that holds the file.
 */
export function owningProject(projects, file) {
  return projects
    .filter((project) => file.startsWith(`${project.projectFolder}/`))
    .toSorted((a, b) => b.projectFolder.length - a.projectFolder.length)[0];
}

/**
 * @param {string} root - Repo root.
 * @returns {Set<string>} Repo-relative paths that git shows as changed: modified, added, renamed
 *   or untracked, and not ignored. Deleted files are not in the set.
 */
export function changedFiles(root) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git status failed: ${String(result.error ?? result.stderr)}`);
  }
  const entries = result.stdout.split('\0');
  const changed = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';
    if (entry.length < 4) {
      continue;
    }
    const status = entry.slice(0, 2);
    if (status[0] === 'R' || status[0] === 'C') {
      index += 1; // The next entry is the old path.
    }
    if (!status.includes('D')) {
      changed.add(entry.slice(3));
    }
  }
  return changed;
}

/**
 * @param {string} root - Repo root.
 * @param {string} file - Repo-relative path.
 * @returns {string} sha256 of the content, hex.
 */
function hashFile(root, file) {
  return createHash('sha256')
    .update(readBytes(path.join(root, file)))
    .digest('hex');
}

/**
 * @param {string} file - Absolute path.
 * @returns {Record<string, any>} The JSON object in the file, or {} when it does not exist.
 */
function readRecord(file) {
  const text = readOptional(file);
  return text ? JSON.parse(text) : {};
}

/**
 * @param {string} root - Repo root.
 * @param {string} session - Session id.
 * @returns {string} The state folder of the session.
 */
function sessionFolder(root, session) {
  return path.join(root, STATE, 'gate', session);
}

/**
 * @param {string} root - Repo root.
 * @param {string} session - Session id.
 * @param {string} agent - Agent id, or "main".
 * @returns {string[]} Repo-relative paths that the agent edited.
 */
function readEdits(root, session, agent) {
  const text = readOptional(path.join(sessionFolder(root, session), 'agents', `${agent}.jsonl`));
  return (text ?? '')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

/**
 * @param {string} root - Repo root.
 * @param {string} session - Session id.
 * @returns {string[]} Agent ids with an edit list in the session, "main" included.
 */
function sessionAgents(root, session) {
  return listFolder(path.join(sessionFolder(root, session), 'agents'))
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => name.slice(0, -'.jsonl'.length));
}

/**
 * The edited source files that still differ from git and have no matching verified hash.
 *
 * @param {string} root - Repo root.
 * @param {string[]} edits - Repo-relative paths.
 * @returns {FileState[]} Unverified files, each with its project and current hash.
 */
function unverifiedFiles(root, edits) {
  const sources = [...new Set(edits)].filter((file) => isSourceFile(file));
  if (sources.length === 0) {
    return [];
  }
  const changed = changedFiles(root);
  const projects = loadProjects(root);
  const verified = readRecord(path.join(root, STATE, 'gate', 'verified.json'));
  /** @type {FileState[]} */
  const result = [];
  for (const file of sources) {
    const project = owningProject(projects, file);
    // A reverted, committed or deleted file is not in `changed`. A file outside each Rush
    // project has no test command. The gate skips both.
    if (!changed.has(file) || !project || !exists(path.join(root, file))) {
      continue;
    }
    const digest = hashFile(root, file);
    if (verified[file] !== digest) {
      result.push({ path: file, project, hash: digest });
    }
  }
  return result;
}

/**
 * @param {FileState[]} files - Unverified files.
 * @returns {Map<string, string[]>} Package name to its files.
 */
function byProject(files) {
  const groups = new Map();
  for (const file of files) {
    const list = groups.get(file.project.packageName) ?? [];
    list.push(file.path);
    groups.set(file.project.packageName, list);
  }
  return groups;
}

/**
 * @param {FileState[]} files - Unverified files.
 * @param {boolean} subagent - True for SubagentStop.
 * @returns {string} The block reason.
 */
export function blockReason(files, subagent) {
  const groups = byProject(files);
  const lines = ['Verify gate: these source files have no passing test run.'];
  for (const [name, list] of groups) {
    const shown = list.slice(0, MAX_FILES_SHOWN);
    const more =
      list.length > shown.length ? `, and ${String(list.length - shown.length)} more` : '';
    lines.push(`- ${name}: ${shown.join(', ')}${more}`);
  }
  const only = [...groups.keys()].map((name) => `--only ${name}`).join(' ');
  lines.push(
    `Run: node common/scripts/install-run-rush.js test ${only}`,
    'Run it with no pipe, "||" or ";" after it. The hook gives credit only when Rush exits 0.',
  );
  if (subagent) {
    lines.push(
      'If a check fails and you cannot fix it, report the failing check to the orchestrator in your final message.',
      'Deferral is for the main session only.',
    );
  } else {
    lines.push(`To stop and ask the owner first, run: node ${GATE_SCRIPT} defer "<reason>"`);
  }
  lines.push(
    'This is a hard block. Claude Code ends the turn after 8 blocks in a row with no tool call.',
  );
  return lines.join('\n');
}

/**
 * @param {HookInput} input - Hook input.
 * @returns {boolean} True when a subagent of the main session is still running.
 */
function hasRunningSubagent(input) {
  const tasks = Array.isArray(input.background_tasks) ? input.background_tasks : [];
  return tasks.some(
    (task) =>
      typeof task === 'object' &&
      task !== null &&
      task.type === 'subagent' &&
      task.status === 'running',
  );
}

/**
 * @param {string} root - Repo root.
 * @param {string} file - Edited path from the hook input.
 * @param {unknown} cwd - `cwd` of the hook input.
 * @returns {string | undefined} The repo-relative path, or undefined outside the repo.
 */
function toRepositoryPath(root, file, cwd) {
  const base = typeof cwd === 'string' ? cwd : root;
  const relative = path.relative(root, realPath(path.resolve(base, file)));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return;
  }
  return relative.split(path.sep).join('/');
}

/**
 * @param {HookInput} input - PostToolUse input for an edit tool.
 * @param {Options} options - Options.
 */
function recordEdit(input, options) {
  const session = safeId(input.session_id, 'session_id');
  const agent = input.agent_id === undefined ? 'main' : safeId(input.agent_id, 'agent_id');
  const toolInput = /** @type {Record<string, unknown>} */ (input.tool_input ?? {});
  const file = toolInput.file_path ?? toolInput.notebook_path;
  if (typeof file !== 'string') {
    throw new Error('edit hook input has no tool_input.file_path or notebook_path');
  }
  const relative = toRepositoryPath(options.root, file, input.cwd);
  if (relative) {
    const list = path.join(sessionFolder(options.root, session), 'agents', `${agent}.jsonl`);
    appendText(list, `${JSON.stringify(relative)}\n`);
  }
}

/**
 * @param {string} text - Hook output for the agent.
 * @returns {string} PostToolUse output (JSON) that adds the text to the agent context.
 */
function context(text) {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text },
  });
}

/**
 * @param {HookInput} input - PostToolUse input for the defer command.
 * @param {Options} options - Options.
 * @returns {string} Hook output.
 */
function recordDeferral(input, options) {
  if (input.agent_id !== undefined) {
    return context('stop-gate: a deferral is for the main session only. Nothing was recorded.');
  }
  const session = safeId(input.session_id, 'session_id');
  const response = /** @type {Record<string, unknown>} */ (input.tool_response ?? {});
  const stdout = typeof response.stdout === 'string' ? response.stdout : '';
  const line = stdout.split('\n').find((candidate) => candidate.startsWith(DEFER_MARKER));
  const reason = line?.slice(DEFER_MARKER.length).trim() ?? '';
  if (reason === '') {
    return context('stop-gate: the defer command gave no reason. Nothing was recorded.');
  }
  const edits = sessionAgents(options.root, session).flatMap((agent) =>
    readEdits(options.root, session, agent),
  );
  const files = unverifiedFiles(options.root, edits);
  const projects = [...byProject(files).keys()];
  const hashes = Object.fromEntries(files.map((file) => [file.path, file.hash]));
  const time = (options.now?.() ?? new Date()).toISOString();
  writeAtomic(
    path.join(sessionFolder(options.root, session), 'deferral.json'),
    `${JSON.stringify({ time, reason, projects, hashes }, undefined, 2)}\n`,
  );
  appendText(
    path.join(options.root, STATE, 'deferrals.log'),
    `${[time, session, reason, projects.join(',')].join('\t')}\n`,
  );
  return context(
    `stop-gate: deferral recorded for projects: ${projects.join(', ') || 'none'}. The next code change blocks again.`,
  );
}

/**
 * @param {HookInput} input - PostToolUse input for Bash.
 * @param {Options} options - Options.
 * @returns {string | undefined} Hook output.
 */
function recordProof(input, options) {
  const toolInput = /** @type {Record<string, unknown>} */ (input.tool_input ?? {});
  const command = typeof toolInput.command === 'string' ? toolInput.command : '';
  if (/stop-gate\.mjs['"]?\s+defer\b/.test(command)) {
    return recordDeferral(input, options);
  }
  const { runs, rejected } = findRushRuns(command);
  if (runs.length === 0) {
    return rejected.length > 0
      ? context(`stop-gate: no test proof recorded: ${rejected.join('; ')}.`)
      : undefined;
  }
  const response = /** @type {Record<string, unknown>} */ (input.tool_response ?? {});
  if (toolInput.run_in_background === true || response.interrupted === true) {
    // A background run returns before the tests end, so its exit code proves nothing.
    return context(
      'stop-gate: no test proof recorded: the Rush run is in the background or was interrupted. Run it in the foreground.',
    );
  }
  const projects = loadProjects(options.root);
  const covered = new Set(runs.flatMap((run) => [...coveredProjects(projects, run.selectors)]));
  const file = path.join(options.root, STATE, 'gate', 'verified.json');
  const verified = readRecord(file);
  let count = 0;
  for (const changed of changedFiles(options.root)) {
    const project = owningProject(projects, changed);
    if (
      project &&
      covered.has(project.packageName) &&
      isSourceFile(changed) &&
      exists(path.join(options.root, changed))
    ) {
      verified[changed] = hashFile(options.root, changed);
      count += 1;
    }
  }
  writeAtomic(file, `${JSON.stringify(verified, undefined, 2)}\n`);
  return context(
    `stop-gate: test proof recorded for ${String(count)} changed files in ${[...covered].join(', ') || 'no project'}.`,
  );
}

/**
 * @param {HookInput} input - Stop or SubagentStop input.
 * @param {Options} options - Options.
 * @returns {string | undefined} Hook output, or undefined to allow the stop with no message.
 */
function gate(input, options) {
  const session = safeId(input.session_id, 'session_id');
  const subagent = input.hook_event_name === 'SubagentStop';
  const errors = readOptional(path.join(sessionFolder(options.root, session), 'errors.log'));
  if (errors) {
    const file = path.join(STATE, 'gate', session, 'errors.log');
    return JSON.stringify({
      decision: 'block',
      reason: `Verify gate: a state hook failed, so the edit list can be incomplete.\n${errors.trim()}\nFix the cause, then delete ${file}. The owner can set FACTORY_STOP_GATE=off.`,
    });
  }
  if (subagent && (input.agent_id === undefined || input.agent_id === '')) {
    // Internal agents of Claude Code (prompt suggestions, /btw) can stop with no agent_id.
    // They have no edit list.
    return;
  }
  const agents = subagent
    ? [safeId(input.agent_id, 'agent_id')]
    : sessionAgents(options.root, session);
  const edits = agents.flatMap((agent) => readEdits(options.root, session, agent));
  const files = unverifiedFiles(options.root, edits);
  if (files.length === 0) {
    return;
  }
  if (!subagent) {
    if (hasRunningSubagent(input)) {
      return;
    }
    /** @type {{ reason?: string, hashes?: Record<string, string> }} */
    const deferral = readRecord(path.join(sessionFolder(options.root, session), 'deferral.json'));
    const hashes = deferral.hashes ?? {};
    if (deferral.reason && files.every((file) => hashes[file.path] === file.hash)) {
      const projects = [...byProject(files).keys()].join(', ');
      return JSON.stringify({
        systemMessage: `Verify deferred: ${deferral.reason} (projects: ${projects})`,
      });
    }
  }
  return JSON.stringify({ decision: 'block', reason: blockReason(files, subagent) });
}

/**
 * Handles one hook input.
 *
 * @param {string} text - Hook input (JSON from stdin).
 * @param {Options} options - Options.
 * @returns {string | undefined} Hook output (JSON), or undefined for no output.
 */
export function handle(text, options) {
  if (options.env.FACTORY_STOP_GATE === 'off') {
    return;
  }
  /** @type {HookInput} */
  const input = JSON.parse(text);
  if (typeof input !== 'object' || input === null || typeof input.hook_event_name !== 'string') {
    throw new Error('hook input has no hook_event_name');
  }
  const root = realPath(options.root);
  const resolved = { ...options, root };
  const event = input.hook_event_name;
  if (event === 'Stop' || event === 'SubagentStop') {
    return gate(input, resolved);
  }
  if (event !== 'PostToolUse') {
    return;
  }
  try {
    if (EDIT_TOOLS.has(String(input.tool_name))) {
      recordEdit(input, resolved);
      return;
    }
    if (input.tool_name === 'Bash') {
      return recordProof(input, resolved);
    }
  } catch (error) {
    // A state hook that fails would let the gate allow a stop with missing state. Mark it.
    if (typeof input.session_id === 'string' && SAFE_ID.test(input.session_id)) {
      appendText(
        path.join(sessionFolder(root, input.session_id), 'errors.log'),
        `${String(input.tool_name)}: ${String(error)}\n`,
      );
    }
    throw error;
  }
  return;
}
