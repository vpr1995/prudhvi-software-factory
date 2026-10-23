// Test impact: picks the gate tests (scripts/gates/test/*.test.js) that a change can affect.
//
// How it works:
//   1. Graph. Every .mjs, .js and .cjs file under scripts/gates is a node. An edge goes from a file
//      to each file it imports with a relative path (`import ... from './x.mjs'`, `export ... from`,
//      `import './x.mjs'` and `import('./x.mjs')` with a literal path).
//   2. Hidden edges. Many tests do not import the script they test: they start it, or they read a
//      file. For each test file we scan the text for file names (`something.mjs`, `gates.md`,
//      `settings.pending.json`, ...) and hook names (`guard-bash`, ...). A name that matches a file
//      of the graph, or one of the known outside files below, is an edge. One explicit entry covers
//      a test that reads a whole folder (`FOLDER_READERS`). The scan can select too many tests. It
//      cannot select too few for a file that a test names.
//   3. Select. A test is selected when it, or a file it depends on (transitively), changed.
//   4. Fall back to every test when the graph cannot see the effect of a change (`FULL_RUN_RULES`
//      and the checks in `selectTests`), or when the graph cannot be built.
import path from 'node:path';

import { listDirectory, pathKind, readText, walkFiles } from './fs-io.mjs';
import { matchesGlob } from './glob.mjs';
import { git } from './proc.mjs';
import { resolveCommit } from './revisions.mjs';

export const GATES_DIR = 'scripts/gates';
export const TEST_DIR = `${GATES_DIR}/test`;
const HOOKS_DIR = `${GATES_DIR}/hooks`;
const SOURCE_EXTENSIONS = new Set(['.mjs', '.js', '.cjs']);
const GIT_FLAGS = ['--no-optional-locks'];

/** A change to one of these paths runs every test. The graph cannot see the effect. */
export const FULL_RUN_RULES = Object.freeze([
  {
    glob: `${GATES_DIR}/gate-files.json`,
    reason: 'the gate list is read by almost every gate script and test',
  },
  { glob: '.claude/hooks/**', reason: 'a hook wrapper runs the hook scripts of every hook test' },
  { glob: 'common/git-hooks/**', reason: 'git hook scripts are not in the import graph' },
]);

/** Files outside scripts/gates that tests read. Tests that name one of them depend on it. */
const OUTSIDE_FILES = Object.freeze([
  '.claude/settings.pending.json',
  '.gitleaks.toml',
  'docs/standards/gates.md',
]);

/** Tests that read a whole folder. A change under the folder selects the test. */
export const FOLDER_READERS = Object.freeze({
  [`${TEST_DIR}/self-scan.test.js`]: [`${GATES_DIR}/`],
});

