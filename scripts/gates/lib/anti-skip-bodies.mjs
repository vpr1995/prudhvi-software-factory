// Test bodies: finds the tests that a diff touches and checks that each one asserts something.
import { maskStrings } from './anti-skip-mask.mjs';
import { isTestFile, languageOf, testCasesInLine } from './anti-skip-rules.mjs';

/** @typedef {import('./diff-parse.mjs').DiffFile} DiffFile */
/** @typedef {{ file: string, line: number, rule: string, message: string }} Finding */

const MAX_BODY_LINES = 400;
const JS_ASSERTION =
  /\b(?:expect|assert|should|verify|validate|ensure|check|require|fail)\w*\s*[(.]|\.(?:toBe|toEqual|toThrow|rejects|resolves|toHaveBeenCalled)\w*|\bt\.(?:is|true|false|deepEqual|throws|snapshot)\b|\b(?:get|find)(?:All)?By\w*\s*\(/;
const PY_ASSERTION =
  /\bassert\b|\bpytest\.(?:raises|fail|warns)\b|\.assert\w*\s*\(|\bself\.fail\b|\b(?:verify|validate|check|expect|ensure)\w*\s*\(|\bassert_\w+\s*\(|\bvalidate\b/;
const GO_ASSERTION =
  /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow|Run)\b|\b(?:assert|require)\.\w+\s*\(|\bcmp\.Diff\b|\b(?:check|verify|validate|assert|ensure|expect)\w*\s*\(|\b\w+\(\s*t\s*[,)]/;

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
    if (isTouched && assertion !== undefined && !assertion.test(body)) {
      findings.push({
        file: file.path,
        line: range.start + 1,
        rule: 'test-without-assertion',
        message:
          'has a changed test that holds no assertion (expect, assert, t.Error or a check helper)',
      });
    }
  }
  return findings;
}
