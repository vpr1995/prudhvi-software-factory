// Builders for the gate fixtures: setup steps, gate commands and expectations. The fixture lists
// (gate-fixtures-*.mjs) use these, so each fixture is a few lines of data.
//
// Bad snippets are built at run time with `join`. A literal such as a skipped test, a disable
// comment or a secret in a source file would trip the scanners (anti-skip, gitleaks, Opengrep)
// that scan the gate scripts themselves.

/**
 * Joins text parts. It hides a bad snippet from the scanners that read this source file.
 *
 * @param {...string} parts - The parts.
 * @returns {string} The text.
 */
export function join(...parts) {
  return parts.join('');
}

/**
 * Turns camelCase keys into snake_case keys, deeply. The hook input of Claude Code uses snake_case.
 *
 * @param {unknown} value - A value built with camelCase keys.
 * @returns {unknown} The same value with snake_case keys.
 */
function toHookInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => toHookInput(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        toHookInput(item),
      ]),
    );
  }
  return value;
}

/**
 * The shape of a rejection: the exit code and the text that must be in the output.
 *
 * @param {(RegExp | string)[]} match - Patterns, or strings that the output must contain. The first one is shown in the report.
 * @param {number | 'nonzero'} [status] - Exit code. Default: any non-zero code.
 * @returns {{ status: number | 'nonzero', match: (RegExp | string)[] }} The expectation.
 */
export function rejects(match, status = 'nonzero') {
  return { status, match };
}

/**
 * The shape of an acceptance (a control): exit 0, a sentinel that proves the gate really ran on the
 * clean change, and text that must not be in the output.
 *
 * @param {(RegExp | string)[]} match - The sentinel patterns. The first one is shown in the report.
 * @param {(RegExp | string)[]} [absent] - Patterns that the output must not contain.
 * @returns {{ status: 0, match: (RegExp | string)[], absent: (RegExp | string)[] }} The expectation.
 */
export function accepts(match, absent = []) {
  return { status: 0, match, absent };
}

export const write = (path, text) => ({ type: 'write', path, text });
export const append = (path, text) => ({ type: 'append', path, text });
export const replace = (path, find, text) => ({ type: 'replace', path, find, text });
export const removeTracked = (directory, suffix) => ({ type: 'removeTracked', directory, suffix });
export const addDependency = (name, value) => ({
  type: 'addDependency',
  path: 'projects/sample/package.json',
  section: 'dependencies',
  name,
  value,
});
export const commit = (message) => ({ type: 'commit', message });
export const stage = (...paths) => ({ type: 'stage', paths });
export const sessionBase = () => ({ type: 'sessionBase' });
export const rewind = (count) => ({ type: 'rewind', count });
export const resetTo = (ref) => ({ type: 'resetTo', ref });

/**
 * Builds the call of a Claude hook wrapper, the way Claude Code calls it: JSON on stdin and
 * CLAUDE_PROJECT_DIR set. The wrapper comes from the main tree. The repo it works on is the worktree.
 *
 * @param {string} name - Hook name without `.sh`.
 * @param {(variables: Record<string, string>) => Record<string, unknown>} payload - Builds the tool part of the input.
 * @returns {import('./gate-fixtures-run.mjs').RunSpec} The run spec.
 */
export function hook(name, payload) {
  return {
    program: 'bash',
    args: [`{main}/.claude/hooks/${name}.sh`],
    env: { CLAUDE_PROJECT_DIR: '{worktree}' },
    input: (variables) =>
      JSON.stringify(
        toHookInput({
          cwd: variables['worktree'],
          hookEventName: 'PreToolUse',
          ...payload(variables),
        }),
      ),
  };
}

/**
 * A hook call for a Bash command.
 *
 * @param {string} name - Hook name.
 * @param {string} command - The command line the agent wants to run.
 * @returns {import('./gate-fixtures-run.mjs').RunSpec} The run spec.
 */
export function bashHook(name, command) {
  return hook(name, () => ({ toolName: 'Bash', toolInput: { command } }));
}

/**
 * A hook call for a Bash command, then the command itself when the hook allows it (exit 0), the
 * way Claude Code runs it. A control uses it: the output of the command proves that it ran.
 *
 * @param {string} name - Hook name.
 * @param {string} command - The command line. It runs in the worktree, with no stdin.
 * @returns {import('./gate-fixtures-run.mjs').RunSpec} The run spec.
 */
