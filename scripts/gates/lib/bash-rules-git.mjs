import path from 'node:path';

import { gateHitForWord } from './bash-paths.mjs';
import { checkIncomingGit, gateChangesUnder, resolvesToCommit } from './bash-rules-vcs.mjs';
import { git } from './proc.mjs';
import { programName } from './shell-parse.mjs';

/**
 * @typedef {import('./shell-parse.mjs').Segment} Segment
 * @typedef {import('./bash-paths.mjs').PathScope} PathScope
 * @typedef {object} GuardContext
 * @property {string} root - Repo root.
 * @property {string} cwd - Folder the command runs in.
 * @property {() => string} currentBranch - Gets the current branch name (lazy).
 * @property {PathScope} [scope] - Folders, variables and gate files of the whole command line.
 */
/**
 * @typedef {object} ParsedGit
 * @property {string} sub - The subcommand.
 * @property {string[]} args - Arguments after the subcommand.
 * @property {string[]} configs - Lower-case `-c name=value` entries.
 * @property {string[]} configEnv - `--config-env` values.
 * @property {string[]} chdirs - `-C` folders, in order.
 */

const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk']);
const VALUE_SHORT_FLAGS = 'mFCcStu';
const GIT_GLOBAL_VALUE_FLAGS = new Set([
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--super-prefix',
]);
const PUSH_VALUE_FLAGS = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);
const BLOCKED_CONFIG_PREFIXES = ['core.hookspath', 'alias.', 'include.', 'includeif.'];
// Settings that change what `git push` publishes when the command names no refspec: every push.*
// key (push.default=matching, push.followTags, push.pushOption) and the push-related keys of a
// remote (remote.<name>.push, .pushurl, .url, .mirror). A name that has no `=` is a key too.
const PUSH_CONFIG_KEY = /^(?:push\.|remote\.[^=]+\.(?:push|pushurl|url|mirror)(?:=|$))/;
// `git config` flags that only read, and flags that write without a key operand.
const CONFIG_READ_FLAGS = new Set([
  '--get',
  '--get-all',
  '--get-regexp',
  '--get-urlmatch',
  '-l',
  '--list',
]);
const CONFIG_WRITE_FLAGS = new Set([
  '--add',
  '--unset',
  '--unset-all',
  '--replace-all',
  '--rename-section',
  '--remove-section',
]);
const CONFIG_EDIT_FLAGS = new Set(['-e', '--edit']);
const DECLARATIONS = new Set(['export', 'declare', 'local', 'readonly', 'typeset']);
const GIT_CONFIG_VARIABLE = /^GIT_CONFIG[A-Z0-9_]*\+?=/i;
export const KNOWN_SUBCOMMANDS = new Set([
  'add',
  'am',
  'apply',
  'bisect',
  'blame',
  'branch',
  'checkout',
  'cherry-pick',
  'clean',
  'clone',
  'commit',
  'config',
  'describe',
  'diff',
  'fetch',
  'grep',
  'init',
  'log',
  'ls-files',
  'merge',
  'mv',
  'pull',
  'push',
  'rebase',
  'reflog',
  'remote',
  'reset',
  'restore',
  'revert',
  'rev-parse',
  'rm',
  'show',
  'stash',
  'status',
  'switch',
  'tag',
  'worktree',
]);

/**
 * Reads a git command line: global flags, the subcommand and its arguments.
 *
 * @param {string[]} argv - Words of the command (argv[0] is git).
 * @returns {ParsedGit} Parsed parts.
 */
export function parseGit(argv) {
  const configs = [];
  const configEnv = [];
  const chdirs = [];
  let index = 1;
  while (index < argv.length) {
    const word = argv[index] ?? '';
    if (word === '-c') {
      configs.push((argv[index + 1] ?? '').toLowerCase());
      index += 2;
    } else if (word.startsWith('-c') && !word.startsWith('--') && word.length > 2) {
      configs.push(word.slice(2).toLowerCase());
      index += 1;
    } else if (word === '-C') {
      chdirs.push(argv[index + 1] ?? '');
      index += 2;
    } else if (word === '--config-env') {
      configEnv.push(argv[index + 1] ?? '');
      index += 2;
    } else if (word.startsWith('--config-env=')) {
      configEnv.push(word.slice('--config-env='.length));
      index += 1;
    } else if (GIT_GLOBAL_VALUE_FLAGS.has(word)) {
      index += 2;
    } else if (word.startsWith('-')) {
      index += 1;
    } else {
      break;
    }
  }
  return { sub: argv[index] ?? '', args: argv.slice(index + 1), configs, configEnv, chdirs };
}

