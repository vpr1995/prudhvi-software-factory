// PreToolUse hook on Bash (issue #146 part 2). Reads the hook input JSON from stdin.
// When the command names a protected path, it writes one JSON object with
// `permissionDecision: "ask"`, so Claude Code asks the owner. The one exception is a simple known
// read: no chain, `&`, pipe, redirect or substitution (after the removal of `2>&1` and `2>/dev/null`),
// and the first words are in KNOWN_READS (exact, case-sensitive match). Then it writes nothing.
// The path check is case-insensitive and ignores `/./` and `//`.
// Bad input or an error also gives `ask` (fail closed). It always exits 0. In
// .claude/settings.json, `|| echo` asks when node cannot start. A hook timeout lets the command
// run (Claude Code behavior).
//
// Best effort: a simple text match. It does not see shell variables, `cd` then a relative path,
// `eval`, or interpreters (`node -e`, `python -c`). FACTORY_STOP_GATE does not turn it off.
import { readFileSync } from 'node:fs';

const PROTECTED = /tooling\/repo-checks|\.claude\/settings(?:\.local)?\.json/u;
const NOT_SIMPLE = /[;|&<>`\n\r]|\$\(/u;
const KNOWN_READS = [
  'cat',
  'head',
  'tail',
  'grep',
  'rg',
  'ls',
  'wc',
  'diff',
  'stat',
  'file',
  'git diff',
  'git log',
  'git show',
  'git status',
  'git blame',
  'git add',
  'git commit',
  'git grep',
  'node --test',
  'node tooling/repo-checks/scripts/factory.mjs',
  'node tooling/repo-checks/scripts/doc-lint.mjs',
  'node common/scripts/install-run-rush.js',
].map((read) => read.split(' '));

/**
 * @param {string} reason - Reason that Claude Code shows to the owner.
 * @returns {string} Hook output (JSON) that asks the owner.
 */
function ask(reason) {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  })}\n`;
}

/**
 * @param {string} command - Bash command text.
 * @returns {boolean} True when the command is a simple known read.
 */
function isSimpleRead(command) {
  const text = command.replaceAll('2>&1', '').replaceAll('2>/dev/null', '');
  if (NOT_SIMPLE.test(text)) return false;
  const words = text.trim().split(/\s+/u);
  return KNOWN_READS.some((read) => read.every((word, index) => words[index] === word));
}

/**
 * @param {string} input - Hook input JSON.
 * @returns {string} Hook output, or '' when the command can run.
 */
function check(input) {
  const command = JSON.parse(input).tool_input.command;
  if (typeof command !== 'string') throw new TypeError('tool_input.command is not a string');
  const normal = command.toLowerCase().replaceAll(/\/(?:\.\/|\/)+/gu, '/');
  const found = PROTECTED.exec(normal);
  if (found === null || isSimpleRead(command)) return '';
  return ask(`This Bash command names the protected path ${found[0]} and is not a simple read.`);
}

try {
  process.stdout.write(check(readFileSync(0, 'utf8')));
} catch (error) {
  process.stdout.write(ask(`protected-write-check failed (fail closed): ${String(error)}`));
}
