// The throwaway git worktree of the gate fixtures, and the setup steps that make a bad change in it.
//
// Design:
//   - `git worktree add --detach <tmp>/worktree HEAD`, under the OS temp folder. No tracked file of
//     the main working tree is written (except the report, by the caller). Git writes the worktree
//     record to .git/worktrees, and a tool (ESLint, Vitest) can write its cache to a node_modules
//     folder of the main tree, because the links of the cache folders point there.
//   - The code under test is read from the MAIN tree (hooks, scripts/gates, tool binaries), the way
//     test/harness.js does it. The worktree is only the subject repo. So a gate file that a human
//     applied but did not commit is tested, and no gate file is copied.
//   - A worktree has no node_modules. For each projects/<name> and packages/<name> that has a
//     node_modules folder in the main tree, the worktree gets a REAL node_modules folder with one
//     symbolic link for each entry (and for each package in an @scope folder). A workspace link (an
//     entry whose real path is a folder under projects/ or packages/ of the main tree) points to the
//     same folder in the worktree. So a shared package (for example shared-cdk-constructs) runs from
//     the worktree, and the repo root that it finds from its own path is the worktree. Every other
//     entry (an external package, .bin, a cache folder, a tooling/ link) points to the main tree.
//   - The build output (dist) of each packages/<name> is ignored by git, so the worktree has none. It
//     is copied (not linked) from the main tree: a link would resolve back to the main tree.
//     The node_modules folders and the dist copies are removed first at the end.
//   - A symbolic link is not matched by the `node_modules/` line of .gitignore, so every git command
//     of a fixture gets `core.excludesFile` through GIT_CONFIG_* variables. It hides the links from
//     `git status`, `git add -A` and `git clean`, without a change to any git config file.
//   - Setup commits use git plumbing (write-tree, commit-tree, update-ref). No git hook runs.
import path from 'node:path';

import {
  copyTree,
  exists,
  inspectPath,
  listDirectory,
  makeTemporaryDirectory,
  readText,
  realPath,
  removePath,
  writeText,
} from './fs-io.mjs';
import { git, gitOrThrow, run } from './proc.mjs';

const AUTHOR = {
  GIT_AUTHOR_NAME: 'gate-fixtures',
  GIT_AUTHOR_EMAIL: 'gate-fixtures@example.invalid',
  GIT_COMMITTER_NAME: 'gate-fixtures',
  GIT_COMMITTER_EMAIL: 'gate-fixtures@example.invalid',
};

/** The folders of the main tree that hold workspace packages. */
const WORKSPACE_AREAS = ['projects', 'packages'];

/**
 * @typedef {object} LinkContext
 * @property {string} mainReal - Real path of the main repo root.
 * @property {string} root - Worktree root.
 */

/**
 * Finds the target of the worktree link for one node_modules entry of the main tree. A workspace
 * link (a symbolic link whose real path is a folder under projects/ or packages/ of the main tree,
 * not in a node_modules folder) points to the same folder in the worktree. Every other entry points
 * to its real path in the main tree (its own path when it cannot be resolved).
 *
 * @param {LinkContext} context - The main tree and the worktree.
 * @param {string} entry - Path of the entry in the main tree.
 * @returns {string} The target of the link.
 */
export function linkTarget(context, entry) {
  const real = realPath(entry);
  if (inspectPath(entry)?.kind !== 'symlink') {
    return real;
  }
  for (const area of WORKSPACE_AREAS) {
    const relative = path.relative(path.join(context.mainReal, area), real);
    const parts = relative.split(path.sep);
    if (
      relative !== '' &&
      !path.isAbsolute(relative) &&
      parts[0] !== '..' &&
      !parts.includes('node_modules')
    ) {
      return path.join(context.root, area, relative);
    }
  }
  return real;
}

/**
 * Makes one symbolic link, or throws.
 *
 * @param {string} target - What the link points to.
 * @param {string} link - Path of the new link.
 * @returns {void}
 */
function makeLink(target, link) {
  const made = run('ln', ['-s', target, link]);
  if (made.status !== 0) {
    throw new Error(`cannot link ${link}: ${made.stderr.trim()}`);
  }
}

/**
 * Makes a real folder in the worktree and fills it with one link for each entry of a main folder.
 * An @scope folder becomes a real folder too, with one link for each package in it.
 *
 * @param {string} source - The node_modules folder (or @scope folder) of the main tree.
 * @param {string} target - The new folder in the worktree.
 * @param {LinkContext} context - The main tree and the worktree.
 * @returns {void} It throws when a folder or a link cannot be made.
 */
