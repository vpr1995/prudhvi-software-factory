// Tests for lib/gate-integrity.mjs. Each bypass command is run for real in a temp git repo. The
// module must report the change from git objects and from the file system, whatever the command was.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  committedSinceSession,
  committedWarning,
  describeChange,
  pushRange,
  range,
  uncommitted,
  uncommittedMessage,
} from '../lib/gate-integrity.mjs';

import { exec, makeRepository } from './harness.js';

const GATE = 'scripts/gates/lib/fs-io.mjs';
const GATE_TEXT = 'export const a = 1;\n';
const PACKAGE = 'packages/a/package.json';
const PACKAGE_TEXT = `${JSON.stringify(
  {
    name: '@t/a',
    version: '1.0.0',
    scripts: { '_phase:test': 'vitest run --coverage', '_phase:lint': 'eslint .', build: 'tsc' },
  },
  null,
  2,
)}\n`;

const files = (changes) => changes.map((change) => change.file);

describe('gate-integrity', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      [GATE]: GATE_TEXT,
      '.claude/hooks/guard-bash.sh': '#!/usr/bin/env bash\n',
      'tooling/eslint-config/index.js': 'export default [];\n',
      'projects/x/src/api-py/pyproject.toml': '[tool.pytest]\n',
      'src/app.mjs': 'export const b = 2;\n',
      [PACKAGE]: PACKAGE_TEXT,
    });
  });
  afterEach(() => repository.remove());

  const run = (command) => exec('bash', ['-c', command], { cwd: repository.root });
  const commit = (message) => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', message);
    return repository.git('rev-parse', 'HEAD').trim();
  };
  const head = () => repository.git('rev-parse', 'HEAD').trim();
  const reported = () => uncommitted(repository.root);

  it('reports nothing for a clean repo', () => {
    assert.deepEqual(reported(), []);
  });

  it('reports nothing for tool output and state folders that hold gate-like names', () => {
    for (const file of [
      '.claude/state/last-verify.json',
      '.claude/state/session-base',
      'node_modules/x/scripts/a.sh',
      'node_modules/x/tsconfig.json',
      '.pytest_cache/.gitignore',
      '.venv/.gitignore',
      '.ruff_cache/.gitignore',
      '.mypy_cache/.gitignore',
      'packages/a/dist/vitest.config.js',
      'packages/a/rush-logs/a._phase_build.log',
      'common/temp/pnpm-lock.yaml',
      'tooling/eslint-config/node_modules/y/scripts/b.mjs',
    ]) {
      repository.write(file, 'x\n');
    }
    assert.deepEqual(reported(), []);
  });

  describe('bypass commands that edit a gate file', () => {
    // A command may leave the file as it was only when the tool is missing. Each case checks that
    // first, so a missing tool fails loudly and does not pass by doing nothing.
    const commandList = [
      ['xargs truncate', `echo ${GATE} | xargs truncate -s0`],
      ['redirect to a substitution', `echo x > $(echo ${GATE})`],
      ['redirect to a backtick substitution', `echo x > \`echo ${GATE}\``],
      [
        'find -exec sh -c',
        `find scripts/gates -name fs-io.mjs -exec sh -c 'echo pwned > "$1"' _ {} \\;`,
      ],
      [
        'find -exec cp',
        `echo y > /tmp/gate-int-src-$$ && find scripts/gates -name fs-io.mjs -exec cp /tmp/gate-int-src-$$ {} \\;`,
      ],
      ['env -C', `env -C scripts/gates sh -c 'echo x > lib/fs-io.mjs'`],
      [
        'node -e with a built path',
        `node -e "require('fs').writeFileSync('scripts/'+'gates/lib/fs-io.mjs','x')"`,
      ],
      [
        'a hard link made with cp -l, then an edit',
        `cp -l ${GATE} alias.mjs && echo x > alias.mjs`,
      ],
      [
        'a hard link made with cp -al on the folder',
        `cp -al scripts/gates gates-copy && echo x > gates-copy/lib/fs-io.mjs`,
      ],
      ['a hard link made with ln, then an edit', `ln ${GATE} alias2.mjs && echo x >> alias2.mjs`],
      ['sed -i', `sed -i.bak 's/a = 1/a = 2/' ${GATE}`],
      [
        'an interpreter that builds the command',
        `python3 -c "open('scripts/'+'gates/lib/fs-io.mjs','w').write('')"`,
      ],
    ];
    for (const [label, command] of commandList) {
      it(`reports the file after: ${label}`, () => {
        const result = run(command);
        assert.equal(result.status, 0, result.stderr);
        assert.notEqual(repository.read(GATE), GATE_TEXT, 'the command must change the file');
        const found = reported();
        assert.ok(files(found).includes(GATE), JSON.stringify(found));
        assert.ok(found.find((change) => change.file === GATE).change === 'modified');
      });
    }

    it('reports a deleted gate file', () => {
      assert.equal(run(`rm ${GATE}`).status, 0);
      assert.deepEqual(
        reported().map((change) => [change.file, change.change]),
        [[GATE, 'deleted']],
      );
    });

    it('reports both paths of a rename', () => {
      assert.equal(run(`git mv ${GATE} src/moved.mjs`).status, 0);
      const found = reported();
      assert.ok(files(found).includes(GATE), JSON.stringify(found));
      assert.ok(found.some((change) => change.change === 'deleted'));
    });

    it('reports a gate file that is a link now', () => {
      assert.equal(run(`rm ${GATE} && ln -s ../../../src/app.mjs ${GATE}`).status, 0);
      assert.equal(reported().find((change) => change.file === GATE)?.change, 'type');
    });

    it('reports a gate folder that became a link', () => {
      assert.equal(
        run('mv scripts/gates /tmp/gate-int-moved-$$ && ln -s /tmp/gate-int-moved-$$ scripts/gates')
          .status,
        0,
      );
      assert.ok(files(reported()).some((file) => file.startsWith('scripts/gates')));
    });

    it('reports a lost executable bit', () => {
      repository.write('tooling/run.sh', '#!/bin/sh\n');
      fs.chmodSync(path.join(repository.root, 'tooling/run.sh'), 0o755);
      commit('exec');
      assert.deepEqual(reported(), []);
      fs.chmodSync(path.join(repository.root, 'tooling/run.sh'), 0o644);
      assert.deepEqual(
        reported().map((change) => [change.file, change.change]),
        [['tooling/run.sh', 'mode']],
      );
    });

    it('reports a change that git is told to ignore (assume-unchanged, skip-worktree)', () => {
      repository.git('update-index', '--assume-unchanged', GATE);
      repository.git('update-index', '--skip-worktree', 'rush.json');
      fs.writeFileSync(path.join(repository.root, GATE), 'x\n');
      fs.writeFileSync(path.join(repository.root, 'rush.json'), '{}\n');
      assert.deepEqual(repository.git('diff', '--name-only', 'HEAD').trim(), '');
      assert.deepEqual(files(reported()).sort(), ['rush.json', GATE].sort());
    });

    it('reports a change that a clean filter hides from git diff (filter attributes)', () => {
      fs.writeFileSync(path.join(repository.root, '.git/info/attributes'), `${GATE} filter=hide\n`);
      repository.git('config', 'filter.hide.clean', `echo 'export const a = 1;'`);
      repository.git('update-index', '--really-refresh');
      assert.equal(run(`echo 'export const a = 99;' > ${GATE}`).status, 0);
      assert.equal(
        repository.git('diff', 'HEAD', '--name-only').trim(),
        '',
        'git diff must see nothing',
      );
      assert.deepEqual(files(reported()), [GATE]);
    });

    it('reports a change that is only in the index', () => {
      fs.writeFileSync(path.join(repository.root, GATE), 'x\n');
      repository.git('add', GATE);
      fs.writeFileSync(path.join(repository.root, GATE), GATE_TEXT);
      assert.equal(
        repository.git('diff', 'HEAD', '--name-only').trim(),
        '',
        'git diff HEAD is blind to it',
      );
      assert.equal(repository.git('diff', '--cached', '--name-only').trim(), GATE);
      assert.equal(repository.read(GATE), GATE_TEXT, 'the work tree matches HEAD');
      assert.deepEqual(
        reported().map((change) => [change.file, change.change]),
        [[GATE, 'staged']],
      );
    });

    it('reports a path restore from an older commit with pathspec magic', () => {
      fs.writeFileSync(path.join(repository.root, GATE), 'export const a = 2;\n');
      commit('human changes a gate');
      for (const spec of [':/', "'*fs-io*'", "':(glob)scripts/**'", "':(icase)SCRIPTS/gates'"]) {
        repository.git('reset', '-q', '--hard', 'HEAD');
        assert.deepEqual(reported(), [], 'start clean');
        const result = run(`git checkout HEAD~1 -- ${spec}`);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          repository.read(GATE),
          GATE_TEXT,
          `the checkout must change the file (${spec})`,
        );
        assert.ok(files(reported()).includes(GATE), spec);
      }
    });

    it('reports git restore --source with a top-level pathspec', () => {
      fs.writeFileSync(path.join(repository.root, GATE), 'export const a = 2;\n');
      commit('human changes a gate');
      assert.equal(run('git restore --source=HEAD~1 :/').status, 0);
      assert.equal(repository.read(GATE), GATE_TEXT);
      assert.ok(files(reported()).includes(GATE));
    });
  });

  describe('files that exist on disk but not in HEAD', () => {
    it('reports an untracked new gate file', () => {
      repository.write('.github/workflows/extra.yml', 'name: x\n');
      assert.deepEqual(
        reported().map((change) => [change.file, change.change]),
        [['.github/workflows/extra.yml', 'new']],
      );
    });

    it('reports a gitignored pytest.toml that no git command lists', () => {
      repository.write('.gitignore', 'common/temp/\n.claude/state/\nnode_modules/\npytest.toml\n');
      commit('ignore pytest.toml');
      repository.write('projects/x/src/api-py/pytest.toml', '[pytest]\naddopts = ""\n');
      assert.equal(repository.git('status', '--porcelain').trim(), '', 'git must not list it');
      assert.equal(
        repository.git('check-ignore', 'projects/x/src/api-py/pytest.toml').trim(),
        'projects/x/src/api-py/pytest.toml',
      );
      assert.deepEqual(
        reported().map((change) => [change.file, change.change]),
        [['projects/x/src/api-py/pytest.toml', 'new']],
      );
    });

    it('reports a file that .git/info/exclude hides', () => {
      fs.appendFileSync(path.join(repository.root, '.git/info/exclude'), 'ruff.toml\n');
      repository.write('projects/x/src/api-py/ruff.toml', 'select = []\n');
      assert.equal(repository.git('status', '--porcelain').trim(), '');
      assert.deepEqual(files(reported()), ['projects/x/src/api-py/ruff.toml']);
    });

    it('reports a new .gitignore, a new pytest.toml and a new scripts/*.py (gate globs)', () => {
      repository.write('projects/x/.gitignore', '*\n');
      repository.write('projects/x/pytest.toml', '[pytest]\n');
      repository.write('projects/x/src/api-py/scripts/test.py', 'print(1)\n');
      assert.deepEqual(files(reported()), [
        'projects/x/.gitignore',
        'projects/x/pytest.toml',
        'projects/x/src/api-py/scripts/test.py',
      ]);
    });

    it('reports a gate file under a gitignored folder that is not a tool folder', () => {
      repository.write(
        '.gitignore',
        'common/temp/\n.claude/state/\nnode_modules/\nprojects/x/hidden/\n',
      );
      commit('ignore hidden');
      repository.write('projects/x/hidden/pytest.ini', '[pytest]\n');
      assert.deepEqual(files(reported()), ['projects/x/hidden/pytest.ini']);
    });

    it('reports an edit to .gitignore itself', () => {
      repository.write('.gitignore', 'common/temp/\n.claude/state/\nnode_modules/\npytest.toml\n');
      assert.deepEqual(files(reported()), ['.gitignore']);
    });
  });

  describe('_phase scripts of a package.json', () => {
    const withScripts = (scripts) =>
      `${JSON.stringify({ name: '@t/a', version: '1.0.0', scripts }, null, 2)}\n`;
    const details = () =>
      reported()
        .filter((change) => change.change === 'phase-script')
        .map((change) => `${change.file} ${change.detail}`);

    it('reports a _phase:test value changed to "vitest --version"', () => {
      repository.write(
        PACKAGE,
        withScripts({ '_phase:test': 'vitest --version', '_phase:lint': 'eslint .', build: 'tsc' }),
      );
      assert.deepEqual(details(), [`${PACKAGE} _phase:test changed`]);
    });

    it('reports a _phase script that is added or removed', () => {
      repository.write(
        PACKAGE,
        withScripts({
          '_phase:test': 'vitest run --coverage',
          '_phase:e2e': 'playwright test',
          build: 'tsc',
        }),
      );
      assert.deepEqual(details().sort(), [
        `${PACKAGE} _phase:e2e added`,
        `${PACKAGE} _phase:lint removed`,
      ]);
    });

    it('does not report a change to another script or to dependencies', () => {
      repository.write(
        PACKAGE,
        `${JSON.stringify({ name: '@t/a', version: '2.0.0', dependencies: { zod: '1' }, scripts: { '_phase:test': 'vitest run --coverage', '_phase:lint': 'eslint .', build: 'tsc -b', dev: 'x' } }, null, 2)}\n`,
      );
      assert.deepEqual(reported(), []);
    });

    it('reports a package.json that cannot be read when it held _phase scripts', () => {
      repository.write(PACKAGE, '{ "scripts": { "_phase:test": "vitest --version", ');
      assert.equal(details().length, 1, JSON.stringify(reported()));
    });

    it('reports a new package.json that has _phase scripts', () => {
      repository.write('packages/b/package.json', withScripts({ '_phase:test': 'true' }));
      assert.deepEqual(details(), ['packages/b/package.json _phase:test added']);
    });

    it('does not report a new package.json that has no _phase script', () => {
      repository.write('packages/b/package.json', withScripts({ build: 'tsc' }));
      assert.deepEqual(reported(), []);
    });

    it('reports a deleted package.json that had _phase scripts', () => {
      fs.rmSync(path.join(repository.root, PACKAGE));
      assert.ok(
        details().some((line) => line.includes('_phase:test removed')),
        details().join('\n'),
      );
    });

    it('reports a _phase change that is only in the index', () => {
      repository.write(
        PACKAGE,
        withScripts({ '_phase:test': 'true', '_phase:lint': 'eslint .', build: 'tsc' }),
      );
      repository.git('add', PACKAGE);
      repository.write(PACKAGE, PACKAGE_TEXT);
      assert.deepEqual(details(), [`${PACKAGE} _phase:test changed`]);
    });

    it('reports a committed _phase change in a range', () => {
      const base = head();
      repository.write(
        PACKAGE,
        withScripts({ '_phase:test': 'vitest --version', '_phase:lint': 'eslint .', build: 'tsc' }),
      );
      commit('weaken test');
      assert.deepEqual(
        range(repository.root, base).map((change) => [change.file, change.change, change.detail]),
        [[PACKAGE, 'phase-script', '_phase:test changed']],
      );
    });
  });

  describe('range', () => {
    it('reports gate files that commits changed, including a revert', () => {
      fs.writeFileSync(path.join(repository.root, GATE), 'export const a = 2;\n');
      const humanCommit = commit('human changes a gate');
      assert.equal(run('git revert --no-edit HEAD').status, 0);
      assert.equal(repository.read(GATE), GATE_TEXT, 'the revert must change the file back');
      assert.deepEqual(reported(), [], 'the working tree is clean after a revert');
      assert.deepEqual(files(range(repository.root, humanCommit)), [GATE]);
      assert.deepEqual(
        range(repository.root, humanCommit).map((change) => change.change),
        ['modified'],
      );
    });

    it('does not report commits that touch no gate file', () => {
      const base = head();
      repository.write('src/app.mjs', 'export const b = 3;\n');
      commit('plain change');
      assert.deepEqual(range(repository.root, base), []);
    });

    it('reports an added and a deleted gate file', () => {
      const base = head();
      repository.write('.github/CODEOWNERS', '* @me\n');
      fs.rmSync(path.join(repository.root, GATE));
      commit('gate changes');
      assert.deepEqual(
        range(repository.root, base).map((change) => [change.file, change.change]),
        [
          ['.github/CODEOWNERS', 'added'],
          [GATE, 'deleted'],
        ],
      );
    });

    it('uses the merge base, so commits that only the base has are not counted', () => {
      const fork = head();
      repository.git('checkout', '-q', '-b', 'feature');
      repository.write('src/app.mjs', 'export const b = 4;\n');
      commit('feature work');
      repository.git('checkout', '-q', 'main');
      fs.writeFileSync(path.join(repository.root, GATE), 'export const a = 3;\n');
      commit('main gate change');
      repository.git('checkout', '-q', 'feature');
      assert.deepEqual(range(repository.root, 'main'), []);
      assert.notEqual(fork, head());
    });

    it('throws for a base that does not exist, so a hook fails closed', () => {
      assert.throws(() => range(repository.root, 'no-such-branch'));
    });

    it('reports gate files from commits since the session base, and writes a warning', () => {
      const base = head();
      fs.mkdirSync(path.join(repository.root, '.claude/state'), { recursive: true });
      fs.writeFileSync(path.join(repository.root, '.claude/state/session-base'), `${base}\n`);
      assert.deepEqual(committedSinceSession(repository.root), []);
      assert.equal(committedWarning([]), '');
      fs.writeFileSync(path.join(repository.root, GATE), 'export const a = 2;\n');
      commit('gate change');
      const changes = committedSinceSession(repository.root);
      assert.deepEqual(files(changes), [GATE]);
      assert.match(
        committedWarning(changes),
        /^WARNING: .*fs-io\.mjs.*Tell the user these commits change gate files\.$/,
      );
    });
  });

  describe('pushRange', () => {
    it('falls back to the root commit when there is no origin/main and never passes silently', () => {
      fs.writeFileSync(path.join(repository.root, GATE), 'export const a = 2;\n');
      commit('gate change');
      const published = pushRange(repository.root);
      assert.equal(published.base, 'the root commit');
      assert.deepEqual(files(published.changes), [GATE]);
    });

    it('reports nothing for a plain commit when there is no origin/main', () => {
      repository.write('src/app.mjs', 'export const b = 3;\n');
      commit('plain');
      assert.deepEqual(pushRange(repository.root).changes, []);
    });

    it('starts at origin/main when it exists', () => {
      const remote = path.join(
        path.dirname(repository.root),
        `${path.basename(repository.root)}-remote.git`,
      );
      try {
        assert.equal(exec('git', ['init', '-q', '--bare', remote]).status, 0);
        repository.git('remote', 'add', 'origin', remote);
        repository.git('push', '-q', 'origin', 'main');
        repository.git('checkout', '-q', '-b', 'feature');
        repository.write('src/app.mjs', 'export const b = 5;\n');
        commit('plain');
        assert.deepEqual(pushRange(repository.root).changes, []);
        assert.equal(pushRange(repository.root).base, 'origin/main');
        fs.writeFileSync(path.join(repository.root, GATE), 'export const a = 2;\n');
        commit('gate');
        assert.deepEqual(files(pushRange(repository.root).changes), [GATE]);
      } finally {
        fs.rmSync(remote, { recursive: true, force: true });
      }
    });

    it('starts at the upstream of the branch when there is one', () => {
      const remote = path.join(
        path.dirname(repository.root),
        `${path.basename(repository.root)}-remote2.git`,
      );
      try {
        assert.equal(exec('git', ['init', '-q', '--bare', remote]).status, 0);
        repository.git('remote', 'add', 'origin', remote);
        repository.git('checkout', '-q', '-b', 'feature');
        fs.writeFileSync(path.join(repository.root, GATE), 'export const a = 2;\n');
        commit('gate that a human pushed');
        repository.git('push', '-q', '-u', 'origin', 'feature');
        repository.write('src/app.mjs', 'export const b = 6;\n');
        commit('plain');
        assert.deepEqual(pushRange(repository.root).changes, []);
        assert.equal(pushRange(repository.root).base, '@{upstream}');
      } finally {
        fs.rmSync(remote, { recursive: true, force: true });
      }
    });
  });

  it('writes a message that names each file and says how to revert it', () => {
    fs.writeFileSync(path.join(repository.root, GATE), 'x\n');
    repository.write('.github/workflows/new.yml', 'name: x\n');
    const found = reported();
    const text = uncommittedMessage(found);
    for (const change of found) {
      assert.ok(text.includes(describeChange(change)), text);
      assert.ok(
        text.includes(
          `Gate file changed. Revert it (git checkout -- ${change.file}) or ask the human.`,
        ),
        text,
      );
    }
  });
});
