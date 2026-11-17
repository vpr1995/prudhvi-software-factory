// Pure rules of the `start` queue (design factory-daily-run 2: R-7, R-36, R-43; 4.5). No gh, no
// file system. lib/factory-queue.mjs calls them with data that it read from GitHub.
import path from 'node:path';

const ACCEPTANCE_HEADING = '### Acceptance';
const CHECKBOX = /^- \[[ xX]\] /;
const ANY_HEADING = /^#{1,3} /;
const PATHS_LINE = /^(?:\*\*Paths:\*\*|Paths:)[ \t]*(.*)$/gm;
const BACKTICKED = /`([^`]+)`/g;
const SPLIT_WORDS = /[\s,]+/;
const GLOB_CHARACTER = /[*?[{]/;
const SCOPE = /'([^']+)'/g;
const CLOSES = /\bCloses #(\d+)/gi;
// The paths that a ticket must not name (R-43), in lower case: a file system can ignore the case.
const FORBIDDEN = ['tooling/repo-checks', '.claude/settings.json'];
const MAIN = 'main';
// A stack is at most 2 PRs deep (R-36). A chain with a loop stops at this many steps.
const MAX_CHAIN = 10;

/** @returns {boolean} True when a checkbox line follows the Acceptance heading, before the next heading. */
export function hasAcceptance(body) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === ACCEPTANCE_HEADING);
  if (start === -1) return false;
  for (const line of lines.slice(start + 1)) {
    if (ANY_HEADING.test(line)) return false;
    if (CHECKBOX.test(line)) return true;
  }
  return false;
}

/**
 * @param {string} body - Ticket body.
 * @returns {string[]} The tokens of every `Paths:` line (also `**Paths:**`): the backticked parts
 *   and the bare words. A token is raw: `namesForbiddenPath` cleans it.
 */
export function pathsOf(body) {
  return [...body.matchAll(PATHS_LINE)].flatMap((match) => {
    const line = match[1];
    const ticked = [...line.matchAll(BACKTICKED)].map((tick) => tick[1].trim());
    const words = line.replaceAll(BACKTICKED, ' ').split(SPLIT_WORDS);
    return [...ticked, ...words].filter((token) => token !== '');
  });
}

/** @returns {string} The token as a clean path from the repo root: no `./`, `..`, `//`, or `/` at the ends. */
function cleanPath(token) {
  // Trailing punctuation goes. A dot after `/` or `.` is a path part (`..`), so it stays.
  const unpunctuated = token
    .replace(/^\(+/, '')
    .replace(/([^./])\.+$/, '$1')
    .replace(/[,;)]+$/, '')
    .replace(/([^./])\.+$/, '$1');
  const clean = path.posix
    .normalize(unpunctuated.length === 0 ? '.' : unpunctuated)
    .replace(/^\/+/, '')
    .replace(/^(?:\.\.\/)+/, '')
    .replace(/\/+$/, '');
  return clean === '..' || clean === '' ? '.' : clean.toLowerCase();
}

const insideOrSame = (file, folder) => file === folder || file.startsWith(`${folder}/`);

function isForbidden(token) {
  const clean = cleanPath(token);
  const glob = GLOB_CHARACTER.exec(clean);
  if (glob !== null) {
    // The part before the glob is fixed. The glob can reach a forbidden path when that part is a
    // parent of it, or is inside it.
    const prefix = clean.slice(0, glob.index);
    return FORBIDDEN.some((entry) => entry.startsWith(prefix) || insideOrSame(prefix, entry));
  }
  return (
    clean === '.' ||
    FORBIDDEN.some((entry) => insideOrSame(clean, entry) || insideOrSame(entry, clean))
  );
}

/**
 * @param {string[]} paths - Tokens of `pathsOf`.
 * @returns {boolean} True when a token names tooling/repo-checks or .claude/settings.json, or a
 *   parent folder of them, or a glob that can reach them (R-43).
 */
export function namesForbiddenPath(paths) {
  return paths.some((token) => isForbidden(token));
}

/**
 * @param {string} text - Output of `gh auth status`.
 * @returns {Set<string>} The token scopes of the active account. Empty when it cannot be found.
 */
export function activeScopes(text) {
  const accounts = text.split('Logged in to').slice(1);
  const active =
    accounts.find((account) => account.includes('Active account: true')) ??
    (accounts.length === 1 ? accounts[0] : '');
  const line = active.split('\n').find((entry) => entry.includes('Token scopes:')) ?? '';
  return new Set([...line.matchAll(SCOPE)].map((match) => match[1]));
}

/**
 * @param {object[]} events - Issue events, oldest first or not.
 * @param {string} label - Label name.
 * @returns {string | undefined} The login of the actor of the last `labeled` event of the label.
 */
export function labelActor(events, label) {
  const added = events
    .filter((entry) => entry?.event === 'labeled' && entry.label?.name === label)
    .toSorted((first, second) => Date.parse(first.created_at) - Date.parse(second.created_at));
  const login = added.at(-1)?.actor?.login;
  return typeof login === 'string' ? login : undefined;
}

/** @returns {number[]} The issue numbers that a PR body closes with `Closes #<n>`. */
export function closedBy(body) {
  return [...String(body ?? '').matchAll(CLOSES)].map((match) => Number(match[1]));
}

/**
 * @param {{ headRefName: string, baseRefName: string }} pr - A PR.
 * @param {object[]} prs - The open PRs.
 * @returns {number} The stack depth of the PR: 1 for a PR on `main`, else 1 + the depth of the PR
 *   that owns its base branch.
 */
export function prDepth(pr, prs) {
  let depth = 1;
  let current = pr;
  while (current.baseRefName !== MAIN && depth <= MAX_CHAIN) {
    const parent = prs.find((entry) => entry.headRefName === current.baseRefName);
    if (parent === undefined) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

/** @returns {boolean} True when a label list (names or `{ name }` objects) has needs-human. */
export function hasNeedsHuman(labels) {
  return (labels ?? []).some((label) => (label?.name ?? label) === 'needs-human');
}
