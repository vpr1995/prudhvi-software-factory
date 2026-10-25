// Typosquat check for new npm dependency names (owner decision, 2026-10-25: no human approval for a
// new dependency, an automatic policy instead). It reads no network. It compares each dependency
// name that a package.json gained since the base with the names that are already known:
//   known = the names in scripts/gates/data/popular-npm-packages.json
//         + every dependency name in a package.json of the repo at the base commit.
// A new name fails when it is not an exact match of a known name, but it
//   - is within edit distance 1 of a known name (distance 2 when the new name has 8 or more
//     characters). The distance counts a swap of two neighbour characters as one edit.
//   - or is a known scoped name written flat or with a changed separator (`types-node` or
//     `@types-node` for `@types/node`).
// Rules that keep false alarms low:
//   - A name shorter than 4 characters is never compared by distance (`ms`, `qs`, `ws` and so on).
//   - A scoped name in a scope that is already known passes: only the owner of a scope can publish
//     into it, so nobody can squat inside it.
//   - A name in the `allow` list of the data file is never flagged.
//   - A dependency with a `workspace:`, `file:` or `link:` version is not fetched from the registry,
//     so its name is not compared.
// The version text (the spec) of each dependency that a package.json gained OR changed is checked too
// (the name check alone cannot see a git, URL or tarball source):
//   - A spec with a URL, `git+`, `git:`, `github:`, `gitlab:`, `bitbucket:`, `gist:`, `http(s):`, a
//     `user/repo` shorthand, a tarball (`.tgz`, `.tar`, `.tar.gz`) or an `npm:` alias fails.
//   - `file:` and `link:` pass only when the path resolves inside the repo (links followed).
//   - A name in the own scope (`@vprprudhvi/*`) must use a `workspace:` spec. A registry spec for the
//     own scope is a dependency confusion risk.
//   - Anything else that is not a plain registry range or tag fails (fail closed), for example `catalog:`.
// The package.json files are the ones under projects/, packages/, platform/ and tooling/, and under
// every project folder of rush.json (working tree, HEAD and base). A project folder outside these four
// roots fails the check (exit 2): the roots must not be a list that an edit of rush.json can bypass.
// A failure means: stop and ask the human.
import path from 'node:path';

import { readJson, readText, realPath } from './fs-io.mjs';
import { git, gitOrThrow } from './proc.mjs';
import { stripJsonComments } from './projects.mjs';
import { resolveCommit } from './revisions.mjs';

/** Folders that hold the package.json files of the repo. */
export const MANIFEST_ROOTS = Object.freeze(['projects/', 'packages/', 'platform/', 'tooling/']);
/** The package.json sections that hold dependency names. */
export const DEPENDENCY_SECTIONS = Object.freeze([
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]);
/** A name with fewer characters than this is not compared by distance. */
export const MIN_FUZZY_LENGTH = 4;
/** A new name with this many characters or more may differ by 2 edits. */
export const LONG_NAME_LENGTH = 8;
export const POPULAR_NAMES_FILE = path.join(
  import.meta.dirname,
  '..',
  'data',
  'popular-npm-packages.json',
);

const IGNORED_FOLDERS = new Set(['node_modules', '.next', 'dist']);
const LOCAL_SPEC = /^(?:workspace|file|link):/;
const SCOPE = /^(@[^/]+)\//;
/** The scope of the packages of this repo. Its dependencies must use `workspace:`. */
export const OWN_SCOPE = '@vprprudhvi/';
const TARBALL_SPEC = /\.(?:tgz|tar|tar\.gz)$/i;
const URL_SPEC = /^(?:https?:|[a-z][a-z0-9+.-]*:\/\/)/i;
const GIT_SPEC = /^(?:git\+|git:|git@|github:|gitlab:|bitbucket:|gist:)/i;
const SHORTHAND_SPEC = /^[\w.-]+\/[\w.-]+$/;
const REGISTRY_SPEC = /^[\w.^~<>=*|+\s-]+$/;

