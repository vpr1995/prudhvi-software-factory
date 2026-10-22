// Path reading for the guard-bash hook: where a command runs (`cd`, `pushd`), what its variables
// hold, and whether a word (a literal path, a glob, a brace list or a variable) can name a gate
// file. The reader over-approximates: when it cannot tell, it checks every possible reading.
import os from 'node:os';
import path from 'node:path';

import {
  findGate,
  gateEntries,
  isInProtectedFolder,
  repositoryRelativeCandidates,
} from './gate-list.mjs';
import { git } from './proc.mjs';
import { programName } from './shell-parse.mjs';

/**
 * @typedef {import('./shell-parse.mjs').Segment} Segment
 * @typedef {object} PathScope
 * @property {string} root - Repo root.
 * @property {string[]} cwds - Every folder the command line may run in (the start folder and each `cd` target).
 * @property {Map<string, Set<string>>} vars - Values that each variable may hold.
 * @property {boolean} unknownCwd - True when a `cd` target could not be read.
 * @property {() => string[]} gateFiles - Repo paths of the gate files that exist (lazy).
 */

const MAX_VARIANTS = 64;
const DECLARATIONS = new Set(['export', 'declare', 'local', 'readonly', 'typeset']);
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\+?=(.*)$/s;
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
const UNRESOLVED = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$/g;
const GLOB_CHARACTERS = /[*?[]/;

/**
 * Lists the gate files that exist in the repo (tracked, or untracked and not ignored).
 *
 * @param {string} root - Repo root.
 * @returns {string[]} Repo paths.
 */
function listGateFiles(root) {
  const listing = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return listing.stdout
    .split('\0')
    .filter((file) => file !== '')
    .filter((file) => findGate(file) !== null || isInProtectedFolder(file));
}

/**
 * Finds the end of the brace list that starts at `open`.
 *
 * @param {string} word - A word.
 * @param {number} open - Index of the `{`.
 * @returns {{ close: number, commas: number[] } | null} The closing index and the top-level commas, or null when the list is not closed.
 */
function braceList(word, open) {
  let depth = 0;
  const commas = [];
  for (let index = open; index < word.length; index += 1) {
    const char = word[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { close: index, commas };
      }
    } else if (char === ',' && depth === 1) {
      commas.push(index);
    }
  }
  return null;
}

/**
 * Expands the first `{a,b}` list of a word, then the lists in each result.
 *
 * @param {string} word - A word.
 * @returns {string[]} The words (the input alone when it has no brace list).
 */
export function braceExpand(word) {
  for (let open = word.indexOf('{'); open !== -1; open = word.indexOf('{', open + 1)) {
    const list = word[open - 1] === '$' ? null : braceList(word, open);
    if (list === null || list.commas.length === 0) {
      continue;
    }
    const head = word.slice(0, open);
    const tail = word.slice(list.close + 1);
    const bounds = [open, ...list.commas, list.close];
    return bounds
      .slice(0, -1)
      .map((start, position) => word.slice(start + 1, bounds[position + 1]))
      .flatMap((part) => braceExpand(`${head}${part}${tail}`));
  }
  return [word];
}

/**
 * Reads the values a variable may hold.
 *
 * @param {string} name - Variable name.
 * @param {PathScope} scope - Scope.
 * @returns {string[] | null} The values, or null when unknown.
 */
function variableValues(name, scope) {
  const known = scope.vars.get(name);
  if (known !== undefined && known.size > 0) {
    return [...known];
  }
  switch (name) {
    case 'PWD':
    case 'OLDPWD': {
      return scope.cwds;
    }
    case 'HOME': {
      return [os.homedir()];
    }
    case 'TMPDIR': {
      return [os.tmpdir()];
    }
    case 'CLAUDE_PROJECT_DIR': {
      return [scope.root];
    }
    default: {
      return null;
    }
  }
}

/**
 * Replaces the variables in one word. Known variables give every value. Unknown ones stay as `$NAME`.
 *
 * @param {string} word - A word.
 * @param {PathScope} scope - Scope.
 * @returns {string[]} The readings of the word.
 */
function substituteVariables(word, scope) {
  let variants = [word];
  for (const match of word.matchAll(VARIABLE)) {
    const name = match[1] ?? match[2] ?? '';
    const values = variableValues(name, scope);
    if (values === null) {
      continue;
    }
    variants = variants
      .flatMap((variant) => values.map((value) => variant.replace(match[0], () => value)))
      .slice(0, MAX_VARIANTS);
  }
  return variants;
}

