// Edits the `projects` array of rush.json as text. rush.json is JSONC (it has comments), so the file
// is never parsed and written back. The edit inserts or removes the text of one entry, and every
// other byte stays the same. A check parses the old and the new text with `stripJsonComments` (the
// JSONC reader of projects.mjs) and fails when anything else changed. scripts/gates/register-project.mjs
// is the only caller.
import { isDeepStrictEqual } from 'node:util';

import { stripJsonComments } from './projects.mjs';

/** A project name: kebab-case, 2 to 41 characters. */
export const PROJECT_NAME = /^[a-z][a-z0-9-]{1,40}$/;
/** The npm scope of every project package. */
export const PACKAGE_SCOPE = '@vprprudhvi/';

const PUNCTUATION = new Set(['{', '}', '[', ']', ':', ',']);
const SEPARATOR_ONLY = /^\s*,\s*$/;

/**
 * @typedef {object} Token
 * @property {string} kind - `string`, or the punctuation character.
 * @property {number} start - Index of the first character.
 * @property {number} end - Index after the last character.
 */

/**
 * @typedef {object} Item
 * @property {number} start - Index of the `{` of the entry.
 * @property {number} end - Index after the `}` of the entry.
 * @property {Record<string, unknown>} value - The parsed entry.
 */

/**
 * Makes the entry that the script adds for a project.
 *
 * @param {string} name - Project name.
 * @returns {{ packageName: string, projectFolder: string, shouldPublish: boolean, tags: string[] }} The entry.
 */
export function projectEntry(name) {
  return {
    packageName: `${PACKAGE_SCOPE}${name}`,
    projectFolder: `projects/${name}`,
    shouldPublish: false,
    tags: [`project/${name}`],
  };
}

/**
 * Finds the index after the closing quote of a string.
 *
 * @param {string} text - JSONC text.
 * @param {number} start - Index of the opening quote.
 * @returns {number} Index after the closing quote. It throws when the string does not end.
 */
function stringEnd(text, start) {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') {
    index += text[index] === '\\' ? 2 : 1;
  }
  if (index >= text.length) {
    throw new Error('rush.json has a string that does not end');
  }
  return index + 1;
}

/**
 * Finds the index after a comment.
 *
 * @param {string} text - JSONC text.
 * @param {number} start - Index of the first slash.
 * @returns {number} Index after the comment, or `start` when no comment starts there.
 */
function commentEnd(text, start) {
  if (text[start + 1] === '/') {
    const newline = text.indexOf('\n', start);
    return newline === -1 ? text.length : newline;
  }
  if (text[start + 1] === '*') {
    const close = text.indexOf('*/', start + 2);
    if (close === -1) {
      throw new Error('rush.json has a comment that does not end');
    }
    return close + 2;
  }
  return start;
}

/**
 * Splits JSONC text into strings, punctuation and comments. Numbers, literals and white space are
 * not tokens.
 *
 * @param {string} text - JSONC text.
 * @returns {{ tokens: Token[], comments: { start: number, end: number }[] }} The tokens and the comments.
 */
export function tokenize(text) {
  const tokens = [];
  const comments = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    const afterComment = char === '/' ? commentEnd(text, index) : index;
    if (char === '"') {
      const end = stringEnd(text, index);
      tokens.push({ kind: 'string', start: index, end });
      index = end;
    } else if (afterComment > index) {
      comments.push({ start: index, end: afterComment });
      index = afterComment;
    } else {
      if (PUNCTUATION.has(char)) {
        tokens.push({ kind: char, start: index, end: index + 1 });
      }
      index += 1;
    }
  }
  return { tokens, comments };
}

/**
 * Finds the `[` token of the top-level `projects` key.
 *
 * @param {string} text - JSONC text.
 * @param {Token[]} tokens - Tokens of the text.
 * @returns {number} Index of the `[` in `tokens`. It throws when there is not exactly one.
 */
function projectsOpenIndex(text, tokens) {
  const found = [];
  let depth = 0;
  for (const [index, token] of tokens.entries()) {
    if (token.kind === '{' || token.kind === '[') {
      depth += 1;
    } else if (token.kind === '}' || token.kind === ']') {
      depth -= 1;
    } else if (
      depth === 1 &&
      token.kind === 'string' &&
      text.slice(token.start, token.end) === '"projects"' &&
      tokens[index + 1]?.kind === ':' &&
      tokens[index + 2]?.kind === '['
    ) {
      found.push(index + 2);
    }
  }
  if (found.length !== 1) {
    throw new Error(
      `rush.json must have one top-level "projects" array (found ${String(found.length)})`,
    );
  }
  return found[0] ?? -1;
}

