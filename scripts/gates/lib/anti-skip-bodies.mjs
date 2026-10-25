// Test bodies: finds the tests that a diff touches and checks that each one asserts something.
import { maskStrings } from './anti-skip-mask.mjs';
import { isTestFile, languageOf, testCasesInLine } from './anti-skip-rules.mjs';

/** @typedef {import('./diff-parse.mjs').DiffFile} DiffFile */
/** @typedef {{ file: string, line: number, rule: string, message: string }} Finding */

const MAX_BODY_LINES = 400;
// The scanner reads masked code: a string literal keeps its quotes, but its text is blanked.
// - require('fs') and require("fs") load a module. They do not assert, so they do not count.
// - The bare words verify, validate and ensure do not count: a test can call validate(input) and
//   assert nothing. Use expect, assert or an assert helper (assertX, expectX).
// - checkX(...) still counts as a helper that asserts, and so does a named helper verifyX(...),
//   validateX(...) or ensureX(...) (a word with a suffix, for example verifyHealth(app)). A method
//   call such as locator.check() (Playwright clicks a check box) or schema.validateX() does not count.
const JS_ASSERTION =
  /\b(?:expect|assert|should|fail)\w*\s*[(.]|(?<![\w$.])check\w*\s*[(.]|(?<![\w$.])(?:verify|validate|ensure)\w+\s*\(|\brequire\w+\s*[(.]|\brequire\s*\.|\brequire\s*\((?!\s*(['"`])[^'"`\n]*\1\s*\))|\.(?:toBe|toEqual|toThrow|rejects|resolves|toHaveBeenCalled)\w*|\bt\.(?:is|true|false|deepEqual|throws|snapshot)\b|\b(?:get|find)(?:All)?By\w*\s*\(/;
// Python: the bare words verify, validate and ensure do not count (validate(x) can assert nothing).
// A named helper such as verify_health(app) counts. A method call such as model.validate_json(x)
// does not count.
const PY_ASSERTION =
  /\bassert\b|\bpytest\.(?:raises|fail|warns)\b|\.assert\w*\s*\(|\bself\.fail\b|\b(?:check|expect)\w*\s*\(|\bassert_\w+\s*\(|(?<![\w.])(?:verify|validate|ensure)\w+\s*\(/;
// Go: t.Run does not count. The closure that t.Run gets must assert (see goSubtestFindings). A
// call that passes t (helper(t, ...)) counts, because a helper asserts through t.
const GO_ASSERTION =
  /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\b|\b(?:assert|require)\.\w+\s*\(|\bcmp\.Diff\b|\b(?:check|verify|validate|assert|ensure|expect)\w*\s*\(|\b\w+\(\s*t\s*[,)]/;
const GO_RUN = /\bt\.Run\s*\(/g;
const RULE = 'test-without-assertion';
const MESSAGE =
  'has a changed test that holds no assertion (expect, assert, t.Error or a check helper)';
const SUBTEST_MESSAGE =
  'has a changed t.Run subtest whose closure holds no assertion (t.Error, t.Fatal or a call that passes t)';

/**
 * Splits the new content of a file into code-only lines (strings and comments blanked).
 *
 * @param {string} text - File content.
 * @param {import('./anti-skip-rules.mjs').Language} language - File language.
 * @returns {string[]} Code lines.
 */
function codeLines(text, language) {
  return text.split('\n').map((line) => maskStrings(line, { language, blankComments: true }));
}

/**
 * Finds the last line of a JS test call that starts on `start` (the call may span lines).
 *
 * @param {string[]} lines - Code lines.
 * @param {number} start - Index of the line that starts the test.
 * @returns {number} Index of the last line of the call.
 */
function jsCallEnd(lines, start) {
  let depth = 0;
  let opened = false;
  const limit = Math.min(lines.length, start + MAX_BODY_LINES);
  for (let index = start; index < limit; index += 1) {
    for (const char of lines[index] ?? '') {
      if (char === '(') {
        depth += 1;
        opened = true;
      } else if (char === ')') {
        depth -= 1;
      }
    }
    if (opened && depth <= 0) {
      const following = (lines[index + 1] ?? '').trimStart();
      if (!following.startsWith('(') || index + 1 >= limit) {
        return index;
      }
    }
  }
  return limit - 1;
}

/**
 * Finds the last line of a Python test function (the lines indented deeper than the def).
 *
 * @param {string[]} lines - Code lines.
 * @param {number} start - Index of the def line.
 * @returns {number} Index of the last body line.
 */
function pyBodyEnd(lines, start) {
  const indent = /^\s*/.exec(lines[start] ?? '')?.[0].length ?? 0;
  const limit = Math.min(lines.length, start + MAX_BODY_LINES);
  let first = start + 1;
  let depth = 0;
  for (let index = start; index < limit; index += 1) {
    const line = lines[index] ?? '';
    depth += [...line].filter((char) => '([{'.includes(char)).length;
    depth -= [...line].filter((char) => ')]}'.includes(char)).length;
    if (depth <= 0 && line.trimEnd().endsWith(':')) {
      first = index + 1;
      break;
    }
  }
  let end = first - 1;
  for (let index = first; index < limit; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      continue;
    }
    if ((/^\s*/.exec(line)?.[0].length ?? 0) <= indent) {
      break;
    }
    end = index;
  }
  return end;
}

/**
 * Finds the last line of a Go function (the first line that is only a closing brace).
 *
 * @param {string[]} lines - Code lines.
 * @param {number} start - Index of the func line.
 * @returns {number} Index of the closing line.
 */
function goBodyEnd(lines, start) {
  const limit = Math.min(lines.length, start + MAX_BODY_LINES);
  for (let index = start + 1; index < limit; index += 1) {
    if (/^\}/.test(lines[index] ?? '')) {
      return index;
    }
  }
  return limit - 1;
}

/**
 * Lists the tests in code lines as { start, end } line indexes.
 *
 * @param {string[]} lines - Code lines.
 * @param {import('./anti-skip-rules.mjs').Language} language - File language.
 * @returns {{ start: number, end: number }[]} Tests.
 */
function testRanges(lines, language) {
  const ranges = [];
  for (const [index, line] of lines.entries()) {
    const isCase =
      language === 'go' ? /^func\s+Test\w*\(/.test(line) : testCasesInLine(line, language) > 0;
    if (!isCase) {
      continue;
    }
    if (language === 'js') {
      ranges.push({ start: index, end: jsCallEnd(lines, index) });
    } else if (language === 'py') {
      ranges.push({ start: index, end: pyBodyEnd(lines, index) });
    } else {
      ranges.push({ start: index, end: goBodyEnd(lines, index) });
    }
  }
  return ranges;
}

/**
 * Reads a Go call from its opening parenthesis to the matching closing one.
 *
 * @param {string[]} lines - Code lines.
 * @param {{ line: number, column: number, last: number }} start - Line and column of the
 *   opening parenthesis, and the last line to read.
 * @returns {string} The call text (it stops at `last` when the call does not close).
 */
function goCallText(lines, start) {
  let depth = 0;
  let text = '';
  for (let index = start.line; index <= start.last; index += 1) {
    const line = (lines[index] ?? '').slice(index === start.line ? start.column : 0);
    for (const [offset, char] of [...line].entries()) {
      depth += char === '(' ? 1 : 0;
      depth -= char === ')' ? 1 : 0;
      if (depth === 0) {
        return `${text}${line.slice(0, offset + 1)}`;
      }
    }
    text += `${line}\n`;
  }
  return text;
}

/**
 * Finds the t.Run subtests of a Go test whose closure holds no assertion.
 *
 * @param {string[]} lines - Code lines.
 * @param {{ start: number, end: number }} range - The Go test.
 * @returns {number[]} Indexes of the lines that start such a t.Run call.
 */
function goSubtestFindings(lines, range) {
  const found = [];
  for (let index = range.start; index <= range.end; index += 1) {
    for (const match of (lines[index] ?? '').matchAll(GO_RUN)) {
      const column = match.index + match[0].length - 1;
      const call = goCallText(lines, { line: index, column, last: range.end });
      if (/\bfunc\s*\(/.test(call) && !GO_ASSERTION.test(call)) {
        found.push(index);
      }
    }
  }
  return found;
}

/**
 * Finds tests that the diff touches and that hold no assertion. It reads the new file content,
 * so a change that strips the checks from an old test is found too.
 *
 * @param {DiffFile} file - A changed file.
 * @param {string | null} content - New content of the file (null when unreadable).
 * @returns {Finding[]} Findings.
 */
export function assertionFindings(file, content) {
  const language = languageOf(file.path);
  if (
    content === null ||
    file.status === 'deleted' ||
    !['js', 'py', 'go'].includes(language) ||
    !isTestFile(file.path) ||
    file.lines.length === 0
  ) {
    return [];
  }
  const lines = codeLines(content, language);
  const assertion = { js: JS_ASSERTION, py: PY_ASSERTION, go: GO_ASSERTION }[language];
  const touched = new Set(file.lines.map((line) => line.newLine));
  const findings = [];
  for (const range of testRanges(lines, language)) {
    const body = lines.slice(range.start, range.end + 1).join('\n');
    const isTouched = [...touched].some((line) => line >= range.start + 1 && line <= range.end + 1);
    if (!isTouched || assertion === undefined) {
      continue;
    }
    const asserts = assertion.test(body);
    if (!asserts) {
      findings.push({ file: file.path, line: range.start + 1, rule: RULE, message: MESSAGE });
    }
    if (language === 'go') {
      for (const index of goSubtestFindings(lines, range)) {
        findings.push({ file: file.path, line: index + 1, rule: RULE, message: SUBTEST_MESSAGE });
      }
    }
  }
  return findings;
}
