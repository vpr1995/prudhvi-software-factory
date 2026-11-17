// Shared parts of the /factory state code (design factory-daily-run 4.3): errors, paths, input
// checks and the lock (R-53). Refusals throw FactoryError. The caller prints the message and exits
// non-zero.
import path from 'node:path';

import { createExclusive, readOptional, removeFile } from './fs-io.mjs';

export class FactoryError extends Error {}

export const fail = (message) => {
  throw new FactoryError(message);
};

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

export const timestamp = (date) => date.toISOString().replace(/\.\d+Z$/, 'Z');

// Lock (R-53)

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

function acquireLock(context) {
  const file = path.join(stateFolder(context.root), 'lock');
  const shown = relative(context.root, file);
  if (createExclusive(file, String(context.pid))) return file;
  const holder = readOptional(file)?.trim();
  if (holder !== undefined) {
    if (!/^\d+$/.test(holder)) fail(`lock file has no valid pid: remove ${shown}`);
    if (isAlive(Number(holder))) fail(`lock held by pid ${holder} (a live process): ${shown}`);
  }
  removeFile(file);
  if (!createExclusive(file, String(context.pid))) fail(`lock taken by another process: ${shown}`);
  return file;
}

export function withLock(context, action) {
  const file = acquireLock(context);
  try {
    return action();
  } finally {
    removeFile(file);
  }
}
