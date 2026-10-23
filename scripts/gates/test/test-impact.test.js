// Tests for lib/test-impact.mjs (the selector) and test-impacted.mjs (the CLI).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  buildGraph,
  changedPaths,
  GraphError,
  listTests,
  selectTests,
} from '../lib/test-impact.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'test-impacted.mjs');
const T = 'scripts/gates/test';
const L = 'scripts/gates/lib';
const H = 'scripts/gates/hooks';
const PASSING_TEST = "import { it } from 'node:test';\nit('passes', () => {});\n";

/** A small tree of gate files. Every test below changes or adds to it. */
const BASE_TREE = {
  [`${L}/leaf.mjs`]: 'export const leaf = 1;\n',
  [`${L}/middle.mjs`]: "import { leaf } from './leaf.mjs';\nexport const middle = leaf;\n",
  [`${L}/other.mjs`]: 'export const other = 1;\n',
  [`${T}/harness.js`]: 'export const helper = 1;\n',
  [`${T}/chain.test.js`]:
    "import { helper } from './harness.js';\nimport { middle } from '../lib/middle.mjs';\n",
  [`${T}/alone.test.js`]: "import { other } from '../lib/other.mjs';\n",
  [`${T}/plain.test.js`]: PASSING_TEST,
};

describe('test-impact selector', () => {
  let root;

  const write = (files) => {
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  };
  const select = (changed, files = {}) => {
    write(files);
    return selectTests({ root, changed });
  };
  const names = (selection) => selection.files.map((file) => path.posix.basename(file));

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'impact-test-')));
    write(BASE_TREE);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  describe('graph', () => {
    it('lists the test files', () => {
      assert.deepEqual(
        listTests(root).map((file) => path.posix.basename(file)),
        ['alone.test.js', 'chain.test.js', 'plain.test.js'],
      );
    });

    it('selects a test that changed', () => {
      const selection = select([`${T}/plain.test.js`]);
      assert.equal(selection.mode, 'some');
      assert.deepEqual(names(selection), ['plain.test.js']);
    });

    it('selects the tests that import a changed module', () => {
      assert.deepEqual(names(select([`${L}/other.mjs`])), ['alone.test.js']);
    });

    it('follows imports through other modules', () => {
      assert.deepEqual(names(select([`${L}/leaf.mjs`])), ['chain.test.js']);
    });

    it('selects every importer of a shared test helper', () => {
      write({ [`${T}/second.test.js`]: "import { helper } from './harness.js';\n" });
      assert.deepEqual(names(selectTests({ root, changed: [`${T}/harness.js`] })), [
        'chain.test.js',
        'second.test.js',
      ]);
    });

    it('reads multi-line imports, re-exports, bare imports and literal dynamic imports', () => {
      write({
        [`${L}/a.mjs`]: 'export const a = 1;\n',
        [`${L}/b.mjs`]: 'export const b = 1;\n',
        [`${L}/c.mjs`]: 'export const c = 1;\n',
        [`${L}/d.mjs`]: 'export const d = 1;\n',
        [`${T}/forms.test.js`]: [
          'import {',
          '  a,',
          "} from '../lib/a.mjs';",
          "export { b } from '../lib/b.mjs';",
          "import '../lib/c.mjs';",
          "const later = await import('../lib/d.mjs');",
          '',
        ].join('\n'),
      });
      for (const name of ['a', 'b', 'c', 'd']) {
        assert.deepEqual(names(selectTests({ root, changed: [`${L}/${name}.mjs`] })), [
          'forms.test.js',
        ]);
      }
    });

    it('does not read imports inside string fixtures, and ignores a dynamic import that leads nowhere', () => {
      write({
        [`${T}/fixture.test.js`]: [
          'const text = "import { notes } from \'./notes\';";',
          'const command = `node -e "import(\'./nowhere/x.mjs\')"`;',
          '',
        ].join('\n'),
      });
      const selection = selectTests({ root, changed: [`${L}/other.mjs`] });
      assert.equal(selection.mode, 'some');
      assert.deepEqual(names(selection), ['alone.test.js']);
    });

    it('resolves a dynamic import in a command string against the repo root', () => {
      write({
        [`${T}/command.test.js`]:
          'const run = `node -e "import(\'./scripts/gates/lib/other.mjs\')"`;\n',
      });
      assert.deepEqual(names(selectTests({ root, changed: [`${L}/other.mjs`] })), [
        'alone.test.js',
        'command.test.js',
      ]);
    });
  });

  describe('tests that do not import what they test', () => {
    it('selects a test that names a script file (it starts the script)', () => {
      write({
        'scripts/gates/tool.mjs': "import { leaf } from './lib/leaf.mjs';\n",
        [`${T}/cli.test.js`]: "const cli = path.join(GATES, 'tool.mjs');\n",
      });
      assert.deepEqual(names(selectTests({ root, changed: ['scripts/gates/tool.mjs'] })), [
        'cli.test.js',
      ]);
      assert.deepEqual(names(selectTests({ root, changed: [`${L}/leaf.mjs`] })), [
        'chain.test.js',
        'cli.test.js',
      ]);
    });

    it('selects a test that calls a hook by name, for the hook script and its modules', () => {
      write({
        [`${H}/guard-bash.mjs`]: "import { other } from '../lib/other.mjs';\n",
        [`${T}/guard.test.js`]: "callHook('guard-bash', payload, { root });\n",
      });
      assert.deepEqual(names(selectTests({ root, changed: [`${H}/guard-bash.mjs`] })), [
        'guard.test.js',
      ]);
      assert.deepEqual(names(selectTests({ root, changed: [`${L}/other.mjs`] })), [
        'alone.test.js',
        'guard.test.js',
      ]);
    });

    it('does not take a part of a longer name for a hook name', () => {
      write({
        [`${H}/guard-bash.mjs`]: 'export {};\n',
        [`${T}/word.test.js`]: "it('guard-bash-extra', () => {});\n",
      });
      assert.equal(selectTests({ root, changed: [`${H}/guard-bash.mjs`] }).mode, 'none');
    });

    it('selects a test that reads an outside file, and only that test', () => {
      write({
        [`${T}/docs.test.js`]: "read(path.join(REPOSITORY, 'docs', 'standards', 'gates.md'));\n",
        [`${T}/settings.test.js`]:
          "read(path.join(REPOSITORY, '.claude', 'settings.pending.json'));\n",
        [`${T}/skills.test.js`]:
          "read(path.join(REPOSITORY, '.claude', 'skills', name, 'SKILL.md'));\n",
        '.claude/skills/new-project/SKILL.md': '# skill\n',
      });
      assert.deepEqual(names(selectTests({ root, changed: ['docs/standards/gates.md'] })), [
        'docs.test.js',
      ]);
      assert.deepEqual(names(selectTests({ root, changed: ['.claude/settings.pending.json'] })), [
        'settings.test.js',
      ]);
      assert.deepEqual(
        names(selectTests({ root, changed: ['.claude/skills/new-project/SKILL.md'] })),
        ['skills.test.js'],
      );
    });

    it('selects a deleted file that a test names', () => {
      write({ [`${T}/gone.test.js`]: "const cli = path.join(GATES, 'removed-tool.mjs');\n" });
      assert.deepEqual(names(selectTests({ root, changed: ['scripts/gates/removed-tool.mjs'] })), [
        'gone.test.js',
      ]);
    });

    it('does not take a file name in a fixture for a dependency on a changed file elsewhere', () => {
      write({
        [`${T}/fixture.test.js`]: "write('rush.json', '{}');\nwrite('package.json', '{}');\n",
      });
      assert.equal(
        selectTests({ root, changed: ['rush.json', 'packages/a/package.json'] }).mode,
        'none',
      );
    });

    it('selects the folder reader for any change under scripts/gates', () => {
      write({ [`${T}/self-scan.test.js`]: PASSING_TEST });
      assert.deepEqual(names(selectTests({ root, changed: [`${L}/other.mjs`] })), [
        'alone.test.js',
        'self-scan.test.js',
      ]);
      assert.equal(selectTests({ root, changed: ['packages/a/src/a.ts'] }).mode, 'none');
    });
  });

  describe('fall back to every test', () => {
    const every = ['alone.test.js', 'chain.test.js', 'plain.test.js'];

    for (const file of [
      'scripts/gates/gate-files.json',
      '.claude/hooks/guard-bash.sh',
      'common/git-hooks/pre-commit',
    ]) {
      it(`runs everything when ${file} changes`, () => {
        const selection = select([file]);
        assert.equal(selection.mode, 'all');
        assert.deepEqual(names(selection), every);
        assert.ok(selection.reasons[0].startsWith(`${file} changed: `), selection.reasons[0]);
      });
    }

    it('runs everything for a test helper that no test names', () => {
      const selection = select([`${T}/fixtures/data.txt`], {
        [`${T}/fixtures/data.txt`]: 'data\n',
      });
      assert.equal(selection.mode, 'all');
      assert.match(
        selection.reasons[0],
        /fixtures\/data\.txt changed: the selector cannot read this kind of file/,
      );
      const helper = select([`${T}/orphan.js`], { [`${T}/orphan.js`]: 'export {};\n' });
      assert.equal(helper.mode, 'all');
      assert.match(helper.reasons[0], /a test helper that no test imports or names/);
    });

    it('runs everything for a file under scripts/gates of a kind it cannot read', () => {
      const selection = select(['scripts/gates/notes.txt'], { 'scripts/gates/notes.txt': 'x\n' });
      assert.equal(selection.mode, 'all');
      assert.match(selection.reasons[0], /cannot read this kind of file/);
    });

    it('runs everything when an import leads nowhere (the graph cannot be built)', () => {
      write({ [`${T}/broken.test.js`]: "import { x } from '../lib/missing.mjs';\n" });
      const selection = selectTests({ root, changed: [`${L}/other.mjs`] });
      assert.equal(selection.mode, 'all');
      assert.match(
        selection.reasons[0],
        /the import graph cannot be built: .*broken\.test\.js imports \.\.\/lib\/missing\.mjs/,
      );
      assert.deepEqual(names(selection), [
        'alone.test.js',
        'broken.test.js',
        'chain.test.js',
        'plain.test.js',
      ]);
      assert.throws(() => buildGraph(root), GraphError);
    });

    it('selects the importers of a deleted module, and runs everything when a module is gone but not listed as changed', () => {
      fs.rmSync(path.join(root, L, 'other.mjs'));
      assert.deepEqual(names(selectTests({ root, changed: [`${L}/other.mjs`] })), [
        'alone.test.js',
      ]);
      assert.equal(selectTests({ root, changed: [`${T}/plain.test.js`] }).mode, 'all');
    });

    it('does not run everything for a change outside the gates', () => {
      const selection = select(['packages/a/src/a.ts', 'docs/guides/api.md']);
      assert.equal(selection.mode, 'none');
      assert.deepEqual(selection.files, []);
    });
  });
});