function fillFolder(source, target, context) {
  const made = run('mkdir', [target]);
  if (made.status !== 0) {
    throw new Error(`cannot make ${target}: ${made.stderr.trim()}`);
  }
  for (const entry of listDirectory(source)) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.name.startsWith('@') && inspectPath(from)?.kind === 'dir') {
      fillFolder(from, to, context);
    } else {
      makeLink(linkTarget(context, from), to);
    }
  }
}

/**
 * Makes a node_modules folder in the worktree for each project and package of the main tree that
 * has one.
 *
 * @param {string} main - Main repo root.
 * @param {string} root - Worktree root.
 * @param {string[]} made - Receives each node_modules folder before it is filled, so that a folder
 * that is only partly filled is removed too.
 * @returns {void} It throws when a folder or a link cannot be made.
 */
export function linkNodeModules(main, root, made) {
  const context = { mainReal: realPath(main), root };
  for (const area of WORKSPACE_AREAS) {
    for (const entry of listDirectory(path.join(main, area))) {
      const source = path.join(main, area, entry.name, 'node_modules');
      const target = path.join(root, area, entry.name, 'node_modules');
      if (entry.isDirectory && exists(source) && exists(path.dirname(target)) && !exists(target)) {
        made.push(target);
        fillFolder(source, target, context);
      }
    }
  }
}

/**
 * Copies the build output (dist) of each package of the main tree into the worktree.
 *
 * @param {string} main - Main repo root.
 * @param {string} root - Worktree root.
 * @param {string[]} made - Receives each copy before it is made.
 * @returns {void} It throws when a copy fails.
 */
export function copyPackageBuilds(main, root, made) {
  for (const entry of listDirectory(path.join(main, 'packages'))) {
    const source = path.join(main, 'packages', entry.name, 'dist');
    const target = path.join(root, 'packages', entry.name, 'dist');
    if (entry.isDirectory && exists(source) && exists(path.dirname(target)) && !exists(target)) {
      made.push(target);
      copyTree(source, target);
    }
  }
}

/**
 * Reads a file of the worktree, or throws.
 *
 * @param {string} root - Worktree root.
 * @param {string} relative - Path in the worktree.
 * @returns {string} The text.
 */
function mustRead(root, relative) {
  const text = readText(path.join(root, relative));
  if (text === null) {
    throw new Error(`setup: ${relative} does not exist in the worktree`);
  }
  return text;
}

/**
 * @typedef {object} StepContext
 * @property {string} root - Worktree root.
 * @property {string} startSha - The commit the worktree started at.
 * @property {Record<string, string>} env - Environment of every git call.
 */

/**
 * Runs git in the worktree and throws on failure.
 *
 * @param {StepContext} context - The worktree.
 * @param {string[]} args - Git arguments.
 * @param {Record<string, string>} [extra] - Extra variables.
 * @returns {string} Trimmed standard output.
 */
function gitIn(context, args, extra = {}) {
  return gitOrThrow(context.root, args, { env: { ...context.env, ...extra } }).stdout.trim();
}

/**
 * Commits every change of the worktree with git plumbing, so that no hook runs.
 *
 * @param {StepContext} context - The worktree.
 * @param {string} message - Commit message.
 * @returns {void}
 */
function commitAll(context, message) {
  gitIn(context, ['add', '-A']);
  const tree = gitIn(context, ['write-tree']);
  const commit = gitIn(context, ['commit-tree', tree, '-p', 'HEAD', '-m', message], AUTHOR);
  gitIn(context, ['update-ref', 'HEAD', commit]);
}

/**
 * Replaces text in a file. The text must be there, or the setup fails.
 *
 * @param {StepContext} context - The worktree.
 * @param {{ path: string, find: string | RegExp, text: string }} step - The step.
 * @returns {void}
 */
function replaceText(context, step) {
  const old = mustRead(context.root, step.path);
  const found = typeof step.find === 'string' ? old.includes(step.find) : step.find.test(old);
  if (!found) {
    throw new Error(`setup: the text to replace was not found in ${step.path}`);
  }
  writeText(
    path.join(context.root, step.path),
    old.replace(step.find, () => step.text),
  );
}

/**
 * Removes the first tracked file of a folder that ends with a suffix.
 *
 * @param {StepContext} context - The worktree.
 * @param {{ directory: string, suffix: string }} step - The step.
 * @returns {void}
 */
function removeFirstTracked(context, step) {
  const listed = gitIn(context, ['ls-files', '--', step.directory]).split('\n');
  const file = listed.find((name) => name.endsWith(step.suffix));
  if (file === undefined) {
    throw new Error(`setup: no tracked ${step.suffix} file under ${step.directory}`);
  }
  removePath(path.join(context.root, file));
}

