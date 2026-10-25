// Guard rule for the base of the gate checks. GATES_BASE (env) and .claude/state/gates-base (file) pick
// the commit that every diff check compares with (lib/gates-base.mjs). An empty or very recent base
// turns the diff into nothing: the dependency policy, anti-skip and check-gates then see no change.
// So an agent must not set the variable and must not write the state file. A human sets GATES_BASE
// in the own shell, outside the agent session.
//
// The rule blocks, in a Bash command of an agent:
//   - `GATES_BASE=x cmd`, `env GATES_BASE=x cmd`, `export|declare|local|readonly|typeset GATES_BASE=x`
//     (the `+=` form and a name without a value too).
//   - A variable name that the guard cannot read (`export ${N}=x`, `$N=x cmd`, `export $(...)`): it
//     can be GATES_BASE.
//   - A redirect or a writer (`tee`, `cp`, `mv`, `install`, `ln`, `touch`, `truncate`, `dd of=`,
//     `sed -i`, `rsync`) whose target is a file named `gates-base`. Copying FROM the file is allowed.
//   - Code of an interpreter or shell (`node -e`, `python3 -c`, a here-document, a pipe into `bash`)
//     that holds the text `GATES_BASE`, or `gates-base` that is not the name of a script file.
// Reading is allowed: `cat .claude/state/gates-base`, `grep -rn GATES_BASE scripts`,
// `node scripts/gates/gates-base.mjs`. The edit hook (protect-gates) blocks writes by the Write and
// Edit tools through the `.claude/state/gates-base` entry of gate-files.json.
import { programName } from './shell-parse.mjs';

/**
 * @typedef {import('./shell-parse.mjs').Segment} Segment
 */

const DECLARATIONS = new Set(['export', 'declare', 'local', 'readonly', 'typeset']);
const GATES_BASE_VARIABLE = /^GATES_BASE\+?(?:=|$)/;
const UNREADABLE_NAME = /^[^=\s]*[$`][^=\s]*=/;
const STATE_TARGET = /(?:^|\/)gates-base$/;
const GATES_BASE_TEXT = /GATES_BASE|gates-base(?!\.(?:mjs|test\.js)\b)/;
/** Writers that change every file operand. */
const ALL_OPERAND_WRITERS = new Set(['tee', 'touch', 'truncate', 'sponge', 'ed', 'ex']);
/** Writers that change the last operand only (the first ones are sources). */
const LAST_OPERAND_WRITERS = new Set(['cp', 'mv', 'install', 'ln', 'rsync']);
const CODE_RUNNERS =
  /^(?:python[0-9.]*|node|nodejs|ruby|perl|deno|bun|php|lua|awk|gawk|mawk|bash|sh|zsh|dash|ksh|source|\.)$/;
const CODE_FLAG = /^-[a-zA-Z]*[ceEp]$|^--eval$/;
const WRITE_REDIRECT = /^(?:&?>>?|>\||<>)$/;

export const GATES_BASE_REASON =
  'GATES_BASE and .claude/state/gates-base choose the base commit of the gate checks. An agent must not set or write them: a different base hides changes from the checks. Run the gates without them, or ask the human.';

/**
 * Collects the code text that a command passes to an interpreter or shell.
 *
 * @param {Segment} segment - A simple command.
 * @returns {string[]} Code texts: inline code, here-documents and piped text.
 */
function codeTexts(segment) {
  const words = segment.argv.slice(1);
  const inline = words.flatMap((word, index) =>
    CODE_FLAG.test(word) ? [words[index + 1] ?? ''] : [],
  );
  const bodies = segment.redirects.map((redirect) => redirect.body ?? '');
  return [...inline, ...segment.stdinTexts, ...bodies];
}

/**
 * Tells whether a command writes to a file that is named `gates-base`.
 *
 * @param {Segment} segment - A simple command.
 * @returns {boolean} True for a redirect or a writer with such a target.
 */
function writesStateFile(segment) {
  const redirected = segment.redirects.some(
    (redirect) =>
      (WRITE_REDIRECT.test(redirect.op) ||
        (redirect.op === '>&' && !/^\d+$|^-$/.test(redirect.target))) &&
      STATE_TARGET.test(redirect.target),
  );
  if (redirected) {
    return true;
  }
  const name = programName(segment);
  const words = segment.argv.slice(1);
  const operands = words.filter((word) => !word.startsWith('-'));
  if (ALL_OPERAND_WRITERS.has(name)) {
    return operands.some((word) => STATE_TARGET.test(word));
  }
  if (LAST_OPERAND_WRITERS.has(name)) {
    return STATE_TARGET.test(operands.at(-1) ?? '');
  }
  if (name === 'dd') {
    return words.some((word) => word.startsWith('of=') && STATE_TARGET.test(word.slice(3)));
  }
  const inPlace = words.some((word) => /^-[a-zA-Z]*i/.test(word) || word.startsWith('--in-place'));
  return name === 'sed' && inPlace && operands.some((word) => STATE_TARGET.test(word));
}

/**
 * Checks a whole command line for a set or write of the gate base.
 *
 * @param {Segment[]} segments - All simple commands (from `parseShell`).
 * @returns {string | null} The reason to block, or null.
 */
export function checkGatesBase(segments) {
  for (const segment of segments) {
    const name = programName(segment);
    const declared = DECLARATIONS.has(name) ? segment.argv.slice(1) : [];
    const words = [...segment.assignments, ...declared];
    const sets = words.some((word) => GATES_BASE_VARIABLE.test(word));
    const hidden =
      [...words, segment.argv[0] ?? ''].some((word) => UNREADABLE_NAME.test(word)) ||
      declared.some((word) => /^[$`]/.test(word));
    const code =
      CODE_RUNNERS.test(name) && codeTexts(segment).some((text) => GATES_BASE_TEXT.test(text));
    if (sets || hidden || writesStateFile(segment) || code) {
      return GATES_BASE_REASON;
    }
  }
  return null;
}