describe('changedPaths', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({ 'a.txt': 'a\n', 'old.txt': 'old\n' });
  });
  afterEach(() => repository.remove());

  const commit = (message) => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', message);
  };

  it('lists the working tree against HEAD, with untracked files and deleted files', () => {
    repository.write('a.txt', 'changed\n');
    repository.write('new.txt', 'new\n');
    repository.git('rm', '-q', 'old.txt');
    assert.deepEqual(changedPaths(repository.root, {}), {
      files: ['a.txt', 'new.txt', 'old.txt'],
      headIsCheckedOut: true,
    });
  });

  it('lists nothing for a clean repo', () => {
    assert.deepEqual(changedPaths(repository.root, {}).files, []);
  });

  it('lists the working tree against the merge base of --base', () => {
    repository.write('b.txt', 'b\n');
    commit('second');
    repository.write('c.txt', 'c\n');
    assert.deepEqual(changedPaths(repository.root, { base: 'HEAD~1' }).files, ['b.txt', 'c.txt']);
  });

  it('lists a range, and tells when the end is not checked out', () => {
    repository.git('checkout', '-q', '-b', 'feature');
    repository.write('b.txt', 'b\n');
    commit('feature work');
    repository.git('checkout', '-q', 'main');
    const range = changedPaths(repository.root, { base: 'main', head: 'feature' });
    assert.deepEqual(range, { files: ['b.txt'], headIsCheckedOut: false });
    repository.git('checkout', '-q', 'feature');
    assert.equal(
      changedPaths(repository.root, { base: 'main', head: 'feature' }).headIsCheckedOut,
      true,
    );
  });

  it('throws for a bad revision', () => {
    assert.throws(() => changedPaths(repository.root, { base: 'no-such-ref' }), /Bad revision/);
    assert.throws(
      () => changedPaths(repository.root, { base: '--output=x' }),
      /must not start with "-"/,
    );
  });
});

