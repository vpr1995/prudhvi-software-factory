// Shared parts of the /factory state code (design factory-daily-run 4.3): errors, paths, input
// checks and the lock (R-53). Refusals throw FactoryError. The caller prints the message and exits
// non-zero.
import path from 'node:path';

import { createExclusive, readOptional, removeFile, renameIfExists } from './fs-io.mjs';

export class FactoryError extends Error {}
/** The lock is held by a live process. A caller can retry. */
export class LockHeldError extends FactoryError {}

export const fail = (message) => {
  throw new FactoryError(message);
};

// The stages of a ticket that the run still works on. `green` waits for the owner (design 4.4).
export const IN_FLIGHT = new Set(['building', 'reviewing', 'ci']);
export const AD_HOC = 'adhoc';
export const PRE_PR = 'pre-pr';
const PLAIN_NAME = /^[a-z][a-z0-9-]*$/;

export const stateFolder = (root) => path.join(root, '.claude', 'factory');
export const relative = (root, file) => path.relative(root, file);

export function ticketNumber(text) {
  if (text === undefined || !/^[1-9]\d*$/.test(text)) {
    fail(`ticket number must be a positive integer, got "${String(text)}"`);
  }
  return text;
}

export function plainName(text, what) {
  if (text === undefined || !PLAIN_NAME.test(text)) {
    fail(`${what} must be lowercase letters, digits and "-", got "${String(text)}"`);
  }
  return text;
}

export function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    return fail(`${what}: not valid JSON`);
  }
}

export const MAX_INPUT_BYTES = 1024 * 1024;

/** @returns {string} All of stdin. Refuses input of more than 1 MiB. Reads at most 1 MiB + 1 byte. */
export function readInput(context) {
  const text = context.stdin(MAX_INPUT_BYTES + 1);
  if (Buffer.byteLength(text) > MAX_INPUT_BYTES) fail('stdin is bigger than 1 MiB');
  return text;
}

export const timestamp = (date) => date.toISOString().replace(/\.\d+Z$/, 'Z');

// Lock (R-53)

/** @returns {boolean} True when a process with this pid exists (`kill 0`). No signal is sent. */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

const lockFile = (root) => path.join(stateFolder(root), 'lock');

/**
 * Takes over a lock of a dead process. The rename is atomic, so one process only moves the stale
 * file. When the moved file is not the stale holder, another process took the lock between the
 * check and the rename: put it back and fail. When the put back fails too, a third process made a
 * new lock in the window. Keep the stale file, so no holder is lost, and fail with both paths.
 *
 * @param {object} context - Command context (root, pid).
 * @param {string | undefined} holder - Pid text that the caller found in the lock.
 */
export function takeOverStale(context, holder) {
  const file = lockFile(context.root);
  const shown = relative(context.root, file);
  const { pid } = context;
  const taken = () => fail(`lock taken by another process: ${shown}`);
  const stale = `${file}.stale.${String(pid)}`;
  if (renameIfExists(file, stale)) {
    const moved = readOptional(stale);
    if (moved?.trim() !== holder) {
      if (!createExclusive(file, moved ?? '')) {
        fail(
          `lock restore failed: ${shown} was taken again while ${relative(context.root, stale)} ` +
            'holds the moved lock. Two holders can exist. The owner must check.',
        );
      }
      removeFile(stale);
      taken();
    }
    removeFile(stale);
  }
  if (!createExclusive(file, String(pid))) taken();
}

function acquireLock(context) {
  const file = lockFile(context.root);
  const shown = relative(context.root, file);
  if (createExclusive(file, String(context.pid))) return file;
  const holder = readOptional(file)?.trim();
  if (holder !== undefined) {
    if (!/^\d+$/.test(holder)) fail(`lock file has no valid pid: remove ${shown}`);
    if (isAlive(Number(holder))) {
      throw new LockHeldError(`lock held by pid ${holder} (a live process): ${shown}`);
    }
  }
  takeOverStale(context, holder);
  return file;
}

const LOCK_TRIES = 20;
const LOCK_RETRY_MS = 100;

/** Sleeps in this thread. A background command or a hook has nothing else to do in the thread. */
export function sleepFor(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// A live holder: try again every 100 ms, 20 times (about 2 s). `context.sleep` is for tests.
function acquirePatiently(context) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return acquireLock(context);
    } catch (error) {
      if (!(error instanceof LockHeldError) || attempt >= LOCK_TRIES) throw error;
      (context.sleep ?? sleepFor)(LOCK_RETRY_MS);
    }
  }
}

function runLocked(context, file, action) {
  try {
    return action();
  } finally {
    if (readOptional(file)?.trim() === String(context.pid)) removeFile(file);
  }
}

export function withLock(context, action) {
  return runLocked(context, acquireLock(context), action);
}

/** Like `withLock`, but a lock held by a live process is tried again for about 2 s first. */
export function withPatientLock(context, action) {
  return runLocked(context, acquirePatiently(context), action);
}
