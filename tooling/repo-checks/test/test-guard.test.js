// End-to-end tests for scripts/test-guard.mjs: temp git repos with a base and a head commit.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { pathFromEnv } from './test-env.config.js';

const GUARD = fileURLToPath(new URL('../scripts/test-guard.mjs', import.meta.url));
const GIT_ENV = {
  PATH: pathFromEnv(),
  HOME: tmpdir(),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};
const GIT_IDENTITY = [
  '-c',
  'user.name=t',
  '-c',
  'user.email=t@t',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=/dev/null',
];
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const SPEC = (count) =>
  Array.from({ length: count }, (_, index) => `it('case ${index}', () => {});`).join('\n');

function git(root, args) {
  return execFileSync('git', [...GIT_IDENTITY, ...args], {
    cwd: root,
    env: GIT_ENV,
    encoding: 'utf8',
  });
}

function writeFiles(root, files) {
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(root, file);
    if (text === null) {
      rmSync(full);
    } else {
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
  }
}

/** Make a repo with a base commit and a head commit. `head` maps path to text, or null to delete. */
function repository(base, head) {
  const root = mkdtempSync(path.join(tmpdir(), 'test-guard-'));
  roots.push(root);
  git(root, ['init', '--quiet', '--initial-branch=main']);
  writeFiles(root, { 'README.txt': 'repo\n', ...base });
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  const sha = git(root, ['rev-parse', 'HEAD']).trim();
  writeFiles(root, head);
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '--allow-empty', '-m', 'head']);
  return { root, sha };
}

function guard({ root, sha }, env = {}) {
  const result = spawnSync('node', [GUARD], {
    cwd: root,
    env: { ...GIT_ENV, BASE_SHA: sha, ...env },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test('a clean diff passes', () => {
  const result = guard(
    repository({ 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n', 'test/b.test.ts': SPEC(1) }),
  );
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /test-guard: ok/);
});

test('a deleted test file fails', () => {
  const result = guard(repository({ 'test/a.test.ts': SPEC(2) }, { 'test/a.test.ts': null }));
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /test\/a\.test\.ts:1: test file deleted/);
});

test('a renamed test file passes', () => {
  const result = guard(
    repository(
      { 'test/a.test.ts': SPEC(3) },
      { 'test/a.test.ts': null, 'test/moved/a.test.ts': SPEC(3) },
    ),
  );
  assert.equal(result.status, 0, result.output);
});

test('fewer test cases fail and the message gives the number removed', () => {
  const result = guard(repository({ 'test/a.test.ts': SPEC(5) }, { 'test/a.test.ts': SPEC(3) }));
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /test\/a\.test\.ts:1: test cases went down from 5 to 3 \(2 removed\)/,
  );
});

test('an added .only fails', () => {
  const head = `${SPEC(1)}\nit.only('focus', () => {});\n`;
  const result = guard(
    repository({ 'test/a.test.ts': `${SPEC(1)}\n` }, { 'test/a.test.ts': head }),
  );
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /test\/a\.test\.ts:2: added a skipped, focused or todo test/);
});

test('an added eslint-disable comment fails in any file', () => {
  const head = 'const a = 1;\n// eslint-disable-next-line no-console\nconsole.log(a);\n';
  const result = guard(repository({ 'src/a.ts': 'const a = 1;\n' }, { 'src/a.ts': head }));
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /src\/a\.ts:2: added an eslint-disable comment/);
});

const CONFIG = 'tooling/vitest-config/src/config.ts';
const THRESHOLDS = (lines) => `export const COVERAGE_THRESHOLDS = {\n  lines: ${lines},\n};\n`;

test('a lowered coverage threshold fails', () => {
  const result = guard(repository({ [CONFIG]: THRESHOLDS(80) }, { [CONFIG]: THRESHOLDS(70) }));
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /config\.ts:2: threshold lines lowered from 80 to 70/);
});

test('a raised coverage threshold gives only the check config finding', () => {
  const result = guard(repository({ [CONFIG]: THRESHOLDS(80) }, { [CONFIG]: THRESHOLDS(90) }));
  assert.equal(result.status, 1, result.output);
  assert.doesNotMatch(result.output, /lowered/);
  assert.match(result.output, /config\.ts:1: check config changed; needs risk:high/);
  assert.match(result.output, /test-guard: 1 findings/);
});

test('a modified vitest.config fails', () => {
  const result = guard(
    repository(
      { 'projects/a/vitest.config.ts': 'export default {};\n' },
      { 'projects/a/vitest.config.ts': 'export default { a: 1 };\n' },
    ),
  );
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /projects\/a\/vitest\.config\.ts:1: check config changed/);
});

test('a modified ci.yml fails', () => {
  const workflow = '.github/workflows/ci.yml';
  const result = guard(
    repository({ [workflow]: 'steps:\n  - run: guard\n' }, { [workflow]: 'steps: []\n' }),
  );
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /\.github\/workflows\/ci\.yml:1: check config changed; needs risk:high/,
  );
});

test('an added vitest.config in a new folder passes', () => {
  const result = guard(repository({}, { 'projects/new/vitest.config.ts': 'export default {};\n' }));
  assert.equal(result.status, 0, result.output);
});

test('the risk:high label turns failures into warnings, exit 0, and writes the step summary', () => {
  const fixture = repository({ 'test/a.test.ts': SPEC(2) }, { 'test/a.test.ts': null });
  const summary = path.join(fixture.root, '..', `${path.basename(fixture.root)}-summary.md`);
  roots.push(summary);
  const result = guard(fixture, {
    PR_LABELS: '["risk:high"]',
    GITHUB_ACTIONS: 'true',
    GITHUB_STEP_SUMMARY: summary,
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /::warning file=test\/a\.test\.ts,line=1::test file deleted/);
  assert.match(readFileSync(summary, 'utf8'), /`test\/a\.test\.ts:1` test file deleted/);
});

test('without the label, GitHub Actions gets error annotations', () => {
  const fixture = repository({ 'test/a.test.ts': SPEC(2) }, { 'test/a.test.ts': null });
  const result = guard(fixture, { PR_LABELS: '["risk:low"]', GITHUB_ACTIONS: 'true' });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /::error file=test\/a\.test\.ts,line=1::test file deleted/);
});

test('invalid PR_LABELS, a missing base SHA and an unknown base SHA exit 2', () => {
  const fixture = repository({}, {});
  assert.equal(guard(fixture, { PR_LABELS: 'risk:high' }).status, 2);
  assert.equal(guard({ root: fixture.root, sha: '' }).status, 2);
  assert.equal(guard({ root: fixture.root, sha: 'deadbeef' }).status, 2);
});

test('the guard package and Markdown are exempt from rules 1 to 5, not from rule 6', () => {
  const head = {
    'docs/a.md': '<!-- eslint-disable -->\n',
    'tooling/repo-checks/test/x.test.js': "it.only('a', () => {});\n",
  };
  const result = guard(repository({}, head));
  assert.equal(result.status, 1, result.output);
  assert.doesNotMatch(result.output, /eslint-disable|focused/);
  assert.match(result.output, /tooling\/repo-checks\/test\/x\.test\.js:1: check config changed/);
});
