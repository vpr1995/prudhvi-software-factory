// A small shell reader for the guard-bash hook. It splits a command line into simple commands
// (words and redirects), and reads inside `$( )`, backticks, `bash -c` and `eval`.
// It is not a full shell. It errs on the side of seeing more commands, never fewer.

/**
 * @typedef {{ op: string, target: string, body?: string }} Redirect
 */

/**
 * @typedef {object} Segment
 * @property {string[]} argv - Command and arguments after env assignments and wrappers.
 * @property {Redirect[]} redirects - Redirects of this command. A here-document has its `body`.
 * @property {string[]} assignments - Leading `NAME=value` words.
 * @property {string} pipedFrom - Name of the command before a `|`, or an empty string.
 * @property {string[]} stdinTexts - Text that feeds stdin: here-document bodies, here-strings and
 *   the words of a piped `echo` or `printf`.
 * @property {{ name: string, values: string[] } | null} loop - The variable of a `for` loop.
 */

import { MAX_DEPTH, SHELLS, innerCommands, unwrap } from './shell-wrappers.mjs';

export const SUBSTITUTION = '$SUBST';
const OPEN_PAREN = '(';
const CLOSE_PAREN = ')';
const WHITESPACE = new Set([' ', '\t', '\r']);
const REDIRECT_START = new Set(['<', '>']);

/**
 * Finds the matching close parenthesis.
 *
 * @param {string} text - Source text.
 * @param {number} openIndex - Index of the character after the open parenthesis.
 * @returns {number} Index of the matching `)`, or the text length when it is missing.
 */
function findClosingParen(text, openIndex) {
  let depth = 1;
  let quote = '';
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '\\') {
      index += 1;
    } else if (quote !== '') {
      quote = char === quote ? '' : quote;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === OPEN_PAREN) {
      depth += 1;
    } else if (char === CLOSE_PAREN) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return text.length;
}

/**
 * @typedef {object} ReaderState
 * @property {string} text - Input.
 * @property {number} position - Read position.
 * @property {Segment[]} segments - Finished segments.
 * @property {string[]} words - Words of the current segment.
 * @property {Redirect[]} redirects - Redirects of the current segment.
 * @property {{ redirect: Redirect, allowTabs: boolean, expands: boolean }[]} heredocQueue - Here-documents that wait for their body.
 * @property {string} word - The word being read.
 * @property {boolean} inWord - True when a word was started (an empty quoted word counts).
 * @property {boolean} quoted - True when the word had a quoted part.
 * @property {string} pendingRedirect - Redirect operator that waits for its target.
 * @property {string} pipedFrom - Command name before a pipe.
 * @property {string[]} nested - Command strings found inside substitutions.
 */

/**
 * Ends the current word.
 *
 * @param {ReaderState} state - Reader state.
 * @returns {void}
 */
function finishWord(state) {
  if (!state.inWord) {
    return;
  }
  if (state.pendingRedirect === '') {
    state.words.push(state.word);
  } else {
    const redirect = { op: state.pendingRedirect, target: state.word };
    state.redirects.push(redirect);
    if (state.pendingRedirect === '<<' || state.pendingRedirect === '<<-') {
      state.heredocQueue.push({
        redirect,
        allowTabs: state.pendingRedirect === '<<-',
        expands: !state.quoted,
      });
    }
    state.pendingRedirect = '';
  }
  state.word = '';
  state.inWord = false;
  state.quoted = false;
}

/**
 * Ends the current simple command.
 *
 * @param {ReaderState} state - Reader state.
 * @param {boolean} piped - True when the next command reads from this one through a pipe.
 * @returns {void}
 */
function finishSegment(state, piped) {
  finishWord(state);
  state.pendingRedirect = '';
  if (state.words.length > 0 || state.redirects.length > 0) {
    const segment = buildSegment(state);
    state.segments.push(segment);
    state.pipedFrom = piped ? (segment.argv[0] ?? '') : '';
  } else if (!piped) {
    state.pipedFrom = '';
  }
  state.words = [];
  state.redirects = [];
}

/**
 * Builds a segment from the words and redirects read so far.
 *
 * @param {ReaderState} state - Reader state.
 * @returns {Segment} The segment.
 */
function buildSegment(state) {
  const { argv, assignments, loop } = unwrap(state.words);
  state.nested.push(...innerCommands(argv));
  return {
    argv,
    redirects: state.redirects,
    assignments,
    pipedFrom: state.pipedFrom,
    stdinTexts: [],
    loop,
  };
}

/**
 * Reads a quoted string. Substitutions inside double quotes are collected.
 *
 * @param {ReaderState} state - Reader state.
 * @param {string} quote - `'` or `"`.
 * @returns {void}
 */
