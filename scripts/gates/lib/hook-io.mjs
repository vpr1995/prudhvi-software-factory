import { readStdin } from './fs-io.mjs';
import { startDirectory } from './gates.config.mjs';
import { repositoryRoot } from './git-state.mjs';

export const BLOCK_EXIT_CODE = 2;
const WARNING_EXIT_CODE = 1;

/**
 * @typedef {object} HookContext
 * @property {Record<string, any>} payload - The JSON the hook got on stdin ({} when empty).
 * @property {string} root - Repo root.
 * @property {string} cwd - Working folder of the tool call.
 * @property {boolean} parsed - False when stdin was not valid JSON.
 */

/**
 * @typedef {object} HookResult
 * @property {number} [exitCode] - 0 allow, 2 block.
 * @property {string} [stderr] - Text for Claude (shown on exit 2) or for the user.
 * @property {string} [stdout] - Text or JSON for stdout.
 */

/**
 * Reads and parses the hook input.
 *
 * @param {boolean} [readInput] - False to skip stdin (a command-line run, not a hook call).
 * @returns {HookContext} Context for the hook.
 */
export function readContext(readInput = true) {
  const raw = readInput ? readStdin() : '';
  let payload = {};
  let parsed = true;
  if (raw.trim() !== '') {
    try {
      const value = JSON.parse(raw);
      payload = value !== null && typeof value === 'object' ? value : {};
    } catch {
      parsed = false;
    }
  }
  const cwd = typeof payload['cwd'] === 'string' ? payload['cwd'] : process.cwd();
  return { payload, root: repositoryRoot(startDirectory(cwd)), cwd, parsed };
}

/**
 * Runs a hook function and turns its result into stdout, stderr and the exit code.
 * An unexpected error blocks (fail closed) for gate hooks and warns for the others.
 *
 * @param {(context: HookContext) => HookResult | undefined} hook - The hook logic.
 * @param {{ failClosed: boolean, name: string, readInput?: boolean }} options - Behavior on an internal error, and whether to read stdin.
 * @returns {void}
 */
export function runHook(hook, options) {
  /** @type {HookResult} */
  let result;
  try {
    result = hook(readContext(options.readInput ?? true)) ?? {};
  } catch (error) {
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
    result = {
      exitCode: options.failClosed ? BLOCK_EXIT_CODE : WARNING_EXIT_CODE,
      stderr: `${options.name} hook crashed. ${options.failClosed ? 'The action is blocked until a human fixes the hook.' : 'The check was skipped.'}\n${text}\n`,
    };
  }
  if (result.stdout !== undefined && result.stdout !== '') {
    process.stdout.write(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
  }
  if (result.stderr !== undefined && result.stderr !== '') {
    process.stderr.write(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
  }
  process.exitCode = result.exitCode ?? 0;
}

/**
 * Makes a blocking result.
 *
 * @param {string} message - Text Claude reads.
 * @returns {HookResult} A result with exit code 2.
 */
export function blockWith(message) {
  return { exitCode: BLOCK_EXIT_CODE, stderr: message };
}

/**
 * Makes a result that adds context for Claude (PostToolUse and UserPromptSubmit).
 *
 * @param {string} eventName - Hook event name, for example `PostToolUse`.
 * @param {string} text - The context.
 * @returns {HookResult} A result with JSON on stdout.
 */
export function addContext(eventName, text) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
    }),
  };
}

/**
 * Gets the file paths a file-editing tool call touches.
 *
 * @param {Record<string, any>} payload - Hook input.
 * @returns {string[]} Paths as written in the tool input.
 */
export function editedPaths(payload) {
  const input = payload['tool_input'];
  if (input === null || typeof input !== 'object') {
    return [];
  }
  return ['file_path', 'notebook_path', 'path']
    .map((field) => input[field])
    .filter((value) => typeof value === 'string' && value !== '');
}

/**
 * Collects the text a file-editing tool call will write.
 *
 * @param {Record<string, any>} payload - Hook input.
 * @returns {string[]} Texts: Write `content`, Edit `new_string`, MultiEdit `edits[].new_string`, NotebookEdit `new_source`.
 */
export function proposedTexts(payload) {
  const input = payload['tool_input'];
  if (input === null || typeof input !== 'object') {
    return [];
  }
  const direct = ['content', 'new_string', 'new_source']
    .map((field) => input[field])
    .filter((value) => typeof value === 'string');
  const edits = Array.isArray(input['edits']) ? input['edits'] : [];
  const fromEdits = edits
    .map((edit) => (edit !== null && typeof edit === 'object' ? edit['new_string'] : undefined))
    .filter((value) => typeof value === 'string');
  return [...direct, ...fromEdits];
}

/**
 * Cuts text to a number of lines.
 *
 * @param {string} text - Text.
 * @param {number} maxLines - Line limit.
 * @returns {string} The first lines, plus a note when text was cut.
 */
export function clipLines(text, maxLines) {
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return text.trimEnd();
  }
  return `${lines.slice(0, maxLines).join('\n')}\n... (${String(lines.length - maxLines)} more lines)`;
}

const ESCAPE = String.fromCodePoint(27);

/**
 * Removes terminal color codes.
 *
 * @param {string} text - Text with ANSI codes.
 * @returns {string} Plain text.
 */
export function stripAnsi(text) {
  return text
    .split(ESCAPE)
    .map((part, index) => (index === 0 ? part : part.replace(/^\[[0-9;]*[A-Za-z]/, '')))
    .join('');
}
