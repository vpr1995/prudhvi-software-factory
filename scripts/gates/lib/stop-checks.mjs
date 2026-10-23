import path from 'node:path';

import { formatFinding, scanFiles as scanAntiSkip } from './anti-skip-engine.mjs';
import { collectDiff } from './diff-source.mjs';
import { exists, fileSize, readText } from './fs-io.mjs';
import { antiSkipSettings } from './gate-list.mjs';
import { clipLines, stripAnsi } from './hook-io.mjs';
import { run, which } from './proc.mjs';
import {
  asPathArgument,
  runEslint,
  runTsc,
  localBinary,
  projectTsconfigs,
  shouldSkipFile,
} from './project-tools.mjs';
import { findManifestDirectory, loadRushProjects, ownerProject } from './projects.mjs';
import { formatFindings, scanFiles as scanSecrets } from './secrets.mjs';
import { discoverEnvironments } from './synth-changed.mjs';

/** @typedef {import('./rush-verify.mjs').Check} Check */

const MAX_SCAN_BYTES = 1_000_000;
const CDK_TIMEOUT_MS = 600_000;
const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/;
const TYPESCRIPT_FILE = /\.(?:[cm]?tsx?)$/;
const OPENGREP_RULES = 'tooling/opengrep';
const OPENGREP_FILES = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml)$/;
const LINT_LINES = 40;

/**
 * Runs the anti-skip scan on the changes since the base commit.
 *
 * @param {string} root - Repo root.
 * @param {string} base - Commit to compare with.
 * @returns {Check} The check.
 */
export function antiSkipCheck(root, base) {
  let source;
  try {
    source = collectDiff({ root, base });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { name: 'anti-skip', status: 'fail', detail: `the diff could not be read: ${text}` };
  }
  const findings = scanAntiSkip(source.files, {
    readFile: source.readFile,
    settings: antiSkipSettings(),
  });
  return {
    name: 'anti-skip',
    status: findings.length === 0 ? 'pass' : 'fail',
    detail: findings.map((finding) => formatFinding(finding)).join('\n'),
  };
}

/**
 * Scans changed files for secrets (gitleaks, plus the built-in patterns).
 *
 * @param {string} root - Repo root.
 * @param {string[]} files - Changed files that still exist.
 * @returns {Check} The check.
 */
export function secretsCheck(root, files) {
  const tooBig = files.filter((file) => fileSize(path.join(root, file)) > MAX_SCAN_BYTES);
  const notes = [];
  if (tooBig.length > 0) {
    notes.push(
      `${String(tooBig.length)} file(s) over ${String(MAX_SCAN_BYTES)} bytes were not scanned: ${tooBig.slice(0, 5).join(', ')}${tooBig.length > 5 ? ', ...' : ''}`,
    );
  }
  const entries = files
    .filter((file) => !tooBig.includes(file))
    .map((file) => ({ file, text: readText(path.join(root, file)) }))
    .filter((entry) => entry.text !== null)
    .map((entry) => ({ file: entry.file, text: entry.text ?? '' }));
  const result = scanSecrets(root, entries);
  if (result.engine === 'regex') {
    notes.push('gitleaks is not installed: only the built-in patterns ran');
  }
  if (result.findings.length === 0) {
    return {
      name: 'secrets',
      status: 'pass',
      detail: notes.join('\n'),
      degraded: notes.length > 0,
    };
  }
  return {
    name: 'secrets',
    status: 'fail',
    detail: `${formatFindings(result.findings)}\nRemove the secret and rotate it. Never print it.`,
  };
}

/**
 * Runs Opengrep with the repo rules on changed files.
 *
 * @param {string} root - Repo root.
 * @param {string[]} files - Changed files that still exist.
 * @returns {Check} The check. It skips when opengrep or the rules are missing.
 */
export function opengrepCheck(root, files) {
  const targets = files.filter(
    (file) =>
      OPENGREP_FILES.test(file) &&
      !file.endsWith('pnpm-lock.yaml') &&
      !file.startsWith(`${OPENGREP_RULES}/`) &&
      !shouldSkipFile(file),
  );
  if (!exists(path.join(root, OPENGREP_RULES))) {
    return { name: 'opengrep', status: 'skip', detail: 'this repo has no tooling/opengrep rules' };
  }
  if (which('opengrep') === null) {
    return {
      name: 'opengrep',
      status: 'skip',
      detail: 'opengrep is not installed, so the Opengrep scan did not run',
      degraded: true,
    };
  }
  if (targets.length === 0) {
    return { name: 'opengrep', status: 'pass', detail: '' };
  }
  const result = run(
    'opengrep',
    ['scan', '--config', OPENGREP_RULES, '--error', '--quiet', ...targets.map(asPathArgument)],
    { cwd: root, timeoutMs: CDK_TIMEOUT_MS },
  );
  if (result.status === 0) {
    return { name: 'opengrep', status: 'pass', detail: '' };
  }
  const text = clipLines(stripAnsi(`${result.stdout}${result.stderr}`).trim(), LINT_LINES);
  return result.status === 1
    ? { name: 'opengrep', status: 'fail', detail: text }
    : {
        name: 'opengrep',
        status: 'skip',
        detail: `opengrep could not run: ${text}`,
        degraded: true,
      };
}