/**
 * Gives the real package name of an `npm:<name>@<range>` alias.
 *
 * @param {string} range - The version text of a dependency.
 * @returns {string} The real name, or an empty string when the text is not an alias.
 */
function aliasTarget(range) {
  if (!range.startsWith('npm:')) {
    return '';
  }
  const target = range.slice('npm:'.length);
  const at = target.indexOf('@', 1);
  return at === -1 ? target : target.slice(0, at);
}

/**
 * @typedef {object} KnownNames
 * @property {Set<string>} names - Every known name.
 * @property {Set<string>} scopes - Every scope (`@types`) of a known scoped name.
 * @property {Map<string, string>} flat - The flat form of each known scoped name, with the name.
 * @property {Set<string>} allowed - Names that are never flagged.
 */

/**
 * @typedef {object} AddedDependency
 * @property {string} file - The package.json.
 * @property {string} name - The dependency name that the file gained.
 */

/**
 * @typedef {object} ChangedDependency
 * @property {string} file - The package.json.
 * @property {string} name - The dependency name.
 * @property {string} spec - The version text (empty when the value is not text).
 * @property {boolean} isNew - True when the file did not hold the name at the base.
 */

/**
 * @typedef {object} TyposquatProblem
 * @property {string} file - The package.json.
 * @property {string} name - The dependency name.
 * @property {string} [looksLike] - The known name that a new name looks like (a name problem).
 * @property {string} [spec] - The version text that is not allowed (a spec problem).
 * @property {string} [reason] - Why the spec is not allowed (a spec problem).
 */

/**
 * Counts the edits between two texts: insert, delete, replace, or swap two neighbour characters.
 *
 * @param {string} left - First text.
 * @param {string} right - Second text.
 * @returns {number} The distance.
 */
export function editDistance(left, right) {
  const table = Array.from({ length: left.length + 1 }, (_, row) =>
    Array.from({ length: right.length + 1 }, (_, column) =>
      Math.min(row, column) === 0 ? Math.max(row, column) : 0,
    ),
  );
  const get = (row, column) => table[row]?.[column] ?? 0;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      let best = Math.min(
        get(row - 1, column) + 1,
        get(row, column - 1) + 1,
        get(row - 1, column - 1) + cost,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        best = Math.min(best, get(row - 2, column - 2) + 1);
      }
      const cells = table[row];
      if (cells !== undefined) {
        cells[column] = best;
      }
    }
  }
  return get(left.length, right.length);
}

/**
 * Gives the scope of a scoped name.
 *
 * @param {string} name - Package name.
 * @returns {string} `@scope`, or an empty string for a name without a scope.
 */
export function scopeOf(name) {
  return SCOPE.exec(name)?.[1] ?? '';
}

/**
 * Writes a name with no `@` and no `/`: `@types/node` and `types-node` give the same text.
 *
 * @param {string} name - Package name.
 * @returns {string} The flat form.
 */
export function flatName(name) {
  return name.replace(/^@/, '').replace('/', '-');
}

/**
 * Builds the lookup tables of the known names.
 *
 * @param {Iterable<string>} names - Every known name.
 * @param {Iterable<string>} [allowed] - Names that are never flagged.
 * @returns {KnownNames} The tables.
 */
export function buildKnownNames(names, allowed = []) {
  /** @type {KnownNames} */
  const known = {
    names: new Set(),
    scopes: new Set(),
    flat: new Map(),
    allowed: new Set(allowed),
  };
  for (const name of names) {
    known.names.add(name);
    const scope = scopeOf(name);
    if (scope !== '') {
      known.scopes.add(scope);
      known.flat.set(flatName(name), name);
    }
  }
  return known;
}

/**
 * Finds the closest known name within the allowed distance.
 *
 * @param {string} name - New name.
 * @param {KnownNames} known - The known names.
 * @returns {string | null} The known name, or null when none is close.
 */
