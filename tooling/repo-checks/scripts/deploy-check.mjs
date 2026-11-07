// Deploy check: fail when a project has no valid `factory.deploy` field or a bad Cloudflare hostname.
//
// Scan: each folder projects/<name>/ that has a package.json.
//
// Rule 1: package.json has `factory.deploy`: "cloudflare", "aws" or "none". Or a non-empty array
//         of "cloudflare" and "aws" with no duplicates.
// Rule 2: a project that deploys to "cloudflare" has projects/<name>/wrangler.jsonc. Its `routes`
//         has at least one entry with `custom_domain: true`. The `pattern` of each such entry is
//         <label>.vprprudhvi.dev with one DNS label. A project without "cloudflare" that has such
//         routes still takes part in rule 3.
// Rule 3: no two projects use the same hostname. The API hostname <project>-api.vprprudhvi.dev of a
//         project that deploys to "aws" must not equal a wrangler hostname of any project.
//
// Run from the repo root: node tooling/repo-checks/scripts/deploy-check.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isGithubActions } from './lib/doc-lint.config.mjs';
import { exists, listFolder, readRepositoryFile } from './lib/fs-io.mjs';
import { parseJsonc } from './lib/jsonc.mjs';

export const DOMAIN = 'vprprudhvi.dev';
const TARGETS = new Set(['cloudflare', 'aws']);
// One DNS label: lowercase letters, digits and hyphens. It may not start or end with a hyphen.
const LABEL_CHARACTERS = /^[a-z0-9-]+$/;

/**
 * @param {unknown} value - The `factory.deploy` value.
 * @returns {boolean} True when the value is valid.
 */
export function validateDeployValue(value) {
  if (typeof value === 'string') return value === 'none' || TARGETS.has(value);
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => TARGETS.has(item)) && new Set(value).size === value.length;
}

/** @returns {string[]} The targets of a valid deploy value. */
function targetsOf(value) {
  return Array.isArray(value) ? value : [value];
}

/** @returns {boolean} True when the host is <label>.vprprudhvi.dev with one DNS label. */
function validHostname(host) {
  const suffix = `.${DOMAIN}`;
  if (!host.endsWith(suffix)) return false;
  const label = host.slice(0, -suffix.length);
  return (
    label.length <= 63 &&
    LABEL_CHARACTERS.test(label) &&
    !label.startsWith('-') &&
    !label.endsWith('-')
  );
}

/** @returns {unknown[]} The routes that have custom_domain true, as { pattern } entries. */
function customDomainRoutes(config) {
  const routes = typeof config === 'object' && config !== null ? config.routes : undefined;
  if (!Array.isArray(routes)) return [];
  return routes.filter(
    (route) => typeof route === 'object' && route !== null && route.custom_domain === true,
  );
}

/**
 * Check the wrangler file of one project.
 * @returns {{ hosts: string[], findings: { file: string, message: string }[] }}
 */
function checkWrangler(root, name, wantsCloudflare) {
  const file = `projects/${name}/wrangler.jsonc`;
  const hosts = [];
  const findings = [];
  if (!exists(path.join(root, file))) {
    if (wantsCloudflare) {
      findings.push({
        file,
        message:
          'deploy includes "cloudflare" but the file does not exist. Add a wrangler.jsonc with a custom_domain route.',
      });
    }
    return { hosts, findings };
  }
  let config;
  try {
    config = parseJsonc(readRepositoryFile(root, file));
  } catch {
    findings.push({ file, message: 'The file is not valid JSONC. Fix the syntax.' });
    return { hosts, findings };
  }
  const routes = customDomainRoutes(config);
  if (wantsCloudflare && routes.length === 0) {
    findings.push({
      file,
      message:
        'No route has custom_domain true. Add { "pattern": "<name>.vprprudhvi.dev", "custom_domain": true } to routes.',
    });
  }
  for (const route of routes) {
    const host = route.pattern;
    if (typeof host === 'string' && validHostname(host)) {
      hosts.push(host.toLowerCase());
    } else {
      findings.push({
        file,
        message: `The hostname ${JSON.stringify(host)} is not valid. Use <label>.${DOMAIN} with one lowercase DNS label, no scheme, path or wildcard.`,
      });
    }
  }
  return { hosts, findings };
}

/** Read and check the package.json of one project. Return { targets, findings }. */
function checkManifest(root, name) {
  const file = `projects/${name}/package.json`;
  let manifest;
  try {
    manifest = JSON.parse(readRepositoryFile(root, file));
  } catch {
    return {
      targets: [],
      findings: [{ file, message: 'The file is not valid JSON. Fix the syntax.' }],
    };
  }
  const deploy = manifest?.factory?.deploy;
  if (!validateDeployValue(deploy)) {
    const message = `factory.deploy is ${deploy === undefined ? 'missing' : `invalid (${JSON.stringify(deploy)})`}. Set it to "cloudflare", "aws", "none", or an array of "cloudflare" and "aws" with no duplicates.`;
    return { targets: [], findings: [{ file, message }] };
  }
  return { targets: targetsOf(deploy), findings: [] };
}

/** Add a finding for each hostname that two projects use. */
function duplicateFindings(owners) {
  const findings = [];
  for (const [host, names] of owners) {
    if (names.length > 1) {
      findings.push({
        file: `projects/${names[0]}/wrangler.jsonc`,
        message: `The hostname ${host} is used by the projects ${names.join(' and ')}. Give each project its own hostname.`,
      });
    }
  }
  return findings;
}

/**
 * Check all projects under root.
 * @param {string} root - Repo root.
 * @returns {{ file: string, message: string }[]} The findings.
 */
export function checkDeploy(root) {
  const findings = [];
  const owners = new Map();
  const apiHosts = [];
  const projectsFolder = path.join(root, 'projects');
  for (const name of listFolder(projectsFolder).sort()) {
    if (!exists(path.join(projectsFolder, name, 'package.json'))) continue;
    const manifest = checkManifest(root, name);
    findings.push(...manifest.findings);
    const wrangler = checkWrangler(root, name, manifest.targets.includes('cloudflare'));
    findings.push(...wrangler.findings);
    for (const host of wrangler.hosts) owners.set(host, [...(owners.get(host) ?? []), name]);
    if (manifest.targets.includes('aws')) apiHosts.push({ name, host: `${name}-api.${DOMAIN}` });
  }
  findings.push(...duplicateFindings(owners));
  for (const { name, host } of apiHosts) {
    const web = owners.get(host);
    if (web !== undefined) {
      findings.push({
        file: `projects/${web[0]}/wrangler.jsonc`,
        message: `The hostname ${host} is the API hostname of the project ${name} and the web hostname of the project ${web.join(' and ')}. Rename the web hostname.`,
      });
    }
  }
  return findings;
}

/** @returns {string} One output line for a finding. */
export function formatFinding(finding, github) {
  return github
    ? `::error file=${finding.file}::${finding.message}`
    : `${finding.file}: ${finding.message}`;
}

/** Run the check from the repo root. Return the exit code. */
export function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const findings = checkDeploy(root);
  if (findings.length > 0) {
    const github = isGithubActions();
    const lines = findings.map((finding) => formatFinding(finding, github));
    process.stderr.write(`${lines.join('\n')}\ndeploy-check: ${findings.length} findings\n`);
    return 1;
  }
  process.stdout.write('deploy-check: ok\n');
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
