// The push exemption in the real hooks: require-verify (git push, gh pr create, gh pr new), and the
// checks that must NOT change: the edit hook, the Bash guard, the Stop hook and the verify rule.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { bashCall, callHook, editCall, exec, makeRepository } from './harness.js';

const LOCK = 'common/config/rush/pnpm-lock.yaml';
const STATE = 'common/config/rush/repo-state.json';
const CONFIG = 'common/config/rush/pnpm-config.json';
const GATE = 'scripts/gates/lib/fs-io.mjs';
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
const hash = (letter) => `sha512-${letter.repeat(86)}==`;
const lockText = (packages) => `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .: {}

packages:

${packages.map(([key, letter]) => `  ${key}:\n    resolution: {integrity: ${hash(letter)}}\n`).join('\n')}
snapshots:

${packages.map(([key]) => `  ${key}: {}\n`).join('\n')}`;
const OLD_LOCK = lockText([['zod@3.23.8', 'A']]);
const NEW_LOCK = lockText([
  ['left-pad@1.3.0', 'B'],
  ['zod@3.23.8', 'A'],
]);
const OLD_STATE = `{"pnpmShrinkwrapHash":"${'a'.repeat(40)}"}\n`;
const NEW_STATE = `{"pnpmShrinkwrapHash":"${'b'.repeat(40)}"}\n`;
const PUSH_COMMANDS = [
  'git push origin HEAD',
  'gh pr create --fill',
  'gh pr new --fill',
  'gh -R o/r pr new --fill',
];

