// Tells which projects a new text of rush.json adds, when the change is a pure addition. The push
// guard (push-exempt.mjs) uses it: an agent may push a range that registers a project, and nothing
// else in rush.json. A removal, a repoint (a new folder or name for an old entry), an edit of an old
// entry, and a change outside `projects` all give "not exempt".
//
// The check is on text, not on parsed values:
//   1. Everything outside the top-level `projects` array is the same, byte for byte (comments and
//      white space too). The array is found with the tokenizer of rush-json-edit.mjs (it knows
//      strings and comments). Both texts must parse as JSONC with the repo reader (projects.mjs).
//   2. Every old entry is in the new array, in the same order, byte for byte (the text from `{` to
//      `}`). So no old entry is removed, moved to another place in the text, or edited.
//   3. Every other (new) entry is exactly the entry that register-project.mjs writes, for a valid
//      project name: { packageName: "@vprprudhvi/<name>", projectFolder: "projects/<name>",
//      shouldPublish: false, tags: ["project/<name>"] }, with these keys in this order, no other
//      key, and no repeated key.
//      The name is not one of node_modules, .next or dist (folder names that the dependency scan skips).
//   4. The new array has no repeated packageName and no repeated projectFolder.
// Any doubt (an unreadable text, no `projects` array, more than one, an array that does not end, no
// added entry) gives null, so the guard fails closed.
import { stripJsonComments } from './projects.mjs';
import { PROJECT_NAME, projectEntry, readProjects, tokenize } from './rush-json-edit.mjs';

const ADDED_FOLDER = /^projects\/([a-z][a-z0-9-]*)$/;
// Folder names that the dependency scan (typosquat.mjs, IGNORED_FOLDERS) skips. A project with such
// a name is not an add that an agent may push, because its package.json could be hidden from a
// scan that reads folder names. Keep the list the same as IGNORED_FOLDERS of typosquat.mjs.
const RESERVED_NAMES = new Set(['node_modules', '.next', 'dist']);

/**
 * Finds the span of the top-level `projects` array.
 *
 * @param {string} text - rush.json text.
 * @returns {{ start: number, end: number }} Index of the `[` and the index after the `]`. It throws when the text has no such array, or has more than one.
 */
function projectsSpan(text) {
  const { tokens } = tokenize(text);
  const opens = [];
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
      opens.push(index + 2);
    }
  }
  const [open] = opens;
  if (opens.length !== 1 || open === undefined) {
    throw new Error(
      `rush.json must have one top-level "projects" array (found ${String(opens.length)})`,
    );
  }
  let level = 0;
  for (const token of tokens.slice(open)) {
    if (token.kind === '{' || token.kind === '[') {
      level += 1;
    } else if (token.kind === '}' || token.kind === ']') {
      level -= 1;
      if (level === 0) {
        return { start: tokens[open]?.start ?? 0, end: token.end };
      }
    }
  }
  throw new Error('the "projects" array of rush.json does not end');
}

/**
 * Tells whether a text is rush.json with a `projects` array of objects.
 *
 * @param {string} text - rush.json text.
 * @returns {boolean} True when the repo JSONC reader parses it and `projects` is an array of objects.
 */
function hasProjectsArray(text) {
  try {
    const parsed = JSON.parse(stripJsonComments(text));
    const projects = parsed !== null && typeof parsed === 'object' ? parsed['projects'] : undefined;
    return (
      Array.isArray(projects) &&
      projects.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
    );
  } catch {
    return false;
  }
}

/**
 * Tells whether two texts of rush.json are the same outside the `projects` array.
 *
 * @param {string} before - The old text.
 * @param {string} after - The new text.
 * @returns {boolean} True when everything outside the `projects` array is the same, byte for byte. False on any doubt.
 */
function sameOutsideProjects(before, after) {
  if (!hasProjectsArray(before) || !hasProjectsArray(after)) {
    return false;
  }
  try {
    const oldSpan = projectsSpan(before);
    const newSpan = projectsSpan(after);
    return (
      before.slice(0, oldSpan.start) === after.slice(0, newSpan.start) &&
      before.slice(oldSpan.end) === after.slice(newSpan.end)
    );
  } catch {
    return false;
  }
}

/**
 * Reads the project name of a new entry, when the entry is exactly the one that register-project.mjs
 * writes.
 *
 * @param {string} text - The text of the entry, from `{` to `}`.
 * @param {Record<string, unknown>} value - The parsed entry.
 * @returns {string | null} The project name, or null when the entry has another shape.
 */
function addedName(text, value) {
  const folder = value['projectFolder'];
  const name = typeof folder === 'string' ? ADDED_FOLDER.exec(folder)?.[1] : undefined;
  if (name === undefined || !PROJECT_NAME.test(name) || RESERVED_NAMES.has(name)) {
    return null;
  }
  const compact = stripJsonComments(text).replaceAll(/\s+/g, '');
  return compact === JSON.stringify(projectEntry(name)) ? name : null;
}

/**
 * Lists the projects that a new text of rush.json adds, when that is the only change.
 *
 * @param {string} before - The old text (the merge base).
 * @param {string} after - The new text (HEAD).
 * @returns {string[] | null} The names of the added projects (at least one), or null when the change is anything else than pure additions of register-project.mjs entries. Null on any doubt.
 */
export function rushJsonAddedProjects(before, after) {
  if (!sameOutsideProjects(before, after)) {
    return null;
  }
  try {
    const old = readProjects(before).items;
    const next = readProjects(after).items;
    const added = [];
    let cursor = 0;
    for (const item of next) {
      const text = after.slice(item.start, item.end);
      const same = old[cursor];
      if (same !== undefined && text === before.slice(same.start, same.end)) {
        cursor += 1;
      } else {
        added.push(item);
      }
    }
    if (cursor !== old.length || added.length === 0) {
      return null;
    }
    const names = [];
    for (const item of added) {
      const name = addedName(after.slice(item.start, item.end), item.value);
      if (name === null) {
        return null;
      }
      names.push(name);
    }
    const packageNames = next.map((item) => item.value['packageName']);
    const folders = next.map((item) => item.value['projectFolder']);
    return new Set(packageNames).size === next.length && new Set(folders).size === next.length
      ? names
      : null;
  } catch {
    return null;
  }
}
