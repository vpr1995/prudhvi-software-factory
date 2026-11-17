// The gh wrapper and the hard stop error of the /factory script (design factory-daily-run 4.1,
// R-54). Each gh call goes through `gh`: one retry, then a hard stop. `main` catches
// `HardStopError` in one place and exits 3. The agent then runs `hardstop` with the reason.
import { execFileSync } from 'node:child_process';

import { FactoryError } from './factory-base.mjs';

export const COMMAND_TIMEOUT_MS = 30_000;
// git push and git fetch go to the network and run the repo hooks: give them more time.
export const GIT_TIMEOUT_MS = 120_000;
// A hard-stop patch can be big: the node default of 1 MiB is too small.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_REASON_CHARS = 300;
// `scheme://user:pass@` and `scheme://token@`, then bare tokens of GitHub. The scheme has at most 32
// characters: a longer text of scheme characters (`a-a-a-`) would be quadratic. The match can start
// inside a longer word: the characters before it stay, the credentials go.
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]{0,31}):\/\/[^\s/@]+@/gi;
const TOKENS = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g;

export const redact = (text) =>
  text.replaceAll(URL_CREDENTIALS, '$1://***@').replaceAll(TOKENS, '***');

/** @returns {string} Stdout of the command. A command that runs longer than the timeout throws. */
export function run(command, args, timeout = COMMAND_TIMEOUT_MS) {
  return execFileSync(command, args, { encoding: 'utf8', timeout, maxBuffer: MAX_OUTPUT_BYTES });
}

/** A refusal that must stop the run. The message is `hard stop: <reason>`. */
export class HardStopError extends FactoryError {
  code = 'hard-stop';

  /**
   * @param {string} reason - Why the run stops.
   * @param {string} [ticket] - Ticket number as text, when the caller knows it.
   */
  constructor(reason, ticket) {
    super(`hard stop: ${reason}`);
    this.reason = reason;
    this.ticket = ticket;
  }
}

export const hardStop = (reason, ticket) => {
  throw new HardStopError(reason, ticket);
};

/** @returns {string} The stderr of a failed command, else the error message, on one capped line. Secrets are redacted first. */
export function failureReason(error) {
  const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : '';
  const text = stderr === '' ? (error instanceof Error ? error.message : String(error)) : stderr;
  return redact(text)
    .replaceAll(/\s*\n\s*/g, ' | ')
    .slice(0, MAX_REASON_CHARS);
}

/**
 * @param {(command: string, args: string[]) => string} [exec] - Runs a command. A test replaces it.
 * @returns {(args: string[]) => string} Runs gh. A failed call is retried once. A second failure
 *   throws HardStopError.
 */
export function createGh(exec = run) {
  return (args) => {
    try {
      return exec('gh', args);
    } catch {
      try {
        return exec('gh', args);
      } catch (error) {
        return hardStop(`gh ${args.slice(0, 2).join(' ')} failed twice: ${failureReason(error)}`);
      }
    }
  };
}

export const gh = createGh();