/**
 * Runs `cdk synth` for one infra folder, once for each environment of the app. An app that reads
 * the `env` context in `bin/` gets `-c env=<name>` for each key of the `configs` object in
 * `lib/config/config.ts`. An app that does not read it gets one synth with no `-c env`. The
 * environments come from `discoverEnvironments`, the same as the pre-push synth.
 *
 * @param {string} root - Repo root.
 * @param {string} folder - Infra folder from the repo root.
 * @returns {Check} The check. It skips when the CDK CLI is not installed there. It fails on the
 *   first environment that fails, and its name tells that environment.
 */
export function cdkSynthCheck(root, folder) {
  const directory = path.join(root, folder);
  const binary = localBinary(directory, 'cdk');
  const name = `cdk synth: ${folder}`;
  if (binary === null) {
    return {
      name,
      status: 'skip',
      detail: 'cdk is not installed in this folder (run rush install)',
      degraded: true,
    };
  }
  let environments;
  try {
    environments = discoverEnvironments(root, folder);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { name, status: 'fail', detail: text };
  }
  for (const env of environments) {
    const context = env === null ? [] : ['-c', `env=${env}`];
    const result = run(binary, ['synth', '--quiet', ...context], {
      cwd: directory,
      timeoutMs: CDK_TIMEOUT_MS,
    });
    if (result.status !== 0) {
      return {
        name: env === null ? name : `${name} (env=${env})`,
        status: 'fail',
        detail: clipLines(stripAnsi(`${result.stdout}${result.stderr}`).trim(), LINT_LINES),
      };
    }
  }
  return { name, status: 'pass', detail: '' };
}

/**
 * Names the Rush package of each changed project.
 *
 * @param {string} root - Repo root.
 * @param {string[]} changed - Changed paths.
 * @returns {Map<string, string>} Map from project folder (absolute) to a label.
 */
function projectFolders(root, changed) {
  const projects = loadRushProjects(root);
  const folders = new Map();
  for (const file of changed) {
    const owner = ownerProject(projects, file);
    const manifest = findManifestDirectory(root, path.join(root, file));
    if (manifest !== null && manifest.marker === 'package.json') {
      folders.set(manifest.directory, owner?.name ?? path.relative(root, manifest.directory));
    }
  }
  return folders;
}

/**
 * Runs tsc for each tsconfig of the changed projects: the root one and the web part one.
 *
 * @param {string} root - Repo root.
 * @param {string[]} typed - Changed TypeScript files that still exist.
 * @returns {Check[]} One check for each tsconfig.
 */
function typecheckChecks(root, typed) {
  return [...projectFolders(root, typed)].flatMap(([directory, label]) => {
    const configs = projectTsconfigs(directory);
    return (configs.length === 0 ? [undefined] : configs).map((tsconfig) => {
      const isRoot = tsconfig === undefined || tsconfig === 'tsconfig.json';
      const result = runTsc(directory, isRoot ? undefined : tsconfig);
      return {
        name: `typecheck: ${label}${isRoot ? '' : ` (${tsconfig})`}`,
        status: result.note !== '' ? 'skip' : result.failed ? 'fail' : 'pass',
        detail: result.note === '' ? result.output : result.note,
      };
    });
  });
}

/**
 * The fast checks for a subagent stop: ESLint on changed script files and tsc per changed project.
 *
 * @param {string} root - Repo root.
 * @param {string[]} files - Changed files that still exist.
 * @returns {Check[]} Checks.
 */
export function fastChecks(root, files) {
  const scripts = files.filter((file) => SCRIPT_FILE.test(file) && !shouldSkipFile(file));
  const lintFailures = scripts
    .map((file) => ({ file, result: runEslint(root, file) }))
    .filter((entry) => entry.result.failed && entry.result.note === '')
    .map((entry) => `${entry.file}:\n${entry.result.output}`);
  const typed = files.filter((file) => TYPESCRIPT_FILE.test(file) && !shouldSkipFile(file));
  return /** @type {Check[]} */ ([
    {
      name: 'eslint (changed files)',
      status: lintFailures.length === 0 ? 'pass' : 'fail',
      detail: clipLines(lintFailures.join('\n'), LINT_LINES),
    },
    ...typecheckChecks(root, typed),
  ]);
}
