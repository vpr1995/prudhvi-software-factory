import { assertionFindings } from './anti-skip-bodies.mjs';
import { coverageFindings } from './anti-skip-coverage.mjs';
import { EXIT_AND_BUILD_RULES } from './anti-skip-exit-rules.mjs';
import { maskStrings } from './anti-skip-mask.mjs';
import { isTestSkipCall, testAliases } from './anti-skip-receivers.mjs';
import {
  EMPTY_BLOCK_RULES,
  EMPTY_TEST_LINE_RULES,
  isTestFile,
  languageOf,
  LINE_RULES,
  testCasesInLine,
} from './anti-skip-rules.mjs';
import { firstMatch } from './glob.mjs';
import { brunoHasAssertion } from './source-text.mjs';

/** @typedef {import('./diff-parse.mjs').DiffFile} DiffFile */
/** @typedef {{ file: string, line: number, rule: string, message: string }} Finding */

/**
 * @typedef {object} ScanContext
 * @property {(path: string) => string | null} readFile - Reads the new content of a file (null when missing).
 * @property {{ ignorePaths: string[], coverageOnlyPaths: string[] }} settings - From gate-files.json.
 */

const BRUNO_REQUEST_BLOCK = /^(?:get|post|put|patch|delete|head|options)\s*\{/m;
const PHASE_KEY = /"(_phase:[\w-]+)"\s*:\s*/;
const NEUTERED_COMMAND =
  /^(?:true|:|exit\s+0|echo\b[^&;|]*|node\s+-e\s+(?:'\s*'|\\"\s*\\")|\/bin\/true|\s*)$|(?:\|\||;)\s*(?:true|:|exit\s+0)\s*$/;
const CONFIG_SHADOW =
  /(?:^|\/)(?:pytest\.ini|ruff\.toml|\.ruff\.toml|mypy\.ini|\.coveragerc|setup\.cfg|tox\.ini|pyrightconfig\.json|\.gitleaksignore|\.semgrepignore|\.opengrepignore|\.eslintignore)$/;

/**
 * Reads the text of a JSON string at the start of `text`.
 *
 * @param {string} text - Text that may start with a JSON string.
 * @returns {string | null} The text between the quotes, or null when no string starts here.
 */
function jsonStringAtStart(text) {
  if (text[0] !== '"') {
    return null;
  }
  for (let index = 1; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
    } else if (text[index] === '"') {
      return text.slice(1, index);
    }
  }
  return null;
}

/**
 * Reads a `"_phase:name": "command"` line of a package.json.
 *
 * @param {string} text - A line.
 * @returns {{ name: string, command: string | null } | null} The script name and its command (null when the value is not a string), or null when the line is not a phase script.
 */
function phaseScriptOf(text) {
  const key = PHASE_KEY.exec(text);
  if (key?.[1] === undefined) {
    return null;
  }
  const command = jsonStringAtStart(text.slice(key.index + key[0].length));
  return { name: key[1], command: command === null ? null : command.trim() };
}

/**
 * Checks added lines against the line rules.
 *
 * @param {DiffFile} file - A changed file.
 * @param {string | null} content - New content of the file (null when unreadable).
 * @returns {Finding[]} Findings.
 */
function lineFindings(file, content) {
  const aliases = testAliases(content);
  const language = languageOf(file.path);
  const testFile = isTestFile(file.path);
  const rules = [
    ...LINE_RULES,
    ...EXIT_AND_BUILD_RULES,
    ...(testFile ? EMPTY_TEST_LINE_RULES : []),
  ].filter(
    (rule) =>
      rule.languages.includes(language) &&
      (rule.files === undefined || rule.files.test(file.path)) &&
      (rule.testFilesOnly !== true || testFile),
  );
  const findings = [];
  for (const entry of file.lines.filter((line) => line.kind === '+')) {
    for (const rule of rules) {
      const subject =
        rule.maskStrings === true ? maskStrings(entry.text, { language }) : entry.text;
      const matches =
        rule.pattern.test(subject) &&
        (rule.receiverCheck !== true ||
          isTestSkipCall({ masked: subject, original: entry.text }, rule.pattern, aliases));
      if (matches) {
        findings.push({
          file: file.path,
          line: entry.newLine,
          rule: rule.id,
          message: rule.message,
        });
      }
    }
  }
  return findings;
}

