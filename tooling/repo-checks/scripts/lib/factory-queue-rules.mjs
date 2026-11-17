// Pure rules of the `start` queue (design factory-daily-run 2: R-7, R-36, R-43; 4.5). No gh, no
// file system. lib/factory-queue.mjs calls them with data that it read from GitHub.

const ACCEPTANCE_HEADING = '### Acceptance';
const CHECKBOX = /^- \[[ xX]\] /;
const PATHS_LINE = /^Paths:[ \t]*(.*)$/m;
const BACKTICKED = /`([^`]+)`/g;
const SPLIT_WORDS = /[\s,]+/;
const SCOPE = /'([^']+)'/g;
const CLOSES = /\bCloses #(\d+)/gi;
const FORBIDDEN_FOLDER = 'tooling/repo-checks';
const FORBIDDEN_FILE = '.claude/settings.json';
const MAIN = 'main';
// A stack is at most 2 PRs deep (R-36). A chain with a loop stops at this many steps.
const MAX_CHAIN = 10;

/** @returns {boolean} True when a checkbox line follows the Acceptance heading, before the next heading. */
export function hasAcceptance(body) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === ACCEPTANCE_HEADING);
  if (start === -1) return false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('### ')) return false;
    if (CHECKBOX.test(line)) return true;
  }
  return false;
}

/**
 * @param {string} body - Ticket body.
 * @returns {string[]} The paths of the `Paths:` line: the backticked parts, else the words.
 */
export function pathsOf(body) {
  const line = PATHS_LINE.exec(body)?.[1] ?? '';
  const ticked = [...line.matchAll(BACKTICKED)].map((match) => match[1].trim());
  const words = line
    .split(SPLIT_WORDS)
    .map((word) => word.trim())
    .filter((word) => word !== '');
  return ticked.length > 0 ? ticked : words;
}

/** @returns {boolean} True when a path is under tooling/repo-checks or is .claude/settings.json (R-43). */
export function namesForbiddenPath(paths) {
  return paths
    .map((entry) => entry.replace(/^\.\//, ''))
    .some(
      (entry) =>
        entry === FORBIDDEN_FILE ||
        entry === FORBIDDEN_FOLDER ||
        entry.startsWith(`${FORBIDDEN_FOLDER}/`),
    );
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