/**
 * Reads the entries of the `projects` array.
 *
 * @param {string} text - JSONC text.
 * @returns {{ items: Item[], comments: { start: number, end: number }[] }} The entries in file order, and all comments of the file.
 */
export function readProjects(text) {
  const { tokens, comments } = tokenize(text);
  const items = [];
  let depth = 0;
  let start = -1;
  for (const token of tokens.slice(projectsOpenIndex(text, tokens) + 1)) {
    if (depth === 0 && token.kind === ']') {
      return { items, comments };
    }
    if (depth === 0) {
      checkTopLevelToken(token);
      start = token.start;
    }
    const change = depthChange(token);
    depth += change;
    if (change < 0 && depth === 0) {
      const value = JSON.parse(stripJsonComments(text.slice(start, token.end)));
      items.push({ start, end: token.end, value });
    }
  }
  throw new Error('the "projects" array of rush.json does not end');
}

/**
 * Tells how a token changes the nesting depth.
 *
 * @param {Token} token - A token.
 * @returns {number} 1 for `{` and `[`, -1 for `}` and `]`, else 0.
 */
function depthChange(token) {
  if (token.kind === '{' || token.kind === '[') {
    return 1;
  }
  return token.kind === '}' || token.kind === ']' ? -1 : 0;
}

/**
 * Checks a token directly inside the `projects` array.
 *
 * @param {Token} token - A token at the top level of the array.
 * @returns {void} It throws for anything other than the start of an object or a comma.
 */
function checkTopLevelToken(token) {
  if (token.kind !== '{' && token.kind !== ',') {
    throw new Error('the "projects" array of rush.json must hold only objects');
  }
}

/**
 * Reads the white space before an index on its line.
 *
 * @param {string} text - JSONC text.
 * @param {number} index - Index of the first character of an entry.
 * @returns {string} The indent. It throws when other text is before the entry on its line.
 */
function lineIndent(text, index) {
  const indent = text.slice(text.lastIndexOf('\n', index - 1) + 1, index);
  if (!/^[ \t]*$/.test(indent)) {
    throw new Error('each rush.json project entry must start on its own line');
  }
  return indent;
}

/**
 * Writes an entry in the format of an existing entry.
 *
 * @param {ReturnType<typeof projectEntry>} entry - The entry.
 * @param {string} text - JSONC text.
 * @param {Item} model - An existing entry to copy the indent from.
 * @returns {{ body: string, indent: string }} The entry text (from `{` to `}`) and the indent of its line.
 */
