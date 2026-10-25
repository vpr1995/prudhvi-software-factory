import { isGhPrCreate } from './bash-rules-gh.mjs';
import { KNOWN_SUBCOMMANDS, parseGit, readAliases } from './bash-rules-git.mjs';
import { describeChange, uncommitted } from './gate-integrity.mjs';
import { currentBranch, verifyIsCurrent } from './git-state.mjs';
import { git } from './proc.mjs';
import { describeExempt, pushBlockers } from './push-exempt.mjs';
import { parseShell, programName } from './shell-parse.mjs';

/**
 * @typedef {object} GuardedCall
 * @property {'git push' | 'gh pr create'} label - The guarded command.
 * @property {string[]} args - For a push: the arguments after `push` (an alias is expanded). For a pull request: all words of the command.
 */

const PUSH_VALUE_FLAGS = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);
const PUSH_CURRENT_ONLY = 'Push the current branch only.';
// Values of push.default under which a push with no refspec sends the current branch to a branch
// of the same name (`upstream`: to its upstream branch, which pushProblem checks). `matching` and
// `nothing` are not in the list, and neither is the deprecated alias `tracking`.
const PLAIN_PUSH_MODES = new Set(['simple', 'current', 'upstream']);

/**
 * Finds the commands that need a passing verify: `gh pr create` and `git push`.
 *
 * @param {string} command - The Bash command line.
 * @param {string} [root] - Repo root. With it, git aliases are read, so `git p` counts when `p` is an alias of push.
 * @returns {GuardedCall[]} The guarded commands, in the order of the command line.
 */
function guardedCalls(command, root) {
  const aliases = new Map();
  const calls = [];
  for (const segment of parseShell(command)) {
    const name = programName(segment);
    if (name === 'git') {
      const args = pushArguments(segment, root, aliases);
      if (args !== null) {
        calls.push({ label: 'git push', args });
      }
    } else if (name === 'gh' && isGhPrCreate(segment.argv)) {
      calls.push({ label: 'gh pr create', args: segment.argv });
    }
  }
  return calls;
}

/**
 * Finds a command that needs a passing verify: `gh pr create` or `git push`.
 *
 * @param {string} command - The Bash command line.
 * @param {string} [root] - Repo root. With it, git aliases are read, so `git p` counts when `p` is an alias of push.
 * @returns {string | null} The guarded command (`gh pr create` or `git push`), or null.
 */
export function guardedCommand(command, root) {
  return guardedCalls(command, root)[0]?.label ?? null;
}

/**
 * Reads the arguments of a `git` command when it is a push, by name or through an alias.
 *
 * @param {import('./shell-parse.mjs').Segment} segment - A `git` command.
 * @param {string | undefined} root - Repo root (without it, aliases are not read).
 * @param {Map<string, string>} aliases - Git aliases. The first unknown subcommand fills it.
 * @returns {string[] | null} The arguments after `push` (words of an alias after `push` come first), or null when the command is not a push.
 */
function pushArguments(segment, root, aliases) {
  const { sub, args } = parseGit(segment.argv);
  if (root !== undefined && sub !== '' && !KNOWN_SUBCOMMANDS.has(sub) && aliases.size === 0) {
    for (const [key, value] of readAliases(root)) {
      aliases.set(key, value);
    }
  }
  if (sub === 'push') {
    return args;
  }
  const words = (aliases.get(sub.toLowerCase()) ?? sub).replace(/^!/, '').split(/\s+/);
  const at = words.indexOf('push');
  return at === -1 ? null : [...words.slice(at + 1), ...args];
}

/**
 * Tells whether a word is a long option or an abbreviation of it. Git accepts any unambiguous prefix.
 *
 * @param {string} word - One argument.
 * @param {string} option - The long option, such as `--all`.
 * @param {number} minimum - Shortest prefix that is unambiguous (the dashes count).
 * @returns {boolean} True when the word is the option or a long enough prefix of it.
 */
function isLongOption(word, option, minimum) {
  const name = word.split('=')[0] ?? '';
  return name.startsWith('--') && name.length >= minimum && option.startsWith(name);
}

/**
 * Tells why a refspec of a push may publish more than the current branch.
 *
 * The range check (push-exempt.mjs) reads the commits from the push base to HEAD. A refspec whose
 * source is HEAD, the current branch, or a commit that HEAD contains publishes nothing outside that
 * range. Any other source that exists (another branch, a commit that HEAD does not contain), an empty
 * source (a delete) and a glob source do not. A source that git cannot find is refused too (the
 * check fails closed: it cannot tell what the push would publish, for example a tag name or a
 * ref that a later command creates).
 *
 * @param {string} root - Repo root.
 * @param {string} spec - One refspec, such as `HEAD:feature`, `+other:x` or `feature`.
 * @param {string} current - The current branch name (empty when HEAD is detached).
 * @returns {string} The reason, or an empty string.
 */