function nearestName(name, known) {
  const limit = name.length >= LONG_NAME_LENGTH ? 2 : 1;
  let found = null;
  let foundDistance = limit + 1;
  for (const candidate of known.names) {
    const near =
      Math.min(name.length, candidate.length) >= MIN_FUZZY_LENGTH &&
      Math.abs(name.length - candidate.length) <= limit;
    const distance = near ? editDistance(name, candidate) : limit + 1;
    const better =
      distance < foundDistance ||
      (distance === foundDistance && found !== null && candidate < found);
    if (distance <= limit && better) {
      found = candidate;
      foundDistance = distance;
    }
  }
  return found;
}

/**
 * Finds the known name that a new name looks like.
 *
 * @param {string} name - New dependency name.
 * @param {KnownNames} known - The known names.
 * @returns {string | null} The known name, or null when the new name is fine.
 */
export function findLookalike(name, known) {
  if (known.names.has(name) || known.allowed.has(name)) {
    return null;
  }
  const confusion = known.flat.get(flatName(name));
  if (confusion !== undefined) {
    return confusion;
  }
  if (known.scopes.has(scopeOf(name))) {
    return null;
  }
  return nearestName(name, known);
}

/**
 * Checks a list of new names.
 *
 * @param {readonly AddedDependency[]} added - The new names with their files.
 * @param {KnownNames} known - The known names.
 * @returns {TyposquatProblem[]} One entry for each new name that looks like a known name.
 */
export function findProblems(added, known) {
  return added.flatMap(({ file, name }) => {
    const looksLike = findLookalike(name, known);
    return looksLike === null ? [] : [{ file, name, looksLike }];
  });
}

/**
 * Writes one problem for a person.
 *
 * @param {TyposquatProblem} problem - The problem.
 * @returns {string} One line.
 */
export function formatProblem(problem) {
  if (problem.looksLike === undefined) {
    return `${problem.file}: Dependency ${problem.name} has a version that is not allowed (${problem.spec ?? ''}): ${problem.reason ?? ''}. Stop and ask the human.`;
  }
  return `${problem.file}: Possible typosquat: ${problem.name} looks like ${problem.looksLike}. Stop and ask the human.`;
}

/**
 * Tells whether a path is a package.json of the repo that the check reads.
 *
 * @param {string} file - Path from the repo root, forward slashes.
 * @param {readonly string[]} [folders] - Folders (each one ends with `/`) that hold manifests. Default: the four roots.
 * @returns {boolean} True for `<folder>/**\/package.json` when no folder below `<folder>` is node_modules, .next or dist. The folder itself may have such a name (a project named `dist`).
 */
export function isManifestPath(file, folders = MANIFEST_ROOTS) {
  return (
    file.split('/').at(-1) === 'package.json' &&
    folders.some(
      (folder) =>
        file.startsWith(folder) &&
        !file
          .slice(folder.length)
          .split('/')
          .some((part) => IGNORED_FOLDERS.has(part)),
    )
  );
}

/**
 * Reads the dependency names of a package.json text.
 *
 * @param {string} text - The package.json text.
 * @param {string} file - The path (for the error message).
 * @returns {{ name: string, local: boolean }[]} Each name once. `local` is true for a dependency that
 *   the registry does not serve (`workspace:`, `file:`, `link:`). An `npm:` alias adds the real name.
 *   It throws when the text is not JSON.
 */
export function readDependencies(text, file) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (caught) {
    throw new Error(
      `${file} is not valid JSON: ${caught instanceof Error ? caught.message : String(caught)}`,
      { cause: caught },
    );
  }
  const found = new Map();
  for (const section of DEPENDENCY_SECTIONS) {
    const entries = manifest?.[section];
    if (entries === null || typeof entries !== 'object') {
      continue;
    }
    for (const [name, spec] of Object.entries(entries)) {
      const range = typeof spec === 'string' ? spec : '';
      const local = LOCAL_SPEC.test(range);
      found.set(name, (found.get(name) ?? true) && local);
      const alias = aliasTarget(range);
      if (alias !== '') {
        found.set(alias, false);
      }
    }
  }
  return [...found].map(([name, local]) => ({ name, local }));
}

