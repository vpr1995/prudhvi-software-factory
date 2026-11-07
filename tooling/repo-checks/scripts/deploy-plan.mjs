// Deploy plan: from the changed projects, list the ones that deploy to Cloudflare and to AWS.
//
// Input: the JSON of `rush list --impacted-by git:<base> --json` on stdin (text before the first "{"
// is ignored, so the Rush banner is fine). Output: four lines for GITHUB_OUTPUT (or stdout when that
// variable is not set): `cloudflare=<json>`, `cloudflare-count=<n>`, `aws=<json>`, `aws-count=<n>`.
//
// Rules for a project that deploys to "cloudflare" (a finding for each rule it breaks):
// - package.json has a "deploy:cloudflare" script (wrangler deploy). The deploy workflow runs it, so
//   the workflow never names wrangler and the project owns the wrangler version.
// - package.json has a "smoke" script. The deploy workflow runs it with SMOKE_BASE_URL set.
// - wrangler.jsonc has a string assets.directory. It stays inside the project folder.
// - wrangler.jsonc has a custom_domain route at the top level with a valid hostname.
//
// The deploy workflow runs this from the commit that it deploys. deploy-check.mjs, which CI runs
// from the base commit on each PR, has already checked the field and the hostnames.
//
// `deploy-plan.mjs base <last-success> <before>` prints the commit to plan from: the first usable one of
// the last successful deploy, the commit before the push, and the parent of HEAD.
//
// Run: node common/scripts/install-run-rush.js list --impacted-by git:<base> --json | node tooling/repo-checks/scripts/deploy-plan.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { routeEntries, validateDeployValue, validHostname } from './deploy-check.mjs';
import { githubOutputFile } from './lib/deploy-plan.config.mjs';
import { appendToFile, exists, readRepositoryFile, readStdin } from './lib/fs-io.mjs';
import { parseJsonc } from './lib/jsonc.mjs';

const PROJECT_PATH = /^projects\/[^/]+$/;

/** @returns {unknown} The parsed file, or null when it is missing or not valid. */
function readConfig(root, file, parse) {
  if (!exists(path.join(root, file))) return null;
  try {
    return parse(readRepositoryFile(root, file));
  } catch {
    return null;
  }
}

/** @returns {string | null} The first top-level custom_domain hostname that is valid. */
function webHost(config) {
  for (const { where, route } of routeEntries(config)) {
    if (where.startsWith('env.')) continue;
    const pattern = route?.custom_domain === true ? route.pattern : null;
    if (typeof pattern === 'string' && validHostname(pattern)) return pattern;
  }
  return null;
}

/** @returns {{ resolved: string, problem: string | null }} The assets folder from the repo root, or what is wrong with it. */
function resolveAssets(projectPath, directory) {
  const bad = (problem) => ({ resolved: '', problem: `${projectPath}: ${problem}` });
  if (typeof directory !== 'string') {
    return bad('wrangler.jsonc has no assets.directory. Set it to the static export folder.');
  }
  if (path.posix.isAbsolute(directory)) {
    return bad(
      `assets.directory ${directory} is an absolute path. Use a folder inside the project.`,
    );
  }
  const resolved = path.posix.normalize(path.posix.join(projectPath, directory));
  if (resolved === projectPath) {
    return bad(
      `assets.directory ${directory} is the project folder. Set it to the static export folder.`,
    );
  }
  if (!resolved.startsWith(`${projectPath}/`)) {
    return bad(`assets.directory ${directory} is outside the project folder.`);
  }
  return { resolved, problem: null };
}

/** @returns {{ entry?: object, findings: string[] }} The plan entry of one cloudflare project. */
function cloudflareEntry(root, projectPath, manifest) {
  const findings = [];
  if (typeof manifest.scripts?.smoke !== 'string') {
    findings.push(
      `${projectPath}: the package.json has no "smoke" script. Add one that tests SMOKE_BASE_URL.`,
    );
  }
  if (typeof manifest.scripts?.['deploy:cloudflare'] !== 'string') {
    findings.push(
      `${projectPath}: the package.json has no "deploy:cloudflare" script. Add "deploy:cloudflare": "wrangler deploy".`,
    );
  }
  const config = readConfig(root, `${projectPath}/wrangler.jsonc`, parseJsonc);
  const { resolved, problem } = resolveAssets(projectPath, config?.assets?.directory);
  if (problem !== null) findings.push(problem);
  const host = webHost(config);
  if (host === null) {
    findings.push(
      `${projectPath}: wrangler.jsonc has no custom_domain route with a valid hostname.`,
    );
  }
  if (findings.length > 0) return { findings };
  return {
    entry: { name: manifest.name, path: projectPath, host, assetsDirectory: resolved },
    findings,
  };
}