describe('push exemption in the hooks', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      [LOCK]: OLD_LOCK,
      [STATE]: OLD_STATE,
      [CONFIG]: '{"strictPeerDependencies":true}\n',
      [GATE]: 'export const a = 1;\n',
      'rush.json': RUSH_JSON,
      'packages/b/package.json': '{"name":"@t/b","version":"1.0.0"}\n',
    });
  });
  afterEach(() => repository.remove());

  const commit = (message) => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', message);
  };
  const head = () => repository.git('rev-parse', 'HEAD').trim();
  const check = (command) =>
    callHook('require-verify', bashCall(command), { root: repository.root });
  const guard = (command) => callHook('guard-bash', bashCall(command), { root: repository.root });
  const protect = (file) =>
    callHook('protect-gates', editCall('Write', file), { root: repository.root });
  const writeState = () =>
    callHook('stop-gate', null, { root: repository.root, args: ['--write-state-only'] });
  const stop = () =>
    callHook(
      'stop-gate',
      { hookEventName: 'Stop', stopHookActive: false },
      { root: repository.root, args: [] },
    );
  const setSessionBase = (sha) => repository.write('.claude/state/session-base', `${sha}\n`);
  const message = (result) => JSON.parse(result.stdout)['systemMessage'];

  describe('require-verify allows', () => {
    // A real session has a session base: session-start writes it. Without it a push is refused.
    beforeEach(() => setSessionBase(head()));

    it('a range that changes only pnpm-lock.yaml and repo-state.json', () => {
      repository.write(LOCK, NEW_LOCK);
      repository.write(STATE, NEW_STATE);
      commit('rush add');
      assert.equal(writeState().status, 0);
      for (const command of PUSH_COMMANDS) {
        const result = check(command);
        assert.equal(result.status, 0, `${command}: ${result.stderr}`);
      }
    });

    it('a range that only adds a project to rush.json, with the lock', () => {
      repository.write('rush.json', RUSH_JSON_PLUS_PROJECT);
      repository.write(PROJECT_PACKAGE, PROJECT_PACKAGE_TEXT);
      repository.write(LOCK, NEW_LOCK);
      repository.write(STATE, NEW_STATE);
      commit('register a project');
      assert.equal(writeState().status, 0);
      for (const command of PUSH_COMMANDS) {
        const result = check(command);
        assert.equal(result.status, 0, `${command}: ${result.stderr}`);
      }
    });
  });

  describe('require-verify still blocks', () => {
    it('a mixed range, and lists the blocking file as a blocker', () => {
      repository.write(LOCK, NEW_LOCK);
      repository.write(GATE, 'export const a = 2;\n');
      commit('lock and gate script');
      assert.equal(writeState().status, 0);
      for (const command of PUSH_COMMANDS) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, /Gate changes are pushed by a human\./);
        assert.ok(
          result.stderr.includes(`- ${GATE} (modified), committed after the root commit`),
          result.stderr,
        );
        assert.ok(!result.stderr.includes(`- ${LOCK}`), result.stderr);
        assert.ok(result.stderr.includes('Not counted'), result.stderr);
        assert.ok(result.stderr.includes(LOCK), result.stderr);
      }
    });

    it('pnpm-config.json next to the lock', () => {
      repository.write(LOCK, NEW_LOCK);
      repository.write(CONFIG, '{"strictPeerDependencies":false}\n');
      commit('lock and config');
      assert.equal(writeState().status, 0);
      for (const command of PUSH_COMMANDS) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.ok(result.stderr.includes(`- ${CONFIG} (modified)`), result.stderr);
      }
    });

    it('rush.json with a change outside the projects array', () => {
      repository.write('rush.json', RUSH_JSON_PLUS_PROJECT.replace('5.100.0', '5.101.0'));
      repository.write(PROJECT_PACKAGE, PROJECT_PACKAGE_TEXT);
      commit('register a project and bump rush');
      assert.equal(writeState().status, 0);
      for (const command of PUSH_COMMANDS) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, /Gate changes are pushed by a human\./);
        assert.ok(result.stderr.includes('- rush.json (modified)'), result.stderr);
      }
    });

    it('an uncommitted change of pnpm-lock.yaml (only committed changes are exempt)', () => {
      repository.write(LOCK, NEW_LOCK);
      for (const command of PUSH_COMMANDS) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.ok(result.stderr.includes(`- ${LOCK} (modified), not committed`), result.stderr);
      }
    });

    it('a lock with a tarball or git source, a changed integrity, or a hash-only change (F2)', () => {
      const cases = [
        [
          'a tarball',
          [
            [
              LOCK,
              NEW_LOCK.replace(
                `{integrity: ${hash('B')}}`,
                '{tarball: https://evil.example/left-pad.tgz}',
              ),
            ],
            [STATE, NEW_STATE],
          ],
        ],
        [
          'a git source',
          [
            [
              LOCK,
              NEW_LOCK.replace(
                '  left-pad@1.3.0:\n    resolution: {integrity: ' + hash('B') + '}',
                "  'left-pad@git+https://evil.example/left-pad.git':\n    resolution: {commit: 0123456789abcdef0123456789abcdef01234567, repo: https://evil.example/left-pad.git, type: git}",
              ),
            ],
            [STATE, NEW_STATE],
          ],
        ],
        ['a changed integrity', [[LOCK, NEW_LOCK.replace(hash('A'), hash('C'))]]],
        ['a hash-only change', [[STATE, NEW_STATE]]],
      ];
      for (const [name, writes] of cases) {
        for (const [file, text] of writes) {
          repository.write(file, text);
        }
        commit(name);
        assert.equal(writeState().status, 0);
        for (const command of PUSH_COMMANDS) {
          const result = check(command);
          assert.equal(result.status, 2, `${name}: ${command}`);
          assert.match(result.stderr, /Gate changes are pushed by a human\./, name);
          assert.ok(
            result.stderr.includes(`- ${writes[0][0]} (modified), committed after the root commit`),
            `${name}: ${result.stderr}`,
          );
        }
        repository.git('reset', '-q', '--hard', 'HEAD~1');
      }
    });

    it('a rush.json that removes, repoints or edits an entry (F1)', () => {
      const cases = [
        ['removal', [entryOf('bb')]],
        ['repoint', [ENTRY_A.replace('packages/a', 'packages/elsewhere'), entryOf('bb')]],
        ['edit', [ENTRY_A.replace('}', ', "shouldPublish": true }'), entryOf('bb')]],
        ['empty array', []],
      ];
      for (const [name, entries] of cases) {
        repository.write('rush.json', rushJsonWith(entries));
        repository.write(PROJECT_PACKAGE, PROJECT_PACKAGE_TEXT);
        commit(name);
        assert.equal(writeState().status, 0);
        for (const command of PUSH_COMMANDS) {
          const result = check(command);
          assert.equal(result.status, 2, `${name}: ${command}`);
          assert.ok(result.stderr.includes('- rush.json (modified)'), `${name}: ${result.stderr}`);
        }
        repository.git('reset', '-q', '--hard', 'HEAD~1');
      }
    });

    it('an uncommitted change of rush.json next to a committed projects-only change', () => {
      repository.write('rush.json', RUSH_JSON_PLUS_PROJECT);
      repository.write(PROJECT_PACKAGE, PROJECT_PACKAGE_TEXT);
      commit('register a project');
      repository.write('rush.json', RUSH_JSON_PLUS_PROJECT.replace('5.100.0', '5.101.0'));
      const result = check('git push origin HEAD');
      assert.equal(result.status, 2);
      assert.ok(result.stderr.includes('- rush.json (modified), not committed'), result.stderr);
    });

    it('an exempt-only range when there is no passing verify (the verify rule is the same)', () => {
      repository.write(LOCK, NEW_LOCK);
      commit('rush add');
      for (const command of PUSH_COMMANDS) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, /needs a passing verify/);
      }
    });

    it('an exempt-only range when the verify state is for an older tree', () => {
      assert.equal(writeState().status, 0);
      repository.write(LOCK, NEW_LOCK);
      commit('rush add after the verify');
      for (const command of PUSH_COMMANDS) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, /needs a passing verify/);
      }
    });
  });

  describe('require-verify publishes the current branch only (F6)', () => {
    beforeEach(() => setSessionBase(head()));

    const currentOnly = /Push the current branch only\./;

    /** Makes a branch `other` that holds a gate change, and goes back to main. */
    const makeOtherBranch = () => {
      repository.git('checkout', '-q', '-b', 'other');
      repository.write(GATE, 'export const a = 2;\n');
      commit('gate change on another branch');
      repository.git('checkout', '-q', 'main');
      assert.equal(writeState().status, 0);
    };

    it('blocks a refspec whose source is another branch with a gate change', () => {
      makeOtherBranch();
      for (const command of [
        'git push origin other:x',
        'git push origin other',
        'git push origin +other:x',
        'git push origin refs/heads/other:refs/heads/x',
        'git push -u origin other:x',
        'git push -o ci.skip origin other:x',
        'git push origin HEAD:x other:y',
        `git push origin ${repository.git('rev-parse', 'other').trim()}:x`,
        'cd . && git push origin other:x',
      ]) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, currentOnly, command);
      }
    });

    it('blocks a push through an alias of push with such a refspec', () => {
      makeOtherBranch();
      repository.git('config', 'alias.p', 'push');
      repository.git('config', 'alias.po', 'push origin');
      for (const command of ['git p origin other:x', 'git po other:x']) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, currentOnly, command);
      }
    });

    it('blocks a delete, a pattern, --all and --branches', () => {
      makeOtherBranch();
      for (const command of [
        'git push origin :x',
        'git push origin --delete x',
        'git push -d origin x',
        'git push origin "refs/heads/*:refs/heads/*"',
        'git push --all origin',
        'git push --branches origin',
        'git push --al origin',
      ]) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, currentOnly, command);
      }
    });

    it('blocks gh pr create with a head that is not the current branch', () => {
      makeOtherBranch();
      for (const command of [
        'gh pr create --fill --head other',
        'gh pr create --fill -H other',
        'gh pr create --fill --head=other',
        'gh pr create --fill -Hother',
        'gh pr create --fill --head someone:other',
        'gh pr new --fill --head other',
      ]) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, currentOnly, command);
      }
    });

    it('allows HEAD, the current branch, and a commit that HEAD holds', () => {
      makeOtherBranch();
      repository.write('src/app.mjs', 'export const b = 3;\n');
      commit('plain');
      repository.git('tag', 'older', 'HEAD~1');
      assert.equal(writeState().status, 0);
      for (const command of [
        'git push origin HEAD',
        'git push -u origin HEAD',
        'git push origin HEAD:feature',
        'git push origin main',
        'git push origin main:feature',
        'git push origin refs/heads/main:refs/heads/feature',
        'git push origin HEAD~1:feature',
        'git push origin older:feature',
        'git push',
        'gh pr create --fill',
        'gh pr create --fill --head main',
        'gh pr create --fill -H someone:main',
      ]) {
        const result = check(command);
        assert.equal(result.status, 0, `${command}: ${result.stderr}`);
      }
    });

    it('measures from origin/main, not from the upstream that the branch has', () => {
      const remote = path.join(
        path.dirname(repository.root),
        `${path.basename(repository.root)}-ph.git`,
      );
      try {
        assert.equal(exec('git', ['init', '-q', '--bare', remote]).status, 0);
        repository.git('remote', 'add', 'origin', remote);
        repository.git('push', '-q', 'origin', 'main');
        repository.git('checkout', '-q', '-b', 'feature');
        repository.write(GATE, 'export const a = 2;\n');
        commit('gate change');
        repository.git('push', '-q', '-u', 'origin', 'feature');
        repository.write('src/app.mjs', 'export const b = 3;\n');
        commit('plain');
        assert.equal(writeState().status, 0);
        for (const command of ['git push origin feature', 'git push', 'gh pr create --fill']) {
          const result = check(command);
          assert.equal(result.status, 2, command);
          assert.ok(
            result.stderr.includes(`- ${GATE} (modified), committed after origin/main`),
            result.stderr,
          );
        }
        repository.git('branch', '-u', 'origin/main');
        assert.equal(check('git push origin feature').status, 2);
      } finally {
        fs.rmSync(remote, { recursive: true, force: true });
      }
    });
  });

  describe('require-verify: a source that git cannot find, tags, and a push with no refspec (N1)', () => {
    beforeEach(() => setSessionBase(head()));

    const currentOnly = /Push the current branch only\./;
    const blocked = (commands) => {
      for (const command of commands) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, currentOnly, command);
      }
    };
    const allowed = (commands) => {
      for (const command of commands) {
        const result = check(command);
        assert.equal(result.status, 0, `${command}: ${result.stderr}`);
      }
    };

    beforeEach(() => {
      repository.write('src/app.mjs', 'export const b = 2;\n');
      commit('plain');
      assert.equal(writeState().status, 0);
    });

    it('blocks a source that git cannot find (fail closed)', () => {
      blocked([
        'git push origin feature',
        'git push origin nope:x',
        'git push origin HEAD:x nope',
        'git push origin tag v1',
        'git push -u origin missing-branch',
      ]);
      const result = check('git push origin nope:x');
      assert.match(result.stderr, /git cannot find the source "nope"/);
    });

    it('still allows an ancestor of HEAD', () => {
      allowed(['git push origin HEAD~1:x', `git push origin ${head()}:x`]);
    });

    it('blocks --tags, --follow-tags, --mirror and --prune, also in short forms', () => {
      blocked([
        'git push origin --tags',
        'git push --tags',
        'git push origin HEAD --tags',
        'git push origin HEAD --follow-tags',
        'git push --follow-tags origin HEAD',
        'git push --follow origin HEAD',
        'git push --tag origin HEAD',
        'git push --mirror origin',
        'git push --prune origin HEAD',
      ]);
      allowed(['git push origin HEAD --no-follow-tags']);
    });

    it('blocks a push with no refspec when remote.<name>.push can publish other branches', () => {
      repository.git('config', 'remote.origin.push', 'refs/heads/*:refs/heads/*');
      repository.git('config', 'alias.p', 'push');
      blocked(['git push', 'git push origin', 'git push -u origin', 'git p origin']);
      allowed(['git push origin HEAD', 'git push upstream']);
      assert.match(check('git push').stderr, /remote\.<name>\.push/);
    });

    it('reads the push setting of every remote when the command names no remote', () => {
      repository.git('config', 'remote.other.push', 'refs/heads/*:refs/heads/*');
      blocked(['git push']);
      allowed(['git push origin', 'git push origin HEAD']);
    });

    it('blocks a push with no refspec when remote.<name>.mirror is set, with any value', () => {
      for (const value of ['true', 'false', 'push']) {
        repository.git('config', 'remote.origin.mirror', value);
        blocked(['git push', 'git push origin', 'git push -u origin']);
        allowed(['git push origin HEAD', 'git push upstream']);
        assert.match(check('git push').stderr, /mirror/);
      }
    });

    it('reads the mirror setting of every remote when the command names no remote', () => {
      repository.git('config', 'remote.other.mirror', 'true');
      blocked(['git push']);
      allowed(['git push origin', 'git push origin HEAD']);
    });

    it('blocks a delete hidden in a short flag cluster', () => {
      blocked(['git push -qd origin x', 'git push -d origin x', 'git push -dq origin x']);
      allowed(['git push -q origin HEAD', 'git push -u origin HEAD']);
    });

    it('blocks a push with no refspec when push.default is not simple, current or upstream', () => {
      for (const mode of ['matching', 'nothing', 'tracking']) {
        repository.git('config', 'push.default', mode);
        blocked(['git push', 'git push origin']);
        allowed(['git push origin HEAD']);
        assert.match(check('git push').stderr, /push\.default/);
      }
    });

    it('blocks a push when push.default is a value that git rejects as malformed (fail closed)', () => {
      // Git accepts only lowercase names. With `MATCHING` or `bogus`, git fails to read the config,
      // so the hook cannot know the mode and must block, also a push with a refspec.
      for (const mode of ['MATCHING', 'bogus']) {
        repository.git('config', 'push.default', mode);
        assert.equal(check('git push').status, 2, mode);
        assert.equal(check('git push origin').status, 2, mode);
      }
    });

    it('allows a push with no refspec for simple, current, upstream (same name) and no setting', () => {
      allowed(['git push', 'git push origin']);
      repository.git('config', 'push.default', 'simple');
      allowed(['git push', 'git push origin']);
      repository.git('config', 'push.default', 'current');
      allowed(['git push', 'git push origin']);
      repository.git('config', 'push.default', 'upstream');
      repository.git('config', 'branch.main.merge', 'refs/heads/main');
      allowed(['git push', 'git push origin']);
    });

    it('blocks push.default upstream when the upstream branch has another name or none', () => {
      repository.git('config', 'push.default', 'upstream');
      blocked(['git push', 'git push origin']);
      repository.git('config', 'branch.main.merge', 'refs/heads/release');
      blocked(['git push', 'git push origin']);
      allowed(['git push origin HEAD']);
    });
  });

  describe('the Bash guard still blocks', () => {
    it('a push to main, a force push and --no-verify, also for an exempt-only range', () => {
      repository.write(LOCK, NEW_LOCK);
      commit('rush add');
      for (const command of [
        'git push origin main',
        'git push origin HEAD:main',
        'git push --force origin feature',
        'git push -f origin feature',
        'git push --no-verify origin feature',
      ]) {
        assert.equal(guard(command).status, 2, command);
      }
    });

    it('a Bash write to the exempt files', () => {
      for (const command of [
        "sed -i '' 's/a/b/' common/config/rush/pnpm-lock.yaml",
        'echo x > common/config/rush/repo-state.json',
        'echo x >> rush.json',
        'echo x > common/config/rush/pnpm-config.json',
      ]) {
        assert.equal(guard(command).status, 2, command);
      }
    });
  });

  describe('the edit hook still blocks a direct edit of', () => {
    it('each exempt file, and names the broad glob for the Rush files', () => {
      for (const [file, glob] of [
        [LOCK, 'common/config/rush/**'],
        [STATE, 'common/config/rush/**'],
        ['rush.json', 'rush.json'],
        [CONFIG, 'common/config/rush/**'],
      ]) {
        const result = protect(file);
        assert.equal(result.status, 2, file);
        assert.ok(result.stderr.includes(`is a gate file (matches ${glob})`), result.stderr);
      }
    });
  });

  describe('the Stop hook still', () => {
    it('blocks while pnpm-lock.yaml has an uncommitted change', () => {
      repository.write(LOCK, NEW_LOCK);
      const result = stop();
      assert.equal(result.status, 2, result.stdout);
      assert.match(result.stderr, /^STOP BLOCKED: 1 gate file change:/);
      assert.ok(result.stderr.includes(LOCK), result.stderr);
    });

    it('blocks while rush.json has an uncommitted change', () => {
      repository.write('rush.json', RUSH_JSON_PLUS_PROJECT);
      const result = stop();
      assert.equal(result.status, 2, result.stdout);
      assert.match(result.stderr, /^STOP BLOCKED: 1 gate file change:/);
      assert.ok(result.stderr.includes('rush.json'), result.stderr);
    });

    it('warns about committed exempt files', () => {
      setSessionBase(head());
      repository.write(LOCK, NEW_LOCK);
      commit('rush add');
      assert.equal(writeState().status, 0);
      const result = stop();
      assert.equal(result.status, 0, result.stderr);
      assert.match(message(result), /Tell the user these commits change gate files\./);
      assert.ok(message(result).includes(LOCK), message(result));
    });
  });
});
