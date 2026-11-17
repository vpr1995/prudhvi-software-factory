// Agent comments (design factory-daily-run 4.1, R-8). Each agent comment goes through
// `postComment`: redact, add the marker line, cap the size, post through the gh wrapper. The body
// goes to gh in a temp file (`--body-file`), never in argv, because it can hold backticks.
import path from 'node:path';

import { fail, readInput, stateFolder, ticketNumber, withLock } from './factory-base.mjs';
import { redact } from './factory-github.mjs';
import { loadTicket, saveTicket } from './factory-state.mjs';
import { removeFile, writeAtomic } from './fs-io.mjs';

export const MARKER = '<!-- factory-agent -->';
export const MAX_COMMENT_CHARS = 60_000;
const REDACTED = '[redacted]';
const ZERO_WIDTH_SPACE = '\u200B';
const KINDS = new Set(['hard-stop', 'reply']);
const COMMENT_ID = /^[1-9]\d{0,14}$/;
const USAGE = 'Usage: comment <n> <hard-stop|reply> [<reply-to-id>]   (body on stdin)';

// Design 4.1, widened. Spaces stay on one line (`[^\S\n]`), so a `token:` at the end of a line cannot
// take the next line, a code fence for example. A key is a keyword with up to 24 name characters after
// it and an optional quote on each side. The text before the keyword (`AWS_`) stays. The limit keeps
// the match fast on a long word. The value is a `Bearer` or `Basic` word pair, a quoted text, or a
// word. The private key pattern runs on to the END line (or the end of the text), so the key body goes
// too, not only the header line.
const SECRET_PATTERNS = [
  /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /npm_[A-Za-z0-9]{36}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  // A JWT starts at the start of a word: `(?<![\w-])` keeps the scan linear on `eyJeyJeyJ`.
  /(?<![\w-])eyJ[\w-]+\.[\w-]+\.[\w-]+/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  // key, separator, value. The key is in a string, in JSON with escaped quotes: `{\"token\":\"x\"}`
  /(?:\\")?(?:secret|token|password|passwd|(?:api|access)[_-]?key|authorization)[\w-]{0,24}\\"[^\S\n]*(?:=>|[:=])[^\S\n]*\\"[^"\\\n]*\\"/gi,
  // key, separator, value. A quoted value ends at the first quote with no backslash before it.
  /["']?(?:secret|token|password|passwd|api[_-]?key|access[_-]?key|authorization)[\w-]{0,24}["']?[^\S\n]*(?:=>|[:=])[^\S\n]*(?:(?:Bearer|Basic)[^\S\n]+\S+|"[^\n]*?(?<!\\)"|'[^\n]*?(?<!\\)'|\S+)/gi,
  // flag and value
  /--(?:password|passwd|token|secret|api[_-]?key|access[_-]?key)[^\S\n]+(?!-)(?:(?:Bearer|Basic)[^\S\n]+\S+|"[^"\n]*"|'[^'\n]*'|\S+)/gi,
];
// Windows home first, then /Users and /home, then /root (not /rooted, not a/root/b).
const HOME_PATHS = [
  /[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/g,
  /\/(?:Users|home)\/[^/\s]+/g,
  /(?<![\w./-])\/root(?![\w-])/g,
];

/** @returns {string} The text with secret-like strings replaced with [redacted] and home paths with ~. */
export function redactText(text) {
  const cleaned = SECRET_PATTERNS.reduce(
    (value, pattern) => value.replace(pattern, REDACTED),
    text,
  );
  return HOME_PATHS.reduce((value, pattern) => value.replaceAll(pattern, '~'), redact(cleaned));
}

// A fence line is 3 or more backticks or tildes with up to 3 spaces before. A closer has the same
// character, at least the same length, and nothing after it. Inline code is a backtick run, text,
// and a run of the same length. An `@` before a letter or digit gets a zero-width space, so GitHub
// pings nobody. A wrong guess must err on the side of a space: a fence that never closes runs to
// the end of the text, as it does on GitHub.
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const INLINE_CODE_OR_MENTION = /(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)|@(?=[A-Za-z0-9])/g;

const neutralize = (line) =>
  line.replaceAll(INLINE_CODE_OR_MENTION, (found) =>
    found === '@' ? `@${ZERO_WIDTH_SPACE}` : found,
  );

function closesFence(line, fence) {
  const found = FENCE_LINE.exec(line);
  return (
    found !== null &&
    found[1][0] === fence[0] &&
    found[1].length >= fence.length &&
    found[2].trim() === ''
  );
}

/** @returns {string} The text with a zero-width space after each @ outside code fences and inline code. */
export function neutralizeMentions(text) {
  let fence;
  return text
    .split('\n')
    .map((line) => {
      if (fence !== undefined) {
        if (closesFence(line, fence)) fence = undefined;
        return line;
      }
      const opens = FENCE_LINE.exec(line);
      // A backtick fence has no backtick in its info text. A line like ```x``` is inline code.
      if (opens !== null && !(opens[1][0] === '`' && opens[2].includes('`'))) {
        [, fence] = opens;
        return line;
      }
      return neutralize(line);
    })
    .join('\n');
}

/** @returns {string} The body, redacted, starting with the marker line, at most 60,000 characters. */
export function buildComment(body) {
  const text = neutralizeMentions(redactText(body));
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

// The reply thread target (PR review comment or issue comment) is task 6 (#101). Until then a reply
// goes on the PR of ticket.json, or on the issue when the ticket has no PR. A hard stop goes on the issue.
function targetOf(kind, state) {
  const pr = state?.pr;
  return kind === 'reply' && Number.isInteger(pr) && pr > 0 ? String(pr) : undefined;
}

function markHandled(context, ticket, commentId) {
  const state = loadTicket(context.root, ticket);
  const handled = state.handledComments ?? [];
  if (handled.map(String).includes(commentId)) return;
  saveTicket(context.root, ticket, { ...state, handledComments: [...handled, Number(commentId)] });
}

/** @returns {string} The line to print. Body on stdin. */
export function commentCommand(words, context) {
  const [ticketWord, kind, replyTo, ...rest] = words;
  const ticket = ticketNumber(ticketWord);
  if (!KINDS.has(kind)) fail(`unknown kind "${String(kind)}". ${USAGE}`);
  const badId = replyTo !== undefined && (kind !== 'reply' || !COMMENT_ID.test(replyTo));
  if (badId || rest.length > 0) fail(USAGE);
  const body = readInput(context);
  if (body.trim() === '') fail('comment body is empty: put the text on stdin');
  return withLock(context, () => {
    // A hard stop needs no ticket state: a broken ticket.json must not stop it.
    const state = kind === 'reply' ? loadTicket(context.root, ticket) : undefined;
    if (replyTo !== undefined && state === undefined) {
      fail(`#${ticket} has no ticket state: cannot store comment ${replyTo} as handled`);
    }
    const pr = targetOf(kind, state);
    postComment(context, { ticket, pr }, body);
    if (replyTo !== undefined) markHandled(context, ticket, replyTo);
    return `#${ticket}: comment posted on ${pr === undefined ? 'the issue' : `PR #${pr}`}\n`;
  });
}
