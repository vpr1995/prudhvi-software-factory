// Claude Code PostToolUse hook (.claude/settings.json). It runs ESLint and tsc for one edited file.
// It reports and never blocks: the exit code is always 0. With findings, it writes one JSON object
// with hookSpecificOutput.additionalContext to stdout, so the agent sees them. Without findings, it
// writes nothing.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { exists, readText } from './fs-io.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const LINTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', '.next', 'coverage', 'cdk.out']);
const TOOL_TIMEOUT_MS = 30_000;
const MAX_LINES = 20;

/**
 * @param {string} text - Hook input (JSON from stdin).
 * @returns {string | undefined} `tool_input.file_path`, when it is a string.
 */
export function readFilePath(text) {
  try {
    const filePath = JSON.parse(text)?.tool_input?.file_path;
    return typeof filePath === 'string' ? filePath : undefined;
  } catch {
    return;
  }
}

/**
 * @param {string} filePath - Path of the edited file.
 * @returns {boolean} True for a source file that is not generated or ignored.
 */
export function isLintable(filePath) {
  if (!LINTED_EXTENSIONS.has(path.extname(filePath))) {
    return false;
  }
  return !filePath.split(/[/\\]/).some((part) => SKIPPED_FOLDERS.has(part));
}

/**
 * Reads the project folders from rush.json. rush.json has comments, so a regex reads it.
 *
 * @param {string} rushJson - Text of rush.json.
 * @returns {string[]} Project folders, relative to the repo root.
 */
export function readProjectFolders(rushJson) {
  return [...rushJson.matchAll(/"projectFolder"\s*:\s*"([^"]+)"/g)].map((match) => match[1] ?? '');
}

/**
 * @param {string} repositoryRoot - Absolute repo root.
 * @param {string} filePath - Absolute path of the edited file.
 * @param {string[]} folders - Rush project folders, relative to the repo root.
 * @returns {string | undefined} The project folder (relative) that holds the file.
 */
export function findProject(repositoryRoot, filePath, folders) {
  const relative = path.relative(repositoryRoot, filePath).split(path.sep).join('/');
  return folders
    .filter((folder) => relative.startsWith(`${folder}/`))
    .toSorted((a, b) => b.length - a.length)[0];
}

/**
 * Finds the nearest tsconfig.json, from the folder of the file up to the project folder.
 *
 * @param {string} projectDirectory - Absolute project folder.
 * @param {string} filePath - Absolute path of the edited file.
 * @param {(file: string) => boolean} fileExists - File check.
 * @returns {string | undefined} The absolute tsconfig path.
 */
export function findTsconfig(projectDirectory, filePath, fileExists) {
  let folder = path.dirname(filePath);
  while (folder.startsWith(projectDirectory)) {
    const candidate = path.join(folder, 'tsconfig.json');
    if (fileExists(candidate)) {
      return candidate;
    }
    if (folder === projectDirectory) {
      return;
    }
    folder = path.dirname(folder);
  }
  return;
}

/**
 * @param {string[]} lines - Lines.
 * @returns {string[]} At most MAX_LINES lines, with a count of the lines left out.
 */
function cap(lines) {
  if (lines.length <= MAX_LINES) {
    return lines;
  }
  return [...lines.slice(0, MAX_LINES), `... ${String(lines.length - MAX_LINES)} more`];
}

/**
 * @typedef {{ line?: number, column?: number, severity: number, message: string, ruleId?: string | null }} EslintMessage
 * @typedef {{ filePath: string, messages: EslintMessage[] }} EslintResult
 */

/**
 * Turns `eslint --format json` output into one line for each message.
 *
 * @param {string} json - ESLint stdout.
 * @param {string} repositoryRoot - Absolute repo root. Paths in the lines are relative to it.
 * @returns {string[]} Lines like `src/a.ts:3:7 error Message (rule-id)`.
 */
export function formatEslint(json, repositoryRoot) {
  /** @type {EslintResult[]} */
  const results = JSON.parse(json);
  const lines = results.flatMap((result) =>
    result.messages.map((message) => {
      const file = path.relative(repositoryRoot, result.filePath);
      const kind = message.severity === 2 ? 'error' : 'warning';
      const rule = message.ruleId ? ` (${message.ruleId})` : '';
      return `${file}:${String(message.line ?? 0)}:${String(message.column ?? 0)} ${kind} ${message.message}${rule}`;
    }),
  );
  return cap(lines);
}

/**
 * Keeps the error lines of `tsc --pretty false`. All files count: an edit can break an importer.
 *
 * @param {string} output - tsc stdout.
 * @returns {string[]} Error lines.
 */
export function formatTsc(output) {
  return cap(output.split('\n').filter((line) => /\berror TS\d+:/.test(line)));
}

