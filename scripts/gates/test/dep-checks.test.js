// Tests for the plan of the dependency checks (lib/dep-checks.mjs, dep-checks.mjs): license checks on
// lock and policy changes, the typosquat check when a package.json gained a dependency name, the
// audit of each lock that changed, and every check with GATES_FULL=1 or --audit-only.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  changedSinceBase,
  formatPlan,
  NODE_LICENSE_INPUTS,
  planDependencyChecks,
  planForRepository,
} from '../lib/dep-checks.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'dep-checks.mjs');
const BASE = '0123456789abcdef0123456789abcdef01234567';
const SHORT = BASE.slice(0, 12);
const AUDIT_LATER =
  'nightly in CI, not set up yet; run bash scripts/gates/local-gates.sh --audit-only or GATES_FULL=1';
const PY_LOCK = 'projects/sample/src/api-py/uv.lock';
const GO_SUM = 'projects/sample/src/api-go/go.sum';

/**
 * Plans with the sample project (api-py and api-go) and no flags, unless overridden.
 *
 * @param {Partial<import('../lib/dep-checks.mjs').PlanInput>} input - Fields to change.
 * @returns {string[]} One `action label (reason)` text for each entry.
 */
function plan(input) {
  return planDependencyChecks({
    changed: [],
    pyProjects: ['sample'],
    goProjects: ['sample'],
    full: false,
    auditOnly: false,
    base: BASE,
    ...input,
  }).map((entry) => `${entry.action} ${entry.label} (${entry.reason})`);
}