function readQuoted(state, quote) {
  state.inWord = true;
  state.quoted = true;
  state.position += 1;
  while (state.position < state.text.length) {
    const char = state.text[state.position] ?? '';
    if (char === quote) {
      state.position += 1;
      return;
    }
    if (quote === '"' && char === '\\') {
      state.word += state.text[state.position + 1] ?? '';
      state.position += 2;
    } else if (quote === '"' && char === '$' && state.text[state.position + 1] === OPEN_PAREN) {
      readSubstitution(state);
    } else if (quote === '"' && char === '`') {
      readBacktick(state);
    } else {
      state.word += char;
      state.position += 1;
    }
  }
}

/**
 * Reads `$( ... )` at the read position.
 *
 * @param {ReaderState} state - Reader state.
 * @returns {void}
 */
function readSubstitution(state) {
  const start = state.position + 2;
  const end = findClosingParen(state.text, start);
  state.nested.push(state.text.slice(start, end));
  state.word += SUBSTITUTION;
  state.inWord = true;
  state.position = end + 1;
}

/**
 * Reads a backtick substitution at the read position.
 *
 * @param {ReaderState} state - Reader state.
 * @returns {void}
 */
function readBacktick(state) {
  const start = state.position + 1;
  let end = start;
  while (end < state.text.length && state.text[end] !== '`') {
    end += state.text[end] === '\\' ? 2 : 1;
  }
  state.nested.push(state.text.slice(start, end));
  state.word += SUBSTITUTION;
  state.inWord = true;
  state.position = end + 1;
}

/**
 * Reads a redirect operator at the read position.
 *
 * @param {ReaderState} state - Reader state.
 * @returns {void}
 */
function readRedirect(state) {
  if (state.inWord && !state.quoted && /^\d+$/.test(state.word)) {
    state.word = '';
    state.inWord = false;
  } else {
    finishWord(state);
  }
  const match = /^(?:&>>?|<<<|<<-?|>>|>\||>&|<&|<>|>|<)/.exec(state.text.slice(state.position));
  const op = match?.[0] ?? state.text[state.position] ?? '>';
  state.position += op.length;
  if (state.text[state.position] === OPEN_PAREN && REDIRECT_START.has(op)) {
    const start = state.position + 1;
    const end = findClosingParen(state.text, start);
    state.nested.push(state.text.slice(start, end));
    state.position = end + 1;
    return;
  }
  state.pendingRedirect = op;
}

/**
 * Finds the `$( )` and backtick substitutions in text that the shell expands (an unquoted heredoc).
 *
 * @param {string} text - Heredoc body.
 * @returns {string[]} The command strings inside the substitutions.
 */
function bodySubstitutions(text) {
  const found = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '\\') {
      index += 1;
    } else if (char === '$' && text[index + 1] === OPEN_PAREN) {
      const end = findClosingParen(text, index + 2);
      found.push(text.slice(index + 2, end));
      index = end;
    } else if (char === '`') {
      const end = text.indexOf('`', index + 1);
      found.push(text.slice(index + 1, end === -1 ? text.length : end));
      index = end === -1 ? text.length : end;
    }
  }
  return found;
}

/**
 * Reads the bodies of the here-documents that started on the line that just ended.
 *
 * @param {ReaderState} state - Reader state. The read position is at the start of the first body.
 * @returns {void}
 */
function readHeredocBodies(state) {
  for (const item of state.heredocQueue.splice(0)) {
    const lines = [];
    while (state.position < state.text.length) {
      const found = state.text.indexOf('\n', state.position);
      const end = found === -1 ? state.text.length : found;
      const line = state.text.slice(state.position, end);
      state.position = Math.min(end + 1, state.text.length);
      if ((item.allowTabs ? line.replace(/^\t+/, '') : line) === item.redirect.target) {
        break;
      }
      lines.push(line);
    }
    item.redirect.body = lines.join('\n');
    if (item.expands) {
      state.nested.push(...bodySubstitutions(item.redirect.body));
    }
  }
}

/**
 * Reads a command separator at the read position, if there is one.
 *
 * @param {ReaderState} state - Reader state.
 * @returns {boolean} True when a separator was read.
 */
function readSeparator(state) {
  const rest = state.text.slice(state.position, state.position + 2);
  const char = state.text[state.position] ?? '';
  if (rest === '&&' || rest === '||' || rest === '|&' || rest === ';;') {
    finishSegment(state, rest === '|&');
    state.position += 2;
    return true;
  }
  if (char === '\n') {
    finishWord(state);
  }
  if (char === '\n' && state.heredocQueue.length > 0) {
    finishSegment(state, false);
    state.position += 1;
    readHeredocBodies(state);
    return true;
  }
  if (char === '|') {
    finishSegment(state, true);
  } else if (
    char === ';' ||
    char === '&' ||
    char === '\n' ||
    char === OPEN_PAREN ||
    char === CLOSE_PAREN
  ) {
    finishSegment(state, false);
  } else {
    return false;
  }
  state.position += 1;
  return true;
}

