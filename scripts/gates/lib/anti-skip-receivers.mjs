// The "skip on any receiver" rule must flag `t.skip('x', ...)` and must not flag `query.skip(10)`.
// A call counts as a test skip when its receiver chain holds a test function name or a file alias
// of one, or when its first argument is a test title (a string).

const TEST_NAMES = new Set([
  'it',
  'test',
  'describe',
  'suite',
  'bench',
  'specify',
  'context',
  'spec',
  'scenario',
  'feature',
  'base',
  'baseTest',
  't',
  'tt',
  'this',
  'testInfo',
  'ctx',
  'task',
]);
const TITLE_ARGUMENT = /^\s*\(\s*['"`]/;
const ASSIGNED_CHAIN = /(?:const|let|var)\s+([\w$]+)\s*=\s*([\w$.]+)/g;
const IMPORT_ALIAS =
  /\b(?:it|test|describe|suite|bench|specify|context|spec|scenario|feature|base|baseTest)\s+as\s+([\w$]+)/g;
const DESTRUCTURE_ALIAS =
  /\b(?:it|test|describe|suite|bench|specify|context|spec|scenario|feature|base|baseTest)\s*:\s*([\w$]+)\s*[,}=]/g;

/**
 * Finds the text of the receiver in front of a call: the identifiers, dots and call arguments that
 * come right before it. Text in parentheses is left out.
 *
 * @param {string} text - The line up to the dot of the call.
 * @returns {string} The receiver text, such as ` test.describe` or ` db.find`.
 */
function receiverBefore(text) {
  let index = text.length;
  let depth = 0;
  while (index > 0) {
    const char = text[index - 1] ?? '';
    if (char === ')') {
      depth += 1;
    } else if (char === '(') {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    } else if (depth === 0 && !/[\w$.\s]/.test(char)) {
      break;
    }
    index -= 1;
  }
  return depth === 0 ? text.slice(index).replaceAll(/\([^()]*\)/g, '') : '';
}

/**
 * Splits a receiver chain into its identifiers.
 *
 * @param {string} chain - Text such as `test.describe` or `db.find`.
 * @returns {string[]} The identifiers.
 */
function segmentsOf(chain) {
  return chain.split(/[^\w$]+/).filter((part) => part !== '');
}

/**
 * Finds the names that stand for a test function in a file (`const t = it`, `import { test as x }`).
 *
 * @param {string | null} content - File content.
 * @returns {Set<string>} The alias names.
 */
export function testAliases(content) {
  const aliases = new Set();
  if (content === null) {
    return aliases;
  }
  for (const match of content.matchAll(ASSIGNED_CHAIN)) {
    if (segmentsOf(match[2] ?? '').some((name) => TEST_NAMES.has(name))) {
      aliases.add(match[1] ?? '');
    }
  }
  for (const match of [...content.matchAll(IMPORT_ALIAS), ...content.matchAll(DESTRUCTURE_ALIAS)]) {
    aliases.add(match[1] ?? '');
  }
  return aliases;
}

/**
 * Tells whether a `.skip(` style call is on a test function.
 *
 * @param {{ masked: string, original: string }} line - The line with strings masked, and as written.
 * @param {RegExp} pattern - The rule pattern. The match index is the dot of the call.
 * @param {Set<string>} aliases - Test aliases of the file.
 * @returns {boolean} True when the call skips or focuses a test.
 */
export function isTestSkipCall(line, pattern, aliases) {
  const found = pattern.exec(line.masked);
  if (found === null) {
    return false;
  }
  const receiver = receiverBefore(line.masked.slice(0, found.index));
  if (segmentsOf(receiver).some((name) => TEST_NAMES.has(name) || aliases.has(name))) {
    return true;
  }
  return TITLE_ARGUMENT.test(line.original.slice(found.index).replace(/^\.\s*\w+\s*/, ''));
}
