// PreToolUse hook on Bash (issue #146 part 2). Reads the hook input JSON from stdin.
// When the command names a protected path and has a write pattern, it writes one JSON object
// with `permissionDecision: "ask"`, so Claude Code asks the owner. Else it writes nothing.
// Bad input or an error also gives `ask` (fail closed). It always exits 0.
//
// Best effort: a simple text match. It does not see shell variables, `cd` then a relative path,
// `eval`, or interpreters (`node -e`, `python -c`). FACTORY_STOP_GATE does not turn it off.
import { readFileSync } from 'node:fs';

const PROTECTED = /tooling\/repo-checks|\.claude\/settings(?:\.local)?\.json/u;
// A `>` or `>>` redirect counts only when its target is a protected path. So `2>&1` and
// `2>/dev/null` are not writes.
const REDIRECT = />>?\s*\S*(?:tooling\/repo-checks|\.claude\/settings)/u;
const WRITE =
  /\bsed\s.*-i|\b(?:tee|cp|mv|rm)\s|\bgit\s+(?:apply|restore)\b|\bgit\s+checkout\s.*--(?:\s|$)/u;

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
 * @param {string} input - Hook input JSON.
 * @returns {string} Hook output, or '' when the command can run.
 */
function check(input) {
  const command = JSON.parse(input).tool_input.command;
  if (typeof command !== 'string') throw new TypeError('tool_input.command is not a string');
  const found = PROTECTED.exec(command);
  if (found === null || !(REDIRECT.test(command) || WRITE.test(command))) return '';
  return ask(`This Bash command can write to the protected path ${found[0]}.`);
}

try {
  process.stdout.write(check(readFileSync(0, 'utf8')));
} catch (error) {
  process.stdout.write(ask(`protected-write-check failed (fail closed): ${String(error)}`));
}
