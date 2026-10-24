// Keeps the logs of a failed gate step, so a rerun never erases the evidence. Rush writes
// `<project>/rush-logs` and Playwright writes `projects/<name>/test-results` again on each run.
// When a step fails, this module copies each of these folders that exists to
// `.claude/state/failure-logs/<UTC yyyymmddThhmmssZ>-<step slug>/`, with the same paths from the
// repo root, and writes `failure.txt` with the step and its report. It keeps the newest 10 folders.
// Callers: scripts/gates/local-gates.sh (through scripts/gates/keep-failure-logs.mjs) and the Stop
// hook (lib/stop-run.mjs). `.claude/state/` is git-ignored, and the gate integrity walk skips it.
import path from 'node:path';

import { copyTree, exists, inspectPath, listDirectory, removePath, writeText } from './fs-io.mjs';

/** The folder for kept logs, from the repo root. */
export const FAILURE_LOGS_FOLDER = '.claude/state/failure-logs';
/** The number of kept folders. A new folder removes the oldest one above this number. */
export const KEEP_COUNT = 10;
/** The parent folders of Rush projects, and the log folders in each project. */
const LOG_FOLDERS = Object.freeze({
  projects: ['rush-logs', 'test-results'],
  packages: ['rush-logs'],
  platform: ['rush-logs'],
  tooling: ['rush-logs'],
});
const KEPT_NAME = /^\d{8}T\d{6}Z-/;
const SLUG_LENGTH = 60;

/**
 * Writes a time as a UTC stamp.
 *
 * @param {Date} date - The time.
 * @returns {string} `yyyymmddThhmmssZ`, for example `20261023T101112Z`.
 */
export function utcStamp(date) {
  return date
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replaceAll(/[-:]/g, '');
}

/**
 * Makes a folder-name slug of a step name.
 *
 * @param {string} step - Step name, for example `rush verify --impacted-by git:abc`.
 * @returns {string} Lowercase letters, digits and single dashes, at most 60 characters. `step` when empty.
 */
export function stepSlug(step) {
  const slug = step
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_LENGTH)
    .replaceAll(/^-+|-+$/g, '');
  return slug === '' ? 'step' : slug;
}

/**
 * Lists the log folders that exist now.
 *
 * @param {string} root - Repo root.
 * @returns {string[]} Folder paths from the repo root, such as `projects/sample/rush-logs`. A link is not a folder here.
 */
export function logFolders(root) {
  return Object.entries(LOG_FOLDERS).flatMap(([parent, names]) =>
    listDirectory(path.join(root, parent))
      .filter((entry) => entry.isDirectory)
      .flatMap((entry) => names.map((name) => `${parent}/${entry.name}/${name}`))
      .filter((folder) => inspectPath(path.join(root, folder))?.kind === 'dir'),
  );
}

/**
 * Finds a folder name that is not used yet.
 *
 * @param {string} base - The failure-logs folder.
 * @param {string} name - The first choice.
 * @returns {string} `name`, or `name-2`, `name-3` and so on.
 */
function freeName(base, name) {
  let candidate = name;
  for (let count = 2; exists(path.join(base, candidate)); count += 1) {
    candidate = `${name}-${String(count)}`;
  }
  return candidate;
}

/**
 * Removes the oldest kept folders, so that at most KEEP_COUNT stay. The new folder always stays.
 *
 * @param {string} base - The failure-logs folder.
 * @param {string} newest - Name of the folder just made.
 * @returns {void}
 */
function prune(base, newest) {
  const older = listDirectory(base)
    .filter((entry) => entry.isDirectory && KEPT_NAME.test(entry.name) && entry.name !== newest)
    .map((entry) => entry.name)
    .sort();
  for (const name of older.slice(0, Math.max(0, older.length - (KEEP_COUNT - 1)))) {
    removePath(path.join(base, name));
  }
}

/**
 * Writes the text of `failure.txt`.
 *
 * @param {{ step: string, time: string, folders: string[], report: string }} details - What failed and what was copied.
 * @returns {string} The text.
 */
function summaryText(details) {
  const copied =
    details.folders.length === 0
      ? ['No rush-logs or test-results folder existed.']
      : details.folders.map((folder) => `- ${folder}`);
  return [
    `Step: ${details.step}`,
    `Time (UTC): ${details.time}`,
    'Copied folders:',
    ...copied,
    ...(details.report === '' ? [] : ['', 'Report:', details.report]),
    '',
  ].join('\n');
}

/**
 * Copies the log folders of a failed step.
 *
 * @param {string} root - Repo root.
 * @param {{ step: string, report?: string, now?: Date }} options - The step name, its report (for
 *   `failure.txt`) and the time (default: now).
 * @returns {string} The new folder, from the repo root. It throws when a copy fails.
 */
export function keepFailureLogs(root, options) {
  const now = options.now ?? new Date();
  const base = path.join(root, FAILURE_LOGS_FOLDER);
  const name = freeName(base, `${utcStamp(now)}-${stepSlug(options.step)}`);
  const target = path.join(base, name);
  const folders = logFolders(root);
  for (const folder of folders) {
    copyTree(path.join(root, folder), path.join(target, folder));
  }
  writeText(
    path.join(target, 'failure.txt'),
    summaryText({
      step: options.step,
      time: now.toISOString(),
      folders,
      report: options.report ?? '',
    }),
  );
  prune(base, name);
  return `${FAILURE_LOGS_FOLDER}/${name}`;
}

/**
 * Writes the line that tells where the logs are.
 *
 * @param {string} folder - The kept folder, from the repo root.
 * @returns {string} The line.
 */
export function keptMessage(folder) {
  return `Logs kept in ${folder}. Read them before you rerun.`;
}

/**
 * Keeps the logs of a failed step and gives the line to print. It never throws: a failed copy must
 * not hide the failure of the step.
 *
 * @param {string} root - Repo root.
 * @param {{ step: string, report?: string, now?: Date }} options - See keepFailureLogs.
 * @returns {string} `Logs kept in <path>. Read them before you rerun.`, or why the logs were not kept.
 */
export function keepFailureLogsNote(root, options) {
  try {
    return keptMessage(keepFailureLogs(root, options));
  } catch (error) {
    return `The failure logs were not kept: ${error instanceof Error ? error.message : String(error)}`;
  }
}
