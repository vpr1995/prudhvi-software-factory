// Tests for classify-risk.mjs and lib/risk-rules.mjs. The rules run as pure functions, and the CLI
// runs against temp git repos.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { dependencyFieldChanges, classifyPaths, higherTier } from '../lib/risk-rules.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'classify-risk.mjs');

const packageText = (fields) =>
  `${JSON.stringify({ name: '@t/a', version: '1.0.0', ...fields }, null, 2)}\n`;
const WITH_DEPENDENCY = packageText({ dependencies: { zod: '4.0.0' }, scripts: { build: 'tsc' } });

/**
 * Builds the `diff` option from two texts of one file.
 *
 * @param {string | null} before - The old text.
 * @param {string | null} after - The new text.
 * @returns {{ readBase: () => string | null, readHead: () => string | null }} The diff access.
 */
const sides = (before, after) => ({ readBase: () => before, readHead: () => after });

const tierOf = (file, diff) => classifyPaths([file], { diff }).files[0];

describe('risk rules', () => {
  it('gives low for an empty change', () => {
    assert.deepEqual(classifyPaths([]), { tier: 'low', files: [] });
  });

  describe('high', () => {
    const gateFiles = [
      'tooling/eslint-config/index.js',
      'rush.json',
      'scripts/gates/check-gates.mjs',
      '.claude/hooks/guard-bash.sh',
      '.claude/settings.pending.json',
      'common/git-hooks/pre-commit',
      'REVIEW.md',
      'projects/p/REVIEW.md',
      'docs/standards/coding-conventions.md',
      'projects/p/vitest.config.ts',
      'projects/p/tsconfig.json',
      'platform/infra/package.json',
    ];
    for (const file of gateFiles) {
      it(`gate file ${file}`, () => {
        const found = tierOf(file);
        assert.equal(found.tier, 'high');
        assert.equal(found.rule, 'gate-file');
        assert.match(found.reason, /^gate file \(/);
      });
    }

    const paths = [
      ['platform/lib/cognito.ts', 'platform'],
      ['platform/README.md', 'platform'],
      ['packages/result/src/index.ts', 'packages'],
      ['packages/cdk-constructs/src/traced-function.ts', 'packages'],
      ['packages/flags/README.md', 'packages'],
      ['projects/p/cdk.json', 'gate-file'],
      ['.github/workflows/ci.yml', 'gate-file'],
      ['common/config/rush/pnpm-lock.yaml', 'gate-file'],
      ['projects/p/src/api-py/uv.lock', 'gate-file'],
      ['projects/p/src/api-go/go.sum', 'gate-file'],
      ['projects/p/src/api-go/go.mod', 'gate-file'],
      ['projects/p/bruno/bruno.json', 'gate-file'],
      ['projects/p/src/api-py/pyproject.toml', 'gate-file'],
      ['projects/p/src/api-py/requirements-dev.txt', 'pyproject'],
    ];
    for (const [file, rule] of paths) {
      it(`${file} (${rule})`, () => {
        const found = tierOf(file);
        assert.equal(found.tier, 'high');
        assert.equal(found.rule, rule);
      });
    }

    it('keeps platform/infra and packages/cdk-constructs high', () => {
      assert.equal(tierOf('platform/infra/x.ts').tier, 'high');
      assert.equal(tierOf('platform/infra/x.ts').rule, 'gate-file');
      assert.equal(tierOf('packages/cdk-constructs/src/x.ts').tier, 'high');
      assert.equal(tierOf('packages/cdk-constructs/src/x.ts').rule, 'packages');
    });
  });

  describe('package.json', () => {
    it('is high when a dependency field changes', () => {
      for (const field of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
        'overrides',
        'pnpm',
      ]) {
        const found = tierOf(
          'projects/p/package.json',
          sides(packageText({}), packageText({ [field]: { zod: '4.0.0' } })),
        );
        assert.equal(found.tier, 'high', field);
        assert.equal(found.rule, 'dependencies');
        assert.ok(found.reason.includes(`(${field})`), found.reason);
      }
    });

    it('is high when a dependency version changes or a dependency is removed', () => {
      const before = packageText({ dependencies: { zod: '4.0.0' } });
      assert.equal(
        tierOf(
          'projects/p/package.json',
          sides(before, packageText({ dependencies: { zod: '4.1.0' } })),
        ).tier,
        'high',
      );
      assert.equal(tierOf('projects/p/package.json', sides(before, packageText({}))).tier, 'high');
    });

    it('is high when a new package.json has dependencies, and when the file is deleted', () => {
      assert.equal(tierOf('projects/p/package.json', sides(null, WITH_DEPENDENCY)).tier, 'high');
      assert.equal(tierOf('projects/p/package.json', sides(WITH_DEPENDENCY, null)).tier, 'high');
    });

    it('is high when a _phase script changes (gate)', () => {
      const before = packageText({ scripts: { '_phase:test': 'vitest run' } });
      const found = tierOf(
        'projects/p/package.json',
        sides(before, packageText({ scripts: { '_phase:test': 'echo ok' } })),
      );
      assert.equal(found.tier, 'high');
      assert.equal(found.rule, 'gate-phase-script');
      assert.match(found.reason, /_phase:test changed/);
    });

    it('is medium when only the version or another script changes', () => {
      const before = packageText({ dependencies: { zod: '4.0.0' }, scripts: { build: 'tsc' } });
      const after = packageText({
        version: '1.1.0',
        dependencies: { zod: '4.0.0' },
        scripts: { build: 'tsc -p .', lint: 'eslint .' },
      });
      const found = tierOf('projects/p/package.json', sides(before, after));
      assert.equal(found.tier, 'medium');
      assert.equal(found.rule, 'default');
    });

    it('is medium for a new package.json with no dependency', () => {
      assert.equal(tierOf('projects/p/package.json', sides(null, packageText({}))).tier, 'medium');
    });

    it('is high when it cannot be read as JSON', () => {
      const found = tierOf('projects/p/package.json', sides(packageText({}), '{ not json'));
      assert.equal(found.tier, 'high');
      assert.match(found.reason, /cannot be read as JSON/);
    });

    it('is high without the diff, because the fields cannot be checked', () => {
      const found = tierOf('projects/p/package.json');
      assert.equal(found.tier, 'high');
      assert.match(found.reason, /without the diff/);
    });

    it('compares dependency fields only', () => {
      assert.deepEqual(
        dependencyFieldChanges(packageText({}), packageText({ version: '2.0.0' })),
        [],
      );
      assert.deepEqual(
        dependencyFieldChanges(
          packageText({}),
          packageText({ devDependencies: { a: '1' }, dependencies: { b: '1' } }),
        ),
        ['dependencies', 'devDependencies'],
      );
      assert.equal(dependencyFieldChanges('[]', packageText({})), 'unreadable');
    });
  });

  describe('medium', () => {
    for (const file of [
      'projects/p/src/api/handler.ts',
      'projects/p/web/app/page.tsx',
      'projects/p/web/lib/client.ts',
      'projects/p/src/lib/util.ts',
      'projects/p/src/api-go/internal/notes/handler.go',
      'projects/p/scripts/e2e.mjs.txt',
      'projects/p/web/package.json.bak',
      '.gitignore.local',
    ]) {
      it(`${file} (no high path, not docs, not tests)`, () => {
        const found = tierOf(file);
        assert.equal(found.tier, 'medium');
        assert.equal(found.rule, 'default');
      });
    }

    for (const file of [
      'projects/p/bin/app.ts',
      'projects/p/lib/stack.ts',
      'projects/p/lib/stack.test.ts',
      'projects/p/infra/stack.ts',
    ]) {
      it(`${file} (project CDK app)`, () => {
        const found = tierOf(file);
        assert.equal(found.tier, 'medium');
        assert.equal(found.rule, 'project-cdk');
        assert.match(found.reason, /^the CDK app of a project/);
      });
    }

    it('keeps projects/*/cdk.json a high gate file next to a medium CDK app', () => {
      assert.equal(tierOf('projects/p/cdk.json').tier, 'high');
      assert.equal(tierOf('projects/p/cdk.json').rule, 'gate-file');
      assert.equal(classifyPaths(['projects/p/lib/stack.ts']).tier, 'medium');
      assert.equal(classifyPaths(['projects/p/lib/stack.ts', 'projects/p/cdk.json']).tier, 'high');
    });

    it('is high when a project CDK path comes with platform/infra or packages/cdk-constructs', () => {
      assert.equal(classifyPaths(['projects/p/lib/stack.ts', 'platform/infra/x.ts']).tier, 'high');
      assert.equal(
        classifyPaths(['projects/p/bin/app.ts', 'packages/cdk-constructs/src/x.ts']).tier,
        'high',
      );
    });

    for (const file of [
      'CLAUDE.md',
      'projects/CLAUDE.md',
      'AGENTS.md',
      'docs/guides/api.md',
      'docs/templates/pr-body.md',
      'docs/standards/testing.md',
    ]) {
      it(`${file} (human-reviewed document)`, () => {
        const found = tierOf(file);
        assert.equal(found.tier, 'medium');
        assert.equal(found.rule, 'reviewed-document');
      });
    }
  });

  describe('low', () => {
    const lowPaths = [
      ['docs/adr/0011-title.md', 'docs'],
      ['docs/build/status.md', 'docs'],
      ['docs/images/flow.png', 'docs'],
      ['README.md', 'docs'],
      ['projects/p/README.md', 'docs'],
      ['.claude/skills/verify/SKILL.md', 'docs'],
      ['projects/p/src/api/handler.test.ts', 'tests'],
      ['projects/p/web/e2e/home.spec.ts', 'tests'],
      ['projects/p/src/api-py/tests/test_a.py', 'tests'],
      ['projects/p/src/api-go/internal/a_test.go', 'tests'],
      ['projects/p/bruno/notes/create-note.bru', 'tests'],
      ['projects/p/bruno/environments/local.bru', 'bruno'],
      ['projects/p/bruno/collection.bru', 'bruno'],
    ];
    for (const [file, rule] of lowPaths) {
      it(`${file} (${rule})`, () => {
        const found = tierOf(file);
        assert.equal(found.tier, 'low');
        assert.equal(found.rule, rule);
      });
    }
  });

  describe('a PR', () => {
    it('takes the highest tier of its files and lists the highest files first', () => {
      const result = classifyPaths([
        'docs/adr/0011-title.md',
        'projects/p/src/api/handler.ts',
        'packages/result/src/index.ts',
        'projects/p/src/api/handler.test.ts',
      ]);
      assert.equal(result.tier, 'high');
      assert.deepEqual(
        result.files.map((entry) => entry.tier),
        ['high', 'medium', 'low', 'low'],
      );
      assert.equal(result.files[0].file, 'packages/result/src/index.ts');
    });

    it('is medium when the highest file is medium', () => {
      assert.equal(
        classifyPaths(['docs/adr/0011-title.md', 'projects/p/src/api/handler.ts']).tier,
        'medium',
      );
      assert.equal(
        classifyPaths(['docs/adr/0011-title.md', 'docs/standards/testing.md']).tier,
        'medium',
      );
    });

    it('is low when every file is docs, tests or Bruno', () => {
      assert.equal(
        classifyPaths([
          'docs/adr/0011-title.md',
          'projects/p/src/api/handler.test.ts',
          'projects/p/bruno/notes/create-note.bru',
        ]).tier,
        'low',
      );
    });

    it('is high for one gate file among many low files', () => {
      const paths = Array.from({ length: 20 }, (_, index) => `docs/adr/${String(index)}.md`);
      assert.equal(classifyPaths([...paths, 'tooling/eslint-config/index.js']).tier, 'high');
    });

    it('lists a path once', () => {
      assert.equal(classifyPaths(['rush.json', 'rush.json']).files.length, 1);
    });

    it('lets a later step raise the tier and never lower it', () => {
      assert.equal(higherTier('low', 'high'), 'high');
      assert.equal(higherTier('high', 'low'), 'high');
      assert.equal(higherTier('medium', 'medium'), 'medium');
      assert.equal(higherTier('low', 'medium'), 'medium');
    });
  });
});

