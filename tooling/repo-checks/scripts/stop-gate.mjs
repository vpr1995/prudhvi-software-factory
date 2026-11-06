// Verify gate for Claude Code (design 6.6.1). .claude/settings.json runs this script as a hook on
// PostToolUse (edit tools and Bash), Stop and SubagentStop. See lib/stop-gate-core.mjs.
//
// Hook mode (no arguments): reads the hook input from stdin. It writes one JSON object or nothing.
// It always exits 0. An error gives `decision: "block"` with the error text, so a crash blocks.
// The import of the core is inside the try block, so a load error blocks too.
//
// Deferral (main session only): node tooling/repo-checks/scripts/stop-gate.mjs defer "<reason>"
// This prints the reason. The PostToolUse hook on Bash records the deferral.
//
// The owner turns the gate off with FACTORY_STOP_GATE=off.
import path from 'node:path';

/**
 * @param {string[]} words - Command-line arguments after "defer".
 * @returns {{ text: string, code: number }} Output and exit code of the defer command.
 */
function defer(words) {
  const reason = words.join(' ').replaceAll(/\s+/g, ' ').trim();
  if (reason === '') {
    return {
      text: 'Usage: node tooling/repo-checks/scripts/stop-gate.mjs defer "<reason>"\n',
      code: 1,
    };
  }
  return {
    text: `stop-gate: deferral requested: ${reason}\nThe hook records it for the main session only. The next code change blocks again.\n`,
    code: 0,
  };
}

/**
 * @param {unknown} error - Error.
 * @returns {string} Hook output (JSON) that blocks with the error text.
 */
function blockOnError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return JSON.stringify({
    decision: 'block',
    reason: `Verify gate error: ${message}\nFix the cause. The owner can set FACTORY_STOP_GATE=off to turn the gate off.`,
  });
}

if (import.meta.main) {
  const [, , mode, ...rest] = process.argv;
  if (mode === 'defer') {
    const { text, code } = defer(rest);
    process.stdout.write(text);
    process.exitCode = code;
  } else {
    let output;
    try {
      const { readStdin } = await import('./lib/fs-io.mjs');
      const { handle } = await import('./lib/stop-gate-core.mjs');
      const { gateEnvironment } = await import('./lib/stop-gate.config.mjs');
      output = handle(readStdin(), {
        root: path.resolve(import.meta.dirname, '../../..'),
        env: gateEnvironment(),
      });
    } catch (error) {
      output = blockOnError(error);
    }
    if (output) {
      process.stdout.write(`${output}\n`);
    }
    process.exitCode = 0;
  }
}

export { defer };
