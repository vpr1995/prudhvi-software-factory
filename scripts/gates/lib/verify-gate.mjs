import { isGhPrCreate } from './bash-rules-gh.mjs';
import { KNOWN_SUBCOMMANDS, parseGit, readAliases } from './bash-rules-git.mjs';
import { describeChange, pushRange, uncommitted } from './gate-integrity.mjs';
import { verifyIsCurrent } from './git-state.mjs';
import { parseShell, programName } from './shell-parse.mjs';

/**
 * Finds a command that needs a passing verify: `gh pr create` or `git push`.
 *
 * @param {string} command - The Bash command line.
 * @param {string} [root] - Repo root. With it, git aliases are read, so `git p` counts when `p` is an alias of push.
 * @returns {string | null} The guarded command (`gh pr create` or `git push`), or null.
 */
export function guardedCommand(command, root) {
  const aliases = new Map();
  for (const segment of parseShell(command)) {
    const name = programName(segment);
    if (name === 'git' && isPush(segment, root, aliases)) {
      return 'git push';
    }
    if (name === 'gh' && isGhPrCreate(segment.argv)) {
      return 'gh pr create';
    }
  }
  return null;
}

/**
 * Tells whether a `git` command is a push, by name or through an alias.
 *
 * @param {import('./shell-parse.mjs').Segment} segment - A `git` command.
 * @param {string | undefined} root - Repo root (without it, aliases are not read).
 * @param {Map<string, string>} aliases - Git aliases. The first unknown subcommand fills it.
 * @returns {boolean} True for a push.
 */
function isPush(segment, root, aliases) {
  const { sub } = parseGit(segment.argv);
  if (root !== undefined && sub !== '' && !KNOWN_SUBCOMMANDS.has(sub) && aliases.size === 0) {
    for (const [key, value] of readAliases(root)) {
      aliases.set(key, value);
    }
  }
  const expanded = aliases.get(sub.toLowerCase()) ?? sub;
  return sub === 'push' || expanded.replace(/^!/, '').split(/\s+/).includes('push');
}

/**
 * Checks whether a push or a pull request would publish a gate file change. It reads git, not the
 * command, and it does not read `.claude/state`.
 *
 * @param {string} root - Repo root.
 * @returns {string | null} The refusal text, or null when no gate file changed.
 */
function gateChangeRefusal(root) {
  const published = pushRange(root);
  const local = uncommitted(root);
  if (published.changes.length === 0 && local.length === 0) {
    return null;
  }
  const lines = [
    ...published.changes.map(
      (entry) => `- ${describeChange(entry)}, committed after ${published.base}`,
    ),
    ...local.map((entry) => `- ${describeChange(entry)}, not committed`),
  ];
  return `Gate changes are pushed by a human.\n${lines.join('\n')}\nRevert them (git checkout -- <file>, or git revert for a commit) or ask the human to push.`;
}

/**
 * Checks a Bash command against the gate files and the last verify state.
 *
 * @param {string} command - The Bash command line.
 * @param {string} root - Repo root.
 * @returns {string | null} A message when the command must be blocked, or null.
 */
export function verifyRefusal(command, root) {
  const guarded = guardedCommand(command, root);
  if (guarded === null) {
    return null;
  }
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
