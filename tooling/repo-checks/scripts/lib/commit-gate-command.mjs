// Shell command parsing for the commit gate: find each `git commit` in a Bash command.
// The gate checks the index, so it allows only the commit options that commit the index. An option
// that commits work tree content (`-a`, `-i`, `-o`, `-p`, paths) or an unknown option is a problem.
import { tokenize } from './stop-gate-command.mjs';

// Git global options before the subcommand that take the next word as a value.
const GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--namespace', '--config-env', '--super-prefix']);
// Global options that point git at another repo or work tree. The gate does not follow them.
const GLOBAL_OTHER_REPO = /^--(git-dir|work-tree)(=|$)/;
// Short commit options that take a value: the rest of the word, or else the next word.
const SHORT_WITH_VALUE = new Set(['m', 'F', 'C', 'c', 't']);
// Short commit options with no value. `S` takes an optional value in the rest of the word.
const SHORT_FLAGS = new Set(['s', 'q', 'v', 'e', 'n', 'S']);
const LONG_WITH_VALUE = new Set([
  '--message',
  '--file',
  '--reuse-message',
  '--reedit-message',
  '--template',
  '--author',
  '--date',
  '--cleanup',
  '--trailer',
  '--fixup',
  '--squash',
]);
const LONG_FLAGS = new Set([
  '--amend',
  '--no-edit',
  '--edit',
  '--signoff',
  '--no-signoff',
  '--quiet',
  '--verbose',
  '--allow-empty',
  '--allow-empty-message',
  '--no-verify',
  '--gpg-sign',
  '--no-gpg-sign',
  '--reset-author',
  '--no-post-rewrite',
  '--status',
  '--no-status',
]);
// The heredoc message form that Claude Code writes: -m "$(cat <<'EOF' ... EOF )".
const HEREDOC_MESSAGE = /"\$\(cat\s*<<-?\s*(['"]?)(\w+)\1[ \t]*\n[\s\S]*?\n[ \t]*\2[ \t]*\n\s*\)"/g;
const MESSAGE_PLACEHOLDER = '"(message)"';
// Any other heredoc: the body is data, not commands. The gate keeps only the `<<EOF` word.
const HEREDOC_BODY = /<<-?[ \t]*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g;
// For a command that the gate cannot parse: git, then the word commit in the same simple command.
const COMMIT_TEXT = /\bgit\s[^;&|\n]*?\bcommit(?=[\s;&|)"']|$)/;

/**
 * @typedef {{ directories: string[], problem: string | undefined }} GitCommit
 */

/**
 * @param {string[]} words - Words of one simple command.
 * @returns {{ directories: string[], rest: string[] } | string | undefined} The `-C` folders
 *   and the words after `commit`; a problem text; or undefined when it is not a commit.
 */
function commitArguments(words) {
  let index = 0;
  while (/^[A-Za-z_]\w*=/.test(words[index] ?? '')) {
    index += 1;
  }
  const entry = words[index] ?? '';
  if (entry !== 'git' && !entry.endsWith('/git')) {
    return;
  }
  /** @type {string[]} */
  const directories = [];
  index += 1;
  let problem;
  while ((words[index] ?? '').startsWith('-')) {
    const word = words[index] ?? '';
    if (GLOBAL_OTHER_REPO.test(word)) {
      problem = `the gate does not follow "${word}"`;
    }
    if (GLOBAL_WITH_VALUE.has(word)) {
      if (word === '-C') {
        directories.push(words[index + 1] ?? '');
      }
      index += 1;
    } else if (word === '--git-dir' || word === '--work-tree') {
      index += 1;
    }
    index += 1;
  }
  if (words[index] !== 'commit') {
    return;
  }
  return problem ?? { directories, rest: words.slice(index + 1) };
}

/**
 * @param {string} word - One short option word, for example `-sm`.
 * @returns {{ problem: string | undefined, takesNext: boolean }} A problem, and true when the
 *   last option takes the next word as its value.
 */
function readShortOptions(word) {
  for (let position = 1; position < word.length; position += 1) {
    const letter = word[position] ?? '';
    if (SHORT_WITH_VALUE.has(letter)) {
      return { problem: undefined, takesNext: position === word.length - 1 };
    }
    if (letter === 'S') {
      return { problem: undefined, takesNext: false };
    }
    if (!SHORT_FLAGS.has(letter)) {
      return { problem: `option "-${letter}"`, takesNext: false };
    }
  }
  return { problem: undefined, takesNext: false };
}

/**
 * @param {string} word - One long option word, for example `--author=x`.
 * @returns {{ problem: string | undefined, takesNext: boolean }} A problem, and true when the
 *   option takes the next word as its value.
 */
function readLongOption(word) {
  const [flag = ''] = word.split('=');
  const inline = word.includes('=');
  if (LONG_WITH_VALUE.has(flag)) {
    return { problem: undefined, takesNext: !inline };
  }
  if (LONG_FLAGS.has(flag) && (!inline || flag === '--gpg-sign')) {
    return { problem: undefined, takesNext: false };
  }
  return { problem: word === '--' ? 'paths after "--"' : `option "${flag}"`, takesNext: false };
}

/**
 * @param {string[]} rest - Words after `commit`.
 * @returns {string | undefined} A problem text, or undefined when the commit takes only the index.
 */
function commitProblem(rest) {
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index] ?? '';
    const redirection = /^\d*(?:[<>]+&?|&>+)/.exec(word);
    if (redirection) {
      // A redirection, for example `<<EOF`, `2>&1` or `> out.txt`: skip it and its target.
      index += redirection[0] === word ? 1 : 0;
      continue;
    }
    if (!word.startsWith('-') || word === '-') {
      return `path "${word}"`;
    }
    const { problem, takesNext } = word.startsWith('--')
      ? readLongOption(word)
      : readShortOptions(word);
    if (problem) {
      return problem;
    }
    index += takesNext ? 1 : 0;
  }
  return;
}

/**
 * Finds each `git commit` in a Bash command.
 *
 * @param {string} command - Bash command.
 * @returns {{ commits: GitCommit[], parsed: boolean }} The commits. `parsed` is false when the
 *   command cannot be parsed but names git and commit: the gate must treat it as a commit.
 */
export function findGitCommits(command) {
  let tokens;
  try {
    tokens = tokenize(
      command.replaceAll(HEREDOC_MESSAGE, MESSAGE_PLACEHOLDER).replaceAll(HEREDOC_BODY, '<<$2$3'),
    );
  } catch {
    return { commits: [], parsed: !COMMIT_TEXT.test(command) };
  }
  /** @type {GitCommit[]} */
  const commits = [];
  /** @type {string[]} */
  let words = [];
  for (const token of [...tokens, { type: 'op', value: ';' }]) {
    if (token.type === 'word') {
      words.push(token.value);
      continue;
    }
    const found = commitArguments(words);
    if (typeof found === 'string') {
      commits.push({ directories: [], problem: found });
    } else if (found) {
      commits.push({ directories: found.directories, problem: commitProblem(found.rest) });
    }
    words = [];
  }
  return { commits, parsed: true };
}