/**
 * @param {string} file - Edited file, relative to the repo root.
 * @param {{ eslint: string[], tsc: string[] }} findings - Lines from each tool.
 * @returns {string | undefined} The feedback text, or undefined when there is nothing to report.
 */
export function buildFeedback(file, findings) {
  const sections = [];
  if (findings.eslint.length > 0) {
    sections.push(`ESLint findings:\n${findings.eslint.join('\n')}`);
  }
  if (findings.tsc.length > 0) {
    sections.push(`TypeScript findings:\n${findings.tsc.join('\n')}`);
  }
  if (sections.length === 0) {
    return;
  }
  return [`lint-on-edit found problems after the edit of ${file}.`, ...sections].join('\n\n');
}

/**
 * @param {string} bin - Absolute tool path.
 * @param {string[]} args - Tool arguments.
 * @param {string} cwd - Working folder.
 * @returns {{ status: number | null, stdout: string, problem?: string }} The result. `problem`
 *   is set when the tool did not start or did not finish in time.
 */
function runTool(bin, args, cwd) {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    timeout: TOOL_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  const name = path.basename(bin);
  if (result.error) {
    const code = /** @type {NodeJS.ErrnoException} */ (result.error).code;
    const problem =
      code === 'ETIMEDOUT'
        ? `${name} did not finish in ${String(TOOL_TIMEOUT_MS / 1000)} s. Findings are unknown.`
        : `${name} did not run (${String(code ?? result.error.message)}).`;
    return { status: null, stdout: '', problem };
  }
  return { status: result.status, stdout: result.stdout };
}

/**
 * @param {string} projectDirectory - Absolute project folder.
 * @param {string} filePath - Absolute path of the edited file.
 * @returns {string[]} ESLint lines.
 */
function runEslint(projectDirectory, filePath) {
  const bin = path.join(projectDirectory, 'node_modules', '.bin', 'eslint');
  const cache = path.join(projectDirectory, 'node_modules', '.cache', 'eslint-on-edit');
  const args = ['--cache', '--cache-location', cache, '--format', 'json', '--no-warn-ignored'];
  const result = runTool(bin, [...args, filePath], projectDirectory);
  if (result.problem) {
    return [result.problem];
  }
  // Exit 0: no errors. Exit 1: findings. Exit 2: ESLint crashed (bad config, parse error).
  if (result.status === 2 || result.stdout.trim() === '') {
    return [`eslint stopped with exit code ${String(result.status)}.`];
  }
  return formatEslint(result.stdout, REPO_ROOT);
}

/**
 * @param {string} projectDirectory - Absolute project folder.
 * @param {string} filePath - Absolute path of the edited file.
 * @returns {string[]} tsc error lines.
 */
function runTsc(projectDirectory, filePath) {
  const tsconfig = findTsconfig(projectDirectory, filePath, exists);
  if (!tsconfig) {
    return [];
  }
  const bin = path.join(projectDirectory, 'node_modules', '.bin', 'tsc');
  const result = runTool(bin, ['--noEmit', '--pretty', 'false', '-p', tsconfig], REPO_ROOT);
  return result.problem ? [result.problem] : formatTsc(result.stdout);
}

/**
 * Runs the hook for one input.
 *
 * @param {string} input - Hook input (JSON from stdin).
 * @returns {string | undefined} The hook output (JSON), or undefined to stay silent.
 */
export function run(input) {
  const filePath = readFilePath(input);
  if (!filePath || !path.isAbsolute(filePath) || !isLintable(filePath)) {
    return;
  }
  const folder = findProject(
    REPO_ROOT,
    filePath,
    readProjectFolders(readText(path.join(REPO_ROOT, 'rush.json'))),
  );
  if (!folder || !exists(filePath)) {
    return;
  }
  const projectDirectory = path.join(REPO_ROOT, folder);
  const feedback = buildFeedback(path.relative(REPO_ROOT, filePath), {
    eslint: runEslint(projectDirectory, filePath),
    tsc: runTsc(projectDirectory, filePath),
  });
  if (!feedback) {
    return;
  }
  return toHookOutput(feedback);
}

/**
 * @param {string} text - Text for the agent.
 * @returns {string} PostToolUse hook output (JSON) that adds the text to the agent context.
 */
export function toHookOutput(text) {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text },
  });
}

if (import.meta.main) {
  let output;
  try {
    output = run(readText('/dev/stdin'));
  } catch (error) {
    // Fail loudly, but never block the edit.
    output = toHookOutput(`lint-on-edit did not run: ${String(error)}`);
  }
  if (output) {
    process.stdout.write(`${output}\n`);
  }
  process.exitCode = 0;
}
