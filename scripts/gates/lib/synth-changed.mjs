// cdk synth for changed infra: finds the CDK apps, picks the ones that changed since a base commit,
// and runs a real, offline `cdk synth --quiet` for every environment of each one.
//
// An app is a folder with a cdk.json: `projects/<name>` or `platform/infra`. It is affected when a
// committed change since the base (`base...HEAD`) touches one of its triggers (see `appTriggers`).
import path from 'node:path';

import {
  exists,
  listDirectory,
  makeTemporaryDirectory,
  readJson,
  readText,
  removePath,
} from './fs-io.mjs';
import { readEnv } from './gates.config.mjs';
import { stripAnsi } from './hook-io.mjs';
import { gitOrThrow, run } from './proc.mjs';
import { listProjects } from './projects.mjs';
import { mergeBase, resolveCommit } from './revisions.mjs';

/** @typedef {{ folder: string, kind: 'project' | 'platform', prefixes: string[], files: string[] }} CdkApp */

const PLATFORM_APP = 'platform/infra';
/** Changes to these paths affect every CDK app. Test-only changes in cdk-constructs do not. */
const GLOBAL_PREFIXES = ['packages/cdk-constructs/src/'];
const GLOBAL_FILES = ['packages/cdk-constructs/package.json', 'common/config/rush/pnpm-lock.yaml'];
/** Rush's own pnpm. CDK bundles Node code with `pnpm exec esbuild` when it finds pnpm-lock.yaml. */
export const RUSH_PNPM_BIN = 'common/temp/pnpm-local/node_modules/.bin';
/** Files the TracedNodeFunction bundle hooks write at the repo root. They must be gone after a synth. */
export const ROOT_LEFTOVERS = Object.freeze(['package.json', '.cdk-bundle-package-json']);
/** A synth bundles Python in Docker, Go and Node code. A first run builds the Docker image. */
export const SYNTH_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_SCRIPT_HOPS = 5;
const ENV_CONTEXT = /\btryGetContext\(\s*['"]env['"]\s*\)/;
const CONFIGS_OBJECT = /\bconst\s+configs\s*=\s*\{([^}]*)\}/;
const CONFIG_KEY = /^\s*['"]?([\w-]+)['"]?\s*(?::|$)/;
const NPM_RUN = /^npm\s+run\s+([\w:.-]+)/;
const PROJECT_FLAG = /(?:^|\s)(?:-p|--project)\s+(\S+)/g;
/**
 * The synth child sees no AWS credentials, so the synth stays offline: the CLI cannot ask STS for
 * the account, and a context lookup fails with a cdk error instead of calling AWS.
 */
const NO_CREDENTIALS = Object.freeze({
  AWS_ACCESS_KEY_ID: '',
  AWS_SECRET_ACCESS_KEY: '',
  AWS_SESSION_TOKEN: '',
  AWS_PROFILE: '',
  AWS_EC2_METADATA_DISABLED: 'true',
});

/**
 * Finds the tsconfig files that the cdk.json `build` command compiles. It follows `npm run <script>`
 * through package.json and reads the `-p` or `--project` arguments of the final command.
 *
 * @param {unknown} cdkJson - Parsed cdk.json.
 * @param {unknown} manifest - Parsed package.json.
 * @returns {string[]} tsconfig paths from the app folder. Empty when the build is not found.
 */
export function buildTsconfigs(cdkJson, manifest) {
  const scripts =
    manifest !== null && typeof manifest === 'object' && 'scripts' in manifest
      ? /** @type {Record<string, unknown>} */ (manifest.scripts ?? {})
      : {};
  let command =
    cdkJson !== null && typeof cdkJson === 'object' && 'build' in cdkJson ? cdkJson.build : '';
  for (let hop = 0; hop < MAX_SCRIPT_HOPS && typeof command === 'string'; hop += 1) {
    const script = NPM_RUN.exec(command.trim())?.[1];
    if (script === undefined) {
      break;
    }
    command = scripts[script];
  }
  return typeof command === 'string'
    ? [...command.matchAll(PROJECT_FLAG)].map((match) => path.posix.normalize(match[1] ?? ''))
    : [];
}

/**
 * Lists the triggers of an app: path prefixes and exact files from the repo root.
 *
 * @param {string} folder - App folder from the repo root.
 * @param {'project' | 'platform'} kind - A project app also bundles its `src/` into Lambda assets.
 * @param {string[]} tsconfigs - tsconfig paths from the app folder that its build compiles.
 * @returns {CdkApp} The app with its triggers.
 */
export function appTriggers(folder, kind, tsconfigs) {
  const ownFolders = kind === 'project' ? ['bin', 'lib', 'src'] : ['bin', 'lib'];
  const ownFiles = new Set(['cdk.json', 'package.json', 'tsconfig.cdk.json', ...tsconfigs]);
  return {
    folder,
    kind,
    prefixes: [...ownFolders.map((name) => `${folder}/${name}/`), ...GLOBAL_PREFIXES],
    files: [...[...ownFiles].map((name) => `${folder}/${name}`), ...GLOBAL_FILES],
  };
}

/**
 * Finds the CDK apps: `projects/<name>` and `platform/infra` folders that have a cdk.json.
 *
 * @param {string} root - Repo root.
 * @returns {CdkApp[]} Apps with their triggers, projects first.
 */
export function findCdkApps(root) {
  const projects = listProjects(root)
    .map((name) => `projects/${name}`)
    .filter((folder) => exists(path.join(root, folder, 'cdk.json')))
    .map((folder) => ({ folder, kind: /** @type {const} */ ('project') }));
  const platform = exists(path.join(root, PLATFORM_APP, 'cdk.json'))
    ? [{ folder: PLATFORM_APP, kind: /** @type {const} */ ('platform') }]
    : [];
  return [...projects, ...platform].map(({ folder, kind }) =>
    appTriggers(
      folder,
      kind,
      buildTsconfigs(
        readJson(path.join(root, folder, 'cdk.json')),
        readJson(path.join(root, folder, 'package.json')),
      ),
    ),
  );
}

/**
 * Picks the apps that a list of changed paths affects.
 *
 * @param {CdkApp[]} apps - The apps.
 * @param {string[]} changedPaths - Changed paths from the repo root.
 * @returns {{ app: CdkApp, paths: string[] }[]} Affected apps (in the order of `apps`) and the paths that hit each.
 */
export function affectedApps(apps, changedPaths) {
  return apps
    .map((app) => ({
      app,
      paths: changedPaths.filter(
        (changed) =>
          app.files.includes(changed) || app.prefixes.some((prefix) => changed.startsWith(prefix)),
      ),
    }))
    .filter((entry) => entry.paths.length > 0);
}

/**
 * Reads the environment names from the `configs` object of an app config module, for example
 * `const configs = { dev: developmentConfig, staging: stagingConfig, prod: productionConfig }`.
 *
 * @param {string} configText - Source of `lib/config/config.ts`.
 * @returns {string[]} The keys, in source order. Empty when there is no such object.
 */
export function envNames(configText) {
  const body = CONFIGS_OBJECT.exec(configText)?.[1] ?? '';
  return body
    .split(',')
    .map((entry) => CONFIG_KEY.exec(entry)?.[1])
    .filter((key) => key !== undefined && key !== '');
}

/**
 * Finds the environments to synth for an app. An app that reads the `env` context in `bin/` gets
 * one synth for each key of the `configs` object in `lib/config/config.ts`. An app that does not
 * read it gets one synth with no context.
 *
 * @param {string} root - Repo root.
 * @param {string} folder - App folder from the repo root.
 * @returns {(string | null)[]} Environment names, or `[null]` for one synth with no `-c env`.
 * @throws When the app reads the `env` context and the names cannot be found.
 */
export function discoverEnvironments(root, folder) {
  const binFolder = path.join(root, folder, 'bin');
  const readsEnv = listDirectory(binFolder)
    .filter((entry) => !entry.isDirectory && /\.[cm]?[jt]s$/.test(entry.name))
    .some((entry) => ENV_CONTEXT.test(readText(path.join(binFolder, entry.name)) ?? ''));
  if (!readsEnv) {
    return [null];
  }
  const configFile = `${folder}/lib/config/config.ts`;
  const names = envNames(readText(path.join(root, configFile)) ?? '');
  if (names.length === 0) {
    throw new Error(
      `${folder}/bin reads the "env" context, but ${configFile} has no "const configs = { <env>: ... }" object, so the environment names are unknown.`,
    );
  }
  return names;
}

/**
 * Builds the synth command of one app and environment.
 *
 * PATH: Rush's pnpm first, then the app's `node_modules/.bin` (as `npm run synth` does), then the
 * PATH of this process. CDK runs `pnpm exec esbuild` in the Rush root, which has no node_modules,
 * so pnpm finds esbuild on PATH: the app's pinned esbuild must come before any global one.
 *
 * @param {{ root: string, folder: string, env: string | null, outDirectory: string, path: string }} options -
 *   `path` is the PATH of this process.
 * @returns {{ program: string, args: string[], cwd: string, env: Record<string, string> }} The command.
 */
export function synthCommand(options) {
  const cwd = path.join(options.root, options.folder);
  const context = options.env === null ? [] : ['-c', `env=${options.env}`];
  const missing = path.join(options.outDirectory, 'no-aws-config');
  return {
    program: path.join(cwd, 'node_modules', '.bin', 'cdk'),
    args: ['synth', '--quiet', ...context, '-o', path.join(options.outDirectory, 'cdk.out')],
    cwd,
    env: {
      ...NO_CREDENTIALS,
      AWS_CONFIG_FILE: missing,
      AWS_SHARED_CREDENTIALS_FILE: missing,
      PATH: [
        path.join(options.root, RUSH_PNPM_BIN),
        path.join(cwd, 'node_modules', '.bin'),
        options.path,
      ]
        .filter(Boolean)
        .join(':'),
    },
  };
}

/**
 * Lists the paths that committed changes since the base touched (`base...HEAD`). Renames count on
 * both sides, and deleted files count.
 *
 * @param {string} root - Repo root.
 * @param {string} base - Base commit id.
 * @returns {string[]} Paths from the repo root.
 */
export function committedChanges(root, base) {
  const start = mergeBase(root, base, resolveCommit(root, 'HEAD'));
  const result = gitOrThrow(root, [
    '--no-optional-locks',
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    '--no-ext-diff',
    start,
    'HEAD',
    '--',
  ]);
  return result.stdout.split('\0').filter((entry) => entry !== '');
}

/**
 * @param {string} root - Repo root.
 * @returns {string[]} Root leftovers of the bundle hooks that exist now.
 */
export function rootLeftovers(root) {
  return ROOT_LEFTOVERS.filter((name) => exists(path.join(root, name)));
}

/**
 * @param {string[]} found - Leftover file names.
 * @param {string} when - When they were found.
 * @returns {string} The failure message.
 */
function leftoverMessage(found, when) {
  return `synth: FAIL ${when}: ${found.join(', ')} at the repo root. The TracedNodeFunction bundle hooks write these files and must remove them. Find the cause, then delete them.\n`;
}

/**
 * Runs the gate.
 *
 * @param {{ root: string, base: string, full?: boolean, write: (text: string) => void, writeError: (text: string) => void }} options -
 *   `base` is a commit id or revision. `full` (GATES_FULL=1) makes every app affected.
 * @returns {number} Exit code: 0 pass, 1 a synth or leftover check failed.
 */
export function runSynthGate(options) {
  const { root, write, writeError } = options;
  const base = resolveCommit(root, options.base);
  const short = base.slice(0, 12);
  const apps = findCdkApps(root);
  const affected =
    options.full === true
      ? apps.map((app) => ({ app, paths: [] }))
      : affectedApps(apps, committedChanges(root, base));
  for (const app of apps) {
    if (!affected.some((entry) => entry.app.folder === app.folder)) {
      write(`synth: SKIP ${app.folder} (no infra change since ${short})\n`);
    }
  }
  if (affected.length === 0) {
    return 0;
  }
  if (!exists(path.join(root, RUSH_PNPM_BIN, 'pnpm'))) {
    writeError(
      `synth: FAIL Rush's pnpm is missing at ${RUSH_PNPM_BIN}/pnpm. CDK bundles Node code with "pnpm exec esbuild". Run "node common/scripts/install-run-rush.js install" first.\n`,
    );
    return 1;
  }
  const stale = rootLeftovers(root);
  if (stale.length > 0) {
    writeError(leftoverMessage(stale, 'before the synth'));
    return 1;
  }
  for (const { app, paths } of affected) {
    const status = synthApp({ root, app, paths }, options);
    if (status !== 0) {
      return status;
    }
  }
  return 0;
}

/**
 * Synths every environment of one app.
 *
 * @param {{ root: string, app: CdkApp, paths: string[] }} target - Repo root, the app, and the
 *   changed paths that hit it. No paths: GATES_FULL=1 forced the app.
 * @param {{ write: (text: string) => void, writeError: (text: string) => void }} io - Output.
 * @returns {number} Exit code.
 */
function synthApp(target, io) {
  const { root, app, paths } = target;
  const cdk = path.join(root, app.folder, 'node_modules', '.bin', 'cdk');
  if (!exists(cdk)) {
    io.writeError(
      `synth: FAIL ${app.folder}: ${app.folder}/node_modules/.bin/cdk is missing. Run "node common/scripts/install-run-rush.js install" first.\n`,
    );
    return 1;
  }
  const more = paths.length > 3 ? ` and ${String(paths.length - 3)} more` : '';
  io.write(
    paths.length === 0
      ? `synth: ${app.folder} forced (GATES_FULL=1)\n`
      : `synth: ${app.folder} changed: ${paths.slice(0, 3).join(', ')}${more}\n`,
  );
  for (const env of discoverEnvironments(root, app.folder)) {
    const label = `${app.folder} env=${env ?? '(none)'}`;
    const outDirectory = makeTemporaryDirectory('synth-changed-');
    const command = synthCommand({
      root,
      folder: app.folder,
      env,
      outDirectory,
      path: readEnv('PATH') ?? '',
    });
    const started = Date.now();
    const result = run(command.program, command.args, {
      cwd: command.cwd,
      env: command.env,
      timeoutMs: SYNTH_TIMEOUT_MS,
    });
    removePath(outDirectory);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const failed = result.status !== 0;
    if (failed) {
      const why = result.timedOut
        ? `timed out after ${String(SYNTH_TIMEOUT_MS / 60_000)} min`
        : `exit ${String(result.status)}`;
      io.writeError(
        `synth: FAIL ${label} (${seconds}s, ${why})\n$ ${[command.program, ...command.args].join(' ')}\n${stripAnsi(`${result.stdout}${result.stderr}`).trimEnd()}\n`,
      );
    }
    // A failed synth can leave the files too: report them with the cdk error.
    const left = rootLeftovers(root);
    if (left.length > 0) {
      io.writeError(leftoverMessage(left, `after ${label}`));
    }
    if (failed || left.length > 0) {
      return 1;
    }
    io.write(`synth: PASS ${label} (${seconds}s)\n`);
  }
  return 0;
}
