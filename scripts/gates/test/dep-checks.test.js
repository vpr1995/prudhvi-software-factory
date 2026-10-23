// Tests for the plan of the dependency checks (lib/dep-checks.mjs, dep-checks.mjs): license checks on
// lock and policy changes, audits only with GATES_FULL=1 or --audit-only.
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
const AUDIT_SKIP =
  'nightly in CI, not set up yet; run bash scripts/gates/local-gates.sh --audit-only or GATES_FULL=1';

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
  it('skips every license check and the audits when nothing changed', () => {
    assert.deepEqual(plan({}), [
      `skip license-check (no lock or policy change since ${SHORT})`,
      `skip license-check api-py (projects/sample) (uv.lock changes run in _phase:lint of rush verify; no policy change since ${SHORT})`,
      `skip license-check api-go (projects/sample) (go.mod and go.sum changes run in _phase:lint of rush verify; no policy change since ${SHORT})`,
      `skip audits (${AUDIT_SKIP})`,
    ]);
  });

  it('runs the Node license check when pnpm-lock.yaml changed, and no audit', () => {
    const entries = plan({ changed: ['common/config/rush/pnpm-lock.yaml', 'README.md'] });
    assert.equal(entries[0], 'run license-check (pnpm-lock.yaml changed)');
    assert.match(entries[1] ?? '', /^skip license-check api-py/);
    assert.match(entries[2] ?? '', /^skip license-check api-go/);
    assert.equal(entries[3], `skip audits (${AUDIT_SKIP})`);
  });

  it('runs the Node license check when its script changed', () => {
    assert.equal(
      plan({ changed: ['scripts/security/license-check.sh'] })[0],
      'run license-check (license-check.sh changed)',
    );
  });

  it('runs every license check when the license policy changed', () => {
    assert.deepEqual(plan({ changed: ['tooling/license-allowlist.json'] }).slice(0, 3), [
      'run license-check (license-allowlist.json changed)',
      'run license-check api-py (projects/sample) (license-allowlist.json changed)',
      'run license-check api-go (projects/sample) (license-allowlist.json changed)',
    ]);
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

  it('leaves uv.lock, go.mod and go.sum changes to _phase:lint (no second run)', () => {
    const entries = plan({
      changed: [
        'projects/sample/src/api-py/uv.lock',
        'projects/sample/src/api-go/go.mod',
        'projects/sample/src/api-go/go.sum',
      ],
    });
    assert.ok(
      entries.slice(0, 3).every((entry) => entry.startsWith('skip ')),
      entries.join('\n'),
    );
  });

  it('a lock change never runs an audit', () => {
    const entries = plan({
      changed: ['common/config/rush/pnpm-lock.yaml', 'projects/sample/src/api-py/uv.lock'],
    });
    assert.equal(entries.at(-1), `skip audits (${AUDIT_SKIP})`);
    assert.ok(!entries.some((entry) => /audit \(|pip-audit|govulncheck/.test(entry)));
  });

  it('GATES_FULL runs every license check and every audit', () => {
    assert.deepEqual(plan({ full: true }), [
      'run license-check (GATES_FULL=1)',
      'run license-check api-py (projects/sample) (GATES_FULL=1)',
      'run license-check api-go (projects/sample) (GATES_FULL=1)',
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
        'node common/scripts/install-run-rush.js audit',
        'bash projects/sample/src/api-py/scripts/security.sh',
        'bash projects/sample/src/api-go/scripts/security.sh',
      ],
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
      'projects/q/package.json': '{"name":"q"}\n',
    });
    base = repository.git('rev-parse', 'HEAD').trim();
  });

  afterEach(() => {
    repository.remove();
  });

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
    assert.equal(lines.at(-1), `skip\taudits\t${AUDIT_SKIP}`);
    const full = exec('node', [CLI, '--root', repository.root, '--base', base], {
      env: { GATES_FULL: '1' },
    });
    assert.match(full.stdout, /^run\trush audit\tGATES_FULL=1\t/m);
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