/**
 * Tells whether a short flag cluster of `git commit` holds `-n` (no-verify).
 *
 * @param {string} word - One argument.
 * @returns {boolean} True when the cluster has the n flag before any value flag.
 */
function commitClusterHasNoVerify(word) {
  if (!/^-[a-zA-Z]+$/.test(word)) {
    return false;
  }
  for (const char of word.slice(1)) {
    if (char === 'n') {
      return true;
    }
    if (VALUE_SHORT_FLAGS.includes(char)) {
      return false;
    }
  }
  return false;
}

/**
 * Tells whether a word is a long option or an abbreviation of it. Git accepts any unambiguous
 * prefix, so `--no-verif` and `--forc` count.
 *
 * @param {string} word - One argument.
 * @param {string} option - The long option, such as `--no-verify`.
 * @param {number} minimum - Shortest prefix that is unambiguous.
 * @returns {boolean} True when the word is the option or a long enough prefix of it.
 */
function isOption(word, option, minimum) {
  const name = word.split('=')[0] ?? '';
  return name.length >= minimum && option.startsWith(name) && name.startsWith('--');
}

/**
 * Tells whether `git push` arguments ask for a force push.
 *
 * @param {string[]} args - Arguments after `push`.
 * @returns {boolean} True for a force flag or a `+refspec`.
 */
function isForcePush(args) {
  return args.some(
    (word) =>
      word.startsWith('--forc') ||
      isOption(word, '--mirror', 3) ||
      /^-[a-zA-Z]*f[a-zA-Z]*$/.test(word) ||
      /^\+\S/.test(word) ||
      word.includes(':+'),
  );
}

/**
 * Checks for a change of the push settings: a `-c` entry, or a `git config` call that sets, adds or
 * unsets a push key. Reading a key stays allowed (`git config --get push.default`, or one key operand
 * with no write flag). `git config --edit` is blocked, because the editor can change any key.
 *
 * @param {ParsedGit} parsed - Parsed git command.
 * @returns {string | null} Reason, or null.
 */
function checkPushConfig(parsed) {
  const reason =
    'Do not change push.* or remote.<name>.push, .pushurl, .url or .mirror. They change what a push with no refspec publishes. Push with git push origin HEAD.';
  if (parsed.configs.some((entry) => PUSH_CONFIG_KEY.test(entry))) {
    return reason;
  }
  if (parsed.sub !== 'config') {
    return null;
  }
  const words = parsed.args.map((word) => word.toLowerCase());
  if (words.some((word) => CONFIG_EDIT_FLAGS.has(word))) {
    return 'git config --edit can change any key, push settings included, so it is blocked. Use git config <key> <value> for a key that is not a push or hook setting.';
  }
  const operands = words.filter((word) => !word.startsWith('-'));
  const writes =
    !words.some((word) => CONFIG_READ_FLAGS.has(word)) &&
    (operands.length >= 2 || words.some((word) => CONFIG_WRITE_FLAGS.has(word)));
  return writes && operands.some((word) => PUSH_CONFIG_KEY.test(word)) ? reason : null;
}

/**
 * Checks `git remote` calls that change what a push with no refspec publishes: `remote add
 * --mirror`, and `remote set-url` and `remote set-branches` (they change the target of a push).
 *
 * @param {ParsedGit} parsed - Parsed git command.
 * @returns {string | null} Reason, or null.
 */
function checkRemoteChange(parsed) {
  if (parsed.sub !== 'remote') {
    return null;
  }
  const action = parsed.args.find((word) => !word.startsWith('-')) ?? '';
  const flags = parsed.args.filter((word) => word.startsWith('-'));
  if (action === 'add' && flags.some((word) => isOption(word, '--mirror', 4))) {
    return 'git remote add --mirror makes every push to that remote a mirror push. Do not do that.';
  }
  if (action === 'set-url' || action === 'set-branches') {
    return `git remote ${action} changes where a push goes or what a remote tracks. It is blocked for the agent. Ask the human.`;
  }
  return null;
}

/**
 * Checks the hook-bypass rules for git.
 *
 * @param {ParsedGit} parsed - Parsed git command.
 * @returns {string | null} Reason, or null.
 */