/**
 * Expands a word the way a shell would, as far as it can: `~`, brace lists and variables.
 * Globs stay as patterns, and unknown variables stay as `$NAME`.
 *
 * @param {string} word - A word from the command.
 * @param {PathScope} scope - Scope.
 * @returns {string[]} The readings of the word (at most 64).
 */
export function expandWord(word, scope) {
  const tilde = word === '~' || word.startsWith('~/') ? `${os.homedir()}${word.slice(1)}` : word;
  const variants = braceExpand(tilde)
    .flatMap((entry) => substituteVariables(entry, scope))
    .slice(0, MAX_VARIANTS);
  return [...new Set(variants)];
}

/**
 * Adds the value of an assignment word (`NAME=value`) to the scope.
 *
 * @param {string} word - The word.
 * @param {PathScope} scope - Scope.
 * @returns {void}
 */
function recordAssignment(word, scope) {
  const match = ASSIGNMENT.exec(word);
  if (match === null) {
    return;
  }
  const name = match[1] ?? '';
  const values = scope.vars.get(name) ?? new Set();
  for (const value of expandWord(match[2] ?? '', scope)) {
    values.add(value);
  }
  scope.vars.set(name, values);
}

/**
 * Adds the folders that a `cd` or `pushd` can lead to.
 *
 * @param {Segment} segment - A `cd` or `pushd` command.
 * @param {PathScope} scope - Scope.
 * @returns {void}
 */
function recordChangeDirectory(segment, scope) {
  const target = segment.argv.slice(1).find((word) => !word.startsWith('-')) ?? '';
  const targets = target === '' ? [os.homedir()] : expandWord(target, scope);
  const known = [...scope.cwds];
  for (const entry of targets) {
    if (entry === '-') {
      continue;
    }
    if (entry.includes('$')) {
      scope.unknownCwd = true;
      continue;
    }
    for (const cwd of known) {
      const resolved = path.resolve(cwd, entry);
      if (!scope.cwds.includes(resolved)) {
        scope.cwds.push(resolved);
      }
    }
  }
}

/**
 * Reads a whole command line: the folders it may run in and the values of its variables.
 *
 * @param {Segment[]} segments - All simple commands, in order.
 * @param {{ root: string, cwd: string }} context - Repo root and start folder.
 * @returns {PathScope} The scope.
 */
export function buildScope(segments, context) {
  /** @type {string[] | undefined} */
  let gateFiles;
  /** @type {PathScope} */
  const scope = {
    root: context.root,
    cwds: [path.resolve(context.cwd)],
    vars: new Map(),
    unknownCwd: false,
    gateFiles: () => {
      gateFiles ??= listGateFiles(context.root);
      return gateFiles;
    },
  };
  for (const segment of segments) {
    readSegment(segment, scope);
  }
  return scope;
}

/**
 * Adds what one simple command sets to the scope: assignments, `cd`, and loop variables.
 *
 * @param {Segment} segment - A simple command.
 * @param {PathScope} scope - Scope to change.
 * @returns {void}
 */
function readSegment(segment, scope) {
  for (const word of segment.assignments) {
    recordAssignment(word, scope);
  }
  const name = programName(segment);
  if (DECLARATIONS.has(name)) {
    for (const word of segment.argv.slice(1)) {
      recordAssignment(word, scope);
    }
  } else if (name === 'cd' || name === 'pushd') {
    recordChangeDirectory(segment, scope);
  }
  if (segment.loop !== null) {
    const values = scope.vars.get(segment.loop.name) ?? new Set();
    for (const word of segment.loop.values) {
      for (const value of expandWord(word, scope)) {
        values.add(value);
      }
    }
    scope.vars.set(segment.loop.name, values);
  }
}

/**
 * @typedef {{ kind: 'any' | 'star' | 'one' } | { kind: 'class', body: string, negated: boolean } | { kind: 'char', char: string }} PatternToken
 */

/**
 * Tells whether a character is in the body of a glob class such as `a-c_`.
 *
 * @param {string} body - Class body (without the brackets and without a leading `!`).
 * @param {string} char - The character.
 * @returns {boolean} True when the class holds it.
 */
function classHolds(body, char) {
  for (let index = 0; index < body.length; index += 1) {
    const from = body[index] ?? '';
    if (body[index + 1] === '-' && index + 2 < body.length) {
      if (char >= from && char <= (body[index + 2] ?? '')) {
        return true;
      }
      index += 2;
    } else if (from === char) {
      return true;
    }
  }
  return false;
}

/**
 * Reads the first token of a glob word. A variable and `**` stand for any text. A `*` stands for
 * text without a slash.
 *
 * @param {string} rest - The word from the current index.
 * @returns {{ token: PatternToken, length: number }} The token and the number of characters it used.
 */
