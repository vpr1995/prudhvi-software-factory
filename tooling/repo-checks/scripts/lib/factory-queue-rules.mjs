// Pure rules of the `start` queue (design factory-daily-run 2: R-7, R-36, R-43; 4.5). No gh, no
// file system. lib/factory-queue.mjs calls them with data that it read from GitHub.
import { createHash } from 'node:crypto';
import path from 'node:path';

const ACCEPTANCE_HEADING = '### Acceptance';
const CHECKBOX = /^- \[[ xX]\] /;
const ANY_HEADING = /^#{1,3} /;
const PATHS_LINE = /^(?:\*\*Paths:\*\*|Paths:)[ \t]*(.*)$/gm;
// The protected-path check and its hash only (#146): more label forms than `PATHS_LINE`. Optional
// spaces, list or quote markers (`-`, `*`, `+`, `>`), bold marks, any case of the word.
const PROTECTED_PATHS_LINE = /^[ \t>*+-]*paths\**:\**[ \t]*(.*)$/gim;
// A lone CR, U+2028 or U+2029 ends a regex line: it can cut a `Paths:` line in two.
const LINE_SEPARATOR = /\r(?!\n)|[\u{2028}\u{2029}]/gu;
const BACKTICKED = /`([^`]+)`/g;
const SPLIT_WORDS = /[\s,]+/;
const GLOB_CHARACTER = /[*?[{]/;
const SCOPE = /'([^']+)'/g;
const CLOSES = /\bCloses #(\d+)/gi;
// The protected paths (R-43, #146), in lower case: a file system can ignore the case. A ticket that
// names one in its `Paths:` line needs the approval of the owner.
const FORBIDDEN = ['tooling/repo-checks', '.claude/settings.json', '.claude/settings.local.json'];
const MAIN = 'main';
/** The diff base of a ticket that is not stacked (R-37). */
export const MAIN_REF = `origin/${MAIN}`;
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

const HAS_NAME_CHARACTER = /[\p{L}\p{N}]/u;
const HAS_PATH_MARK = /[/.]/;

// A bare word (not in ticks) is a path when it has a glob character, or when it has `/` or `.`
// and a letter or digit. Other bare words are prose (`and`, `see`, a lone `.` or `/`).
const isBarePath = (word) =>
  GLOB_CHARACTER.test(word) || (HAS_PATH_MARK.test(word) && HAS_NAME_CHARACTER.test(word));
// A line with no ticks has no prose marker. Each bare word with a letter or digit stays, so
// `Paths: tooling` is a path.
const isBareWord = (word) => GLOB_CHARACTER.test(word) || HAS_NAME_CHARACTER.test(word);

/**
 * @param {string} body - Ticket body.
 * @returns {string[]} The tokens of every `Paths:` line (also `**Paths:**`). For each line, the
 *   union of two sets. Set 1: each backticked part. It always stays: `*`, `**\/*` and `.` are paths.
 *   Set 2: each bare word (the text outside the ticks) that is a path. See `isBarePath`. A line with
 *   no ticks keeps every bare word with a letter, a digit or a glob character (`isBareWord`).
 *   A token is raw: `protectedPaths` cleans it.
 */
export function pathsOf(body) {
  return [...body.matchAll(PATHS_LINE)].flatMap((match) => tokensOf(match[1]));
}

function tokensOf(line) {
  const ticked = [...line.matchAll(BACKTICKED)].map((tick) => tick[1].trim());
  const keep = ticked.length > 0 ? isBarePath : isBareWord;
  const bare = line
    .replaceAll(BACKTICKED, ' ')
    .split(SPLIT_WORDS)
    .filter((word) => keep(word));
  return [...ticked, ...bare];
}

// Characters that hide a name in a text: zero-width, soft hyphen, BOM, and C0 controls but \n, \t.
const HIDDEN = new Set([0x20_0b, 0x20_0c, 0x20_0d, 0x20_60, 0xfe_ff, 0xad]);
const isHidden = (character) => {
  const code = character.codePointAt(0);
  return HIDDEN.has(code) || (code < 0x20 && code !== 0x0a && code !== 0x09);
};

// Undoes the usual tricks on one `Paths:` line, before the split into tokens: a hidden character
// can split a word. The case stays: `cleanPath` makes it lower case.
const unhide = (line) =>
  [...line.normalize('NFKC')]
    .filter((character) => !isHidden(character))
    .join('')
    .replaceAll(/%2f/gi, '/')
    .replaceAll('\\', '/');

/**
 * @returns {string[]} The clean `Paths:` lines (label not included) that the protected-path check
 *   reads. A separator (see `LINE_SEPARATOR`) gives 3 views of the body: separator removed, separator
 *   as a new line (a label after it is found), separator as a space (the text after it joins the
 *   line). The result has the lines of each view, in a fixed order. Too many lines only ask once more.
 */