function refspecProblem(root, spec, current) {
  const stripped = spec.replace(/^\+/, '');
  const source = stripped.includes(':') ? stripped.slice(0, stripped.indexOf(':')) : stripped;
  if (
    source === 'HEAD' ||
    (current !== '' && (source === current || source === `refs/heads/${current}`))
  ) {
    return '';
  }
  if (source === '' || /[*?[]/.test(source)) {
    return `the refspec "${spec}" has no single source (a delete or a pattern)`;
  }
  const found = git(root, ['rev-parse', '--verify', '--quiet', `${source}^{commit}`]);
  if (found.status !== 0 || found.stdout.trim() === '') {
    return `git cannot find the source "${source}" of the refspec "${spec}" as a commit`;
  }
  const inside = git(root, ['merge-base', '--is-ancestor', found.stdout.trim(), 'HEAD']);
  return inside.status === 0 ? '' : `"${source}" is not HEAD, the current branch or a commit of it`;
}

/**
 * Reads the values of a git config key, with `git config <args>`.
 *
 * @param {string} root - Repo root.
 * @param {string[]} args - Arguments after `git config`.
 * @returns {string[] | null} The non-blank output lines (empty when the key is not set), or null when git fails in another way (the caller refuses then).
 */
function configLines(root, args) {
  const result = git(root, ['config', ...args]);
  if (result.status === 0) {
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  }
  return result.status === 1 ? [] : null;
}

/**
 * Tells why a push with no refspec may publish more than the current branch. Git then follows its
 * config: `remote.<name>.push` lists refspecs (it can be `refs/heads/*:refs/heads/*`),
 * `remote.<name>.mirror` (any value) makes the push a mirror push, and
 * `push.default` says which branches go (`matching` sends every branch that exists on both sides).
 *
 * @param {string} root - Repo root.
 * @param {string | undefined} remote - The remote named on the command line, if any. Without it, git picks the remote, so the check reads the push setting of every remote.
 * @param {string} current - The current branch name (empty when HEAD is detached).
 * @returns {string} The reason, or an empty string.
 */
function plainPushProblem(root, remote, current) {
  const refspecs =
    remote === undefined
      ? configLines(root, ['--get-regexp', String.raw`^remote\..*\.push$`])
      : configLines(root, ['--get-all', `remote.${remote}.push`]);
  if (refspecs === null || refspecs.length > 0) {
    return 'a push with no refspec follows remote.<name>.push, which can publish other branches. Name the refspec (git push origin HEAD)';
  }
  const mirrors =
    remote === undefined
      ? configLines(root, ['--get-regexp', String.raw`^remote\..*\.mirror$`])
      : configLines(root, ['--get-all', `remote.${remote}.mirror`]);
  if (mirrors === null || mirrors.length > 0) {
    return 'a push with no refspec to a remote with remote.<name>.mirror set publishes and deletes every ref. Name the refspec (git push origin HEAD)';
  }
  const modes = configLines(root, ['--get', 'push.default']);
  const mode = (modes?.at(-1) ?? 'simple').toLowerCase();
  if (modes === null || !PLAIN_PUSH_MODES.has(mode)) {
    return `a push with no refspec follows push.default (${modes === null ? 'unreadable' : mode}), which can publish other branches. Name the refspec (git push origin HEAD)`;
  }
  if (mode === 'upstream') {
    const merge = configLines(root, ['--get', `branch.${current}.merge`]);
    if (merge === null || merge.at(-1) !== `refs/heads/${current}`) {
      return 'push.default is upstream and the upstream branch of the current branch has another name. Name the refspec (git push origin HEAD)';
    }
  }
  return '';
}

/**
 * Tells why a `git push` may publish more than the current branch.
 *
 * @param {string} root - Repo root.
 * @param {string[]} args - Arguments after `push`.
 * @returns {string} The reason, or an empty string.
 */
function pushProblem(root, args) {
  const wide = args.find(
    (word) =>
      isLongOption(word, '--all', 4) ||
      isLongOption(word, '--branches', 4) ||
      isLongOption(word, '--delete', 4) ||
      isLongOption(word, '--tags', 4) ||
      isLongOption(word, '--follow-tags', 5) ||
      isLongOption(word, '--mirror', 3) ||
      isLongOption(word, '--prune', 5) ||
      /^-[a-zA-Z]*d[a-zA-Z]*$/.test(word),
  );
  if (wide !== undefined) {
    return `${wide} publishes or deletes more than the current branch (a tag, every branch, or a mirror)`;
  }
  const operands = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? '';
    if (PUSH_VALUE_FLAGS.has(word)) {
      index += 1;
    } else if (!word.startsWith('-')) {
      operands.push(word);
    }
  }
  const current = currentBranch(root);
  const specs = operands.slice(1);
  for (const spec of specs) {
    const problem = refspecProblem(root, spec, current);
    if (problem !== '') {
      return problem;
    }
  }
  return specs.length === 0 ? plainPushProblem(root, operands[0], current) : '';
}