function patternPiece(rest) {
  const variable = /^(?:\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$)/.exec(rest);
  if (variable !== null) {
    return { token: { kind: 'any' }, length: variable[0].length };
  }
  if (rest.startsWith('**')) {
    return { token: { kind: 'any' }, length: 2 };
  }
  const char = rest[0] ?? '';
  if (char === '*') {
    return { token: { kind: 'star' }, length: 1 };
  }
  if (char === '?') {
    return { token: { kind: 'one' }, length: 1 };
  }
  const close = char === '[' ? rest.indexOf(']', 2) : -1;
  if (close !== -1) {
    const body = rest.slice(1, close);
    const negated = body.startsWith('!');
    return {
      token: { kind: 'class', body: negated ? body.slice(1) : body, negated },
      length: close + 1,
    };
  }
  return { token: { kind: 'char', char }, length: 1 };
}

/**
 * Splits a word that has globs or unknown variables into tokens.
 *
 * @param {string} pattern - The word.
 * @returns {PatternToken[]} The tokens.
 */
function patternTokens(pattern) {
  const tokens = [];
  let index = 0;
  while (index < pattern.length) {
    const piece = patternPiece(pattern.slice(index));
    tokens.push(piece.token);
    index += piece.length;
  }
  return tokens;
}

/**
 * Tells whether one token takes the character at a place of the text.
 *
 * @param {PatternToken} token - A token that is not `any`.
 * @param {string} char - The character.
 * @returns {boolean} True when the token matches it.
 */
function tokenTakes(token, char) {
  switch (token.kind) {
    case 'star': {
      return char !== '/';
    }
    case 'one': {
      return char !== '/';
    }
    case 'class': {
      return char !== '/' && classHolds(token.body, char) !== token.negated;
    }
    case 'char': {
      return token.char === char;
    }
    default: {
      return true;
    }
  }
}

/**
 * Tells whether the tokens from `index` match the text from `position`. The match may end at the
 * end of the text or before a `/` (the word then names a folder that holds the rest).
 *
 * @param {{ tokens: PatternToken[], text: string, seen: Map<number, boolean> }} state - Pattern, path and the answers found so far.
 * @param {number} index - Index of the first token to match.
 * @param {number} position - Index in the text.
 * @returns {boolean} True when it matches.
 */
function matchFrom(state, index, position) {
  const { tokens, text, seen } = state;
  const current = tokens[index];
  if (current === undefined) {
    return position === text.length || text[position] === '/';
  }
  const key = index * (text.length + 1) + position;
  const known = seen.get(key);
  if (known !== undefined) {
    return known;
  }
  let answer = false;
  if (current.kind === 'any' || current.kind === 'star') {
    // Both can take no text. An `any` also takes slashes. A `*` stops at a slash.
    for (let end = position; end <= text.length && !answer; end += 1) {
      answer = matchFrom(state, index + 1, end);
      if (current.kind === 'star' && text[end] === '/') {
        break;
      }
    }
  } else {
    answer =
      position < text.length &&
      tokenTakes(current, text[position] ?? '') &&
      matchFrom(state, index + 1, position + 1);
  }
  seen.set(key, answer);
  return answer;
}

/**
 * Tells whether the tokens match the text from `start`.
 *
 * @param {PatternToken[]} tokens - The pattern.
 * @param {string} text - A path.
 * @param {number} start - Index in the text where the match begins.
 * @returns {boolean} True when it matches.
 */
function tokensMatchFrom(tokens, text, start) {
  return matchFrom({ tokens, text, seen: new Map() }, 0, start);
}

/**
 * Tests the tokens against a path from its start, or from the start of any folder name.
 *
 * @param {PatternToken[]} tokens - The pattern.
 * @param {string} text - A path.
 * @param {boolean} anywhere - True to also try each place after a `/`.
 * @returns {boolean} True when it matches.
 */
