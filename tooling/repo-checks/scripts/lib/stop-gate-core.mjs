// Verify gate (design 6.6.1). One handler for the Claude Code hook events:
// - PostToolUse on Edit, Write, MultiEdit, NotebookEdit: record the edited file for the agent.
// - PreToolUse on Bash: store the hash of each changed source file. PostToolUse and
//   PostToolUseFailure on Bash: record each source file whose hash changed for the agent. Writers
//   run one at a time, so the time window of the command tells which agent changed the file.
// - PostToolUse on Bash: after a passing `rush test` or `rush verify`, store the hash of each
//   covered source file that the command did not change. Also record a deferral of the main session.
// - PostToolUseFailure on Bash: record a failed `rush test` or `rush verify` for the agent.
// - Stop and SubagentStop: block while an edited source file has no stored hash that matches.
// "Changed" means: different from the commit at the first hook call of the session (the session
// base), or untracked. So a commit or a stash does not hide an edit.
// The handler runs no tests and no Rush command. It reads state, runs git and hashes files.
import path from 'node:path';

import {
  appendText,
  exists,
  listFolder,
  readOptional,
  realPath,
  removeFile,
  writeAtomic,
} from './fs-io.mjs';
import { coveredProjects, findRushRuns } from './stop-gate-command.mjs';
import { blockReason, byProject } from './stop-gate-messages.mjs';
import {
  candidateFiles,
  changedFromBase,
  git,
  hashFile,
  isSourceFile,
  loadProjects,
  owningProject,
} from './stop-gate-repo.mjs';

const DEFER_MARKER = 'stop-gate: deferral requested: ';
const STATE = '.claude/state';
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SAFE_ID = /^[\w-]{1,128}$/;
const MAX_COMMAND_SHOWN = 300;

/**
 * @typedef {import('./stop-gate-command.mjs').Project} Project
 * @typedef {{ root: string, env: Record<string, string | undefined>, now?: () => Date }} Options
 * @typedef {{ path: string, project: Project | undefined, hash: string }} FileState
 * @typedef {Record<string, unknown>} HookInput
 * @typedef {Record<string, string>} Hashes
 */

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
 * @param {HookInput} input - Hook input.
 * @returns {string} The agent id, or "main" for the main session.
 */