/**
 * Reads each dependency of a package.json text with its version text.
 *
 * @param {string} text - The package.json text.
 * @param {string} file - The path (for the error message).
 * @returns {{ name: string, spec: string }[]} One entry for each name in each section. `spec` is
 *   empty when the value is not text. It throws when the text is not JSON.
 */
export function readDependencySpecs(text, file) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (caught) {
    throw new Error(
      `${file} is not valid JSON: ${caught instanceof Error ? caught.message : String(caught)}`,
      { cause: caught },
    );
  }
  const found = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const entries = manifest?.[section];
    if (entries === null || typeof entries !== 'object') {
      continue;
    }
    for (const [name, spec] of Object.entries(entries)) {
      found.push({ name, spec: typeof spec === 'string' ? spec : '' });
    }
  }
  return found;
}

/**
 * Tells whether a `file:` or `link:` path stays inside the repo. Links are followed when the path exists.
 *
 * @param {string} root - Repo root.
 * @param {string} file - The package.json (path from the repo root).
 * @param {string} target - The path in the spec, without the `file:` or `link:` prefix.
 * @returns {boolean} True when the path resolves inside the repo.
 */
function insideRepository(root, file, target) {
  const resolved = path.resolve(root, path.dirname(file), target);
  const relative = path.relative(realPath(root), realPath(resolved));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Tells why the version text of a dependency is not allowed.
 *
 * @param {{ file: string, name: string, spec: string }} entry - The dependency and its package.json.
 * @param {string} root - Repo root (for `file:` and `link:` paths).
 * @returns {string} The reason, or an empty string when the spec is allowed.
 */
export function specProblem(entry, root) {
  const spec = entry.spec.trim();
  if (spec === '') {
    return 'the version is missing or is not text';
  }
  if (entry.name.startsWith(OWN_SCOPE)) {
    return spec.startsWith('workspace:')
      ? ''
      : `a package of ${OWN_SCOPE.slice(0, -1)} must use a workspace: version (dependency confusion)`;
  }
  if (spec.startsWith('workspace:')) {
    return '';
  }
  if (spec.startsWith('npm:')) {
    return 'an npm: alias hides the real package name';
  }
  if (TARBALL_SPEC.test(spec)) {
    return 'a tarball is not a registry package';
  }
  if (/^(?:file|link):/.test(spec)) {
    const target = spec.replace(/^(?:file|link):/, '');
    return target !== '' && insideRepository(root, entry.file, target)
      ? ''
      : 'the path is empty or leaves the repo';
  }
  if (URL_SPEC.test(spec)) {
    return 'a URL is not a registry package';
  }
  if (GIT_SPEC.test(spec) || SHORTHAND_SPEC.test(spec.split('#')[0] ?? '')) {
    return 'a git source is not a registry package';
  }
  return REGISTRY_SPEC.test(spec) ? '' : 'it is not a registry version range or tag';
}

/**
 * Reads the project folders of a rush.json text.
 *
 * @param {string} text - The rush.json text (JSONC).
 * @returns {string[]} The `projectFolder` values. It throws when the text is not JSON or the list has a wrong shape.
 */
function rushProjectFolders(text) {
  let rush;
  try {
    rush = JSON.parse(stripJsonComments(text));
  } catch (caught) {
    throw new Error(
      `rush.json is not valid JSON: ${caught instanceof Error ? caught.message : String(caught)}`,
      { cause: caught },
    );
  }
  const projects = rush?.projects;
  if (projects === undefined) {
    return [];
  }
  const folders = Array.isArray(projects)
    ? projects.map((project) => project?.projectFolder)
    : [undefined];
  if (!folders.every((folder) => typeof folder === 'string' && folder !== '')) {
    throw new Error('rush.json has a project with no projectFolder text');
  }
  return folders;
}

/**
 * Finds the folders that hold package.json files: the four roots and every project folder of
 * rush.json (in the working tree, at HEAD and at the base).
 *
 * @param {string} root - Repo root.
 * @param {string} commit - Base commit id.
 * @returns {string[]} Folders, each one ends with `/`. It throws when a project folder is outside
 *   the four roots, or when a rush.json cannot be read.
 */
export function manifestFolders(root, commit) {
  const texts = [readText(path.join(root, 'rush.json'))];
  for (const revision of new Set([resolveCommit(root, 'HEAD'), commit])) {
    const shown = git(root, ['show', `${revision}:rush.json`]);
    texts.push(shown.status === 0 ? shown.stdout : null);
  }
  const folders = new Set(MANIFEST_ROOTS);
  for (const text of texts) {
    for (const folder of text === null ? [] : rushProjectFolders(text)) {
      const normalized = path.posix.normalize(folder);
      const inside =
        !folder.split('/').includes('..') &&
        !folder.includes('\\') &&
        MANIFEST_ROOTS.some((prefix) => normalized.startsWith(prefix));
      if (!inside) {
        throw new Error(
          `rush.json has the project folder "${folder}". It must be inside projects/, packages/, platform/ or tooling/. Stop and ask the human.`,
        );
      }
      folders.add(`${normalized.replace(/\/+$/, '')}/`);
    }
  }
  return [...folders];
}

/**
 * Lists the package.json files of the repo at a commit.
 *
 * @param {string} root - Repo root.
 * @param {string} commit - Commit id.
 * @param {readonly string[]} folders - Folders that hold manifests (see `manifestFolders`).
 * @returns {string[]} Paths from the repo root, sorted. It throws when git fails.
 */
function manifestsAtCommit(root, commit, folders) {
  const listed = gitOrThrow(root, ['ls-tree', '-r', '--name-only', '-z', commit]);
  return listed.stdout
    .split('\0')
    .filter((file) => file !== '' && isManifestPath(file, folders))
    .sort();
}

/**
 * Reads a file at a commit.
 *
 * @param {string} root - Repo root.
 * @param {string} commit - Commit id.
 * @param {string} file - Path from the repo root.
 * @returns {string} The text. It throws when git fails.
 */
function textAtCommit(root, commit, file) {
  return gitOrThrow(root, ['show', `${commit}:${file}`]).stdout;
}

/**
 * Lists the dependencies that package.json files gained or changed since the base: a name that the
 * file did not hold at the base, or a name with a version text that the file did not hold for it at
 * the base. Only the files in `changed` are read. A name that moves to another section of the same
 * file with the same version text is not listed. It reads rush.json first, so a project folder
 * outside the four roots fails even when no package.json changed.
 *
 * @param {string} root - Repo root.
 * @param {string} base - Base commit.
 * @param {readonly string[]} changed - Paths changed since the base (from `changedSinceBase`).
 * @returns {ChangedDependency[]} The entries, sorted by file. It throws when git fails, a file is not
 *   JSON or a project folder of rush.json is outside the four roots.
 */
export function changedDependencies(root, base, changed) {
  const commit = resolveCommit(root, base);
  const folders = manifestFolders(root, commit);
  const files = [...new Set(changed.filter((file) => isManifestPath(file, folders)))].sort();
  if (files.length === 0) {
    return [];
  }
  const atBase = new Set(manifestsAtCommit(root, commit, folders));
  const found = [];
  for (const file of files) {
    const text = readText(path.join(root, file));
    if (text === null) {
      continue;
    }
    /** @type {Map<string, Set<string>>} */
    const before = new Map();
    for (const entry of atBase.has(file)
      ? readDependencySpecs(textAtCommit(root, commit, file), file)
      : []) {
      before.set(entry.name, (before.get(entry.name) ?? new Set()).add(entry.spec));
    }
    const seen = new Set();
    for (const entry of readDependencySpecs(text, file)) {
      const specs = before.get(entry.name);
      const key = `${entry.name}\0${entry.spec}`;
      if ((specs === undefined || !specs.has(entry.spec)) && !seen.has(key)) {
        seen.add(key);
        found.push({ file, name: entry.name, spec: entry.spec, isNew: specs === undefined });
      }
    }
  }
  return found;
}

/**
 * Lists the dependency names that package.json files gained since the base (for the name check).
 * A name with only `workspace:`, `file:` or `link:` versions is not fetched from the registry, so it
 * is not listed.
 *
 * @param {ChangedDependency[]} changedList - The result of `changedDependencies`.
 * @returns {AddedDependency[]} The new names, sorted by file.
 */
export function addedNames(changedList) {
  const names = new Map();
  for (const { file, name, spec, isNew } of changedList) {
    if (isNew && !LOCAL_SPEC.test(spec.trim())) {
      names.set(`${file}\0${name}`, { file, name });
    }
  }
  return [...names.values()];
}

/**
 * Lists the dependency names that package.json files gained since the base.
 *
 * @param {string} root - Repo root.
 * @param {string} base - Base commit.
 * @param {readonly string[]} changed - Paths changed since the base (from `changedSinceBase`).
 * @returns {AddedDependency[]} The new names, sorted by file. It throws like `changedDependencies`.
 */
export function addedDependencies(root, base, changed) {
  return addedNames(changedDependencies(root, base, changed));
}

/**
 * Reads the data file of well-known names.
 *
 * @param {string} [file] - Path of the data file.
 * @returns {{ packages: string[], allow: string[] }} The names. It throws when the file is missing or wrong:
 *   a missing list must not turn into "nothing to compare with".
 */
export function loadPopularNames(file = POPULAR_NAMES_FILE) {
  const data = readJson(file);
  const isNames = (value) =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');
  if (
    data === null ||
    typeof data !== 'object' ||
    !isNames(data.packages) ||
    !isNames(data.allow)
  ) {
    throw new Error(`${file} is missing or has no "packages" and "allow" lists of names`);
  }
  return { packages: data.packages, allow: data.allow };
}

/**
 * Collects every dependency name in the package.json files of the repo at the base commit.
 *
 * @param {string} root - Repo root.
 * @param {string} base - Base commit.
 * @returns {string[]} The names (with repeats). It throws when git fails or a file is not JSON.
 */
export function dependencyNamesAtBase(root, base) {
  const commit = resolveCommit(root, base);
  return manifestsAtCommit(root, commit, manifestFolders(root, commit)).flatMap((file) =>
    readDependencies(textAtCommit(root, commit, file), file).map((entry) => entry.name),
  );
}

/**
 * Runs the whole check.
 *
 * @param {string} root - Repo root.
 * @param {string} base - Base commit.
 * @param {readonly string[]} changed - Paths changed since the base.
 * @returns {{ added: AddedDependency[], problems: TyposquatProblem[] }} The new names and the failures:
 *   first the version texts that are not allowed (new or changed dependencies), then the names that
 *   look like a known name (new dependencies).
 */
export function checkTyposquats(root, base, changed) {
  const changedList = changedDependencies(root, base, changed);
  const added = addedNames(changedList);
  const specProblems = changedList.flatMap((entry) => {
    const reason = specProblem(entry, root);
    return reason === '' ? [] : [{ file: entry.file, name: entry.name, spec: entry.spec, reason }];
  });
  if (added.length === 0) {
    return { added, problems: specProblems };
  }
  const popular = loadPopularNames();
  const known = buildKnownNames(
    [...popular.packages, ...dependencyNamesAtBase(root, base)],
    popular.allow,
  );
  return { added, problems: [...specProblems, ...findProblems(added, known)] };
}