/**
 * Finds empty catch, except and error blocks that span two added lines.
 *
 * @param {DiffFile} file - A changed file.
 * @returns {Finding[]} Findings.
 */
function emptyBlockFindings(file) {
  const language = languageOf(file.path);
  const added = file.lines.filter((line) => line.kind === '+');
  const findings = [];
  const testFile = isTestFile(file.path);
  const rules = EMPTY_BLOCK_RULES.filter(
    (entry) => entry.languages.includes(language) && (entry.id !== 'empty-test-body' || testFile),
  );
  for (const rule of rules) {
    for (const [index, entry] of added.entries()) {
      const next = added[index + 1];
      if (
        rule.open.test(entry.text) &&
        next !== undefined &&
        next.newLine === entry.newLine + 1 &&
        rule.close.test(next.text)
      ) {
        findings.push({
          file: file.path,
          line: entry.newLine,
          rule: rule.id,
          message: rule.message,
        });
      }
    }
  }
  return findings;
}

/**
 * Finds deleted test files and test files with fewer test cases than before.
 *
 * @param {DiffFile} file - A changed file.
 * @returns {Finding[]} Findings.
 */
function testRemovalFindings(file) {
  if (file.status === 'deleted' && isTestFile(file.oldPath)) {
    return [
      { file: file.oldPath, line: 1, rule: 'test-file-deleted', message: 'deletes a test file' },
    ];
  }
  const language = languageOf(file.path);
  if (!isTestFile(file.path) || file.status === 'added') {
    return [];
  }
  const removed = file.lines.filter(
    (line) => line.kind === '-' && testCasesInLine(line.text, language) > 0,
  );
  const countOf = (kind) =>
    file.lines
      .filter((line) => line.kind === kind)
      .reduce((sum, line) => sum + testCasesInLine(line.text, language), 0);
  const removedCount = countOf('-');
  const addedCount = countOf('+');
  if (removedCount <= addedCount) {
    return [];
  }
  return [
    {
      file: file.path,
      line: removed[0]?.oldLine ?? 1,
      rule: 'fewer-test-cases',
      message: `has fewer test cases than before (${String(removedCount)} removed, ${String(addedCount)} added)`,
    },
  ];
}

/**
 * Finds a Bruno request with no assert block and no tests block.
 *
 * @param {DiffFile} file - A changed file.
 * @param {ScanContext} context - Scan context.
 * @returns {Finding[]} Findings.
 */
function brunoFindings(file, context) {
  if (file.status === 'deleted' || languageOf(file.path) !== 'bru' || !isTestFile(file.path)) {
    return [];
  }
  const text = context.readFile(file.path);
  if (text === null || !BRUNO_REQUEST_BLOCK.test(text)) {
    return [];
  }
  const asserts = brunoHasAssertion(text);
  return asserts
    ? []
    : [
        {
          file: file.path,
          line: 1,
          rule: 'bru-no-assertion',
          message:
            'is a Bruno request with no real assertion (an assert line that is not disabled, or expect() in the tests block)',
        },
      ];
}

/**
 * Finds `_phase:*` scripts that a package.json change removes or turns into a no-op. These scripts
 * are the gates that `rush verify` runs for each project.
 *
 * @param {DiffFile} file - A changed file.
 * @returns {Finding[]} Findings.
 */