/**
 * Plan the deploy of the changed projects.
 * @param {string} root - Repo root.
 * @param {string[]} changed - Repo-relative project paths that the change impacts.
 * @returns {{ cloudflare: object[], aws: object[], findings: string[] }} The plan.
 */
export function planDeploy(root, changed) {
  const plan = { cloudflare: [], aws: [], findings: [] };
  for (const projectPath of new Set(changed)) {
    if (!PROJECT_PATH.test(projectPath)) continue;
    const manifest = readConfig(root, `${projectPath}/package.json`, JSON.parse);
    const deploy = manifest?.factory?.deploy;
    if (!validateDeployValue(deploy)) continue;
    const targets = Array.isArray(deploy) ? deploy : [deploy];
    if (targets.includes('cloudflare')) {
      const { entry, findings } = cloudflareEntry(root, projectPath, manifest);
      if (entry !== undefined) plan.cloudflare.push(entry);
      plan.findings.push(...findings);
    }
    if (targets.includes('aws')) plan.aws.push({ name: manifest.name, path: projectPath });
  }
  return plan;
}

/** @returns {string[]} The lines for GITHUB_OUTPUT. */
export function outputLines(plan) {
  return [
    `cloudflare=${JSON.stringify(plan.cloudflare)}`,
    `cloudflare-count=${String(plan.cloudflare.length)}`,
    `aws=${JSON.stringify(plan.aws)}`,
    `aws-count=${String(plan.aws.length)}`,
  ];
}

/** @returns {string[]} The project paths in the output of `rush list --json`. */
export function changedPaths(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('The input has no JSON object.');
  return JSON.parse(text.slice(start)).projects.map((project) => project.path);
}

const ZERO_SHA = /^0+$/;

/**
 * Pick the commit to plan from. GitHub keeps one waiting run for each concurrency group, so a
 * newer push can cancel the run of an older push. The event's "before" commit then misses the
 * changes of the cancelled push. The last successful deploy is the safe base.
 * @param {string[]} candidates - Commits in order of preference.
 * @param {(sha: string) => boolean} isUsable - True when the commit is in the checkout and is an ancestor of HEAD.
 * @returns {string} The first usable commit, or an empty string.
 */
export function pickBase(candidates, isUsable) {
  return candidates.find((sha) => sha !== '' && !ZERO_SHA.test(sha) && isUsable(sha)) ?? '';
}

/** @returns {boolean} True when git succeeds for the arguments. */
function gitSucceeds(args) {
  try {
    execFileSync('git', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Print the base commit for `deploy-plan.mjs base <last-success> <before>`. Return the exit code. */
function printBase(lastSuccess = '', before = '') {
  const parent = gitSucceeds(['rev-parse', '--verify', '--quiet', 'HEAD~1'])
    ? execFileSync('git', ['rev-parse', 'HEAD~1'], { encoding: 'utf8' }).trim()
    : '';
  const isUsable = (sha) =>
    gitSucceeds(['cat-file', '-e', `${sha}^{commit}`]) &&
    gitSucceeds(['merge-base', '--is-ancestor', sha, 'HEAD']);
  const base = pickBase([lastSuccess, before, parent], isUsable);
  if (base === '') {
    process.stderr.write('deploy-plan: no usable base commit.\n');
    return 1;
  }
  process.stdout.write(`${base}\n`);
  return 0;
}

/** Run the plan from the repo root. Return the exit code. */
export function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const plan = planDeploy(root, changedPaths(readStdin()));
  if (plan.findings.length > 0) {
    process.stderr.write(
      `${plan.findings.join('\n')}\ndeploy-plan: ${plan.findings.length} findings\n`,
    );
    return 1;
  }
  const lines = `${outputLines(plan).join('\n')}\n`;
  const target = githubOutputFile();
  if (target === '') process.stdout.write(lines);
  else appendToFile(target, lines);
  process.stderr.write(
    `deploy-plan: ${plan.cloudflare.length} cloudflare, ${plan.aws.length} aws\n`,
  );
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...rest] = process.argv.slice(2);
  process.exitCode = mode === 'base' ? printBase(...rest) : main();
}