export function bashHookThenRun(name, command) {
  const call = bashHook(name, command);
  return {
    ...call,
    args: [
      '-c',
      'bash "$1" || exit "$?"; bash -c "$2" </dev/null',
      'gate-fixtures',
      ...(call.args ?? []),
      command,
    ],
  };
}

/**
 * A hook call for a file edit.
 *
 * @param {string} name - Hook name.
 * @param {{ tool: 'Write' | 'Edit', file: string, text: string }} edit - The edit: `file` is relative to the repo root.
 * @returns {import('./gate-fixtures-run.mjs').RunSpec} The run spec.
 */
export function editHook(name, edit) {
  return hook(name, (variables) => {
    const file = `${variables['worktree']}/${edit.file}`;
    return {
      toolName: edit.tool,
      toolInput:
        edit.tool === 'Write'
          ? { filePath: file, content: edit.text }
          : { filePath: file, oldString: 'a', newString: edit.text },
    };
  });
}

/**
 * The call of a script in scripts/gates (from the main tree), with the worktree as its repo.
 *
 * @param {string} script - File name in scripts/gates.
 * @param {string[]} args - Arguments. Use `{worktree}` and `{base}`.
 * @returns {import('./gate-fixtures-run.mjs').RunSpec} The run spec.
 */
export function gateScript(script, args) {
  return { program: process.execPath, args: [`{main}/scripts/gates/${script}`, ...args] };
}

/**
 * ESLint with the config of the sample project.
 *
 * @param {string[]} files - Files, relative to projects/sample.
 * @returns {import('./gate-fixtures-run.mjs').RunSpec} The run spec.
 */
export function eslintRun(files) {
  return {
    program: '{sample}/node_modules/.bin/eslint',
    args: ['--max-warnings', '0', ...files],
    cwd: 'sample',
  };
}

/**
 * Vitest in the sample project.
 *
 * @param {string[]} args - Arguments after `run`.
 * @param {number} [timeoutMs] - Time limit.
 * @returns {import('./gate-fixtures-run.mjs').RunSpec} The run spec.
 */
export function vitestRun(args, timeoutMs = 300_000) {
  return {
    program: '{sample}/node_modules/.bin/vitest',
    args: ['run', '--project', 'node', ...args],
    cwd: 'sample',
    timeoutMs,
  };
}

/**
 * Opengrep with the repo rules, on files of the worktree.
 *
 * @param {string[]} files - Files, relative to the repo root.
 * @returns {import('./gate-fixtures-run.mjs').RunSpec} The run spec.
 */
export function opengrepRun(files) {
  return {
    program: 'opengrep',
    args: ['scan', '--config', 'tooling/opengrep', '--error', '--quiet', ...files],
  };
}

/**
 * A fixture for a source file that ESLint must reject.
 *
 * @param {object} spec - The fixture.
 * @param {string} spec.id - Id.
 * @param {string} spec.row - Plan row.
 * @param {string} spec.change - The bad change.
 * @param {string} spec.file - File, relative to projects/sample.
 * @param {string} spec.text - File content.
 * @param {(RegExp | string)[]} spec.match - Patterns of the rule ids (the file name is added).
 * @returns {import('./gate-fixtures-run.mjs').Fixture} The fixture.
 */
export function lintFixture(spec) {
  return {
    id: spec.id,
    row: spec.row,
    change: spec.change,
    gate: 'ESLint (project config)',
    setup: [write(`projects/sample/${spec.file}`, spec.text)],
    run: eslintRun([spec.file]),
    expected: rejects([...spec.match, spec.file.split('/').pop() ?? spec.file]),
  };
}

/**
 * A fixture for a hook that must block (exit 2) with a text.
 *
 * @param {object} spec - The fixture.
 * @param {string} spec.id - Id.
 * @param {string} spec.row - Plan row.
 * @param {string} spec.change - The bad change.
 * @param {string} spec.gate - The hook.
 * @param {import('./gate-fixtures-run.mjs').RunSpec} spec.run - The hook call.
 * @param {(RegExp | string)[]} spec.match - Patterns, or strings that the output must contain.
 * @param {Record<string, unknown>[]} [spec.setup] - Setup steps.
 * @param {string} [spec.needs] - The rule of another agent that this fixture needs.
 * @returns {import('./gate-fixtures-run.mjs').Fixture} The fixture.
 */
export function blockFixture(spec) {
  const { match, ...rest } = spec;
  return { ...rest, expected: rejects(match, 2) };
}