function checkBypass(parsed) {
  const joined = parsed.args.join(' ').toLowerCase();
  if (
    parsed.configs.some((entry) => entry.startsWith('core.hookspath')) ||
    joined.includes('core.hookspath')
  ) {
    return 'Changing core.hooksPath turns the git hooks off. Do not do that. Rush installs the hooks.';
  }
  if (parsed.configEnv.length > 0) {
    return 'git --config-env can set core.hooksPath or an alias, so it is blocked.';
  }
  if (
    parsed.configs.some((entry) =>
      BLOCKED_CONFIG_PREFIXES.some((prefix) => entry.startsWith(prefix)),
    ) ||
    (parsed.sub === 'config' &&
      parsed.args.some((word) =>
        BLOCKED_CONFIG_PREFIXES.some((prefix) => word.toLowerCase().startsWith(prefix)),
      ))
  ) {
    return 'Do not set a git alias or an include through -c or git config. An alias can hide push and commit from the guard.';
  }
  const pushConfig = checkPushConfig(parsed);
  if (pushConfig !== null) {
    return pushConfig;
  }
  const remoteChange = checkRemoteChange(parsed);
  if (remoteChange !== null) {
    return remoteChange;
  }
  const separator = parsed.args.indexOf('--');
  const flags = separator === -1 ? parsed.args : parsed.args.slice(0, separator);
  const noVerify =
    flags.some((word) => isOption(word, '--no-verify', '--no-v'.length)) ||
    (parsed.sub === 'commit' && flags.some((word) => commitClusterHasNoVerify(word)));
  return noVerify
    ? 'Do not skip git hooks (--no-verify or commit -n). Fix the cause of the failing hook.'
    : null;
}

/**
 * Checks the whole command line for variables that change git config (`GIT_CONFIG_*`).
 *
 * @param {Segment[]} segments - All simple commands.
 * @returns {string | null} Reason, or null.
 */
export function checkGitEnvironment(segments) {
  for (const segment of segments) {
    const declared = DECLARATIONS.has(programName(segment)) ? segment.argv.slice(1) : [];
    if ([...segment.assignments, ...declared].some((word) => GIT_CONFIG_VARIABLE.test(word))) {
      return 'GIT_CONFIG_* variables can set core.hooksPath or an alias for git, so they are blocked.';
    }
  }
  return null;
}

/**
 * Checks `git reset --hard` and `git clean`.
 *
 * @param {ParsedGit} parsed - Parsed git command.
 * @param {GuardContext} context - Guard context.
 * @returns {string | null} Reason, or null.
 */
function checkDestructive(parsed, context) {
  if (parsed.sub === 'reset' && parsed.args.includes('--hard')) {
    const targetsMain = parsed.args.some((word) => /(^|\/)(main|master|trunk)$/.test(word));
    if (targetsMain || PROTECTED_BRANCHES.has(context.currentBranch())) {
      return 'git reset --hard on main is blocked. Use a feature branch, or ask the human.';
    }
  }
  if (parsed.sub === 'clean') {
    const force = parsed.args.some(
      (word) => word === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(word),
    );
    const dry = parsed.args.some(
      (word) => word === '--dry-run' || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(word),
    );
    if (force && !dry) {
      return 'git clean -f deletes untracked files for good. Delete named files in temp, dist, .next or coverage only.';
    }
  }
  return null;
}

/**
 * Gets the branch a push refspec writes to.
 *
 * @param {string} refspec - One refspec, such as `HEAD:main`, `+feature` or `refs/heads/main`.
 * @param {string} current - The current branch.
 * @returns {string} The destination branch name.
 */
function refspecDestination(refspec, current) {
  const stripped = refspec.replace(/^\+/, '');
  const destination = stripped.includes(':') ? stripped.slice(stripped.indexOf(':') + 1) : stripped;
  const name = destination.replace(/^refs\/heads\//, '');
  return name === 'HEAD' || name === '' ? current : name;
}

/**
 * Checks that a push does not write to a protected branch.
 *
 * @param {string[]} args - Arguments after `push`.
 * @param {GuardContext} context - Guard context.
 * @returns {string | null} Reason, or null.
 */
function checkPushTarget(args, context) {
  const operands = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? '';
    if (PUSH_VALUE_FLAGS.has(word)) {
      index += 1;
    } else if (!word.startsWith('-')) {
      operands.push(word);
    }
  }
  const refspecs = operands.slice(1);
  const pushesTagsOnly = args.includes('--tags') && refspecs.length === 0;
  const current = context.currentBranch();
  const destinations =
    refspecs.length > 0 ? refspecs.map((spec) => refspecDestination(spec, current)) : [current];
  const bad = pushesTagsOnly
    ? undefined
    : destinations.find((name) => PROTECTED_BRANCHES.has(name));
  return bad === undefined
    ? null
    : `git push to ${bad} is blocked. Push a feature branch and open a pull request.`;
}

/**
 * Finds the revision a restore or checkout takes its files from.
 *
 * @param {ParsedGit} parsed - Parsed git command.
 * @param {string} root - Repo root.
 * @returns {string[]} Arguments for `git diff` that name the source (empty for the index).
 */