/**
 * Adds a dependency to a package.json (the formatting of the file is kept as 2-space JSON).
 *
 * @param {StepContext} context - The worktree.
 * @param {{ path: string, section: string, name: string, value: string }} step - The step.
 * @returns {void}
 */
function addDependency(context, step) {
  const data = JSON.parse(mustRead(context.root, step.path));
  data[step.section] = { ...data[step.section], [step.name]: step.value };
  writeText(path.join(context.root, step.path), `${JSON.stringify(data, null, 2)}\n`);
}

const HANDLERS = {
  write: (context, step) => writeText(path.join(context.root, step.path), step.text),
  append: (context, step) =>
    writeText(
      path.join(context.root, step.path),
      `${mustRead(context.root, step.path)}${step.text}`,
    ),
  replace: replaceText,
  remove: (context, step) => removePath(path.join(context.root, step.path)),
  removeTracked: removeFirstTracked,
  addDependency,
  stage: (context, step) => gitIn(context, ['add', '--', ...step.paths]),
  commit: (context, step) => commitAll(context, step.message),
  sessionBase: (context) =>
    writeText(
      path.join(context.root, '.claude', 'state', 'session-base'),
      `${gitIn(context, ['rev-parse', 'HEAD'])}\n`,
    ),
  rewind: (context, step) =>
    gitIn(context, ['reset', '-q', '--hard', `HEAD~${String(step.count)}`]),
  resetTo: (context, step) => gitIn(context, ['reset', '-q', '--hard', String(step.ref)]),
};

/**
 * Applies one setup step to the worktree.
 *
 * @param {StepContext} context - The worktree.
 * @param {Record<string, unknown>} step - A step: `write`, `append`, `replace`, `remove`, `removeTracked`, `addDependency`, `stage`, `commit`, `sessionBase`, `rewind` or `resetTo`.
 * @returns {void} It throws when the step cannot be applied.
 */
export function applyStep(context, step) {
  const handler = HANDLERS[String(step['type'])];
  if (handler === undefined) {
    throw new Error(`setup: unknown step type ${String(step['type'])}`);
  }
  handler(context, step);
}

/**
 * Removes the node_modules folders and dist copies, the worktree and its temp folder. The
 * node_modules folders go first, so that `git worktree remove` cannot follow their links into the
 * main tree.
 *
 * @param {{ main: string, parent: string, root: string, links: string[], added: boolean }} made - What was made.
 * @returns {string[]} The problems found (an empty list when all is removed).
 */
function removeWorktree(made) {
  const problems = [];
  for (const link of made.links) {
    removePath(link);
  }
  if (made.added) {
    const removed = git(made.main, ['worktree', 'remove', '--force', made.root]);
    if (removed.status !== 0) {
      problems.push(`git worktree remove failed: ${removed.stderr.trim()}`);
    }
  }
  git(made.main, ['worktree', 'prune']);
  removePath(made.parent);
  return problems;
}

/**
 * Creates the throwaway worktree. When a step of the creation fails, it removes what it made, then
 * throws.
 *
 * @param {string} main - Main repo root.
 * @returns {{ root: string, startSha: string, env: Record<string, string>, reset: () => void, apply: (step: Record<string, unknown>) => void, cleanup: () => string[] }} The worktree. `cleanup` returns the problems it found (an empty list when all is removed).
 */
export function createWorktree(main) {
  const parent = makeTemporaryDirectory('gate-fixtures-');
  /** @type {{ main: string, parent: string, root: string, links: string[], added: boolean }} */
  const made = { main, parent, root: path.join(parent, 'worktree'), links: [], added: false };
  const { root } = made;
  const excludes = path.join(parent, 'exclude');
  const env = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.excludesFile',
    GIT_CONFIG_VALUE_0: excludes,
  };
  let startSha = '';
  try {
    startSha = gitOrThrow(main, ['rev-parse', 'HEAD']).stdout.trim();
    gitOrThrow(main, ['worktree', 'add', '--detach', root, startSha]);
    made.added = true;
    writeText(excludes, 'node_modules\n');
    linkNodeModules(main, root, made.links);
    copyPackageBuilds(main, root, made.links);
  } catch (error) {
    const problems = removeWorktree(made);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error([`cannot create the worktree: ${message}`, ...problems].join('\n'), {
      cause: error,
    });
  }
  const context = { root, startSha, env };
  return {
    root,
    startSha,
    env,
    reset() {
      gitIn(context, ['reset', '-q', '--hard', startSha]);
      gitIn(context, ['clean', '-fdq']);
      removePath(path.join(root, '.claude', 'state'));
    },
    apply: (step) => applyStep(context, step),
    cleanup: () => removeWorktree(made),
  };
}
