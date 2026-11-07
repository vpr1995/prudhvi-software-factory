// Deploy plan: from the changed projects, list the ones that deploy to Cloudflare and to AWS.
//
// Input: the JSON of `rush list --impacted-by git:<base> --json` on stdin (text before the first "{"
// is ignored, so the Rush banner is fine). Output: four lines for GITHUB_OUTPUT (or stdout when that
// variable is not set): `cloudflare=<json>`, `cloudflare-count=<n>`, `aws=<json>`, `aws-count=<n>`.
//
// Rules for a project that deploys to "cloudflare" (a finding for each rule it breaks):
// - package.json has a "smoke" script. The deploy workflow runs it with SMOKE_BASE_URL set.
// - wrangler.jsonc has a string assets.directory. It stays inside the project folder.
// - wrangler.jsonc has a custom_domain route at the top level with a valid hostname.
//
// The deploy workflow runs this from the commit that it deploys. deploy-check.mjs, which CI runs
// from the base commit on each PR, has already checked the field and the hostnames.
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

/** @returns {{ entry?: object, findings: string[] }} The plan entry of one cloudflare project. */
function cloudflareEntry(root, projectPath, manifest) {
  const findings = [];
  if (typeof manifest.scripts?.smoke !== 'string') {
    findings.push(
      `${projectPath}: the package.json has no "smoke" script. Add one that tests SMOKE_BASE_URL.`,
    );
  }
  const config = readConfig(root, `${projectPath}/wrangler.jsonc`, parseJsonc);
  const directory = config?.assets?.directory;
  let assetsDirectory;
  if (typeof directory === 'string') {
    assetsDirectory = path.posix.normalize(path.posix.join(projectPath, directory));
    if (!assetsDirectory.startsWith(`${projectPath}/`)) {
      findings.push(`${projectPath}: assets.directory ${directory} is outside the project folder.`);
    }
  } else {
    findings.push(
      `${projectPath}: wrangler.jsonc has no assets.directory. Set it to the static export folder.`,
    );
  }
  const host = webHost(config);
  if (host === null) {
    findings.push(
      `${projectPath}: wrangler.jsonc has no custom_domain route with a valid hostname.`,
    );
  }
  if (findings.length > 0) return { findings };
  return {
    entry: { name: manifest.name, path: projectPath, host, assetsDirectory },
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
function changedPaths(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('The input has no JSON object.');
  return JSON.parse(text.slice(start)).projects.map((project) => project.path);
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
  process.exitCode = main();
}
