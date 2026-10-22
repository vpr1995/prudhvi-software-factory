import { checkGh } from './bash-rules-gh.mjs';
import { programName } from './shell-parse.mjs';

/**
 * @typedef {import('./shell-parse.mjs').Segment} Segment
 */

const RUSH = 'node common/scripts/install-run-rush.js';
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'pnpx']);
const LAUNCHERS = new Set(['npx', 'corepack', 'bunx', 'pnpx']);
const PM_CHANGE_COMMANDS = new Set([
  'install',
  'i',
  'in',
  'ins',
  'add',
  'ci',
  'clean-install',
  'install-test',
  'it',
  'update',
  'up',
  'upgrade',
  'remove',
  'rm',
  'uninstall',
  'un',
  'unlink',
  'dedupe',
  'ddp',
  'link',
  'ln',
  'prune',
  'rebuild',
  'publish',
]);
const PM_VALUE_FLAGS = new Set([
  '--filter',
  '-F',
  '-C',
  '--dir',
  '--prefix',
  '--workspace',
  '-w',
  '--registry',
  '--cwd',
  '--loglevel',
]);
const CDK_BLOCKED = new Set([
  'deploy',
  'destroy',
  'bootstrap',
  'watch',
  'rollback',
  'import',
  'migrate',
  'refactor',
]);
const CDK_VALUE_FLAGS = new Set([
  '-a',
  '--app',
  '-c',
  '--context',
  '-o',
  '--output',
  '--profile',
  '-r',
  '--role-arn',
  '--plugin',
  '-p',
]);
const AWS_VALUE_FLAGS = new Set([
  '--profile',
  '--region',
  '--output',
  '--query',
  '--endpoint-url',
  '--color',
  '--ca-bundle',
  '--cli-read-timeout',
  '--cli-connect-timeout',
  '--cli-binary-format',
  '--cli-input-json',
  '--debug-flag',
]);
const AWS_READ_PREFIXES = [
  'describe',
  'list',
  'get',
  'head',
  'batch-get',
  'lookup',
  'search',
  'filter',
  'validate',
  'estimate',
  'tail',
  'wait',
  'ls',
  'help',
  'start-query',
  'start-live-tail',
];
const AWS_READ_ONLY_COMMANDS = new Set([
  'configure list',
  'sso login',
  'sso logout',
  'sts get-caller-identity',
]);
const INTERPRETERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'python',
  'python3',
  'node',
  'perl',
  'ruby',
]);
const REMOTE_FETCHERS = new Set(['curl', 'wget']);

/**
 * Finds the first operand after skipping flags and the values of flags that take one.
 *
 * @param {string[]} words - Arguments.
 * @param {Set<string>} valueFlags - Flags that take a value.
 * @param {number} [count] - Which operand to return (0 is the first).
 * @returns {string} The operand, or an empty string.
 */
function nthOperand(words, valueFlags, count = 0) {
  const found = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (valueFlags.has(word)) {
      index += 1;
    } else if (!word.startsWith('-')) {
      found.push(word);
    }
  }
  return found[count] ?? '';
}

/**
 * Checks npm, pnpm, yarn and bun.
 *
 * @param {Segment} segment - A simple command.
 * @returns {string | null} Reason, or null.
 */
function checkPackageManager(segment) {
  let argv = segment.argv;
  while (LAUNCHERS.has(programName({ ...segment, argv })) && argv.length > 1) {
    argv = argv.slice(1).filter((word, index) => index > 0 || !word.startsWith('-'));
  }
  const name = programName({ ...segment, argv });
  if (!PACKAGE_MANAGERS.has(name)) {
    return null;
  }
  const words = argv.slice(1);
  const sub = nthOperand(words, PM_VALUE_FLAGS);
  const bareYarn = name === 'yarn' && sub === '';
  if (!PM_CHANGE_COMMANDS.has(sub) && !bareYarn) {
    return null;
  }
  return `Do not run ${name} ${sub} directly. Add a dependency with \`${RUSH} add -p <pkg>\` (run it inside the project folder), or edit package.json and run \`${RUSH} update\`. Install with \`${RUSH} install\`.`;
}