/**
 * Tells whether a `#` starts a comment: only at the start of a word, outside quotes.
 *
 * @param {ReaderState} state - Reader state.
 * @param {string} char - The character at the read position.
 * @returns {boolean} True for a comment start.
 */
function startsComment(state, char) {
  return char === '#' && !state.inWord && state.pendingRedirect === '';
}

/**
 * Skips a comment up to the end of its line. The newline stays, so it still ends the command and
 * starts any here-document body.
 *
 * @param {ReaderState} state - Reader state.
 * @returns {void}
 */
function skipComment(state) {
  const found = state.text.indexOf('\n', state.position);
  state.position = found === -1 ? state.text.length : found;
}

/**
 * Reads one step of input.
 *
 * @param {ReaderState} state - Reader state.
 * @returns {void}
 */
function step(state) {
  const char = state.text[state.position] ?? '';
  const next = state.text[state.position + 1] ?? '';
  if (WHITESPACE.has(char)) {
    finishWord(state);
    state.position += 1;
  } else if (startsComment(state, char)) {
    skipComment(state);
  } else if (char === "'" || char === '"') {
    readQuoted(state, char);
  } else if (char === '$' && next === OPEN_PAREN) {
    readSubstitution(state);
  } else if (char === '$' && next === "'") {
    state.position += 1;
    readQuoted(state, "'");
  } else if (char === '`') {
    readBacktick(state);
  } else if (char === '\\') {
    state.word += next === '\n' ? '' : next;
    state.inWord = state.inWord || next !== '\n';
    state.quoted = state.quoted || next !== '\n';
    state.position += 2;
  } else if (REDIRECT_START.has(char) || (char === '&' && next === '>')) {
    readRedirect(state);
  } else if (!readSeparator(state)) {
    state.word += char;
    state.inWord = true;
    state.position += 1;
  }
}

/**
 * Tells whether a shell command reads its commands from stdin (no `-c`, no script file).
 *
 * @param {string[]} argv - Command words.
 * @returns {boolean} True for `bash`, `sh -s`, `bash -`.
 */
function shellReadsStdin(argv) {
  const name = (argv[0] ?? '').split('/').pop() ?? '';
  if (!SHELLS.has(name)) {
    return false;
  }
  const words = argv.slice(1);
  const hasCommandFlag = words.some((word) => /^-[a-z]*c[a-z]*$/.test(word));
  const operands = words.filter((word) => !word.startsWith('-') || word === '-');
  return !hasCommandFlag && operands.every((word) => word === '-');
}

/**
 * Gives each command the text that reaches its stdin: its own here-documents and here-strings,
 * and what the commands before it in a pipe print (`echo`, `printf`, or anything passed on).
 *
 * @param {Segment[]} segments - Segments in order.
 * @returns {void}
 */
function flowStdin(segments) {
  /** @type {string[]} */
  let carry = [];
  for (const segment of segments) {
    const own = segment.redirects.flatMap((redirect) => {
      if (redirect.op === '<<<') {
        return [redirect.target];
      }
      return redirect.body === undefined ? [] : [redirect.body];
    });
    const incoming = segment.pipedFrom === '' ? [] : carry;
    segment.stdinTexts = [...own, ...incoming];
    const name = programName(segment);
    carry = ['echo', 'printf'].includes(name)
      ? [...segment.stdinTexts, segment.argv.slice(1).join(' ')]
      : [...segment.stdinTexts];
  }
}

/**
 * Splits a command line into simple commands. It also reads commands nested in `$( )`,
 * backticks, `bash -c`, `eval`, `find -exec` and here-documents or pipes that feed a shell.
 *
 * @param {string} command - The Bash command line.
 * @param {number} [depth] - Nesting depth (internal).
 * @returns {Segment[]} All simple commands, nested ones last.
 */
export function parseShell(command, depth = 0) {
  /** @type {ReaderState} */
  const state = {
    text: command,
    position: 0,
    segments: [],
    words: [],
    redirects: [],
    heredocQueue: [],
    word: '',
    inWord: false,
    quoted: false,
    pendingRedirect: '',
    pipedFrom: '',
    nested: [],
  };
  while (state.position < state.text.length) {
    step(state);
  }
  finishSegment(state, false);
  flowStdin(state.segments);
  for (const segment of state.segments) {
    if (shellReadsStdin(segment.argv)) {
      state.nested.push(...segment.stdinTexts);
    }
  }
  if (depth >= MAX_DEPTH) {
    return state.segments;
  }
  const inner = state.nested.flatMap((text) => parseShell(text, depth + 1));
  return [...state.segments, ...inner];
}

/**
 * Gets the program name of a command (no folder part).
 *
 * @param {Segment} segment - A simple command.
 * @returns {string} The program name, or an empty string.
 */
export function programName(segment) {
  return (segment.argv[0] ?? '').split('/').pop() ?? '';
}