function tokensMatch(tokens, text, anywhere) {
  if (tokensMatchFrom(tokens, text, 0)) {
    return true;
  }
  if (!anywhere) {
    return false;
  }
  for (let index = text.indexOf('/'); index !== -1; index = text.indexOf('/', index + 1)) {
    if (tokensMatchFrom(tokens, text, index + 1)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks a word that has globs or unknown variables against the gate files that exist.
 *
 * @param {string} pattern - The word.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} The repo path of a gate file the word can name, or null.
 */
function patternHit(pattern, scope) {
  if (pattern.replaceAll(UNRESOLVED, '') === '') {
    return null;
  }
  const tokens = patternTokens(pattern);
  for (const gate of scope.gateFiles()) {
    const forms = patternForms(pattern, gate, scope);
    if (
      forms.some((form) => tokensMatch(tokens, form, false)) ||
      (scope.unknownCwd && tokensMatch(tokens, gate, true))
    ) {
      return gate;
    }
  }
  return null;
}

/**
 * Lists the spellings of a gate file that a word can match, one for each working folder.
 *
 * @param {string} pattern - The word.
 * @param {string} gate - Repo path of a gate file.
 * @param {PathScope} scope - Scope.
 * @returns {string[]} The paths to test.
 */
function patternForms(pattern, gate, scope) {
  const absolute = path.join(scope.root, gate);
  if (pattern.startsWith('/')) {
    return [absolute];
  }
  const relativeForms = [gate, ...scope.cwds.map((cwd) => path.relative(cwd, absolute))];
  // A variable at the start can hold anything, so it can also stand for the repo root.
  return pattern.startsWith('$')
    ? [absolute, ...relativeForms.map((form) => `./${form}`), ...relativeForms]
    : relativeForms;
}

/**
 * Checks a literal path against the gate list, for each possible working folder. A folder that
 * holds gate files counts too (a move or delete of the folder changes them).
 *
 * @param {string} variant - A path without globs or unknown variables.
 * @param {PathScope} scope - Scope.
 * @returns {{ relative: string, why: string } | null} The hit, or null.
 */
function literalHit(variant, scope) {
  const bySuffix = scope.unknownCwd && !path.isAbsolute(variant) ? suffixHit(variant, scope) : null;
  if (bySuffix !== null) {
    return bySuffix;
  }
  for (const cwd of scope.cwds) {
    if (path.resolve(cwd, variant) === scope.root && scope.gateFiles().length > 0) {
      return { relative: '.', why: 'The repo root holds gate files.' };
    }
    for (const relative of repositoryRelativeCandidates(scope.root, cwd, variant)) {
      const hit = repositoryPathHit(relative, scope);
      if (hit !== null) {
        return hit;
      }
    }
  }
  return null;
}

/**
 * Matches a relative path by suffix when a `cd` went to a folder that we cannot read: the path can
 * be under any folder.
 *
 * @param {string} variant - A relative path without globs or unknown variables.
 * @param {PathScope} scope - Scope.
 * @returns {{ relative: string, why: string } | null} The hit, or null.
 */
function suffixHit(variant, scope) {
  const tail = path.normalize(variant).replace(/\/$/, '');
  const hit = scope
    .gateFiles()
    .find(
      (gate) =>
        gate === tail ||
        gate.endsWith(`/${tail}`) ||
        gate.includes(`/${tail}/`) ||
        gate.startsWith(`${tail}/`),
    );
  return hit === undefined
    ? null
    : { relative: hit, why: findGate(hit)?.why ?? 'Hook scripts must not change.' };
}

/**
 * Checks one repo path against the gate list.
 *
 * @param {string} relative - Repo path.
 * @param {PathScope} scope - Scope.
 * @returns {{ relative: string, why: string } | null} The hit, or null.
 */
function repositoryPathHit(relative, scope) {
  const entry = findGate(relative) ?? findGate(`${relative}/x`);
  if (entry !== null) {
    return { relative, why: entry.why };
  }
  if (isInProtectedFolder(relative)) {
    return { relative, why: 'Hook scripts must not change.' };
  }
  // A folder counts when a gate file sits under it now, or when a gate path with no wildcard sits
  // under it (the gitignored `.claude/state` files are not in any git list).
  const folderPrefix = `${relative}/`;
  const holdsGate =
    scope.gateFiles().some((gate) => gate.startsWith(folderPrefix)) ||
    gateEntries().some(
      (entry) => !GLOB_CHARACTERS.test(entry.glob) && entry.glob.startsWith(folderPrefix),
    );
  return holdsGate ? { relative, why: 'The folder holds gate files.' } : null;
}

/**
 * Checks one word from a command against the gate list. It reads `cd` targets, variables, brace
 * lists, `~`, and globs. A word it cannot resolve counts as a hit when it can name a gate file.
 *
 * @param {string} word - A path word from a command.
 * @param {PathScope} scope - Scope of the command line.
 * @returns {{ relative: string, why: string } | null} The gate hit, or null.
 */
export function gateHitForWord(word, scope) {
  for (const variant of expandWord(word, scope)) {
    if (variant === '') {
      continue;
    }
    const literal = variant.includes('$') ? null : literalHit(variant, scope);
    if (literal !== null) {
      return literal;
    }
    if (GLOB_CHARACTERS.test(variant) || variant.includes('$')) {
      const matched = patternHit(variant, scope);
      if (matched !== null) {
        const entry = findGate(matched);
        return { relative: matched, why: entry?.why ?? 'Hook scripts must not change.' };
      }
    }
  }
  return null;
}