/**
 * Checks pip and friends.
 *
 * @param {Segment} segment - A simple command.
 * @returns {string | null} Reason, or null.
 */
function checkPython(segment) {
  const name = programName(segment);
  const words = segment.argv.slice(1);
  const isPip = /^pip[0-9.]*$/.test(name) || name === 'pipx' || name === 'easy_install';
  const viaModule = /^python[0-9.]*$/.test(name) && words[0] === '-m' && words[1] === 'pip';
  const viaUv =
    name === 'uv' &&
    words[0] === 'pip' &&
    ['install', 'sync', 'uninstall'].includes(words[1] ?? '');
  const sub = nthOperand(viaModule ? words.slice(2) : words, new Set());
  const changes = ['install', 'uninstall', 'download'].includes(sub) || name === 'easy_install';
  if ((isPip || viaModule) && changes) {
    return 'Do not use pip. Python dependencies use uv: `uv add <pkg>` or `uv sync`. The lock file is uv.lock.';
  }
  return viaUv
    ? 'Do not use `uv pip`. It skips the lock file. Use `uv add <pkg>` or `uv sync`.'
    : null;
}

/**
 * Checks cdk commands that change AWS.
 *
 * @param {Segment} segment - A simple command.
 * @returns {string | null} Reason, or null.
 */
function checkCdk(segment) {
  const index = segment.argv.findIndex((word) => (word.split('/').pop() ?? '') === 'cdk');
  if (
    index === -1 ||
    (!['cdk', 'npx', 'pnpm', 'yarn', 'node', 'rush-pnpm', 'rushx'].includes(programName(segment)) &&
      index !== 0)
  ) {
    return null;
  }
  const sub = nthOperand(segment.argv.slice(index + 1), CDK_VALUE_FLAGS);
  return CDK_BLOCKED.has(sub)
    ? `cdk ${sub} changes AWS and is blocked. Use \`cdk synth\` (and a read-only \`cdk diff\`). A human deploys.`
    : null;
}

/**
 * Checks the aws CLI. Only read verbs are allowed.
 *
 * @param {Segment} segment - A simple command.
 * @returns {string | null} Reason, or null.
 */
function checkAws(segment) {
  if (programName(segment) !== 'aws') {
    return null;
  }
  const words = segment.argv.slice(1);
  const service = nthOperand(words, AWS_VALUE_FLAGS, 0);
  const verb = nthOperand(words, AWS_VALUE_FLAGS, 1);
  if (service === '' || service === 'help' || AWS_READ_ONLY_COMMANDS.has(`${service} ${verb}`)) {
    return null;
  }
  if (AWS_READ_PREFIXES.some((prefix) => verb === prefix || verb.startsWith(`${prefix}-`))) {
    return null;
  }
  return `aws ${service} ${verb} may change AWS and is blocked. Only read commands (describe-*, list-*, get-*, s3 ls) are allowed.`;
}

/**
 * Checks downloads piped into an interpreter.
 *
 * @param {Segment} segment - A simple command.
 * @returns {string | null} Reason, or null.
 */
function checkRemoteScript(segment) {
  return INTERPRETERS.has(programName(segment)) && REMOTE_FETCHERS.has(segment.pipedFrom)
    ? 'Do not pipe a download into a shell or interpreter. Download the file, read it, then decide with the human.'
    : null;
}

/**
 * Checks tool commands: package managers, pip, cdk, aws, gh, remote scripts.
 *
 * @param {Segment} segment - A simple command.
 * @returns {string | null} A reason to block, or null.
 */
export function checkTools(segment) {
  return (
    checkPackageManager(segment) ??
    checkPython(segment) ??
    checkCdk(segment) ??
    checkAws(segment) ??
    checkGh(segment) ??
    checkRemoteScript(segment)
  );
}