function agentOf(input) {
  return input.agent_id === undefined ? 'main' : safeId(input.agent_id, 'agent_id');
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
 * Reads the session base. With `create`, stores HEAD as the base when the session has none.
 *
 * @param {string} root - Repo root.
 * @param {string} session - Session id.
 * @param {boolean} create - True to store HEAD when there is no base.
 * @returns {string | undefined} The base commit, or undefined (no base, or no commit yet).
 */
function sessionBase(root, session, create) {
  const file = path.join(sessionFolder(root, session), 'base');
  const stored = readOptional(file);
  if (stored !== undefined || !create) {
    return stored?.trim() || undefined;
  }
  const head = git(root, ['rev-parse', '--verify', '-q', 'HEAD']);
  const base = head.ok ? head.stdout.trim() : '';
  writeAtomic(file, `${base}\n`);
  return base || undefined;
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
 * The edited source files that differ from the session base and have no matching verified hash.
 * A file outside each Rush project is unverified with `project: undefined`.
 *
 * @param {string} root - Repo root.
 * @param {string} session - Session id.
 * @param {string[]} edits - Repo-relative paths.
 * @returns {FileState[]} Unverified files, each with its project and current hash.
 */
function unverifiedFiles(root, session, edits) {
  const sources = [...new Set(edits)].filter((file) => isSourceFile(file));
  if (sources.length === 0) {
    return [];
  }
  const changed = changedFromBase(root, sessionBase(root, session, false));
  const projects = loadProjects(root);
  const verified = readRecord(path.join(root, STATE, 'gate', 'verified.json'));
  /** @type {FileState[]} */
  const result = [];
  for (const file of sources) {
    // A reverted or deleted file has nothing to test.
    if (!changed.has(file) || !exists(path.join(root, file))) {
      continue;
    }
    const digest = hashFile(root, file);
    if (verified[file] !== digest) {
      result.push({ path: file, project: owningProject(projects, file), hash: digest });
    }
  }
  return result;
}

/**
 * @param {HookInput} input - Hook input.
 * @returns {string[]} Ids of the subagents of the main session that still run.
 */
function runningSubagents(input) {
  const tasks = Array.isArray(input.background_tasks) ? input.background_tasks : [];
  return tasks
    .filter(
      (task) =>
        typeof task === 'object' &&
        task !== null &&
        task.type === 'subagent' &&
        task.status === 'running' &&
        typeof task.id === 'string' &&
        SAFE_ID.test(task.id),
    )
    .map((task) => task.id);
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
 * @param {{ root: string, session: string, agent: string }} owner - Repo root, session id, and
 *   agent id or "main".
 * @param {string[]} files - Repo-relative paths to add to the edit list of the agent.
 */
function addEdits({ root, session, agent }, files) {
  if (files.length > 0) {
    const list = path.join(sessionFolder(root, session), 'agents', `${agent}.jsonl`);
    appendText(list, files.map((file) => `${JSON.stringify(file)}\n`).join(''));
  }
}

/**
 * @param {HookInput} input - PostToolUse input for an edit tool.
 * @param {Options} options - Options.
 */
function recordEdit(input, options) {
  const session = safeId(input.session_id, 'session_id');
  const agent = agentOf(input);
  const toolInput = /** @type {Record<string, unknown>} */ (input.tool_input ?? {});
  const file = toolInput.file_path ?? toolInput.notebook_path;
  if (typeof file !== 'string') {
    throw new Error('edit hook input has no tool_input.file_path or notebook_path');
  }
  const relative = toRepositoryPath(options.root, file, input.cwd);
  if (relative) {
    sessionBase(options.root, session, true);
    addEdits({ root: options.root, session, agent }, [relative]);
  }
}

/**
 * @param {string} root - Repo root.
 * @param {string | undefined} base - Session base commit, or undefined.
 * @returns {Hashes} Hash of each candidate source file that exists.
 */
function snapshot(root, base) {
  return Object.fromEntries(
    [...candidateFiles(root, base)]
      .filter((file) => isSourceFile(file) && exists(path.join(root, file)))
      .map((file) => [file, hashFile(root, file)]),
  );
}

/**
 * @param {HookInput} input - Bash hook input.
 * @param {string} root - Repo root.
 * @returns {string} Path of the snapshot file for this tool call.
 */
function snapshotFile(input, root) {
  const session = safeId(input.session_id, 'session_id');
  const call = safeId(input.tool_use_id, 'tool_use_id');
  return path.join(sessionFolder(root, session), 'bash', `${call}.json`);
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
 * @param {HookInput} input - Bash hook input.
 * @returns {string} The command text.
 */
function commandOf(input) {
  const toolInput = /** @type {Record<string, unknown>} */ (input.tool_input ?? {});
  return typeof toolInput.command === 'string' ? toolInput.command : '';
}

/**
 * @param {HookInput} input - Bash hook input.
 * @returns {boolean} True when the run is in the background or was interrupted.
 */
function isIncomplete(input) {
  const toolInput = /** @type {Record<string, unknown>} */ (input.tool_input ?? {});
  const response = /** @type {Record<string, unknown>} */ (input.tool_response ?? {});
  return (
    toolInput.run_in_background === true ||
    response.interrupted === true ||
    input.is_interrupt === true
  );
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
  const files = unverifiedFiles(options.root, session, edits);
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
 * PostToolUse on Bash: after a passing Rush run, store the hash of each covered source file that
 * has the same content before and after the command. A file that the command changed or made
 * gets no credit, because the tests can have run before the change.
 *
 * @param {HookInput} input - PostToolUse input for Bash.
 * @param {Options} options - Options.
 * @param {{ before: Hashes | undefined, after: Hashes }} hashes - Snapshots around the command.
 * @returns {string | undefined} Hook output.
 */
function recordProof(input, options, { before, after }) {
  const command = commandOf(input);
  if (/stop-gate\.mjs['"]?\s+defer\b/.test(command)) {
    return recordDeferral(input, options);
  }
  const { runs, rejected } = findRushRuns(command);
  if (runs.length === 0) {
    return rejected.length > 0
      ? context(`stop-gate: no test proof recorded: ${rejected.join('; ')}.`)
      : undefined;
  }
  if (isIncomplete(input)) {
    return context(
      'stop-gate: no test proof recorded: the Rush run is in the background or was interrupted. Run it in the foreground.',
    );
  }
  if (!before) {
    return context('stop-gate: no test proof recorded: no file hashes from before the command.');
  }
  const projects = loadProjects(options.root);
  const covered = new Set(runs.flatMap((run) => [...coveredProjects(projects, run.selectors)]));
  const file = path.join(options.root, STATE, 'gate', 'verified.json');
  const verified = readRecord(file);
  let count = 0;
  for (const [changed, digest] of Object.entries(after)) {
    const project = owningProject(projects, changed);
    if (project && covered.has(project.packageName) && before[changed] === digest) {
      verified[changed] = digest;
      count += 1;
    }
  }
  writeAtomic(file, `${JSON.stringify(verified, undefined, 2)}\n`);
  return context(
    `stop-gate: test proof recorded for ${String(count)} changed files in ${[...covered].join(', ') || 'no project'}.`,
  );
}

/**
 * PostToolUseFailure on Bash: store a failed Rush run of the agent, with the hashes of its
 * unverified files. A subagent can stop with this record (design 6.6.1, hard block).
 *
 * @param {HookInput} input - PostToolUseFailure input for Bash.
 * @param {Options} options - Options.
 */
function recordFailure(input, options) {
  const command = commandOf(input);
  const { runs } = findRushRuns(command, true);
  if (runs.length === 0 || isIncomplete(input)) {
    return;
  }
  const session = safeId(input.session_id, 'session_id');
  const agent = agentOf(input);
  const projects = loadProjects(options.root);
  const covered = [
    ...new Set(runs.flatMap((run) => [...coveredProjects(projects, run.selectors)])),
  ];
  const files = unverifiedFiles(options.root, session, readEdits(options.root, session, agent));
  const hashes = Object.fromEntries(files.map((file) => [file.path, file.hash]));
  writeAtomic(
    path.join(sessionFolder(options.root, session), 'failures', `${agent}.json`),
    `${JSON.stringify({ command: command.slice(0, MAX_COMMAND_SHOWN), projects: covered, hashes }, undefined, 2)}\n`,
  );
}

/**
 * PostToolUse or PostToolUseFailure on Bash: add each source file that the command changed or
 * made to the edit list of the agent (a failed command can also change files). Then record the
 * proof or the failure. Then delete the snapshot.
 *
 * @param {HookInput} input - Hook input.
 * @param {Options} options - Options.
 * @returns {string | undefined} Hook output.
 */
function afterBash(input, options) {
  const session = safeId(input.session_id, 'session_id');
  const file = snapshotFile(input, options.root);
  const text = readOptional(file);
  /** @type {Hashes | undefined} */
  const before = text === undefined ? undefined : JSON.parse(text);
  const after = snapshot(options.root, sessionBase(options.root, session, true));
  if (before) {
    const changed = Object.keys(after).filter((name) => before[name] !== after[name]);
    addEdits({ root: options.root, session, agent: agentOf(input) }, changed);
  }
  let output;
  if (input.hook_event_name === 'PostToolUse') {
    output = recordProof(input, options, { before, after });
  } else {
    recordFailure(input, options);
  }
  removeFile(file);
  return output;
}

/**
 * @param {string} session - Session id.
 * @param {string} errors - Text of errors.log.
 * @returns {string} Block output for a failed state hook.
 */
function errorBlock(session, errors) {
  const file = path.join(STATE, 'gate', session, 'errors.log');
  return JSON.stringify({
    decision: 'block',
    reason: `Verify gate: a state hook failed, so the edit list can be incomplete.\n${errors.trim()}\nDo not change ${file}. Stop and report this error to the owner in your final message. The owner fixes the cause or sets FACTORY_STOP_GATE=off.`,
  });
}

/**
 * @param {HookInput} input - SubagentStop input.
 * @param {Options} options - Options.
 * @param {string} session - Session id.
 * @returns {string | undefined} Hook output.
 */
function subagentGate(input, options, session) {
  if (input.agent_id === undefined || input.agent_id === '') {
    // Internal agents of Claude Code (prompt suggestions, /btw) can stop with no agent_id.
    // They have no edit list.
    return;
  }
  const agent = safeId(input.agent_id, 'agent_id');
  const files = unverifiedFiles(options.root, session, readEdits(options.root, session, agent));
  if (files.length === 0) {
    return;
  }
  /** @type {{ command?: string, projects?: string[], hashes?: Hashes }} */
  const failure = readRecord(
    path.join(sessionFolder(options.root, session), 'failures', `${agent}.json`),
  );
  const failed = failure.projects ?? [];
  const hashes = failure.hashes ?? {};
  const reported = files.every(
    (file) =>
      file.project !== undefined &&
      failed.includes(file.project.packageName) &&
      hashes[file.path] === file.hash,
  );
  if (failure.command && reported) {
    const projects = [...byProject(files).keys()].join(', ');
    return JSON.stringify({
      systemMessage: `Subagent stopped with failing check: ${failure.command} (projects: ${projects})`,
    });
  }
  return JSON.stringify({ decision: 'block', reason: blockReason(files, true) });
}

/**
 * @param {HookInput} input - Stop input.
 * @param {Options} options - Options.
 * @param {string} session - Session id.
 * @returns {string | undefined} Hook output.
 */
function mainGate(input, options, session) {
  const edits = sessionAgents(options.root, session).flatMap((agent) =>
    readEdits(options.root, session, agent),
  );
  const files = unverifiedFiles(options.root, session, edits);
  if (files.length === 0) {
    return;
  }
  // The orchestrator waits for writers: allow when a running subagent owns each unverified file.
  const owned = new Set(
    runningSubagents(input).flatMap((agent) => readEdits(options.root, session, agent)),
  );
  if (files.every((file) => owned.has(file.path))) {
    return;
  }
  /** @type {{ reason?: string, hashes?: Hashes }} */
  const deferral = readRecord(path.join(sessionFolder(options.root, session), 'deferral.json'));
  const hashes = deferral.hashes ?? {};
  if (deferral.reason && files.every((file) => hashes[file.path] === file.hash)) {
    const projects = [...byProject(files).keys()].join(', ');
    return JSON.stringify({
      systemMessage: `Verify deferred: ${deferral.reason} (projects: ${projects})`,
    });
  }
  return JSON.stringify({ decision: 'block', reason: blockReason(files, false) });
}

/**
 * @param {HookInput} input - Stop or SubagentStop input.
 * @param {Options} options - Options.
 * @returns {string | undefined} Hook output, or undefined to allow the stop with no message.
 */
function gate(input, options) {
  const session = safeId(input.session_id, 'session_id');
  const errors = readOptional(path.join(sessionFolder(options.root, session), 'errors.log'));
  if (errors) {
    return errorBlock(session, errors);
  }
  return input.hook_event_name === 'SubagentStop'
    ? subagentGate(input, options, session)
    : mainGate(input, options, session);
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
  try {
    return dispatchToolEvent(input, resolved);
  } catch (error) {
    // A state hook that fails would let the gate allow a stop with missing state. Mark it.
    if (typeof input.session_id === 'string' && SAFE_ID.test(input.session_id)) {
      appendText(
        path.join(sessionFolder(root, input.session_id), 'errors.log'),
        `${event} ${String(input.tool_name)}: ${String(error)}\n`,
      );
    }
    if (event === 'PreToolUse') {
      return; // Never block a command. The stop blocks on errors.log.
    }
    throw error;
  }
}

/**
 * @param {HookInput} input - Tool hook input.
 * @param {Options} options - Options with the real repo root.
 * @returns {string | undefined} Hook output.
 */
function dispatchToolEvent(input, options) {
  const event = input.hook_event_name;
  if (input.tool_name === 'Bash') {
    if (event === 'PreToolUse') {
      const session = safeId(input.session_id, 'session_id');
      const base = sessionBase(options.root, session, true);
      writeAtomic(snapshotFile(input, options.root), JSON.stringify(snapshot(options.root, base)));
      return;
    }
    if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
      return afterBash(input, options);
    }
    return;
  }
  if (event === 'PostToolUse' && EDIT_TOOLS.has(String(input.tool_name))) {
    recordEdit(input, options);
  }
  return;
}
