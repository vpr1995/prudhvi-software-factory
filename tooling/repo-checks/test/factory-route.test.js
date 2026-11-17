// Tests for scripts/lib/factory-route.mjs and the routing table (design factory-daily-run 4.2).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildRoute,
  changedFiles,
  COMMAND_TIMEOUT_MS,
  parseRouteArguments,
  run,
} from '../scripts/factory.mjs';
import { matches, parseSize, route, tierOf } from '../scripts/lib/factory-route.mjs';
import { routing } from '../scripts/lib/factory-routing.mjs';
import { readRepositoryFile } from '../scripts/lib/fs-io.mjs';
import { CHECK_CONFIG_MESSAGE } from '../scripts/lib/test-guard-rules.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FACTORY = fileURLToPath(new URL('../scripts/factory.mjs', import.meta.url));

/** One changed file with `lines` added lines. */
const file = (path, lines = 1) => ({ path, oldPath: path, added: lines, deleted: 0 });

const routeFiles = (paths, extra = {}) =>
  route({ base: 'origin/main', changedFiles: paths.map((path) => file(path)), size: 2, ...extra });

const names = (list) => list.map((entry) => entry.name);

test('matches: a leading dot in a segment matches * and ** (design 4.2 examples)', () => {
  assert.equal(matches('packages/x/.npmignore', 'packages/**'), true);
  assert.equal(matches('.github/x.md', '**/*.md'), true);
  assert.equal(matches('.github/x.md', '.github/**'), true);
  assert.equal(matches('docs/x.ts', '**/*.md'), false);
});

test('doc-only diff gives only the spec pass', () => {
  const result = routeFiles(['docs/designs/x/design.md', 'README.md']);
  assert.equal(result.docOnly, true);
  assert.equal(result.tier, 'low');
  assert.deepEqual(result.passes, [{ name: 'spec-reviewer', model: 'opus', rule: 'always' }]);
  assert.deepEqual(names(result.skipped), [
    'fresh-reviewer',
    'simplify',
    'security-reviewer',
    'infra-reviewer',
  ]);
  assert.ok(result.skipped.every((entry) => entry.reason === 'doc-only diff'));
});

test('.github/x.md and .claude/x.md are not doc-only', () => {
  for (const path of ['.github/x.md', '.claude/x.md', 'projects/a/CLAUDE.md']) {
    const result = routeFiles([path]);
    assert.equal(result.docOnly, false, path);
    assert.ok(names(result.passes).includes('fresh-reviewer'), path);
  }
});

test('packages/x/.npmignore is high', () => {
  const result = routeFiles(['packages/x/.npmignore']);
  assert.equal(result.tier, 'high');
  const security = result.passes.find((pass) => pass.name === 'security-reviewer');
  assert.deepEqual(security, { name: 'security-reviewer', model: 'opus', rule: 'code-change' });
});

test('the old path of a rename counts for the tier', () => {
  const moved = { path: 'projects/a/src/x.ts', oldPath: 'packages/a/x.ts', added: 0, deleted: 0 };
  const result = route({ base: 'origin/main', changedFiles: [moved], size: 1 });
  assert.equal(result.tier, 'high');
});

test('a path in no tier: low for a test file, medium for code', () => {
  assert.equal(routeFiles(['projects/a/test/x.test.ts']).tier, 'low');
  assert.equal(routeFiles(['projects/a/src/x.ts']).tier, 'medium');
  assert.equal(routeFiles(['projects/a/src/x.ts', 'platform/infra/x.ts']).tier, 'high');
});

test('R-19: a reviewer with no usable rule runs', () => {
  const table = {
    ...routing,
    passes: { ...routing.passes, 'new-reviewer': { model: 'sonnet' } },
  };
  const result = route({
    base: 'origin/main',
    changedFiles: [file('projects/a/src/x.ts')],
    size: 1,
    table,
  });
  assert.deepEqual(
    result.passes.find((pass) => pass.name === 'new-reviewer'),
    { name: 'new-reviewer', model: 'sonnet', rule: 'no rule decides (R-19)' },
  );
});

