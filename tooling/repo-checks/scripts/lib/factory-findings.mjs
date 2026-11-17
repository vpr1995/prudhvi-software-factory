// The pre-pr state of the /factory run: the round and findings commands (design factory-daily-run
// 4.1 and 4.3, R-27). Each command takes the context that lib/factory-state.mjs describes.
import path from 'node:path';

import {
  AD_HOC,
  fail,
  PRE_PR,
  readInput,
  stateFolder,
  ticketNumber,
  timestamp,
  withLock,
} from './factory-base.mjs';
import { listFolder, readOptional, removeFile, writeAtomic } from './fs-io.mjs';

const SEVERITIES = ['Important', 'Nit'];
const FINDING_STATUSES = ['open', 'fixed', 'rejected'];
const LOCATION = /^[^\s|]+:\d+$/;
const ROW_FIELDS = 6;
const INPUT_FIELDS = 4;

const preprFolder = (root, ticket) => path.join(stateFolder(root), ticket ?? AD_HOC, PRE_PR);
const findingsFile = (root, ticket) => path.join(preprFolder(root, ticket), 'findings.md');

const roundNumbers = (folder) =>
  listFolder(folder)
    .map((name) => /^round-(\d+)\.json$/.exec(name)?.[1])
    .filter((digits) => digits !== undefined)
    .map(Number);

/** Splits `[<n>] <rest...>`: a first word of digits is the ticket. No ticket: the ad hoc folder. */
function splitTicket(words) {
  const [first, ...rest] = words;
  return /^\d+$/.test(first ?? '')
    ? { ticket: ticketNumber(first), rest }
    : { ticket: undefined, rest: words };
}

export function roundCommand(words, context) {
  const { ticket, rest } = splitTicket(words);
  const [action, flag, ...extra] = rest;
  if (action !== 'start' || (flag !== undefined && flag !== '--new') || extra.length > 0) {
    fail('Usage: round [<n>] start [--new]');
  }
  const folder = preprFolder(context.root, ticket);
  return withLock(context, () => {
    const sha = context.git(['rev-parse', 'HEAD']).trim();
    const entry = { sha, ts: timestamp(context.now()) };
    if (flag === '--new') {
      for (const name of listFolder(folder)) removeFile(path.join(folder, name));
    }
    const number = Math.max(0, ...roundNumbers(folder)) + 1;
    writeAtomic(path.join(folder, `round-${String(number)}.json`), `${JSON.stringify(entry)}\n`);
    return `round ${String(number)}\n`;
  });
}

// findings.md row: id | round | severity | file:line | bug class | status | reason

function readRows(root, ticket) {
  const text = readOptional(findingsFile(root, ticket)) ?? '';
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const fields = line.split('|').map((field) => field.trim());
      const [id, round, severity, location, bugClass, status] = fields;
      return {
        id,
        round: Number(round),
        severity,
        location,
        bugClass,
        status,
        reason: fields.slice(ROW_FIELDS).join(' | '),
      };
    });
}

function writeRows(root, ticket, rows) {
  const lines = rows.map((row) =>
    [row.id, row.round, row.severity, row.location, row.bugClass, row.status, row.reason].join(
      ' | ',
    ),
  );
  writeAtomic(findingsFile(root, ticket), lines.length === 0 ? '' : `${lines.join('\n')}\n`);
}

function parseInputRows(text) {
  const rows = text.split('\n').flatMap((line, index) => {
    if (line.trim() === '') return [];
    const where = `line ${String(index + 1)}`;
    const [severity, location, bugClass, ...reason] = line.split('|').map((field) => field.trim());
    if (reason.length === 0 || bugClass === '' || reason.join('') === '') {
      fail(
        `${where}: need ${String(INPUT_FIELDS)} fields: severity | file:line | bug class | reason`,
      );
    }
    if (!SEVERITIES.includes(severity))
      fail(`${where}: severity must be ${SEVERITIES.join(' or ')}`);
    if (!LOCATION.test(location)) fail(`${where}: location must be file:line`);
    return [{ severity, location, bugClass, reason: reason.join(' | ') }];
  });
  if (rows.length === 0) fail('no rows on stdin');
  return rows;
}

const sameFinding = (row, input) =>
  row.location === input.location && row.bugClass.toLowerCase() === input.bugClass.toLowerCase();

function addFindings(context, ticket, inputs) {
  const folder = preprFolder(context.root, ticket);
  const round = Math.max(0, ...roundNumbers(folder));
  if (round === 0) fail('no round started. Run "round start" first');
  const rows = readRows(context.root, ticket);
  const report = inputs.map((input) => {
    const match = rows.find((row) => sameFinding(row, input));
    if (match === undefined) {
      const number = Math.max(0, ...rows.map((row) => Number(row.id.slice(1)))) + 1;
      rows.push({ id: `F${String(number)}`, round, ...input, status: 'open' });
      return `F${String(number)} added`;
    }
    if (input.severity === 'Important' && match.severity === 'Nit' && match.status !== 'fixed') {
      Object.assign(match, { severity: 'Important', status: 'open', reason: input.reason });
      return `${match.id} raised to Important`;
    }
    if (match.status !== 'fixed') return `${match.id} skipped (${match.status})`;
    match.status = 'open';
    return `${match.id} reopened`;
  });
  writeRows(context.root, ticket, rows);
  return `${report.join('\n')}\n`;
}

function setFinding(context, ticket, [id, status]) {
  if (!FINDING_STATUSES.includes(status)) fail(`status must be ${FINDING_STATUSES.join(', ')}`);
  const rows = readRows(context.root, ticket);
  const row = rows.find((entry) => entry.id === id) ?? fail(`no finding ${String(id)}`);
  row.status = status;
  writeRows(context.root, ticket, rows);
  return `${id} ${status}\n`;
}

export function listFindings(context, ticket) {
  return readOptional(findingsFile(context.root, ticket)) ?? '';
}

export function findingsCommand(words, context) {
  const { ticket, rest } = splitTicket(words);
  const [action, ...extra] = rest;
  if (action === 'list') return listFindings(context, ticket);
  if (action === 'add') {
    const inputs = parseInputRows(readInput(context));
    return withLock(context, () => addFindings(context, ticket, inputs));
  }
  if (action === 'set') return withLock(context, () => setFinding(context, ticket, extra));
  return fail('Usage: findings [<n>] add | set <id> <status> | list');
}
