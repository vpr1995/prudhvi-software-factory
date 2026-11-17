// Agent comments (design factory-daily-run 4.1, R-8). Each agent comment goes through
// `postComment`: redact, add the marker line, cap the size, post through the gh wrapper. The body
// goes to gh in a temp file (`--body-file`), never in argv, because it can hold backticks.
import path from 'node:path';

import { fail, readInput, stateFolder, ticketNumber, withLock } from './factory-base.mjs';
import { redact } from './factory-github.mjs';
import { removeFile, writeAtomic } from './fs-io.mjs';

export const MARKER = '<!-- factory-agent -->';
export const MAX_COMMENT_CHARS = 60_000;
const REDACTED = '[redacted]';
const PR_NUMBER = /^[1-9]\d*$/;

// Design 4.1. The key and value pattern spaces stay on one line (design: `\s*`), so a `token:` at the end
// of a line cannot take the next line, a code fence for example. The private key pattern runs on to the END line (or the end of the text), so the key
// body goes too, not only the header line.
const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /(?:secret|token|password|api[_-]?key)[^\S\n]*[:=][^\S\n]*\S+/gi,
];
const HOME_PATH = /\/(?:Users|home)\/[^/\s]+/g;

/** @returns {string} The text with secret-like strings replaced with [redacted] and home paths with ~. */
export function redactText(text) {
  const cleaned = SECRET_PATTERNS.reduce(
    (value, pattern) => value.replace(pattern, REDACTED),
    text,
  );
  return redact(cleaned).replaceAll(HOME_PATH, '~');
}

/** @returns {string} The body, redacted, starting with the marker line, at most 60,000 characters. */
export function buildComment(body) {
  const text = redactText(body);
  const marked = text.split('\n', 1)[0] === MARKER ? text : `${MARKER}\n${text}`;
  return marked.slice(0, MAX_COMMENT_CHARS);
}

/**
 * Posts one agent comment. The caller holds the lock.
 *
 * @param {object} context - Command context (root, gh, pid).
 * @param {{ ticket: string, pr?: string }} target - Ticket, and a PR number to post on the PR.
 * @param {string} body - Comment text.
 */
export function postComment(context, { ticket, pr }, body) {
  const file = path.join(
    stateFolder(context.root),
    ticket,
    'logs',
    `comment-${String(context.pid)}.md`,
  );
  writeAtomic(file, buildComment(body));
  try {
    context.gh(
      pr === undefined
        ? ['issue', 'comment', ticket, '--body-file', file]
        : ['pr', 'comment', pr, '--body-file', file],
    );
  } finally {
    removeFile(file);
  }
}

/** @returns {string} The line to print. Body on stdin. */
export function commentCommand(words, context) {
  const [ticketWord, flag, pr, ...rest] = words;
  const ticket = ticketNumber(ticketWord);
  const usage = 'Usage: comment <n> [--pr <m>]   (body on stdin)';
  if (flag !== undefined && (flag !== '--pr' || pr === undefined || !PR_NUMBER.test(pr)))
    fail(usage);
  if (rest.length > 0) fail(usage);
  const body = readInput(context);
  if (body.trim() === '') fail('comment body is empty: put the text on stdin');
  return withLock(context, () => {
    postComment(context, { ticket, pr }, body);
    return `#${ticket}: comment posted on ${pr === undefined ? 'the issue' : `PR #${pr}`}\n`;
  });
}