test('the JSON has rule and skipped, and an infra glob is the rule', () => {
  const plain = routeFiles(['projects/a/src/x.ts']);
  assert.deepEqual(plain, {
    base: 'origin/main',
    tier: 'medium',
    docOnly: false,
    passes: [
      { name: 'spec-reviewer', model: 'opus', rule: 'always' },
      { name: 'fresh-reviewer', model: 'sonnet', rule: 'code-change' },
      { name: 'simplify', model: 'session', rule: 'code-change' },
      { name: 'security-reviewer', model: 'sonnet', rule: 'code-change' },
    ],
    skipped: [{ name: 'infra-reviewer', reason: 'no path matched' }],
    changedLines: 1,
    budget: 300,
    overBudget: false,
    warnings: [],
  });
  const infra = routeFiles(['projects/a/lib/stack.ts']);
  assert.deepEqual(
    infra.passes.find((pass) => pass.name === 'infra-reviewer'),
    { name: 'infra-reviewer', model: 'sonnet', rule: 'projects/*/lib/**' },
  );
  assert.deepEqual(infra.skipped, []);
});

test('a check-config finding gives risk:high and the high models', () => {
  const result = routeFiles(['projects/a/src/x.ts'], { checkConfig: true });
  assert.equal(result.tier, 'high');
  const security = result.passes.find((pass) => pass.name === 'security-reviewer');
  assert.equal(security.model, 'opus');
});

test('a missing size gives 800 and a warning; a size above 5 too', () => {
  const missing = routeFiles(['projects/a/src/x.ts'], { size: undefined });
  assert.equal(missing.budget, 800);
  assert.equal(missing.warnings.length, 1);
  assert.match(missing.warnings[0], /size missing/);
  const big = routeFiles(['projects/a/src/x.ts'], { size: 8 });
  assert.equal(big.budget, 800);
  assert.match(big.warnings[0], /size 8/);
  for (const [size, budget] of [
    [1, 150],
    [2, 300],
    [3, 500],
    [4, 800],
    [5, 800],
  ]) {
    const result = routeFiles(['projects/a/src/x.ts'], { size });
    assert.equal(result.budget, budget);
    assert.deepEqual(result.warnings, []);
  }
});

test('parseSize reads the Size line at a line start only', () => {
  const body = [
    '- [ ] R-34: the limit for the ticket size (`Size:` in the ticket Notes): 1: 150',
    '### Notes',
    'Size: 8 (layer shared 1, R-IDs +4, raw 8), kept whole',
  ].join('\n');
  assert.equal(parseSize(body), 8);
  assert.equal(parseSize('### Notes\nno size here'), undefined);
  assert.equal(parseSize('text `Size: 3` in a line'), undefined);
});

test('parseSize: the number stays on the Size line and ends the token', () => {
  assert.equal(parseSize('Size:\n3'), undefined);
  assert.equal(parseSize('Size: 3.5'), undefined);
  assert.equal(parseSize('Size: 3'), 3);
  assert.equal(parseSize('Size:\t3 (raw 8)'), 3);
});

test('an invalid Size line gives the missing-size budget and a warning', () => {
  for (const body of ['Size:\n3', 'Size: 3.5']) {
    const result = routeFiles(['projects/a/src/x.ts'], { size: parseSize(body) });
    assert.equal(result.budget, 800, body);
    assert.match(result.warnings[0], /size missing/, body);
  }
  assert.equal(routeFiles(['projects/a/src/x.ts'], { size: parseSize('Size: 3') }).budget, 500);
});

test('test files, the lockfile and generated files are not counted', () => {
  const result = route({
    base: 'origin/main',
    changedFiles: [
      { ...file('projects/a/src/x.ts', 100), deleted: 60 },
      file('projects/a/src/x.test.ts', 500),
      file('projects/a/bruno/get.bru', 500),
      file('common/config/rush/pnpm-lock.yaml', 900),
      file('projects/a/src/api.generated.ts', 900),
    ],
    size: 1,
  });
  assert.equal(result.changedLines, 160);
  assert.equal(result.budget, 150);
  assert.equal(result.overBudget, true);
});

test('an empty diff gives a warning', () => {
  const result = routeFiles([]);
  assert.deepEqual(result.warnings, ['no changed files']);
});

// R-22: the routing table and docs/standards/risk-tiers.md sections 2 and 2.1 agree.

// Rows of the tables with no path. "New dependency" shares a row with the lockfile path: the
// router sees a new dependency only through the lockfile, so the test checks that path.
const KNOWN_PROSE_ROWS = [
  'Authentication and authorization code',
  'Billing code',
  'New dependency, or a change to `common/config/rush/pnpm-lock.yaml`',
];
const PROSE_WITH_PATH = new Set([
  'New dependency, or a change to `common/config/rush/pnpm-lock.yaml`',
]);

