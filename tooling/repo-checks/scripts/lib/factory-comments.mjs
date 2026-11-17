// The review loop of the /factory script (design factory-daily-run 4.3, 4.5; R-9, R-30, R-31).
//
// `findCommentStep` is the seam of `next`: a green ticket whose open PR has a new owner comment
// gives `{ kind: 'comment', ticket, pr }` before a new ticket. A comment is new when it passes the
// owner filter (lib/factory-github.mjs, R-9) and its id is not in `handledComments`. Order: a ticket
// in flight (`building`, `reviewing`, `ci`) resumes first, then owner comments, then a new ticket.
// So `findCommentStep` gives nothing while any local ticket is in flight: two tickets must not be in
// flight. Only a `green` ticket is looked at. `only` of the run limits the scan to one ticket (R-2).
//
// R-31: a new comment in a thread with 3 agent replies (`threadReplies` of ticket.json, counted by
// `comment <n> reply <id>`) is a hard stop. The reason has fixed words and numbers only.
//
// `comments <n>` prints the new owner comments of a ticket: it is the only way the skill reads
// comment text. It writes nothing. `replyTarget` and `repliedState` serve `comment <n> reply <id>`.
import { fail, IN_FLIGHT, ticketNumber } from './factory-base.mjs';
import { hardStop, ownerComments, readPrComments } from './factory-github.mjs';
import { localTickets } from './factory-queue.mjs';
import { ghJson, loadTicket } from './factory-state.mjs';

export const MAX_AGENT_REPLIES = 3;
const COMMENT_STAGE = 'green';
const USAGE = 'Usage: comments <n>';

const byNumber = (left, right) => Number(left) - Number(right);

function ownerOf(context) {
  const login = ghJson(context, ['repo', 'view', '--json', 'nameWithOwner,owner']).owner?.login;
  return typeof login === 'string' && login !== '' ? login : fail('gh repo view: no owner login');
}

/** @returns {number | undefined} The open PR of the branch of the ticket. */
function openPr(context, state) {
  if (typeof state.branch !== 'string' || state.branch === '') return;
  const prs = ghJson(context, [
    'pr',
    'list',
    '--head',
    state.branch,
    '--state',
    'open',
    '--json',
    'number',
  ]);
  return prs.find((pr) => Number.isInteger(pr.number) && pr.number > 0)?.number;
}

const isHandled = (state, comment) =>
  (state.handledComments ?? []).some((id) => String(id) === String(comment.id));

const repliesOf = (state, comment) => state.threadReplies?.[String(comment.thread)] ?? 0;

/** @returns {{ pr: number, fresh: object[] } | undefined} The new owner comments on the open PR. Undefined with no open PR. */
function freshComments(context, { state, owner }) {
  const pr = openPr(context, state);
  if (pr === undefined) return;
  const fresh = ownerComments(readPrComments(context.gh, pr), owner).filter(
    (comment) => !isHandled(state, comment),
  );
  return { pr, fresh };
}

// R-31
function checkThreads(ticket, { state, fresh }) {
  const full = fresh.find((comment) => repliesOf(state, comment) >= MAX_AGENT_REPLIES);
  if (full !== undefined) {
    hardStop(
      `owner comment ${String(full.id)} on #${ticket}: its thread has ${String(MAX_AGENT_REPLIES)} agent replies (R-31)`,
      ticket,
    );
  }
}

/**
 * Looks for a new owner comment. Reads only. Makes no `gh` call when no ticket is green. Gives
 * nothing while a local ticket is in flight: that ticket resumes first.
 *
 * @param {object} context - Command context (root, gh).
 * @param {number | null} only - The ticket of `start <n>`, or null.
 * @returns {{ kind: 'comment', ticket: number, pr: number } | undefined} The step, or undefined.
 * @throws {HardStopError} A new comment is in a thread with 3 agent replies (R-31).
 */
export function findCommentStep(context, only) {
  const tickets = localTickets(context.root, only)
    .toSorted(byNumber)
    .map((ticket) => ({ ticket, state: loadTicket(context.root, ticket) }));
  if (tickets.some(({ state }) => IN_FLIGHT.has(state.stage))) return;
  const green = tickets.filter(({ state }) => state.stage === COMMENT_STAGE);
  if (green.length === 0) return;
  const owner = ownerOf(context);
  for (const { ticket, state } of green) {
    const found = freshComments(context, { state, owner });
    if (found !== undefined && found.fresh.length > 0) {
      checkThreads(ticket, { state, fresh: found.fresh });
      return { kind: 'comment', ticket: Number(ticket), pr: found.pr };
    }
  }
}

function show(state, comment) {
  const place = comment.location === '' ? '' : `, ${comment.location}`;
  const replies = `agent replies in the thread: ${String(repliesOf(state, comment))}`;
  const head = `--- comment ${String(comment.id)}: ${comment.type}, thread ${String(comment.thread)}${place}, ${replies}`;
  return `${head}\n${comment.body.trimEnd()}\n`;
}

/** @returns {string} The new owner comments of the ticket, with ids. `comments <n>`. */
export function commentsCommand(words, context) {
  if (words.length !== 1) fail(USAGE);
  const ticket = ticketNumber(words[0]);
  const state = loadTicket(context.root, ticket);
  if (state === undefined) fail(`#${ticket} has no ticket state`);
  const found = freshComments(context, { state, owner: ownerOf(context) });
  if (found === undefined) return `#${ticket}: no open PR\n`;
  const pr = `PR #${String(found.pr)}`;
  if (found.fresh.length === 0) return `#${ticket}: no new owner comments on ${pr}\n`;
  const head = `#${ticket}: ${String(found.fresh.length)} new owner comments on ${pr}\n`;
  return `${head}${found.fresh.map((comment) => show(state, comment)).join('')}`;
}

/**
 * R-9: a reply goes only to a new owner comment. The id comes from the model, so GitHub is read
 * again and the id must be in the filtered list.
 *
 * @param {object} context - Command context (root, gh).
 * @param {{ ticket: string, state: object, id: string }} target - Ticket, its state, the comment id.
 * @returns {{ pr: number, comment: object }} The PR and the comment.
 */
export function replyTarget(context, { ticket, state, id }) {
  const pr = openPr(context, state) ?? fail(`#${ticket} has no open PR: cannot reply to ${id}`);
  const comment = ownerComments(readPrComments(context.gh, pr), ownerOf(context)).find(
    (entry) => String(entry.id) === id,
  );
  if (comment === undefined) fail(`comment ${id} is not an owner comment of PR #${String(pr)}`);
  if (isHandled(state, comment)) fail(`comment ${id} is already handled`);
  return { pr, comment };
}

/** @returns {object} The ticket state with the comment stored as handled and one more reply in its thread. */
export function repliedState(state, comment) {
  const key = String(comment.thread);
  return {
    ...state,
    handledComments: [...(state.handledComments ?? []), comment.id],
    threadReplies: { ...state.threadReplies, [key]: repliesOf(state, comment) + 1 },
  };
}
