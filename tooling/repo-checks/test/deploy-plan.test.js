// Tests for scripts/deploy-plan.mjs: which changed projects deploy to which target.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { outputLines, planDeploy } from '../scripts/deploy-plan.mjs';

const wrangler = (host, directory = './web/out') =>
  `{
  // Worker config.
  "name": "x",
  "assets": { "directory": ${JSON.stringify(directory)} },
  "routes": [{ "pattern": "${host}", "custom_domain": true }],
}`;

/** Build a temp repo. `projects` maps a folder name to { deploy, wrangler, scripts }. */
function fixture(projects) {
  const root = mkdtempSync(path.join(tmpdir(), 'deploy-plan-'));
  for (const [folderName, { deploy, wrangler: config, scripts }] of Object.entries(projects)) {
    const folder = path.join(root, 'projects', folderName);
    mkdirSync(folder, { recursive: true });
    const manifest = {
      name: `@scope/${folderName}`,
      ...(deploy === undefined ? {} : { factory: { deploy } }),
      ...(scripts === undefined ? {} : { scripts }),
    };
    writeFileSync(path.join(folder, 'package.json'), JSON.stringify(manifest));
    if (config !== undefined) writeFileSync(path.join(folder, 'wrangler.jsonc'), config);
  }
  return root;
}

/** Plan on a fixture and remove it. */
function run(projects, changed) {
  const root = fixture(projects);
  try {
    return planDeploy(root, changed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const web = (host) => ({
  deploy: 'cloudflare',
  wrangler: wrangler(host),
  scripts: { smoke: 'playwright test' },
});

test('a changed cloudflare project is planned with its host and assets folder', () => {
  const plan = run({ site: web('site.vprprudhvi.dev') }, ['projects/site']);
  assert.deepEqual(plan.findings, []);
  assert.deepEqual(plan.aws, []);
  assert.deepEqual(plan.cloudflare, [
    {
      name: '@scope/site',
      path: 'projects/site',
      host: 'site.vprprudhvi.dev',
      assetsDirectory: 'projects/site/web/out',
    },
  ]);
});

test('aws, an array and none map to the right jobs', () => {
  const plan = run(
    {
      api: { deploy: 'aws' },
      both: { ...web('both.vprprudhvi.dev'), deploy: ['cloudflare', 'aws'] },
      lib: { deploy: 'none' },
    },
    ['projects/api', 'projects/both', 'projects/lib'],
  );
  assert.deepEqual(plan.findings, []);
  assert.deepEqual(
    plan.cloudflare.map((entry) => entry.path),
    ['projects/both'],
  );
  assert.deepEqual(
    plan.aws.map((entry) => entry.path),
    ['projects/api', 'projects/both'],
  );
});

test('a project that did not change is not planned, and neither is a path outside projects', () => {
  const plan = run({ site: web('site.vprprudhvi.dev'), other: web('other.vprprudhvi.dev') }, [
    'projects/site',
    'packages/shared-logger',
    'tooling/repo-checks',
  ]);
  assert.deepEqual(
    plan.cloudflare.map((entry) => entry.path),
    ['projects/site'],
  );
  assert.deepEqual(plan.findings, []);
});

test('a cloudflare project with no smoke script, no assets folder or no custom domain is a finding', () => {
  const plan = run(
    {
      nosmoke: { deploy: 'cloudflare', wrangler: wrangler('a.vprprudhvi.dev') },
      noassets: {
        deploy: 'cloudflare',
        scripts: { smoke: 'x' },
        wrangler: '{ "routes": [{ "pattern": "b.vprprudhvi.dev", "custom_domain": true }] }',
      },
      nodomain: {
        deploy: 'cloudflare',
        scripts: { smoke: 'x' },
        wrangler: '{ "assets": { "directory": "./out" } }',
      },
    },
    ['projects/nosmoke', 'projects/noassets', 'projects/nodomain'],
  );
  assert.deepEqual(plan.cloudflare, []);
  assert.deepEqual(plan.findings, [
    'projects/nosmoke: the package.json has no "smoke" script. Add one that tests SMOKE_BASE_URL.',
    'projects/noassets: wrangler.jsonc has no assets.directory. Set it to the static export folder.',
    'projects/nodomain: wrangler.jsonc has no custom_domain route with a valid hostname.',
  ]);
});

test('an assets folder that leaves the project folder is a finding', () => {
  const plan = run(
    {
      site: {
        deploy: 'cloudflare',
        scripts: { smoke: 'x' },
        wrangler: wrangler('site.vprprudhvi.dev', '../../etc'),
      },
    },
    ['projects/site'],
  );
  assert.deepEqual(plan.cloudflare, []);
  assert.deepEqual(plan.findings, [
    'projects/site: assets.directory ../../etc is outside the project folder.',
  ]);
});

test('outputLines gives a matrix and a count for each job', () => {
  const plan = run({ site: web('site.vprprudhvi.dev'), api: { deploy: 'aws' } }, [
    'projects/site',
    'projects/api',
  ]);
  const lines = outputLines(plan);
  assert.equal(lines.length, 4);
  assert.equal(lines[1], 'cloudflare-count=1');
  assert.equal(lines[3], 'aws-count=1');
  assert.deepEqual(JSON.parse(lines[0].replace('cloudflare=', '')), plan.cloudflare);
  assert.deepEqual(JSON.parse(lines[2].replace('aws=', '')), plan.aws);
});