// The first cell of each body row of each table between `start` and `end`.
function tableRows(text, start, end) {
  const section = text.slice(text.indexOf(start), text.indexOf(end));
  return section
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.startsWith('| Path or change'))
    .filter((line) => !/^\|\s*-/.test(line))
    .map((line) => line.split('|')[1].trim());
}

function documentTiers() {
  const text = readRepositoryFile(ROOT, 'docs/standards/risk-tiers.md');
  return {
    high: tableRows(text, '## 2. High-tier paths', '### 2.1'),
    medium: tableRows(text, '### 2.1', '## 3.'),
  };
}

const backticked = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
const sample = (glob) => glob.replaceAll('**', 'sample').replaceAll('*', 'sample');
// A dot-name sample under the folder of a folder glob. An exact file path has no folder sample.
const dotSample = (glob) =>
  glob.endsWith('/**') ? `${glob.slice(0, -'/**'.length).replaceAll('*', 'sample')}/.sample` : '';

/** Each doc path whose samples get another tier from `table`: [{ glob, path, want, got }]. */
function mismatches(tiers, table) {
  const samples = Object.entries(tiers).flatMap(([want, rows]) =>
    rows
      .flatMap((row) => backticked(row))
      .flatMap((glob) => [sample(glob), dotSample(glob)].map((path) => ({ glob, path, want }))),
  );
  return samples
    .filter((entry) => entry.path !== '')
    .map((entry) => ({ ...entry, got: tierOf(entry.path, table) }))
    .filter((entry) => entry.got !== entry.want);
}

test('R-22: each path of risk-tiers.md sections 2 and 2.1 has the same tier in the table', () => {
  const tiers = documentTiers();
  assert.ok(tiers.high.flatMap((row) => backticked(row)).length > 0, 'no path in section 2');
  assert.ok(tiers.medium.flatMap((row) => backticked(row)).length > 0, 'no path in section 2.1');
  assert.deepEqual(mismatches(tiers, routing), []);
});

// Prose lines of section 2.1 with paths: `x` stays high risk, or `x` are at least `risk:medium`.
function proseExpectations() {
  const text = readRepositoryFile(ROOT, 'docs/standards/risk-tiers.md');
  const section = text.slice(text.indexOf('### 2.1'), text.indexOf('## 3.'));
  return section
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('|') && !line.startsWith('#'))
    .map((line) => ({ line, globs: backticked(line).filter((glob) => !glob.startsWith('risk:')) }))
    .filter((entry) => entry.globs.length > 0)
    .map(({ line, globs }) => {
      if (line.includes('stays high risk')) return { globs, want: 'high' };
      if (line.includes('are at least `risk:medium`')) return { globs, want: 'medium' };
      throw new Error(`risk-tiers.md 2.1: prose line with paths has no known tier: ${line}`);
    });
}

// A sample path of a glob that ends in .md for a folder glob, so a lost glob shows as doc-only.
const proseSample = (glob) =>
  glob.endsWith('/**') ? `${sample(glob.slice(0, -'/**'.length))}/sample.md` : sample(glob);

/** Each prose path whose tier in the table is lower than the tier of the doc ("at least" for medium). */
function proseMismatches(table) {
  const rank = { low: 0, medium: 1, high: 2 };
  // A lost CLAUDE.md or REVIEW.md glob is not seen here: the path is not doc-only, so it is medium.
  return proseExpectations()
    .flatMap(({ globs, want }) => globs.map((glob) => ({ glob, want, path: proseSample(glob) })))
    .filter(({ path, want }) => rank[tierOf(path, table)] < rank[want])
    .map(({ glob }) => glob);
}

test('R-22: the prose paths of section 2.1 have their tier in the table', () => {
  const globs = proseExpectations().flatMap((entry) => entry.globs);
  assert.deepEqual(globs, [
    'projects/*/cdk.json',
    'CLAUDE.md',
    'REVIEW.md',
    'docs/guides/**',
    'docs/standards/**',
  ]);
  assert.deepEqual(proseMismatches(routing), []);
});

test('R-22: the prose compare finds a path that the table lost', () => {
  const without = (tier, lost) => ({
    ...routing,
    tiers: { ...routing.tiers, [tier]: routing.tiers[tier].filter((glob) => !lost.includes(glob)) },
  });
  assert.deepEqual(proseMismatches(without('high', ['projects/*/cdk.json'])), [
    'projects/*/cdk.json',
  ]);
  assert.deepEqual(proseMismatches(without('medium', ['docs/guides/**'])), ['docs/guides/**']);
  assert.deepEqual(proseMismatches(without('medium', ['docs/standards/**'])), [
    'docs/standards/**',
  ]);
});