const STATIC_IMPORT = /^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*['"](\.{1,2}\/[^'"\n]+)['"]/gm;
const BARE_IMPORT = /^[ \t]*import\s*['"](\.{1,2}\/[^'"\n]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*['"](\.{1,2}\/[^'"\n]+)['"]\s*\)/g;
/** A word of letters, digits, `_` and `-`. A hook name such as `guard-bash` is one word. */
const WORD = /[\w-]+/g;
const FILE_NAME = /[\w.-]+\.(?:mjs|cjs|js|sh|json|md|toml)\b/g;

/** The graph cannot be built. The selector then runs every test. */
export class GraphError extends Error {}

/**
 * @typedef {object} Graph
 * @property {string[]} tests - Test files, sorted.
 * @property {Map<string, Set<string>>} dependents - File to the files that depend on it.
 */

/**
 * @typedef {object} Selection
 * @property {'all' | 'some' | 'none'} mode - Every test, some tests or no test.
 * @property {string[]} files - The selected test files (paths from the repo root), sorted.
 * @property {string[]} reasons - Why the selector chose `all`. Empty for the other modes.
 */

/**
 * Tells whether a path is a test file.
 *
 * @param {string} file - Path from the repo root.
 * @returns {boolean} True for `scripts/gates/test/*.test.js`.
 */
function isTestFile(file) {
  return path.posix.dirname(file) === TEST_DIR && file.endsWith('.test.js');
}

/**
 * Lists the files under scripts/gates.
 *
 * @param {string} root - Repo root.
 * @returns {string[]} Paths from the repo root.
 */
function gateFilesOf(root) {
  return walkFiles(path.join(root, GATES_DIR), {
    skipNames: new Set(['node_modules', 'coverage']),
    skipPaths: new Set(),
  }).map((entry) => `${GATES_DIR}/${entry.path}`);
}

/**
 * Lists the gate test files.
 *
 * @param {string} root - Repo root.
 * @returns {string[]} Test paths from the repo root, sorted.
 */
export function listTests(root) {
  return gateFilesOf(root).filter((file) => isTestFile(file));
}

/**
 * Finds the files that a source text imports with a relative path.
 *
 * @param {string} text - Source text.
 * @returns {{ specifier: string, dynamic: boolean }[]} The specifiers.
 */
function importSpecifiers(text) {
  const found = [];
  for (const pattern of [STATIC_IMPORT, BARE_IMPORT]) {
    for (const match of text.matchAll(pattern)) {
      found.push({ specifier: match[1] ?? '', dynamic: false });
    }
  }
  for (const match of text.matchAll(DYNAMIC_IMPORT)) {
    found.push({ specifier: match[1] ?? '', dynamic: true });
  }
  return found;
}

/**
 * Finds the files of the other tests and scripts that outside files (see `OUTSIDE_FILES`) and
 * skill files stand for.
 *
 * @param {string} root - Repo root.
 * @returns {string[]} Paths from the repo root.
 */
function outsideFiles(root) {
  const skills = listDirectory(path.join(root, '.claude', 'skills'))
    .filter((entry) => entry.isDirectory)
    .map((entry) => `.claude/skills/${entry.name}/SKILL.md`);
  return [...OUTSIDE_FILES, ...skills];
}

/**
 * Adds an edge from a file to the file it depends on.
 *
 * @param {Map<string, Set<string>>} dependents - The edges, stored from the target to the source.
 * @param {string} from - The file that depends on `to`.
 * @param {string} to - The file that is needed.
 * @returns {void}
 */
function addEdge(dependents, from, to) {
  if (from === to) {
    return;
  }
  const set = dependents.get(to) ?? new Set();
  set.add(from);
  dependents.set(to, set);
}

/**
 * Resolves the relative imports of one file and adds their edges.
 *
 * @param {{ file: string, text: string, known: Set<string>, root: string, dependents: Map<string, Set<string>> }} input - The file and the graph state.
 * @returns {void} It throws a `GraphError` for a static import that leads nowhere.
 */
function addImportEdges(input) {
  const { file, text, known, root, dependents } = input;
  for (const { specifier, dynamic } of importSpecifiers(text)) {
    const local = path.posix.join(path.posix.dirname(file), specifier);
    // A string inside `node -e "import('./scripts/...')"` is relative to the repo root.
    const candidates = dynamic ? [local, path.posix.normalize(specifier)] : [local];
    const target = candidates.find(
      (entry) => known.has(entry) || pathKind(path.join(root, entry)) === 'file',
    );
    if (target !== undefined) {
      addEdge(dependents, file, target);
    } else if (!dynamic) {
      throw new GraphError(`${file} imports ${specifier}, and that file does not exist`);
    }
  }
}

/**
 * Adds the hidden edges of one test: file names and hook names in its text.
 *
 * @param {{ file: string, text: string, byName: Map<string, string[]>, hookNames: string[], dependents: Map<string, Set<string>> }} input - The test and the graph state.
 * @returns {void}
 */
function addNameEdges(input) {
  const { file, text, byName, hookNames, dependents } = input;
  for (const name of new Set(text.match(FILE_NAME) ?? [])) {
    for (const target of byName.get(name) ?? []) {
      addEdge(dependents, file, target);
    }
  }
  const words = new Set(text.match(WORD) ?? []);
  for (const hook of hookNames) {
    if (words.has(hook)) {
      addEdge(dependents, file, `${HOOKS_DIR}/${hook}.mjs`);
    }
  }
}

/**
 * Builds the graph from the files on disk.
 *
 * @param {string} root - Repo root.
 * @param {readonly string[]} [extraFiles] - Changed paths. A deleted gate file is still a node, so tests that name it are found.
 * @returns {Graph} The graph. It throws a `GraphError` when a file cannot be read or an import leads nowhere.
 */
export function buildGraph(root, extraFiles = []) {
  const gateFiles = gateFilesOf(root);
  // A deleted gate file is still a node. A changed file elsewhere is not: tests name files such as
  // `rush.json` or `package.json` in their fixtures, and that is not a dependency.
  const deleted = extraFiles.filter((file) => file.startsWith(`${GATES_DIR}/`));
  const known = new Set([...gateFiles, ...outsideFiles(root), ...deleted]);
  const byName = new Map();
  for (const file of known) {
    const list = byName.get(path.posix.basename(file)) ?? [];
    list.push(file);
    byName.set(path.posix.basename(file), list);
  }
  const hookNames = gateFiles
    .filter((file) => path.posix.dirname(file) === HOOKS_DIR && file.endsWith('.mjs'))
    .map((file) => path.posix.basename(file, '.mjs'));
  const dependents = new Map();
  const tests = gateFiles.filter((file) => isTestFile(file));
  for (const file of gateFiles) {
    if (!SOURCE_EXTENSIONS.has(path.posix.extname(file))) {
      continue;
    }
    const text = readText(path.join(root, file));
    if (text === null) {
      throw new GraphError(`${file} cannot be read`);
    }
    addImportEdges({ file, text, known, root, dependents });
    if (isTestFile(file)) {
      addNameEdges({ file, text, byName, hookNames, dependents });
    }
  }
  return { tests, dependents };
}

/**
 * Finds every file that depends on the changed files, and the changed files themselves.
 *
 * @param {Graph} graph - The graph.
 * @param {readonly string[]} changed - Changed paths.
 * @returns {Set<string>} The affected files.
 */
function affectedFiles(graph, changed) {
  const seen = new Set(changed);
  const pending = [...changed];
  while (pending.length > 0) {
    const current = pending.pop() ?? '';
    for (const user of graph.dependents.get(current) ?? []) {
      if (!seen.has(user)) {
        seen.add(user);
        pending.push(user);
      }
    }
  }
  return seen;
}

/**
 * Finds the changes that the graph cannot judge.
 *
 * @param {readonly string[]} changed - Changed paths.
 * @param {Graph} graph - The graph.
 * @returns {string[]} One reason for each change that needs a full run.
 */
function unjudgeable(changed, graph) {
  const reasons = [];
  for (const file of changed) {
    const rule = FULL_RUN_RULES.find((entry) => matchesGlob(file, entry.glob));
    if (rule !== undefined) {
      reasons.push(`${file} changed: ${rule.reason}`);
    } else if (
      file.startsWith(`${GATES_DIR}/`) &&
      !SOURCE_EXTENSIONS.has(path.posix.extname(file))
    ) {
      reasons.push(`${file} changed: the selector cannot read this kind of file`);
    } else if (
      file.startsWith(`${TEST_DIR}/`) &&
      !isTestFile(file) &&
      ![...affectedFiles(graph, [file])].some((entry) => isTestFile(entry))
    ) {
      reasons.push(`${file} changed: a test helper that no test imports or names`);
    }
  }
  return reasons;
}

/**
 * Picks the tests that the changed files can affect.
 *
 * @param {{ root: string, changed: readonly string[] }} input - The repo root and the changed paths (from the repo root, forward slashes). A deleted file counts as changed.
 * @returns {Selection} The tests to run.
 */
export function selectTests(input) {
  const { root, changed } = input;
  let graph;
  try {
    graph = buildGraph(root, changed);
  } catch (error) {
    if (!(error instanceof GraphError)) {
      throw error;
    }
    return {
      mode: 'all',
      files: listTests(root),
      reasons: [`the import graph cannot be built: ${error.message}`],
    };
  }
  const reasons = unjudgeable(changed, graph);
  if (reasons.length > 0) {
    return { mode: 'all', files: graph.tests, reasons };
  }
  const affected = affectedFiles(graph, changed);
  const files = graph.tests.filter(
    (test) =>
      affected.has(test) ||
      (FOLDER_READERS[test] ?? []).some((folder) =>
        changed.some((file) => file.startsWith(folder)),
      ),
  );
  return { mode: files.length === 0 ? 'none' : 'some', files, reasons: [] };
}

/**
 * Runs git and splits its NUL-separated output.
 *
 * @param {string} root - Repo root.
 * @param {string[]} args - Git arguments.
 * @returns {string[]} The fields. It throws when git fails.
 */
function gitFields(root, args) {
  const result = git(root, [...GIT_FLAGS, ...args]);
  if (result.status !== 0) {
    throw new Error(
      `git ${args.slice(0, 2).join(' ')} failed (exit ${String(result.status)}): ${result.stderr.trim().slice(0, 300)}`,
    );
  }
  return result.stdout.split('\0').filter((entry) => entry !== '');
}

/**
 * Lists the paths that a change touches.
 *
 * @param {string} root - Repo root.
 * @param {{ base?: string, head?: string }} options - `base`: the start (default HEAD). `head`: the end. With no `head`, the end is the working tree, and untracked files count. The range starts at the merge base, like `gate-integrity`.
 * @returns {{ files: string[], headIsCheckedOut: boolean }} The paths from the repo root (a deleted or renamed file lists its old and new path), and whether the end is the checked-out commit (the graph is read from the working tree).
 */
export function changedPaths(root, options) {
  const start = resolveCommit(root, options.base ?? 'HEAD');
  const end = resolveCommit(root, options.head ?? 'HEAD');
  const merge = git(root, [...GIT_FLAGS, 'merge-base', start, end]);
  const from = merge.status === 0 && merge.stdout.trim() !== '' ? merge.stdout.trim() : start;
  const diff = ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', from];
  if (options.head === undefined) {
    const untracked = gitFields(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    return {
      files: [...new Set([...gitFields(root, [...diff, '--']), ...untracked])].sort(),
      headIsCheckedOut: true,
    };
  }
  return {
    files: [...new Set(gitFields(root, [...diff, end, '--']))].sort(),
    headIsCheckedOut: end === resolveCommit(root, 'HEAD'),
  };
}
