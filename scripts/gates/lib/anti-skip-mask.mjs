// Tokenizer for the anti-skip scanner: blanks string and regex literals in one source line.

/** @typedef {import('./anti-skip-rules.mjs').Language} Language */

const POSTFIX_OPERATOR = /(?:\+\+|--)$/;
const REGEX_PRECEDERS = /[(,=:[!&|?{};+\-*%<>~^]$/;
// A keyword after a dot is a member name (`range.of`, `map.in`), so a slash after it divides.
const REGEX_KEYWORDS =
  /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/;

/**
 * Finds the end of a regex literal that starts at `start`.
 *
 * @param {string} text - A source line.
 * @param {number} start - Index of the opening slash.
 * @returns {number} Index of the closing slash, or -1 when the line has no closing slash.
 */
function regexEnd(text, start) {
  let inClass = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
    } else if (char === '[') {
      inClass = true;
    } else if (char === ']') {
      inClass = false;
    } else if (char === '/' && !inClass) {
      return index;
    }
  }
  return -1;
}

/**
 * Finds the closing quote of a string literal.
 *
 * @param {string} text - A source line.
 * @param {number} start - Index of the opening quote.
 * @returns {number} Index of the closing quote, or -1 when the string does not end on the line.
 */
function stringEnd(text, start) {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
    } else if (text[index] === quote) {
      return index;
    }
  }
  return -1;
}

/**
 * Tells whether a slash at this place starts a regex literal (and not a division).
 *
 * @param {string} before - The masked text before the slash.
 * @returns {boolean} True for a regex literal.
 */
function startsRegex(before) {
  const trimmed = before.trimEnd();
  if (POSTFIX_OPERATOR.test(trimmed)) {
    return false;
  }
  return trimmed === '' || REGEX_PRECEDERS.test(trimmed) || REGEX_KEYWORDS.test(trimmed);
}

/**
 * Reads a comment that starts at `index` in a source line.
 *
 * @param {string} text - A source line.
 * @param {number} index - Index of the possible comment start.
 * @param {Language} language - Language of the file.
 * @returns {{ comment: string, next: number } | null} The comment text and the next index (the line end for a line comment), or null when no comment starts here.
 */
function commentAt(text, index, language) {
  const char = text[index];
  if (language === 'py') {
    return char === '#' ? { comment: text.slice(index), next: text.length } : null;
  }
  const pair = text.slice(index, index + 2);
  if (pair === '//') {
    return { comment: text.slice(index), next: text.length };
  }
  if (pair === '/*') {
    const close = text.indexOf('*/', index + 2);
    const stop = close === -1 ? text.length : close + 2;
    return { comment: text.slice(index, stop), next: stop };
  }
  return null;
}

/**
 * Reads a literal (regex or string) that starts at `index` and blanks its contents.
 *
 * @param {string} text - A source line.
 * @param {number} index - Index of the possible literal start.
 * @param {{ language: Language, masked: string }} context - Language and the masked text so far.
 * @returns {{ chunk: string, next: number } | null} The blanked literal and the next index, or null when no literal starts here.
 */
function literalAt(text, index, context) {
  const char = text[index] ?? '';
  const blank = (value) => ' '.repeat(value.length);
  if (context.language === 'js' && char === '/' && startsRegex(context.masked)) {
    const close = regexEnd(text, index);
    if (close !== -1) {
      return { chunk: `/${blank(text.slice(index + 1, close))}/`, next: close + 1 };
    }
  }
  if (char === "'" || char === '"' || char === '`') {
    const close = stringEnd(text, index);
    if (close !== -1) {
      return { chunk: `${char}${blank(text.slice(index + 1, close))}${char}`, next: close + 1 };
    }
  }
  return null;
}

/**
 * Blanks the contents of string literals and regex literals in one source line, so a word inside
 * them does not match a rule. It reads comments (kept as they are), regex literals and `${}` parts
 * of template literals. A string that does not end on the line is not a string: the quote counts
 * as a plain character, so a stray apostrophe cannot hide the rest of the line.
 *
 * @param {string} text - A source line.
 * @param {{ language?: Language, blankComments?: boolean }} [options] - Language (default js) and
 *   whether to blank comment text too.
 * @returns {string} The line with literal contents blanked. It has the same length.
 */
export function maskStrings(text, options = {}) {
  const language = options.language ?? 'js';
  let masked = '';
  let index = 0;
  while (index < text.length) {
    const comment = commentAt(text, index, language);
    const found = comment === null ? literalAt(text, index, { language, masked }) : null;
    if (comment !== null) {
      masked +=
        options.blankComments === true ? ' '.repeat(comment.comment.length) : comment.comment;
      index = comment.next;
    } else if (found !== null) {
      masked += found.chunk;
      index = found.next;
    } else {
      masked += text[index];
      index += 1;
    }
  }
  return masked;
}