describe('dependency check plan', () => {
  it('skips every license check and every audit when nothing changed', () => {
    assert.deepEqual(plan({}), [
      `skip license-check (no lock or policy change since ${SHORT})`,
      `skip license-check api-py (projects/sample) (uv.lock changes run in _phase:lint of rush verify; no policy change since ${SHORT})`,
      `skip license-check api-go (projects/sample) (go.mod and go.sum changes run in _phase:lint of rush verify; no policy change since ${SHORT})`,
      `skip rush audit (no pnpm-lock.yaml change since ${SHORT}; ${AUDIT_LATER})`,
      `skip pip-audit (projects/sample, security.sh) (no uv.lock change since ${SHORT}; ${AUDIT_LATER})`,
      `skip govulncheck (projects/sample, security.sh) (no go.sum change since ${SHORT}; ${AUDIT_LATER})`,
    ]);
  });

  it('runs the Node license check and rush audit when pnpm-lock.yaml changed', () => {
    const entries = plan({ changed: ['common/config/rush/pnpm-lock.yaml', 'README.md'] });
    assert.equal(entries[0], 'run license-check (pnpm-lock.yaml changed)');
    assert.match(entries[1] ?? '', /^skip license-check api-py/);
    assert.match(entries[2] ?? '', /^skip license-check api-go/);
    assert.equal(entries[3], 'run rush audit (pnpm-lock.yaml changed)');
    assert.match(
      entries[4] ?? '',
      /^skip pip-audit \(projects\/sample, security\.sh\) \(no uv\.lock/,
    );
    assert.match(
      entries[5] ?? '',
      /^skip govulncheck \(projects\/sample, security\.sh\) \(no go\.sum/,
    );
  });

  it('runs the Node license check when its script changed, and no audit', () => {
    const entries = plan({ changed: ['scripts/security/license-check.sh'] });
    assert.equal(entries[0], 'run license-check (license-check.sh changed)');
    assert.ok(
      entries.slice(3).every((entry) => entry.startsWith('skip ')),
      entries.join('\n'),
    );
  });

  it('runs every license check when the license policy changed, and no audit', () => {
    const entries = plan({ changed: ['tooling/license-allowlist.json'] });
    assert.deepEqual(entries.slice(0, 3), [
      'run license-check (license-allowlist.json changed)',
      'run license-check api-py (projects/sample) (license-allowlist.json changed)',
      'run license-check api-go (projects/sample) (license-allowlist.json changed)',
    ]);
    assert.ok(
      entries.slice(3).every((entry) => entry.startsWith('skip ')),
      entries.join('\n'),
    );
  });

  it('names two changed inputs, and counts the rest', () => {
    assert.equal(
      plan({ changed: [...NODE_LICENSE_INPUTS] })[0],
      'run license-check (pnpm-lock.yaml, license-allowlist.json and 1 more changed)',
    );
    assert.equal(
      plan({ changed: [NODE_LICENSE_INPUTS[0] ?? '', NODE_LICENSE_INPUTS[1] ?? ''] })[0],
      'run license-check (pnpm-lock.yaml and license-allowlist.json changed)',
    );
  });

  it('leaves uv.lock, go.mod and go.sum license checks to _phase:lint (no second run)', () => {
    const entries = plan({
      changed: [PY_LOCK, 'projects/sample/src/api-go/go.mod', GO_SUM],
    });
    assert.ok(
      entries.slice(0, 3).every((entry) => entry.startsWith('skip ')),
      entries.join('\n'),
    );
  });

  it('runs pip-audit when the uv.lock of the project changed', () => {
    assert.deepEqual(plan({ changed: [PY_LOCK] }).slice(3), [
      `skip rush audit (no pnpm-lock.yaml change since ${SHORT}; ${AUDIT_LATER})`,
      'run pip-audit (projects/sample, security.sh) (uv.lock changed)',
      `skip govulncheck (projects/sample, security.sh) (no go.sum change since ${SHORT}; ${AUDIT_LATER})`,
    ]);
  });

  it('runs govulncheck when the go.sum of the module changed, and not for go.mod alone', () => {
    assert.equal(
      plan({ changed: [GO_SUM] }).at(-1),
      'run govulncheck (projects/sample, security.sh) (go.sum changed)',
    );
    assert.match(
      plan({ changed: ['projects/sample/src/api-go/go.mod'] }).at(-1) ?? '',
      /^skip govulncheck/,
    );
  });

  it('runs the audit of each changed lock, and nothing for a lock in another folder', () => {
    const entries = plan({
      changed: ['common/config/rush/pnpm-lock.yaml', PY_LOCK, GO_SUM],
    });
    assert.deepEqual(entries.slice(3), [
      'run rush audit (pnpm-lock.yaml changed)',
      'run pip-audit (projects/sample, security.sh) (uv.lock changed)',
      'run govulncheck (projects/sample, security.sh) (go.sum changed)',
    ]);
    const elsewhere = plan({
      changed: ['projects/sample/uv.lock', 'projects/other/src/api-go/go.sum', 'pnpm-lock.yaml'],
    });
    assert.ok(
      elsewhere.slice(3).every((entry) => entry.startsWith('skip ')),
      elsewhere.join('\n'),
    );
  });

  it('GATES_FULL runs every license check, the typosquat check and every audit', () => {
    assert.deepEqual(plan({ full: true }), [
      'run license-check (GATES_FULL=1)',
      'run license-check api-py (projects/sample) (GATES_FULL=1)',
      'run license-check api-go (projects/sample) (GATES_FULL=1)',
      'run typosquat check (GATES_FULL=1)',
      'run rush audit (GATES_FULL=1)',
      'run pip-audit (projects/sample, security.sh) (GATES_FULL=1)',
      'run govulncheck (projects/sample, security.sh) (GATES_FULL=1)',
    ]);
  });

  it('--audit-only runs the three audits and no license check', () => {
    assert.deepEqual(plan({ auditOnly: true }), [
      'run rush audit (audit only)',
      'run pip-audit (projects/sample, security.sh) (audit only)',
      'run govulncheck (projects/sample, security.sh) (audit only)',
    ]);
  });

  it('plans one entry for each project, and none for a missing part', () => {
    const entries = plan({ full: true, pyProjects: ['a', 'b'], goProjects: [] });
    assert.deepEqual(
      entries.filter((entry) => entry.includes('api-py') || entry.includes('pip-audit')),
      [
        'run license-check api-py (projects/a) (GATES_FULL=1)',
        'run license-check api-py (projects/b) (GATES_FULL=1)',
        'run pip-audit (projects/a, security.sh) (GATES_FULL=1)',
        'run pip-audit (projects/b, security.sh) (GATES_FULL=1)',
      ],
    );
    assert.ok(!entries.some((entry) => entry.includes('api-go') || entry.includes('govulncheck')));
  });

  it('runs pip-audit only for the project whose uv.lock changed', () => {
    const entries = plan({
      pyProjects: ['a', 'b'],
      goProjects: [],
      changed: ['projects/b/src/api-py/uv.lock'],
    });
    assert.deepEqual(
      entries.filter((entry) => entry.includes('pip-audit')),
      [
        `skip pip-audit (projects/a, security.sh) (no uv.lock change since ${SHORT}; ${AUDIT_LATER})`,
        'run pip-audit (projects/b, security.sh) (uv.lock changed)',
      ],
    );
  });

  it('gives the commands of the checks', () => {
    const entries = planDependencyChecks({
      changed: [],
      pyProjects: ['sample'],
      goProjects: ['sample'],
      full: true,
      auditOnly: false,
      base: BASE,
    });
    assert.deepEqual(
      entries.map((entry) => entry.command.join(' ')),
      [
        'node common/scripts/install-run-rush.js license-check',
        'bash projects/sample/src/api-py/scripts/license-check.sh',
        'bash projects/sample/src/api-go/scripts/license-check.sh',
        `node scripts/gates/typosquat-check.mjs --base ${BASE}`,
        'node common/scripts/install-run-rush.js audit',
        'bash projects/sample/src/api-py/scripts/security.sh',
        'bash projects/sample/src/api-go/scripts/security.sh',
      ],
    );
  });

  it('gives the audit commands for a lock change, and no command for a skip', () => {
    const entries = planDependencyChecks({
      changed: [PY_LOCK],
      pyProjects: ['sample'],
      goProjects: ['sample'],
      full: false,
      auditOnly: false,
      base: BASE,
    });
    assert.deepEqual(
      entries.slice(3).map((entry) => entry.command.join(' ')),
      ['', 'bash projects/sample/src/api-py/scripts/security.sh', ''],
    );
  });

  it('formats the plan as tab-separated lines', () => {
    assert.equal(
      formatPlan([
        { action: 'run', label: 'rush audit', reason: 'audit only', command: ['node', 'x.js'] },
        { action: 'skip', label: 'audits', reason: 'nightly', command: [] },
      ]),
      'run\trush audit\taudit only\tnode\tx.js\nskip\taudits\tnightly\n',
    );
  });
});

describe('typosquat check in the plan', () => {
  it('has no entry and no skip line when no package.json gained a dependency name', () => {
    assert.ok(!plan({}).some((entry) => entry.includes('typosquat')));
    assert.ok(!plan({ dependenciesAdded: false }).some((entry) => entry.includes('typosquat')));
    const entries = plan({ changed: ['projects/sample/package.json'] });
    assert.ok(!entries.join('\n').includes('typosquat'));
  });

  it('runs after the license checks and before the audits when a name was added', () => {
    const entries = plan({ dependenciesAdded: true });
    assert.equal(entries.length, 7);
    assert.equal(entries[3], 'run typosquat check (new dependency names)');
    assert.match(entries[2] ?? '', /^skip license-check api-go/);
    assert.match(entries[4] ?? '', /^skip rush audit/);
  });

  it('runs with GATES_FULL=1 even when no name was added', () => {
    assert.ok(plan({ full: true }).includes('run typosquat check (GATES_FULL=1)'));
    assert.ok(
      plan({ full: true, dependenciesAdded: false }).includes('run typosquat check (GATES_FULL=1)'),
    );
  });

  it('does not run with --audit-only, with or without a new name', () => {
    assert.ok(!plan({ auditOnly: true, dependenciesAdded: true }).join('\n').includes('typosquat'));
    assert.ok(!plan({ auditOnly: true, full: true }).join('\n').includes('typosquat'));
  });

  it('gives the command with the base commit', () => {
    const entry = planDependencyChecks({
      changed: [],
      pyProjects: [],
      goProjects: [],
      full: false,
      auditOnly: false,
      base: BASE,
      dependenciesAdded: true,
    }).find((item) => item.label === 'typosquat check');
    assert.deepEqual(entry?.command, ['node', 'scripts/gates/typosquat-check.mjs', '--base', BASE]);
  });
});

describe('dependency check plan in a repo', () => {
  /** @type {ReturnType<typeof makeRepository>} */
  let repository;
  /** @type {string} */
  let base;

  beforeEach(() => {
    repository = makeRepository({
      'projects/p/package.json': '{"name":"p"}\n',
      'projects/p/src/api-py/uv.lock': 'version = 1\n',
      'projects/p/src/api-go/go.mod': 'module p\n',
      'projects/q/package.json': '{"name":"q","dependencies":{"zod":"^4.0.0"}}\n',
    });
    base = repository.git('rev-parse', 'HEAD').trim();
  });

  afterEach(() => {
    repository.remove();
  });

  /**
   * Lists the labels of the entries that run.
   *
   * @returns {string[]} The labels, in plan order.
   */
  function runLabels() {
    return planForRepository(repository.root, { base, full: false, auditOnly: false })
      .filter((entry) => entry.action === 'run')
      .map((entry) => entry.label);
  }

  it('sees committed, unstaged and untracked changes since the base', () => {
    repository.write('common/config/rush/pnpm-lock.yaml', 'lockfileVersion: 9\n');
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', 'lock');
    repository.write('projects/p/src/api-py/uv.lock', 'version = 2\n');
    repository.write('tooling/license-allowlist.json', '{}\n');
    assert.deepEqual(changedSinceBase(repository.root, base).sort(), [
      'common/config/rush/pnpm-lock.yaml',
      'projects/p/src/api-py/uv.lock',
      'tooling/license-allowlist.json',
    ]);
  });

  it('fails on a base that is not a commit', () => {
    assert.throws(() => changedSinceBase(repository.root, '--cached'), /Bad revision/);
    assert.throws(() => changedSinceBase(repository.root, 'no-such-ref'), /Bad revision/);
  });

  it('detects the api-py and api-go parts by folder', () => {
    const entries = planForRepository(repository.root, { base, full: true, auditOnly: true });
    assert.deepEqual(
      entries.map((entry) => entry.label),
      [
        'rush audit',
        'pip-audit (projects/p, security.sh)',
        'govulncheck (projects/p, security.sh)',
      ],
    );
  });

  it('plans the audit of a committed lock change', () => {
    repository.write('common/config/rush/pnpm-lock.yaml', 'lockfileVersion: 9\n');
    repository.write('projects/p/src/api-go/go.sum', 'example.com/m v1.0.0 h1:x=\n');
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', 'locks');
    assert.deepEqual(runLabels(), [
      'license-check',
      'rush audit',
      'govulncheck (projects/p, security.sh)',
    ]);
  });

  it('plans the typosquat check when a package.json gained a dependency name', () => {
    repository.write(
      'projects/p/package.json',
      '{"name":"p","dependencies":{"left-pad":"1.0.0"}}\n',
    );
    assert.deepEqual(runLabels(), ['typosquat check']);
  });

  it('plans the typosquat check for a committed change and for a new package.json', () => {
    repository.write(
      'projects/p/package.json',
      '{"name":"p","devDependencies":{"left-pad":"1"}}\n',
    );
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', 'dep');
    assert.deepEqual(runLabels(), ['typosquat check']);
    repository.write('packages/n/package.json', '{"name":"n","peerDependencies":{"react":"19"}}\n');
    assert.deepEqual(runLabels(), ['typosquat check']);
  });

  it('does not plan the typosquat check for a version change, a removal or a moved name', () => {
    repository.write('projects/q/package.json', '{"name":"q","dependencies":{"zod":"^4.1.0"}}\n');
    assert.deepEqual(runLabels(), []);
    repository.write('projects/q/package.json', '{"name":"q"}\n');
    assert.deepEqual(runLabels(), []);
    repository.write(
      'projects/q/package.json',
      '{"name":"q","devDependencies":{"zod":"^4.0.0"}}\n',
    );
    assert.deepEqual(runLabels(), []);
  });

  it('does not plan the typosquat check for other fields, other files or a workspace link', () => {
    repository.write(
      'projects/p/package.json',
      '{"name":"p","version":"2.0.0","scripts":{"a":"b"}}\n',
    );
    repository.write('projects/p/notes.txt', 'left-pad\n');
    repository.write('docs/package.json', '{"dependencies":{"left-pad":"1"}}\n');
    repository.write(
      'projects/p/node_modules/x/package.json',
      '{"dependencies":{"left-pad":"1"}}\n',
    );
    repository.write('projects/p/web/.next/package.json', '{"dependencies":{"left-pad":"1"}}\n');
    repository.write(
      'projects/q/package.json',
      '{"name":"q","dependencies":{"zod":"^4.0.0","@x/shared":"workspace:*"}}\n',
    );
    assert.deepEqual(runLabels(), []);
  });

  it('plans the typosquat check when an old dependency changes to a git, URL or tarball version', () => {
    for (const spec of ['github:o/zod', 'https://example.com/zod.tgz', 'npm:evil@1.0.0']) {
      repository.write(
        'projects/q/package.json',
        JSON.stringify({ name: 'q', dependencies: { zod: spec } }),
      );
      assert.deepEqual(runLabels(), ['typosquat check'], spec);
    }
  });

  it('plans the typosquat check for a registry version of the own scope, and not for workspace:', () => {
    repository.write(
      'projects/q/package.json',
      JSON.stringify({
        name: 'q',
        dependencies: { zod: '^4.0.0', '@vprprudhvi/shared-logger': 'workspace:*' },
      }),
    );
    assert.deepEqual(runLabels(), []);
    repository.write(
      'projects/q/package.json',
      JSON.stringify({
        name: 'q',
        dependencies: { zod: '^4.0.0', '@vprprudhvi/shared-logger': '^1.0.0' },
      }),
    );
    assert.deepEqual(runLabels(), ['typosquat check']);
  });

  it('fails the plan when a project folder of rush.json is outside the four roots', () => {
    repository.write(
      'rush.json',
      JSON.stringify({ projects: [{ packageName: '@t/a', projectFolder: 'common/x' }] }),
    );
    assert.throws(
      () => planForRepository(repository.root, { base, full: false, auditOnly: false }),
      /project folder "common\/x"/,
    );
  });

  it('fails the plan when a changed package.json is not JSON', () => {
    repository.write('projects/p/package.json', '{"name":');
    assert.throws(
      () => planForRepository(repository.root, { base, full: false, auditOnly: false }),
      /projects\/p\/package\.json is not valid JSON/,
    );
  });

  it('CLI prints the plan, and reads GATES_FULL', () => {
    repository.write('tooling/license-allowlist.json', '{}\n');
    const result = exec('node', [CLI, '--root', repository.root, '--base', base], {
      env: { GATES_FULL: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split('\n');
    assert.deepEqual(lines[0]?.split('\t'), [
      'run',
      'license-check',
      'license-allowlist.json changed',
      'node',
      'common/scripts/install-run-rush.js',
      'license-check',
    ]);
    assert.equal(
      lines.at(-1),
      `skip\tgovulncheck (projects/p, security.sh)\tno go.sum change since ${base.slice(0, 12)}; ${AUDIT_LATER}`,
    );
    assert.doesNotMatch(result.stdout, /typosquat/);
    const full = exec('node', [CLI, '--root', repository.root, '--base', base], {
      env: { GATES_FULL: '1' },
    });
    assert.match(full.stdout, /^run\trush audit\tGATES_FULL=1\t/m);
    assert.ok(
      full.stdout
        .split('\n')
        .includes(
          `run\ttyposquat check\tGATES_FULL=1\tnode\tscripts/gates/typosquat-check.mjs\t--base\t${base}`,
        ),
      full.stdout,
    );
  });

  it('CLI plans the typosquat check for a new dependency name', () => {
    repository.write('projects/p/package.json', '{"name":"p","dependencies":{"left-pad":"1"}}\n');
    const result = exec('node', [CLI, '--root', repository.root, '--base', base], {
      env: { GATES_FULL: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      result.stdout
        .split('\n')
        .includes(
          `run\ttyposquat check\tnew dependency names\tnode\tscripts/gates/typosquat-check.mjs\t--base\t${base}`,
        ),
      result.stdout,
    );
  });

  it('CLI exits 2 for a rush.json project folder outside the four roots', () => {
    repository.write(
      'rush.json',
      JSON.stringify({ projects: [{ packageName: '@t/a', projectFolder: '../x' }] }),
    );
    const result = exec('node', [CLI, '--root', repository.root, '--base', base], {
      env: { GATES_FULL: '' },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /dep-checks: could not plan: rush\.json has the project folder/);
  });

  it('CLI exits 2 when a changed package.json is not JSON', () => {
    repository.write('projects/p/package.json', 'not json');
    const result = exec('node', [CLI, '--root', repository.root, '--base', base], {
      env: { GATES_FULL: '' },
    });
    assert.equal(result.status, 2);
    assert.match(
      result.stderr,
      /dep-checks: could not plan: projects\/p\/package\.json is not valid JSON/,
    );
  });

  it('CLI runs rush audit for an uncommitted pnpm-lock.yaml change', () => {
    repository.write('common/config/rush/pnpm-lock.yaml', 'lockfileVersion: 9\n');
    const result = exec('node', [CLI, '--root', repository.root, '--base', base], {
      env: { GATES_FULL: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /^run\trush audit\tpnpm-lock\.yaml changed\tnode\tcommon\/scripts\/install-run-rush\.js\taudit$/m,
    );
  });

  it('CLI needs --base without --audit-only, and exits 2 on a bad base', () => {
    // GATES_FULL is cleared: the test can run inside a GATES_FULL=1 gate run.
    const env = { GATES_FULL: '' };
    assert.equal(exec('node', [CLI, '--root', repository.root], { env }).status, 2);
    const bad = exec('node', [CLI, '--root', repository.root, '--base', 'nope'], { env });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /dep-checks: could not plan: Bad revision "nope"/);
    assert.equal(bad.stdout, '');
    const auditOnly = exec('node', [CLI, '--root', repository.root, '--audit-only'], { env });
    assert.equal(auditOnly.status, 0, auditOnly.stderr);
    assert.match(auditOnly.stdout, /^run\trush audit\taudit only\t/);
  });
});