function restoreSource(parsed, root) {
  const { args } = parsed;
  const flagIndex = args.findIndex((word) => word === '-s' || word === '--source');
  const attached = args.find((word) => word.startsWith('--source='));
  const named =
    attached === undefined
      ? flagIndex === -1
        ? undefined
        : args[flagIndex + 1]
      : attached.slice(9);
  if (named !== undefined) {
    return [resolvesToCommit(root, named) ? named : 'HEAD'];
  }
  const separator = args.indexOf('--');
  const before = separator === -1 ? args : args.slice(0, separator);
  const rev =
    parsed.sub === 'checkout' ? before.find((word) => resolvesToCommit(root, word)) : undefined;
  return rev === undefined ? [] : [rev];
}

/**
 * Checks git commands that restore, remove or move gate files.
 *
 * @param {ParsedGit} parsed - Parsed git command.
 * @param {PathScope} scope - Scope of the command, moved by `git -C`.
 * @returns {string | null} Reason, or null.
 */
function checkGatePaths(parsed, scope) {
  if (!['checkout', 'restore', 'rm', 'mv', 'switch'].includes(parsed.sub)) {
    return null;
  }
  const separator = parsed.args.indexOf('--');
  const words = parsed.args.filter((entry, index) =>
    separator === -1 ? !entry.startsWith('-') : index > separator,
  );
  const restores = parsed.sub === 'checkout' || parsed.sub === 'restore';
  for (const word of words) {
    const hit = gateHitForWord(word, scope);
    if (hit === null) {
      continue;
    }
    const isFolderHit = hit.why.startsWith('The folder') || hit.why.startsWith('The repo root');
    if (restores && isFolderHit) {
      const changes = gateChangesUnder(scope.root, hit.relative, restoreSource(parsed, scope.root));
      if (changes.length === 0) {
        continue;
      }
      return `git ${parsed.sub} would reset ${changes[0] ?? ''}, which is a gate file. Only a human changes gate files.`;
    }
    return `git ${parsed.sub} changes ${hit.relative}, which is a gate file. Only a human changes gate files.`;
  }
  return null;
}

/**
 * Reads the git aliases of the repo.
 *
 * @param {string} cwd - Folder to run git in.
 * @returns {Map<string, string>} Alias name to its value.
 */
export function readAliases(cwd) {
  const result = git(cwd, ['config', '--get-regexp', String.raw`^alias\.`]);
  const aliases = new Map();
  for (const line of result.stdout.split('\n')) {
    const space = line.indexOf(' ');
    if (space > 0) {
      aliases.set(line.slice('alias.'.length, space).toLowerCase(), line.slice(space + 1));
    }
  }
  return aliases;
}

/**
 * Checks one git command.
 *
 * @param {Segment} segment - A simple command whose program is git.
 * @param {GuardContext} context - Guard context.
 * @param {(command: string) => string | null} [checkNested] - Checks a command string (for a `!` alias).
 * @returns {string | null} A reason to block, or null.
 */
export function checkGit(segment, context, checkNested = () => null) {
  if (programName(segment) !== 'git') {
    return null;
  }
  const parsed = parseGit(segment.argv);
  const bypass = checkBypass(parsed);
  if (bypass !== null) {
    return bypass;
  }
  const aliased =
    KNOWN_SUBCOMMANDS.has(parsed.sub) || parsed.sub === ''
      ? undefined
      : readAliases(context.cwd).get(parsed.sub.toLowerCase());
  if (aliased !== undefined) {
    return aliased.startsWith('!')
      ? checkNested(`${aliased.slice(1)} ${parsed.args.join(' ')}`)
      : checkGit(
          { ...segment, argv: ['git', ...aliased.split(/\s+/), ...parsed.args] },
          context,
          checkNested,
        );
  }
  if (parsed.sub === 'push') {
    if (isForcePush(parsed.args)) {
      return 'Force push is blocked. Push normally. If history must change, ask the human.';
    }
    const target = checkPushTarget(parsed.args, context);
    if (target !== null) {
      return target;
    }
  }
  const base = context.scope ?? {
    root: context.root,
    cwds: [context.cwd],
    vars: new Map(),
    unknownCwd: false,
    gateFiles: () => [],
  };
  const scope = {
    ...base,
    cwds: base.cwds.map((cwd) => path.resolve(cwd, ...parsed.chdirs)),
  };
  return (
    checkDestructive(parsed, context) ??
    checkGatePaths(parsed, scope) ??
    checkIncomingGit(segment, parsed, scope)
  );
}
