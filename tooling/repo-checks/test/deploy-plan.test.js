// Tests for scripts/deploy-plan.mjs: which changed projects deploy to which target.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { changedPaths, outputLines, pickBase, planDeploy } from '../scripts/deploy-plan.mjs';

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

// The scripts that a cloudflare project needs: the deploy command and the smoke test.
const SCRIPTS = { smoke: 'playwright test', 'deploy:cloudflare': 'wrangler deploy' };

const web = (host) => ({
  deploy: 'cloudflare',
  wrangler: wrangler(host),
  scripts: SCRIPTS,
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
      nosmoke: {
        deploy: 'cloudflare',
        scripts: { 'deploy:cloudflare': 'wrangler deploy' },
        wrangler: wrangler('a.vprprudhvi.dev'),
      },
      nodeploy: {
        deploy: 'cloudflare',
        scripts: { smoke: 'x' },
        wrangler: wrangler('d.vprprudhvi.dev'),
      },
      noassets: {
        deploy: 'cloudflare',
        scripts: SCRIPTS,
        wrangler: '{ "routes": [{ "pattern": "b.vprprudhvi.dev", "custom_domain": true }] }',
      },
      nodomain: {
        deploy: 'cloudflare',
        scripts: SCRIPTS,
        wrangler: '{ "assets": { "directory": "./out" } }',
      },
    },
    ['projects/nosmoke', 'projects/nodeploy', 'projects/noassets', 'projects/nodomain'],
  );
  assert.deepEqual(plan.cloudflare, []);
  assert.deepEqual(plan.findings, [
    'projects/nosmoke: the package.json has no "smoke" script. Add one that tests SMOKE_BASE_URL.',
    'projects/nodeploy: the package.json has no "deploy:cloudflare" script. Add "deploy:cloudflare": "wrangler deploy".',
    'projects/noassets: wrangler.jsonc has no assets.directory. Set it to the static export folder.',
    'projects/nodomain: wrangler.jsonc has no custom_domain route with a valid hostname.',
  ]);
});

test('an assets folder that leaves the project folder is a finding', () => {
  const plan = run(
    {
      site: {
        deploy: 'cloudflare',
        scripts: SCRIPTS,
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

test('an absolute assets folder and an assets folder that is the project folder are findings', () => {
  const plan = run(
    {
      absolute: {
        deploy: 'cloudflare',
        scripts: SCRIPTS,
        wrangler: wrangler('a.vprprudhvi.dev', '/abs/out'),
      },
      same: {
        deploy: 'cloudflare',
        scripts: SCRIPTS,
        wrangler: wrangler('b.vprprudhvi.dev', '.'),
      },
      empty: {
        deploy: 'cloudflare',
        scripts: SCRIPTS,
        wrangler: wrangler('c.vprprudhvi.dev', ''),
      },
    },
    ['projects/absolute', 'projects/same', 'projects/empty'],
  );
  assert.deepEqual(plan.cloudflare, []);
  assert.deepEqual(plan.findings, [
    'projects/absolute: assets.directory /abs/out is an absolute path. Use a folder inside the project.',
    'projects/same: assets.directory . is the project folder. Set it to the static export folder.',
    'projects/empty: assets.directory  is the project folder. Set it to the static export folder.',
  ]);
});

test('a project listed twice is planned once', () => {
  const plan = run({ site: web('site.vprprudhvi.dev') }, ['projects/site', 'projects/site']);
  assert.equal(plan.cloudflare.length, 1);
});

test('changedPaths skips the text before the first brace', () => {
  const text =
    'Rush banner\nNode.js version\n{"projects":[{"path":"projects/a"},{"path":"tooling/x"}]}';
  assert.deepEqual(changedPaths(text), ['projects/a', 'tooling/x']);
});

test('changedPaths throws when the input has no JSON', () => {
  assert.throws(() => changedPaths('no json here'), /no JSON object/);
});

test('pickBase takes the first usable candidate and skips empty, zero and unusable shas', () => {
  const usable = (sha) => sha !== 'gone';
  assert.equal(pickBase(['last', 'before', 'parent'], usable), 'last');
  assert.equal(pickBase(['', 'before', 'parent'], usable), 'before');
  assert.equal(
    pickBase(['gone', '0000000000000000000000000000000000000000', 'parent'], usable),
    'parent',
  );
  assert.equal(pickBase(['gone', ''], usable), '');
});

test('an assets folder in a sibling folder with the same name prefix is a finding', () => {
  const plan = run(
    {
      site: {
        deploy: 'cloudflare',
        scripts: SCRIPTS,
        wrangler: wrangler('site.vprprudhvi.dev', '../site-evil/out'),
      },
    },
    ['projects/site'],
  );
  assert.deepEqual(plan.cloudflare, []);
  assert.deepEqual(plan.findings, [
    'projects/site: assets.directory ../site-evil/out is outside the project folder.',
  ]);
});

const SCRIPT = fileURLToPath(new URL('../scripts/deploy-plan.mjs', import.meta.url));
const ZERO = '0'.repeat(40);

/** Run git in a folder with a fixed identity. Return the trimmed stdout. */
function git(folder, ...args) {
  const identity = [
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    '-c',
    'commit.gpgsign=false',
  ];
  return execFileSync('git', [...identity, ...args], { cwd: folder, encoding: 'utf8' }).trim();
}

/** Make a repo with `count` commits. Return the folder and the commit shas, oldest first. */
function repository(count) {
  const folder = mkdtempSync(path.join(tmpdir(), 'deploy-base-'));
  git(folder, 'init', '-q');
  const shas = [];
  for (let index = 0; index < count; index += 1) {
    git(folder, 'commit', '-q', '--allow-empty', '-m', `c${String(index)}`);
    shas.push(git(folder, 'rev-parse', 'HEAD'));
  }
  return { folder, shas };
}

/** Run `deploy-plan.mjs base` in a repo. */
function base(folder, ...args) {
  const result = spawnSync('node', [SCRIPT, 'base', ...args], { cwd: folder, encoding: 'utf8' });
  return { status: result.status, out: result.stdout.trim() };
}

test('base prints the last successful deploy when it is an ancestor of HEAD', () => {
  const { folder, shas } = repository(3);
  try {
    assert.deepEqual(base(folder, shas[0], shas[1]), { status: 0, out: shas[0] });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('base falls back to the before commit when the last success is not an ancestor', () => {
  const { folder, shas } = repository(3);
  try {
    const orphan = git(folder, 'commit-tree', '-m', 'orphan', `${shas[0]}^{tree}`);
    assert.deepEqual(base(folder, orphan, shas[1]), { status: 0, out: shas[1] });
    assert.deepEqual(base(folder, '', ZERO), { status: 0, out: shas[1] });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('base exits 1 when no commit is usable', () => {
  const { folder } = repository(1);
  try {
    const result = base(folder, '', ZERO);
    assert.equal(result.status, 1);
    assert.equal(result.out, '');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
