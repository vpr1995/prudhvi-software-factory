// Reads the wrapper commands (`sudo`, `env`, `xargs` and more), control words and inner commands
// (`bash -c`, `eval`, `find -exec`) in front of or inside a simple command. See shell-parse.mjs.

export const MAX_DEPTH = 6;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
export const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const WRAPPERS_WITH_FLAGS = new Set([
  'sudo',
  'env',
  'command',
  'nohup',
  'time',
  'nice',
  'exec',
  'builtin',
  'stdbuf',
  'timeout',
  'doas',
  'xargs',
]);
const WRAPPER_VALUE_FLAGS = new Set([
  '-u',
  '-g',
  '-h',
  '-p',
  '-C',
  '-D',
  '-R',
  '-T',
  '-U',
  '-n',
  '-s',
  '-k',
  '-S',
  '-I',
  '-L',
  '-P',
  '-d',
  '-E',
  '-a',
]);
const CONTROL_WORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  '!',
  '{',
  '}',
  'fi',
  'done',
  'esac',
  'for',
  'case',
]);

/**
 * Skips flags (and the value of known value flags) after a wrapper command.
 *
 * @param {string[]} words - Words after the wrapper.
 * @returns {{ rest: string[], assignments: string[] }} Words from the wrapped command on, and the
 *   `NAME=value` words that the wrapper (`env`) set for it.
 */
function skipWrapperFlags(words) {
  const assignments = [];
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? '';
    if (ASSIGNMENT.test(word)) {
      assignments.push(word);
      index += 1;
    } else if (word.startsWith('-')) {
      index += WRAPPER_VALUE_FLAGS.has(word) ? 2 : 1;
    } else if (/^\d+[smhd]?$/.test(word) && index === 0 && words.length > 1) {
      index += 1;
    } else {
      break;
    }
  }
  return { rest: words.slice(index), assignments };
}

/**
 * Strips env assignments, control words and wrapper commands from the front of a command.
 *
 * @param {string[]} words - Raw words.
 * @returns {{ argv: string[], assignments: string[], loop: { name: string, values: string[] } | null }} The command,
 *   its leading assignments and the variable of a `for` loop.
 */
export function unwrap(words) {
  const assignments = [];
  let loop = null;
  let rest = [...words];
  for (let guard = 0; guard < MAX_DEPTH * 2; guard += 1) {
    const first = rest[0] ?? '';
    if (ASSIGNMENT.test(first)) {
      assignments.push(first);
      rest = rest.slice(1);
    } else if (first === 'for' && rest[2] === 'in') {
      loop = { name: rest[1] ?? '', values: rest.slice(3) };
      rest = [];
    } else if (CONTROL_WORDS.has(first)) {
      rest = rest.slice(1);
    } else if (
      WRAPPERS_WITH_FLAGS.has(first) &&
      !(first === 'command' && /^-[vV]/.test(rest[1] ?? ''))
    ) {
      const skipped = skipWrapperFlags(rest.slice(1));
      assignments.push(...skipped.assignments);
      rest = skipped.rest;
    } else {
      break;
    }
  }
  return { argv: rest, assignments, loop };
}

/**
 * Finds the commands that `find -exec` and `-ok` run.
 *
 * @param {string[]} argv - Words of the find command.
 * @returns {string[]} One command string per `-exec`.
 */
function findExecCommands(argv) {
  const found = [];
  for (let index = 1; index < argv.length; index += 1) {
    if (['-exec', '-execdir', '-ok', '-okdir'].includes(argv[index] ?? '')) {
      const end = argv.findIndex(
        (word, position) => position > index && (word === ';' || word === '+' || word === '\\;'),
      );
      found.push(argv.slice(index + 1, end === -1 ? argv.length : end).join(' '));
    }
  }
  return found;
}

/**
 * Finds command strings that a command runs inside itself (`bash -c`, `eval`).
 *
 * @param {string[]} argv - Command words.
 * @returns {string[]} Inner command strings.
 */
export function innerCommands(argv) {
  const name = (argv[0] ?? '').split('/').pop() ?? '';
  if (name === 'eval') {
    return [argv.slice(1).join(' ')];
  }
  if (name === 'find') {
    return findExecCommands(argv);
  }
  if (!SHELLS.has(name)) {
    return [];
  }
  const flagIndex = argv.findIndex((word, index) => index > 0 && /^-[a-z]*c[a-z]*$/.test(word));
  const inner = flagIndex === -1 ? undefined : argv[flagIndex + 1];
  return inner === undefined ? [] : [inner];
}