/**
 * Tells why a `gh pr create` may publish a branch other than the current one (`--head`).
 *
 * @param {string} root - Repo root.
 * @param {string[]} argv - Words of the command.
 * @returns {string} The reason, or an empty string.
 */
function headProblem(root, argv) {
  const current = currentBranch(root);
  for (const [index, word] of argv.entries()) {
    let value;
    if (word === '-H' || word === '--head') {
      value = argv[index + 1] ?? '';
    } else if (word.startsWith('--head=')) {
      value = word.slice('--head='.length);
    } else if (/^-H./.test(word)) {
      value = word.slice(2);
    }
    if (value !== undefined && value.slice(value.lastIndexOf(':') + 1) !== current) {
      return `--head "${value}" is not the current branch`;
    }
  }
  return '';
}

/**
 * Checks that the guarded commands of a command line publish only the current branch. The range
 * check reads HEAD, so a command that publishes another branch would skip it.
 *
 * @param {GuardedCall[]} calls - The guarded commands.
 * @param {string} root - Repo root.
 * @returns {string | null} The refusal text, or null.
 */
function targetRefusal(calls, root) {
  for (const call of calls) {
    const problem =
      call.label === 'git push' ? pushProblem(root, call.args) : headProblem(root, call.args);
    if (problem !== '') {
      return `BLOCKED by require-verify: \`${call.label}\` is refused. ${PUSH_CURRENT_ONLY} (${problem}.)`;
    }
  }
  return null;
}

/**
 * Checks whether a push or a pull request would publish a gate file change that needs a human. It
 * reads git, not the command, and it does not read `.claude/state`.
 *
 * Committed changes of the generated Node dependency files (pnpm-lock.yaml and repo-state.json under
 * common/config/rush, and a rush.json change that only adds projects) do not count when their
 * content passes the check of push-exempt.mjs. Every other committed gate change counts. Every
 * uncommitted gate change counts, the exempt files too.
 *
 * @param {string} root - Repo root.
 * @returns {string | null} The refusal text, or null when no gate file needs a human.
 */
function gateChangeRefusal(root) {
  const published = pushBlockers(root);
  const local = uncommitted(root);
  if (published.blocking.length === 0 && local.length === 0) {
    return null;
  }
  const lines = [
    ...published.blocking.map(
      (entry) => `- ${describeChange(entry)}, committed after ${published.base}`,
    ),
    ...local.map((entry) => `- ${describeChange(entry)}, not committed`),
  ];
  const allowed =
    published.exempt.length === 0
      ? ''
      : `\nNot counted (generated Node dependency files that an agent may push): ${describeExempt(published.exempt)}.`;
  return `Gate changes are pushed by a human.\n${lines.join('\n')}${allowed}\nRevert them (git checkout -- <file>, or git revert for a commit) or ask the human to push.`;
}

/**
 * Checks a Bash command against the gate files and the last verify state.
 *
 * @param {string} command - The Bash command line.
 * @param {string} root - Repo root.
 * @returns {string | null} A message when the command must be blocked, or null.
 */
export function verifyRefusal(command, root) {
  const calls = guardedCalls(command, root);
  const [first] = calls;
  if (first === undefined) {
    return null;
  }
  const target = targetRefusal(calls, root);
  if (target !== null) {
    return target;
  }
  const guarded = first.label;
  const gateRefusal = gateChangeRefusal(root);
  if (gateRefusal !== null) {
    return `BLOCKED by require-verify: \`${guarded}\` is refused. ${gateRefusal}`;
  }
  const current = verifyIsCurrent(root);
  if (current.ok) {
    return null;
  }
  return `BLOCKED by require-verify: \`${guarded}\` needs a passing verify for the current tree, but ${current.reason}.\nRun the \`verify\` skill: run \`node common/scripts/install-run-rush.js verify\` (all five phases), then \`bash .claude/hooks/stop-gate.sh --write-state-only\`. When the result is pass, run the command again. Do not edit .claude/state/last-verify.json by hand.`;
}
