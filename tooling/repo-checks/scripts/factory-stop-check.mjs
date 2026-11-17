// The factory Stop hook for Claude Code (design factory-daily-run 4.7; R-44, R-45, R-48, R-56).
// .claude/settings.json runs this script on the Stop event, next to the verify gate. The logic is
// in lib/factory-stop-check.mjs.
//
// The script reads the hook input from stdin. It writes one JSON object that blocks, or nothing.
// It always exits 0. Only the JSON output blocks.
// Every import of its own code is inside a try block, so a load error is an error of the check.
// With no open run it allows at once: it loads nothing but lib/fs-io.mjs.
//
// R-56: an error blocks and names the error, but only while a run is open and only the owner of the
// run. After 3 errors in a row it allows the stop and prints the error. The count is in
// .claude/factory/stop-errors. A good check of the owner removes the file. Another session (the
// run has a session id that is not the session of the hook input) is allowed at once and never
// moves the count. A stop that hits a held lock is allowed and leaves the count as it is.
// The entry finds the owner with a plain JSON.parse: it loads no lib code.
//
// The owner turns the factory off with FACTORY_RUN=off (R-45).
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const RUN_FILE = path.join(ROOT, '.claude', 'factory', 'run.json');
const ERRORS_FILE = path.join(ROOT, '.claude', 'factory', 'stop-errors');
const MAX_ERRORS = 3;

/** @returns {boolean} True when run.json text is an open run (active or stalled). A bad file counts as open: the core reports it. */
function isOpen(text) {
  try {
    const run = JSON.parse(text);
    return run?.active === true || run?.stalled === true;
  } catch {
    return true;
  }
}

/** @returns {boolean} True when run.json has an owner session and the hook session is another one. A bad text or input gives false: the core reports it. */
function isOtherSession(input, text) {
  try {
    const owner = JSON.parse(text)?.sessionId;
    const session = JSON.parse(input)?.session_id;
    const named = owner !== null && owner !== undefined && owner !== '';
    return named && typeof session === 'string' && session !== '' && owner !== session;
  } catch {
    return false;
  }
}

// The hook input, for the error path. The entry reads stdin once.
const hookInput = { text: '' };

async function check() {
  const { readOptional, readStdin, removeFile } = await import('./lib/fs-io.mjs');
  const input = readStdin();
  hookInput.text = input;
  const text = readOptional(RUN_FILE);
  let output;
  let lockHeld = false;
  if (text !== undefined && isOpen(text)) {
    const { handleStopCheck } = await import('./lib/factory-stop-check.mjs');
    const { isRunOff } = await import('./lib/factory.config.mjs');
    ({ output, lockHeld } = handleStopCheck(input, {
      root: ROOT,
      now: () => new Date(),
      pid: process.pid,
      runOff: isRunOff,
      err: (line) => process.stderr.write(line),
    }));
  }
  // Only the owner (or the claiming session) has a good check. Else the count is not theirs.
  // A held lock is no check: the stop is allowed and the count stays.
  if (!lockHeld && (text === undefined || !isOpen(text) || !isOtherSession(input, text))) {
    removeFile(ERRORS_FILE);
  }
  return output;
}

/** @returns {Promise<string | undefined>} The block output, or undefined to allow. The error goes to stderr when the stop is allowed. */
async function onError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  try {
    const { readOptional, writeAtomic } = await import('./lib/fs-io.mjs');
    const text = readOptional(RUN_FILE);
    if (text === undefined || !isOpen(text)) {
      process.stderr.write(`factory stop-check error (no open run): ${message}\n`);
      return;
    }
    if (isOtherSession(hookInput.text, text)) {
      process.stderr.write(`factory stop-check error (another session, allowed): ${message}\n`);
      return;
    }
    const before = Number.parseInt(readOptional(ERRORS_FILE) ?? '0', 10);
    const count = (Number.isInteger(before) && before > 0 ? before : 0) + 1;
    writeAtomic(ERRORS_FILE, `${String(count)}\n`);
    if (count < MAX_ERRORS) {
      return JSON.stringify({
        decision: 'block',
        reason: `Factory stop check error (${String(count)} of ${String(MAX_ERRORS)}): ${message}\nFix the cause. The owner can set FACTORY_RUN=off to turn the factory off.`,
      });
    }
  } catch {
    // The state files do not work: allow the stop and print the error below.
  }
  process.stderr.write(`factory stop-check error: ${message}\n`);
}

if (import.meta.main) {
  let output;
  try {
    output = await check();
  } catch (error) {
    output = await onError(error);
  }
  if (output) {
    process.stdout.write(`${output}\n`);
  }
  process.exitCode = 0;
}