describe('test-impacted CLI', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      ...BASE_TREE,
      [`${T}/failing.test.js`]:
        "import { it } from 'node:test';\nimport assert from 'node:assert/strict';\nimport '../lib/other.mjs';\nit('fails', () => { assert.equal(1, 2); });\n",
    });
  });
  afterEach(() => repository.remove());

  const run = (args) => exec('node', [CLI, '--root', repository.root, ...args]);
  const commit = (message) => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', message);
  };

  it('prints "no gate tests affected" and exits 0 when no test is affected', () => {
    repository.write('packages/a/src/a.ts', 'export const a = 1;\n');
    const result = run([]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'no gate tests affected\n');
  });

  it('lists the selected tests with --list and does not run them', () => {
    repository.write(`${L}/other.mjs`, 'export const other = 2;\n');
    const result = run(['--list']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      `${T}/alone.test.js`,
      `${T}/failing.test.js`,
    ]);
    assert.match(result.stderr, /2 test files selected/);
  });

  it('runs the selected tests and passes the exit code through', () => {
    repository.write(`${L}/leaf.mjs`, 'export const leaf = 2;\n');
    const passing = run([]);
    assert.equal(passing.status, 0, `${passing.stdout}${passing.stderr}`);
    assert.match(passing.stdout, /ℹ pass 1/);
    repository.write(`${L}/other.mjs`, 'export const other = 2;\n');
    const failing = run([]);
    assert.equal(failing.status, 1, `${failing.stdout}${failing.stderr}`);
    assert.match(failing.stdout, /ℹ fail 1/);
  });

  it('selects from a committed range with --base', () => {
    repository.write(`${L}/leaf.mjs`, 'export const leaf = 2;\n');
    commit('change leaf');
    const result = run(['--base', 'HEAD~1', '--list']);
    assert.deepEqual(result.stdout.trim().split('\n'), [`${T}/chain.test.js`]);
    assert.equal(run(['--list']).stdout, 'no gate tests affected\n');
  });

  it('runs every test with --all', () => {
    const result = run(['--all', '--list']);
    assert.equal(result.stdout.trim().split('\n').length, 4);
    assert.match(result.stderr, /all 4 test files\. Reason: --all/);
  });

  it('runs every test and says why when the gate list changes', () => {
    repository.write('scripts/gates/gate-files.json', '{}\n');
    const result = run(['--list']);
    assert.equal(result.stdout.trim().split('\n').length, 4);
    assert.match(
      result.stderr,
      /all 4 test files\. Reason: scripts\/gates\/gate-files\.json changed/,
    );
  });

  it('runs every test when --head is not the checked-out commit', () => {
    repository.git('checkout', '-q', '-b', 'feature');
    repository.write(`${L}/leaf.mjs`, 'export const leaf = 2;\n');
    commit('change leaf');
    repository.git('checkout', '-q', 'main');
    const result = run(['--base', 'main', '--head', 'feature', '--list']);
    assert.equal(result.stdout.trim().split('\n').length, 4);
    assert.match(result.stderr, /--head is not the checked-out commit/);
  });

  it('exits 2 for a bad revision, a missing value, --head alone and an unknown argument', () => {
    const bad = run(['--base', 'no-such-ref']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /could not select tests: Bad revision/);
    assert.equal(bad.stdout, '');
    assert.match(run(['--base']).stderr, /missing value for --base/);
    assert.match(run(['--head', 'HEAD']).stderr, /--head needs --base/);
    assert.match(run(['--nope']).stderr, /unknown argument: --nope/);
    assert.equal(run(['--nope']).status, 2);
  });

  it('prints the help text with --help', () => {
    const result = exec('node', [CLI, '--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
  });
});