function phaseScriptFindings(file) {
  if (!/(?:^|\/)package\.json$/.test(file.path)) {
    return [];
  }
  const findings = [];
  const added = new Map();
  for (const entry of file.lines.filter((line) => line.kind === '+')) {
    const script = phaseScriptOf(entry.text);
    if (script !== null) {
      added.set(script.name, entry.newLine);
      if (script.command !== null && NEUTERED_COMMAND.test(script.command)) {
        findings.push({
          file: file.path,
          line: entry.newLine,
          rule: 'phase-script-neutered',
          message: `turns the ${script.name} script into a no-op ("${script.command}")`,
        });
      }
    }
  }
  for (const entry of file.lines.filter((line) => line.kind === '-')) {
    const name = phaseScriptOf(entry.text)?.name;
    if (name !== undefined && !added.has(name)) {
      findings.push({
        file: file.path,
        line: entry.oldLine,
        rule: 'phase-script-removed',
        message: `removes the ${name} script, so rush verify no longer runs that gate`,
      });
    }
  }
  return findings;
}

/**
 * Finds a test file that a rename moves out of the test set: the new path is not a test path, or it is
 * a path the scanner skips.
 *
 * @param {DiffFile} file - A changed file.
 * @param {string[]} ignorePaths - Skipped paths.
 * @returns {Finding[]} Findings.
 */
function renamedTestFindings(file, ignorePaths) {
  if (file.status !== 'renamed' || !isTestFile(file.oldPath)) {
    return [];
  }
  if (isTestFile(file.path) && firstMatch(file.path, ignorePaths) === null) {
    return [];
  }
  return [
    {
      file: file.oldPath,
      line: 1,
      rule: 'test-file-deleted',
      message: `renames a test file to ${file.path}, where it no longer runs as a test`,
    },
  ];
}

/**
 * Finds a new tool config file that can shadow the gated config of a project.
 *
 * @param {DiffFile} file - A changed file.
 * @returns {Finding[]} Findings.
 */
function shadowConfigFindings(file) {
  if ((file.status !== 'added' && file.status !== 'renamed') || !CONFIG_SHADOW.test(file.path)) {
    return [];
  }
  return [
    {
      file: file.path,
      line: 1,
      rule: 'config-shadow-file',
      message: 'adds a tool config or ignore file that can override or hide gated settings',
    },
  ];
}

/**
 * Scans one changed file.
 *
 * @param {DiffFile} file - A changed file.
 * @param {ScanContext} context - Scan context.
 * @returns {Finding[]} Findings.
 */
export function scanFile(file, context) {
  const { ignorePaths, coverageOnlyPaths } = context.settings;
  const renamed = renamedTestFindings(file, ignorePaths);
  if (firstMatch(file.path, ignorePaths) !== null) {
    return renamed;
  }
  const shared = [
    ...renamed,
    ...coverageFindings(file),
    ...testRemovalFindings(file),
    ...phaseScriptFindings(file),
  ];
  if (firstMatch(file.path, coverageOnlyPaths) !== null) {
    return shared;
  }
  const content = file.status === 'deleted' ? null : context.readFile(file.path);
  return [
    ...lineFindings(file, content),
    ...emptyBlockFindings(file),
    ...shared,
    ...shadowConfigFindings(file),
    ...assertionFindings(file, content),
    ...brunoFindings(file, context),
  ];
}

/**
 * Scans a list of changed files and sorts the findings.
 *
 * @param {DiffFile[]} files - Changed files.
 * @param {ScanContext} context - Scan context.
 * @returns {Finding[]} Findings sorted by file and line, without duplicates.
 */
export function scanFiles(files, context) {
  const all = files.flatMap((file) => scanFile(file, context));
  const unique = new Map(
    all.map((finding) => [`${finding.file}:${String(finding.line)}:${finding.rule}`, finding]),
  );
  return [...unique.values()].sort(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line,
  );
}

/**
 * Formats a finding as `file:line: [rule] message`.
 *
 * @param {Finding} finding - A finding.
 * @returns {string} One line.
 */
export function formatFinding(finding) {
  return `${finding.file}:${String(finding.line)}: [${finding.rule}] ${finding.message}`;
}
