// Tests for scripts/deploy-check.mjs: factory.deploy values, wrangler hostnames and uniqueness.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { checkDeploy, formatFinding, validateDeployValue } from '../scripts/deploy-check.mjs';

const wrangler = (...patterns) =>
  `{
  // Worker config.
  "name": "x",
  "routes": [
    ${patterns.map((pattern) => `{ "pattern": "${pattern}", "custom_domain": true },`).join('\n    ')}
  ],
}`;

/** Build a temp repo. `projects` maps a folder name to { deploy, wrangler }. */
function fixture(projects) {
  const root = mkdtempSync(path.join(tmpdir(), 'deploy-check-'));
  for (const [name, { deploy, wrangler: config, raw }] of Object.entries(projects)) {
    const folder = path.join(root, 'projects', name);
    mkdirSync(folder, { recursive: true });
    const manifest = raw ?? { name, ...(deploy === undefined ? {} : { factory: { deploy } }) };
    writeFileSync(path.join(folder, 'package.json'), JSON.stringify(manifest));
    if (config !== undefined) writeFileSync(path.join(folder, 'wrangler.jsonc'), config);
  }
  return root;
}

/** Run the check on a fixture and remove it. Return the messages. */
function run(projects) {
  const root = fixture(projects);
  try {
    return checkDeploy(root).map((finding) => `${finding.file}: ${finding.message}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('validateDeployValue accepts the strings and the arrays', () => {
  for (const value of ['cloudflare', 'aws', 'none', ['aws'], ['cloudflare', 'aws']]) {
    assert.equal(validateDeployValue(value), true, JSON.stringify(value));
  }
});

test('validateDeployValue rejects bad values', () => {
  const bad = ['Cloudflare', '', 'vercel', [], ['none'], ['aws', 'aws'], ['aws', 'x'], 1, null, {}];
  for (const value of bad) {
    assert.equal(validateDeployValue(value), false, JSON.stringify(value));
  }
});

test('a valid repo has no finding', () => {
  const findings = run({
    site: { deploy: 'cloudflare', wrangler: wrangler('site.vprprudhvi.dev') },
    tool: { deploy: ['cloudflare', 'aws'], wrangler: wrangler('tool.vprprudhvi.dev') },
    sample: { deploy: 'none' },
    backend: { deploy: 'aws' },
  });
  assert.deepEqual(findings, []);
});

test('a missing factory.deploy is a finding', () => {
  const findings = run({ a: {} });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /projects\/a\/package\.json: .*factory\.deploy/);
});

test('a bad factory.deploy value is a finding', () => {
  assert.equal(run({ a: { deploy: 'vercel' } }).length, 1);
  assert.equal(run({ a: { deploy: ['none'] } }).length, 1);
  assert.equal(run({ a: { deploy: ['aws', 'aws'] } }).length, 1);
});

test('a package.json that is not valid JSON is a finding', () => {
  const root = fixture({ a: { deploy: 'none' } });
  try {
    writeFileSync(path.join(root, 'projects/a/package.json'), '{ nope');
    const findings = checkDeploy(root);
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a folder with no package.json is skipped', () => {
  const root = fixture({});
  try {
    mkdirSync(path.join(root, 'projects/empty'), { recursive: true });
    assert.deepEqual(checkDeploy(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cloudflare with no wrangler.jsonc is a finding', () => {
  const findings = run({ a: { deploy: 'cloudflare' } });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /wrangler\.jsonc/);
});

test('cloudflare with no custom_domain route is a finding', () => {
  const config = '{ "routes": ["a.vprprudhvi.dev/*", { "pattern": "a.vprprudhvi.dev" }] }';
  const findings = run({ a: { deploy: 'cloudflare', wrangler: config } });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /custom_domain/);
});

test('cloudflare with no routes array is a finding', () => {
  assert.equal(run({ a: { deploy: 'cloudflare', wrangler: '{}' } }).length, 1);
});

test('a wrangler.jsonc that does not parse is a finding', () => {
  assert.equal(run({ a: { deploy: 'cloudflare', wrangler: '{ "routes": [' } }).length, 1);
});

test('the apex hostname is a finding', () => {
  const findings = run({ a: { deploy: 'cloudflare', wrangler: wrangler('vprprudhvi.dev') } });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /vprprudhvi\.dev/);
});

test('a nested hostname is a finding', () => {
  const findings = run({ a: { deploy: 'cloudflare', wrangler: wrangler('x.a.vprprudhvi.dev') } });
  assert.equal(findings.length, 1);
});

test('a wildcard, a scheme, a path, an uppercase label and another domain are findings', () => {
  for (const host of [
    '*.vprprudhvi.dev',
    'https://a.vprprudhvi.dev',
    'a.vprprudhvi.dev/path',
    'A.vprprudhvi.dev',
    'a.example.com',
    '-a.vprprudhvi.dev',
  ]) {
    const findings = run({ a: { deploy: 'cloudflare', wrangler: wrangler(host) } });
    assert.equal(findings.length, 1, host);
  }
});

test('a duplicate hostname across two projects names both projects', () => {
  const findings = run({
    a: { deploy: 'cloudflare', wrangler: wrangler('same.vprprudhvi.dev') },
    b: { deploy: 'cloudflare', wrangler: wrangler('same.vprprudhvi.dev') },
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /same\.vprprudhvi\.dev/);
  assert.match(findings[0], /\ba\b/);
  assert.match(findings[0], /\bb\b/);
});

test('a project without cloudflare still takes part in the uniqueness check', () => {
  const findings = run({
    a: { deploy: 'cloudflare', wrangler: wrangler('same.vprprudhvi.dev') },
    b: { deploy: 'none', wrangler: wrangler('same.vprprudhvi.dev') },
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /\ba\b.*\bb\b|\bb\b.*\ba\b/);
});

test('an api hostname that equals a web hostname is a finding', () => {
  const findings = run({
    shop: { deploy: 'aws' },
    web: { deploy: 'cloudflare', wrangler: wrangler('shop-api.vprprudhvi.dev') },
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /shop-api\.vprprudhvi\.dev/);
  assert.match(findings[0], /\bshop\b/);
  assert.match(findings[0], /\bweb\b/);
});

test('an api hostname of a project without aws does not collide', () => {
  const findings = run({
    shop: { deploy: 'none' },
    web: { deploy: 'cloudflare', wrangler: wrangler('shop-api.vprprudhvi.dev') },
  });
  assert.deepEqual(findings, []);
});

test('formatFinding gives a plain line, and a GitHub annotation in Actions', () => {
  const finding = { file: 'projects/a/package.json', message: 'bad value. Fix it.' };
  assert.equal(formatFinding(finding, false), 'projects/a/package.json: bad value. Fix it.');
  assert.equal(
    formatFinding(finding, true),
    '::error file=projects/a/package.json::bad value. Fix it.',
  );
});