function formatEntry(entry, text, model) {
  const indent = lineIndent(text, model.start);
  const inner = /\n([ \t]*)"/.exec(text.slice(model.start, model.end))?.[1] ?? `${indent}  `;
  const lines = [
    `"packageName": ${JSON.stringify(entry.packageName)},`,
    `"projectFolder": ${JSON.stringify(entry.projectFolder)},`,
    `"shouldPublish": ${JSON.stringify(entry.shouldPublish)},`,
    `"tags": [${entry.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
  ];
  return { body: `{\n${lines.map((line) => `${inner}${line}`).join('\n')}\n${indent}}`, indent };
}

/**
 * Parses JSONC text into an object.
 *
 * @param {string} text - JSONC text.
 * @returns {Record<string, unknown>} The object.
 */
function parseJsonc(text) {
  return JSON.parse(stripJsonComments(text));
}

/**
 * Lists the comment texts of a file.
 *
 * @param {string} text - JSONC text.
 * @returns {string[]} The comments in file order.
 */
function commentTexts(text) {
  return tokenize(text).comments.map((comment) => text.slice(comment.start, comment.end));
}

/**
 * Checks that an edit changed only the `projects` array, and that the array is the expected one.
 *
 * @param {string} before - Old text.
 * @param {string} after - New text.
 * @param {unknown[]} expectedProjects - The array that the new text must hold.
 * @returns {void} It throws when the check fails.
 */
export function verifyEdit(before, after, expectedProjects) {
  const { projects: oldProjects, ...oldRest } = parseJsonc(before);
  const { projects: newProjects, ...newRest } = parseJsonc(after);
  if (!Array.isArray(oldProjects) || !isDeepStrictEqual(newProjects, expectedProjects)) {
    throw new Error('check failed: the new "projects" array is not the expected one');
  }
  if (!isDeepStrictEqual(oldRest, newRest)) {
    throw new Error('check failed: a key outside "projects" changed');
  }
  if (!isDeepStrictEqual(commentTexts(before), commentTexts(after))) {
    throw new Error('check failed: a comment changed');
  }
}

/**
 * Finds where a new entry goes: before the first `projects/` entry with a greater folder. With no
 * such entry, it goes after the last `projects/` entry (after the last entry when there is none).
 *
 * @param {Item[]} items - Entries.
 * @param {string} folder - The project folder of the new entry.
 * @returns {number} Array index for the new entry.
 */
function sortedIndex(items, folder) {
  const isProject = (item) =>
    typeof item.value['projectFolder'] === 'string' &&
    item.value['projectFolder'].startsWith('projects/');
  const next = items.findIndex(
    (item) => isProject(item) && String(item.value['projectFolder']) > folder,
  );
  if (next !== -1) {
    return next;
  }
  const lastProject = items.findLastIndex((item) => isProject(item));
  return lastProject === -1 ? items.length : lastProject + 1;
}

/**
 * Adds the entry of a project to the `projects` array.
 *
 * @param {string} text - rush.json text.
 * @param {string} name - Project name (already checked against PROJECT_NAME).
 * @returns {{ text: string, index: number }} The new text and the array index of the new entry. It
 *   throws on a duplicate, on an empty array, or when the check fails.
 */
export function addProject(text, name) {
  const entry = projectEntry(name);
  const { items } = readProjects(text);
  const duplicate = items.find(
    (item) =>
      item.value['packageName'] === entry.packageName ||
      item.value['projectFolder'] === entry.projectFolder,
  );
  if (duplicate !== undefined) {
    throw new Error(
      `rush.json already has an entry for ${String(duplicate.value['packageName'])} (${String(duplicate.value['projectFolder'])})`,
    );
  }
  if (items.length === 0) {
    throw new Error('the "projects" array of rush.json is empty, so no entry format can be copied');
  }
  const index = sortedIndex(items, entry.projectFolder);
  const following = items[index];
  const previous = items[index - 1];
  let result = text;
  if (following !== undefined) {
    const { body, indent } = formatEntry(entry, text, following);
    result = `${text.slice(0, following.start)}${body},\n${indent}${text.slice(following.start)}`;
  } else if (previous !== undefined) {
    const { body, indent } = formatEntry(entry, text, previous);
    result = `${text.slice(0, previous.end)},\n${indent}${body}${text.slice(previous.end)}`;
  }
  const expected = items.map((item) => item.value);
  expected.splice(index, 0, entry);
  verifyEdit(text, result, expected);
  return { text: result, index };
}

/**
 * Removes the entry of a project from the `projects` array.
 *
 * @param {string} text - rush.json text.
 * @param {string} name - Project name (already checked against PROJECT_NAME).
 * @returns {{ text: string, index: number }} The new text and the array index of the removed entry.
 *   It throws when there is no such entry, when the entry is not the only match, when a comment is
 *   inside or next to it, or when the check fails.
 */
export function removeProject(text, name) {
  const entry = projectEntry(name);
  const { items, comments } = readProjects(text);
  const matches = items.filter(
    (item) =>
      item.value['packageName'] === entry.packageName ||
      item.value['projectFolder'] === entry.projectFolder,
  );
  if (matches.length === 0) {
    throw new Error(`rush.json has no entry for ${entry.packageName} (${entry.projectFolder})`);
  }
  const [item] = matches;
  if (
    matches.length > 1 ||
    item === undefined ||
    item.value['packageName'] !== entry.packageName ||
    item.value['projectFolder'] !== entry.projectFolder
  ) {
    throw new Error(
      `the rush.json entry for ${name} must have packageName ${entry.packageName} and projectFolder ${entry.projectFolder}. A human edits it.`,
    );
  }
  if (items.length === 1) {
    throw new Error('the entry is the only one in rush.json. A human removes it.');
  }
  const index = items.indexOf(item);
  const next = items[index + 1];
  const previous = items[index - 1];
  const [from, to, between] =
    next === undefined
      ? [previous?.end ?? item.start, item.end, text.slice(previous?.end ?? 0, item.start)]
      : [item.start, next.start, text.slice(item.end, next.start)];
  if (!SEPARATOR_ONLY.test(between) || comments.some((c) => c.start < to && c.end > from)) {
    throw new Error(
      `a comment is inside or next to the rush.json entry for ${name}. A human removes it.`,
    );
  }
  const result = `${text.slice(0, from)}${text.slice(to)}`;
  verifyEdit(
    text,
    result,
    items.filter((other) => other !== item).map((other) => other.value),
  );
  return { text: result, index };
}