test('R-22: the known prose rows are the rows of the doc with prose', () => {
  const rows = Object.values(documentTiers()).flat();
  const prose = rows.filter((row) => backticked(row).length === 0 || PROSE_WITH_PATH.has(row));
  assert.deepEqual(prose, KNOWN_PROSE_ROWS);
});

test('R-22: the compare finds a path that the table lost', () => {
  const table = {
    ...routing,
    tiers: { ...routing.tiers, high: routing.tiers.high.filter((glob) => glob !== 'packages/**') },
  };
  const lost = mismatches(documentTiers(), table).map((entry) => entry.path);
  // packages/cdk-constructs/** is also under packages/**, so its samples are lost too.
  assert.deepEqual(lost, [
    'packages/cdk-constructs/sample',
    'packages/cdk-constructs/.sample',
    'packages/sample',
    'packages/.sample',
  ]);
});

test('factory.mjs: an unknown command exits non-zero with a usage line', () => {
  const result = spawnSync(process.execPath, [FACTORY, 'bogus'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^Usage: node tooling\/repo-checks\/scripts\/factory\.mjs route <n>/m,
  );
});

test('factory.mjs: route with a bad ticket number exits non-zero', () => {
  const result = spawnSync(process.execPath, [FACTORY, 'route', 'abc'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test('parseRouteArguments: ticket, default base, --base value', () => {
  assert.deepEqual(parseRouteArguments(['98']), { ticket: '98', base: 'origin/main' });
  assert.deepEqual(parseRouteArguments(['98', '--base', 'abc123']), {
    ticket: '98',
    base: 'abc123',
  });
});

test('parseRouteArguments: bad input gives undefined', () => {
  const bad = [
    [],
    ['abc'],
    ['98', 'extra'],
    ['98', '--base'],
    ['98', '--base', ''],
    ['98', '--base', '-x'],
    ['98', '--base', '--output=x'],
    ['98', '--other', 'main'],
    ['98', '--base', 'main', 'extra'],
  ];
  for (const words of bad) assert.equal(parseRouteArguments(words), undefined, words.join(' '));
});

test('factory.mjs: a --base value that starts with - exits 2 with usage', () => {
  const result = spawnSync(process.execPath, [FACTORY, 'route', '98', '--base', '-x'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^Usage: /m);
});

test('factory.mjs: extra arguments exit 2 with usage', () => {
  const result = spawnSync(process.execPath, [FACTORY, 'route', '98', 'extra'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^Usage: /m);
});

test('buildRoute: a check-config finding gives tier high', () => {
  const input = { base: 'origin/main', files: [file('projects/a/src/x.ts')], body: 'Size: 2' };
  assert.equal(buildRoute({ ...input, findings: [] }).tier, 'medium');
  const other = [{ file: 'a', line: 1, message: 'test file deleted' }];
  assert.equal(buildRoute({ ...input, findings: other }).tier, 'medium');
  const config = [{ file: 'a', line: 1, message: CHECK_CONFIG_MESSAGE }];
  const result = buildRoute({ ...input, findings: config });
  assert.equal(result.tier, 'high');
  assert.equal(result.budget, 300);
});

test('changedFiles: counts lines of the patch, renames use the old path', () => {
  const entries = [
    { status: 'M', path: 'a.ts', oldPath: 'a.ts' },
    { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
    { status: 'A', path: 'none.ts', oldPath: 'none.ts' },
  ];
  const patch = new Map([
    ['a.ts', { added: [{}, {}], removed: [{}] }],
    ['old.ts', { added: [{}], removed: [] }],
  ]);
  assert.deepEqual(changedFiles({ entries, patch }), [
    { path: 'a.ts', oldPath: 'a.ts', added: 2, deleted: 1 },
    { path: 'new.ts', oldPath: 'old.ts', added: 1, deleted: 0 },
    { path: 'none.ts', oldPath: 'none.ts', added: 0, deleted: 0 },
  ]);
});

test('run: the command timeout is 30 seconds and stops a slow command', () => {
  assert.equal(COMMAND_TIMEOUT_MS, 30_000);
  assert.throws(
    () => run(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 100),
    (error) => error.code === 'ETIMEDOUT',
  );
});
