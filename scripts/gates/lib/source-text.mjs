// Text helpers for the coverage gates: comment removal for JS and TS, and the Bruno assertion rule.

const BRUNO_ASSERT_BLOCK = /^assert\s*\{([^}]*)\}/m;
const BRUNO_ASSERT_LINE = /^\s*(?!~|\/\/)[\w.[\]$-]+\s*:\s*\S/m;
const BRUNO_TESTS_BLOCK = /^tests\s*\{([\s\S]*?)^\}/m;
const BRUNO_EXPECT = /(?<![\w.])expect\s*\((?!\s*(?:true|false|1)\s*\))[^)]+\)/;

/**
 * Copies one character of a string literal (or an escape pair) and tells if the string ends.
 *
 * @param {string} text - Source text.
 * @param {number} index - Index inside the string.
 * @param {string} quote - The quote that opened the string.
 * @returns {{ chunk: string, next: number, quote: string }} The copied text, the next index and the open quote ('' when the string ended).
 */
function copyQuoted(text, index, quote) {
  const char = text[index] ?? '';
  if (char === '\\') {
    return { chunk: text.slice(index, index + 2), next: index + 2, quote };
  }
  const closes = char === quote || (char === '\n' && quote !== '`');
  return { chunk: char, next: index + 1, quote: closes ? '' : quote };
}

/**
 * Blanks a comment that starts at `index`.
 *
 * @param {string} text - Source text.
 * @param {number} index - Index of a `/`.
 * @returns {{ chunk: string, next: number } | null} Spaces for the comment (newlines stay) and the next index, or null when no comment starts here.
 */
function blankComment(text, index) {
  const pair = text.slice(index, index + 2);
  if (pair === '//') {
    const end = text.indexOf('\n', index);
    const stop = end === -1 ? text.length : end;
    return { chunk: ' '.repeat(stop - index), next: stop };
  }
  if (pair === '/*') {
    const close = text.indexOf('*/', index + 2);
    const stop = close === -1 ? text.length : close + 2;
    return { chunk: text.slice(index, stop).replaceAll(/[^\n]/g, ' '), next: stop };
  }
  return null;
}

/**
 * Replaces the comments of JS or TS source with spaces (newlines stay, so line numbers hold).
 * Comment markers inside strings are not comments.
 *
 * @param {string} text - Source text.
 * @returns {string} The text without comments.
 */
export function stripComments(text) {
  let output = '';
  let quote = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    const comment = quote === '' && char === '/' ? blankComment(text, index) : null;
    if (comment !== null) {
      output += comment.chunk;
      index = comment.next;
    } else if (quote === '') {
      quote = char === "'" || char === '"' || char === '`' ? char : '';
      output += char;
      index += 1;
    } else {
      const copied = copyQuoted(text, index, quote);
      output += copied.chunk;
      index = copied.next;
      quote = copied.quote;
    }
  }
  return output;
}

/**
 * Tells whether a .bru file asserts something real: an `assert` line that is not disabled
 * (`~` prefix), or an `expect(...)` on a real value inside the `tests` block. An empty `test()`
 * and `expect(true)` do not count.
 *
 * @param {string} text - File content.
 * @returns {boolean} True when the request asserts something.
 */
export function brunoHasAssertion(text) {
  const assertBlock = BRUNO_ASSERT_BLOCK.exec(text)?.[1] ?? '';
  const testsBlock = BRUNO_TESTS_BLOCK.exec(text)?.[1] ?? '';
  return BRUNO_ASSERT_LINE.test(assertBlock) || BRUNO_EXPECT.test(stripComments(testsBlock));
}