describe('classify-risk CLI', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      'docs/adr/0001-first.md': 'text\n',
      'projects/p/src/api/handler.ts': 'export const a = 1;\n',
      'projects/p/src/api/handler.test.ts': "it('a', () => {});\n",
      'projects/p/package.json': packageText({
        dependencies: { zod: '4.0.0' },
        scripts: { build: 'tsc' },
      }),
      'packages/a/src/a.ts': 'export const a = 1;\n',
    });
    repository.git('checkout', '-q', '-b', 'feature');
  });
  afterEach(() => repository.remove());

  const commit = (message = 'change') => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', message);
  };
  const classify = (args = []) =>
    exec('node', [CLI, '--root', repository.root, '--base', 'main', '--head', 'feature', ...args]);
  const classifyJson = () => {
    const result = classify(['--json']);
    return { result, report: JSON.parse(result.stdout) };
  };

  it('gives low for an empty diff', () => {
    const result = classify();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^risk:low \(0 files: 0 high, 0 medium, 0 low\)\n$/);
  });

  it('gives low for docs and tests only', () => {
    repository.write('docs/adr/0002-second.md', 'text\n');
    repository.write(
      'projects/p/src/api/handler.test.ts',
      "it('a', () => {});\nit('b', () => {});\n",
    );
    commit();
    const { result, report } = classifyJson();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.tier, 'low');
    assert.deepEqual(
      report.files.map((entry) => entry.file),
      ['docs/adr/0002-second.md', 'projects/p/src/api/handler.test.ts'],
    );
  });

  it('gives medium for a code change', () => {
    repository.write('projects/p/src/api/handler.ts', 'export const a = 2;\n');
    commit();
    const result = classify();
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /^risk:medium \(1 files: 0 high, 1 medium, 0 low\)\n {2}medium projects\/p\/src\/api\/handler\.ts: /,
    );
  });

  it('gives medium for a change to the CDK app of a project', () => {
    repository.write('projects/p/lib/stack.ts', 'export const a = 1;\n');
    commit();
    const { result, report } = classifyJson();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.tier, 'medium');
    assert.deepEqual(
      report.files.map((entry) => [entry.file, entry.rule]),
      [['projects/p/lib/stack.ts', 'project-cdk']],
    );
  });

  it('gives high for a gate file or a shared package, and still exits 0', () => {
    repository.write('packages/a/src/a.ts', 'export const a = 2;\n');
    repository.write('rush.json', '{}\n');
    commit();
    const { result, report } = classifyJson();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.tier, 'high');
    assert.deepEqual(
      report.files.map((entry) => [entry.file, entry.rule]),
      [
        ['packages/a/src/a.ts', 'packages'],
        ['rush.json', 'gate-file'],
      ],
    );
  });

  it('gives high when a dependency is added to a package.json', () => {
    repository.write(
      'projects/p/package.json',
      packageText({ dependencies: { zod: '4.0.0', yaml: '2.0.0' }, scripts: { build: 'tsc' } }),
    );
    commit();
    const { report } = classifyJson();
    assert.equal(report.tier, 'high');
    assert.equal(report.files[0].rule, 'dependencies');
  });

  it('gives medium when a package.json changes only outside the dependency fields', () => {
    repository.write(
      'projects/p/package.json',
      packageText({ dependencies: { zod: '4.0.0' }, scripts: { build: 'tsc -p .' } }),
    );
    commit();
    assert.equal(classifyJson().report.tier, 'medium');
  });

  it('judges a package.json against the merge base, not against the base tip', () => {
    repository.write('docs/adr/0002-second.md', 'text\n');
    commit();
    repository.git('checkout', '-q', 'main');
    repository.write(
      'projects/p/package.json',
      packageText({ dependencies: { zod: '4.0.0', yaml: '2.0.0' }, scripts: { build: 'tsc' } }),
    );
    repository.write('packages/a/src/a.ts', 'export const a = 3;\n');
    commit('base moves');
    repository.git('checkout', '-q', 'feature');
    const { report } = classifyJson();
    assert.equal(report.tier, 'low');
    assert.deepEqual(
      report.files.map((entry) => entry.file),
      ['docs/adr/0002-second.md'],
    );
  });

  it('counts a deleted file and both paths of a rename', () => {
    repository.git('rm', '-q', 'packages/a/src/a.ts');
    commit();
    assert.equal(classifyJson().report.tier, 'high');
  });

  it('prints one line for each file, highest first, and cuts a long list', () => {
    repository.write('rush.json', '{}\n');
    for (let index = 0; index < 30; index += 1) {
      repository.write(`docs/adr/gen-${String(index).padStart(2, '0')}.md`, 'x\n');
    }
    commit();
    const result = classify();
    assert.match(
      result.stdout,
      /^risk:high \(31 files: 1 high, 0 medium, 30 low\)\n {2}high {3}rush\.json: gate file \(rush\.json\)\n/,
    );
    assert.match(result.stdout, / {2}\.\.\. and 6 more files \(use --json\)\n$/);
    assert.equal(JSON.parse(classify(['--json']).stdout).files.length, 31);
  });

  it('exits 2 for a bad revision, a missing flag and an unknown argument', () => {
    const bad = exec('node', [CLI, '--root', repository.root, '--base', 'main', '--head', 'nope']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /could not classify: Bad revision "nope"/);
    assert.equal(bad.stdout, '');
    assert.equal(exec('node', [CLI, '--root', repository.root, '--base', 'main']).status, 2);
    assert.match(exec('node', [CLI, '--base']).stderr, /missing value for --base/);
    assert.match(classify(['--nope']).stderr, /unknown argument: --nope/);
  });

  it('prints the help text with --help', () => {
    const result = exec('node', [CLI, '--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
  });
});
