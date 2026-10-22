import { programName } from './shell-parse.mjs';

/**
 * @typedef {import('./shell-parse.mjs').Segment} Segment
 * @typedef {object} ParsedGh
 * @property {string} area - First operand: `pr`, `api`, `label`, and so on.
 * @property {string} action - Second operand: `merge`, `create`, and so on.
 * @property {string[]} operands - All operands (flag values left out).
 * @property {string[]} flags - All flag words, with the value of a value flag after it.
 */

const GH_LABEL_FLAGS = ['--add-label', '--remove-label'];
const GH_VALUE_FLAGS = new Set([
  '-R',
  '--repo',
  '--hostname',
  '-B',
  '--base',
  '-H',
  '--head',
  '-t',
  '--title',
  '-b',
  '--body',
  '--body-file',
  '-l',
  '--label',
  '-a',
  '--assignee',
  '-r',
  '--reviewer',
  '-m',
  '--milestone',
  '-q',
  '--jq',
  '--template',
  '-p',
  '--project',
  '--json',
  '--cache',
  '-X',
  '--method',
  '-f',
  '-F',
  '--raw-field',
  '--field',
  '--input',
  '--header',
  '-s',
  '--state',
  '--add-label',
  '--remove-label',
]);
const BODY_FLAG = /^(?:-f|-F|--raw-field|--field|--input)(?:=|$)|^-[fF]./;

/**
 * Reads a `gh` command line. It skips the values of flags that take one, so
 * `gh -R owner/repo pr merge 5` gives area `pr` and action `merge`.
 *
 * @param {string[]} argv - Words of the command (argv[0] is gh).
 * @returns {ParsedGh} The parts.
 */
export function parseGh(argv) {
  const operands = [];
  const flags = [];
  const words = argv.slice(1);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (word === '--') {
      operands.push(...words.slice(index + 1));
      break;
    }
    if (GH_VALUE_FLAGS.has(word)) {
      flags.push(word, words[index + 1] ?? '');
      index += 1;
    } else if (word.startsWith('-')) {
      flags.push(word);
    } else {
      operands.push(word);
    }
  }
  return { area: operands[0] ?? '', action: operands[1] ?? '', operands, flags };
}

/**
 * Tells whether a `gh` command opens a pull request.
 *
 * @param {string[]} argv - Words of the command.
 * @returns {boolean} True for `gh pr create` and `gh pr new` (the built-in alias of create).
 */
export function isGhPrCreate(argv) {
  const parsed = parseGh(argv);
  return parsed.area === 'pr' && (parsed.action === 'create' || parsed.action === 'new');
}

/**
 * Reads the HTTP method of a `gh api` call.
 *
 * @param {string[]} flags - Flag words from `parseGh`.
 * @returns {string} Upper-case method, `GET` when none is given.
 */
function apiMethod(flags) {
  for (const [index, word] of flags.entries()) {
    if (word === '-X' || word === '--method') {
      return (flags[index + 1] ?? '').toUpperCase();
    }
    if (word.startsWith('--method=')) {
      return word.slice('--method='.length).toUpperCase();
    }
    if (/^-X./.test(word)) {
      return word.slice(2).toUpperCase();
    }
  }
  return 'GET';
}

/**
 * Checks `gh api`: only plain GET calls with no body are allowed.
 *
 * @param {ParsedGh} parsed - The command.
 * @returns {string | null} Reason, or null.
 */
function checkApi(parsed) {
  const method = apiMethod(parsed.flags);
  const endpoint = (parsed.operands[1] ?? '').toLowerCase();
  if (method !== 'GET') {
    return `gh api with method ${method} changes GitHub settings and is blocked.`;
  }
  if (parsed.flags.some((word) => BODY_FLAG.test(word))) {
    return 'gh api with -f, -F, --field, --raw-field or --input sends a request body, which makes it a POST. It is blocked.';
  }
  return endpoint.startsWith('graphql') || endpoint.startsWith('/graphql')
    ? 'gh api graphql is always a POST and can change GitHub settings. It is blocked.'
    : null;
}

/**
 * Checks the GitHub CLI for label, merge, approve and write API calls.
 *
 * @param {Segment} segment - A simple command.
 * @returns {string | null} Reason, or null.
 */
export function checkGh(segment) {
  if (programName(segment) !== 'gh') {
    return null;
  }
  const parsed = parseGh(segment.argv);
  if (
    parsed.flags.some((word) =>
      GH_LABEL_FLAGS.some((flag) => word === flag || word.startsWith(`${flag}=`)),
    )
  ) {
    return 'Agents must not add or remove labels. A human or a workflow sets them (docs/standards/gates.md, section 5).';
  }
  if (parsed.area === 'label' && parsed.action !== 'list') {
    return 'Agents must not change labels.';
  }
  if (parsed.area === 'alias' && ['set', 'import'].includes(parsed.action)) {
    return 'gh alias can hide a blocked command. Do not set aliases.';
  }
  if (
    parsed.area === 'pr' &&
    (parsed.action === 'merge' ||
      (parsed.action === 'review' &&
        parsed.flags.some((word) => word.startsWith('--approve') || word === '-a')))
  ) {
    return `gh pr ${parsed.action} is blocked. A human merges and approves.`;
  }
  return parsed.area === 'api' ? checkApi(parsed) : null;
}