function protectedLines(body) {
  return ['', '\n', ' ']
    .map((replacement) => body.replaceAll(LINE_SEPARATOR, replacement))
    .flatMap((view) => [...view.matchAll(PROTECTED_PATHS_LINE)].map((match) => unhide(match[1])));
}

/** @returns {string} A SHA-256 hash of the lines that `protectedPaths` reads. A change asks again. */
export function pathsHash(body) {
  return createHash('sha256').update(protectedLines(body).join('\n')).digest('hex');
}

/** @returns {string} The text without the characters of `marks` at its end. Linear. */
function trimEndOf(text, marks) {
  let end = text.length;
  while (end > 0 && marks.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

// A dot at the end is prose, but a dot after `/` or `.` is a path part (`..`, `./`): it stays.
function trimDots(text) {
  const end = trimEndOf(text, '.').length;
  return end === 0 || end === text.length || text.charAt(end - 1) === '/'
    ? text
    : text.slice(0, end);
}

/** @returns {string} The token as a clean path from the repo root: no `./`, `..`, `//`, or `/` at the ends. */
function cleanPath(token) {
  const unpunctuated = trimDots(trimEndOf(trimDots(token.replace(/^["'(]+/, '')), `,;)"'`));
  const clean = trimEndOf(
    path.posix
      .normalize(unpunctuated.length === 0 ? '.' : unpunctuated)
      .replace(/^\/+/, '')
      .replace(/^(?:\.\.\/)+/, ''),
    '/',
  );
  return clean === '..' || clean === '' ? '.' : clean.toLowerCase();
}

const insideOrSame = (file, folder) => file === folder || file.startsWith(`${folder}/`);

/** @returns {boolean} True when the clean token can reach the protected entry. */
function reaches(clean, entry) {
  const glob = GLOB_CHARACTER.exec(clean);
  if (glob !== null) {
    // The part before the glob is fixed. The glob can reach a protected path when that part is a
    // parent of it, or is inside it.
    const prefix = clean.slice(0, glob.index);
    return entry.startsWith(prefix) || insideOrSame(prefix, entry);
  }
  return clean === '.' || insideOrSame(clean, entry) || insideOrSame(entry, clean);
}

/**
 * R-43 (#146). Only the `Paths:` lines count (see `protectedLines`). Each line is cleaned first
 * (see `unhide`).
 *
 * @param {string} body - Ticket body.
 * @returns {string[]} The protected paths (tooling/repo-checks, .claude/settings.json,
 *   .claude/settings.local.json) that a token names, or that a parent folder or a glob of a token
 *   can reach. Fixed names, never ticket text.
 */
export function protectedPaths(body) {
  const clean = protectedLines(body)
    .flatMap((line) => tokensOf(line))
    .map((token) => cleanPath(token));
  return FORBIDDEN.filter((entry) => clean.some((token) => reaches(token, entry)));
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
 * @param {object[]} prs - All the open PRs, from any author: a link of the chain counts, whoever owns it.
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

/**
 * R-37. The one place that chooses the diff base of a ticket: the router, the local test guard, the
 * diff count and the risk tier use it.
 *
 * @param {{ base?: unknown } | undefined} state - The ticket state, or undefined when there is none.
 * @returns {string} `origin/<base>` while the ticket is stacked (`base` is a branch name), else `origin/main`.
 */
export function baseRef(state) {
  return typeof state?.base === 'string' ? `origin/${state.base}` : MAIN_REF;
}

/** @returns {string} The API path of an issue, with an optional suffix such as `/events`. */
export const issuePath = (number, suffix = '') =>
  `repos/{owner}/{repo}/issues/${String(number)}${suffix}`;

/** @returns {boolean} True when the login is the owner. The case does not count. */
export const isOwner = (login, owner) =>
  typeof login === 'string' && login.toLowerCase() === owner.toLowerCase();

// Letters, digits, ".", "_", "-" and "/", and no leading "-", "+" or ".".
const BRANCH = /^[A-Za-z0-9][\w./-]*$/;
// git refuses a path component that starts with ".": "/." covers it.
const BAD_BRANCH_PARTS = ['..', '//', '.lock/', '/.'];

/**
 * @param {string} name - A branch name. It can come from GitHub (`headRefName`).
 * @returns {boolean} True when the name is safe in a git command: it cannot start with `-`, so git
 *   never reads it as an option.
 */
export function isSafeBranch(name) {
  return (
    typeof name === 'string' &&
    BRANCH.test(name) &&
    !BAD_BRANCH_PARTS.some((part) => `${name}/`.includes(part)) &&
    !name.endsWith('/') &&
    !name.endsWith('.')
  );
}
