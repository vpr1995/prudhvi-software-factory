// Tests for the session base check of gate integrity (backlog w2-fu-reset). A `git reset` or a
// `git checkout` can move HEAD back past a human gate commit. The range from the merge base cannot
// see that: the gate file is back to the old content and no commit in the range changes it.
// `rewoundChanges` finds it: HEAD does not descend from the session base S, and a gate file that
// M..S changes (M is the merge base of HEAD and S) has other content at HEAD than at S. A rebase
// keeps that content, and a branch that is behind origin/main does not revert main, so neither is
// reported. Each case builds the real history in a temp git repo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  committedSinceSession,
  committedWarning,
  pushRange,
  range,
  rewoundChanges,
  savedSessionBase,
  treeDifferences,
} from '../lib/gate-integrity.mjs';
import { pushBlockers } from '../lib/push-exempt.mjs';

import { bashCall, callHook, exec, makeRepository } from './harness.js';

const GATE = 'scripts/gates/lib/fs-io.mjs';
const GATE_OLD = 'export const a = 1;\n';
const GATE_HUMAN = 'export const a = 2;\n';
const NEW_GATE = '.github/CODEOWNERS';
const LOCK = 'common/config/rush/pnpm-lock.yaml';
const SESSION_BASE = '.claude/state/session-base';
const REWOUND = /rewound past the session base: scripts\/gates\/lib\/fs-io\.mjs/;
const MISSING = /session base is missing/;

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
const LOCK_OLD = lockText([['zod@3.23.8', 'A']]);
const LOCK_NEW = lockText([
  ['left-pad@1.3.0', 'B'],
  ['zod@3.23.8', 'A'],
]);

const files = (changes) => changes.map((change) => change.file).sort();
const summary = (changes) => changes.map((change) => [change.file, change.change, change.detail]);
const LOST = [[GATE, 'modified', 'differs from the session base']];

describe('gate integrity: reset past a human gate commit', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({ [GATE]: GATE_OLD, [LOCK]: LOCK_OLD });
  });
  afterEach(() => repository.remove());

  const head = () => repository.git('rev-parse', 'HEAD').trim();
  const commit = (message) => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', message);
    return head();
  };
  const saveSessionBase = (sha) => repository.write(SESSION_BASE, `${sha}\n`);
  /** A human commits a gate change. It does not move the session base. */
  const gateCommit = () => {
    repository.write(GATE, GATE_HUMAN);
    return commit('human changes a gate');
  };
  /** A human commits a gate change on main. The session starts there. */
  const humanGateCommit = () => {
    const sha = gateCommit();
    saveSessionBase(sha);
    return sha;
  };
  let plainCount = 0;
  const plainCommit = (message = 'plain') => {
    plainCount += 1;
    repository.write('src/app.mjs', `export const b = ${String(plainCount)};\n`);
    return commit(message);
  };

  describe('treeDifferences', () => {
    it('reports nothing for equal trees', () => {
      assert.deepEqual(treeDifferences(repository.root, 'HEAD', { label: 'HEAD' }), []);
    });

    it('reports a modified, an added and a deleted gate file, and labels them', () => {
      const first = head();
      repository.write(GATE, GATE_HUMAN);
      repository.write(NEW_GATE, '* @me\n');
      fs.rmSync(path.join(repository.root, LOCK));
      commit('gate changes');
      const options = { label: 'the old tree' };
      assert.deepEqual(summary(treeDifferences(repository.root, first, options)), [
        [NEW_GATE, 'added', 'differs from the old tree'],
        [LOCK, 'deleted', 'differs from the old tree'],
        [GATE, 'modified', 'differs from the old tree'],
      ]);
    });

    it('sees the change from the ref to head in both directions', () => {
      const first = head();
      repository.write(NEW_GATE, '* @me\n');
      const second = commit('add a gate file');
      const forward = treeDifferences(repository.root, first, { label: 'a', head: second });
      const backward = treeDifferences(repository.root, second, { label: 'b', head: first });
      assert.deepEqual(
        forward.map((entry) => entry.change),
        ['added'],
      );
      assert.deepEqual(
        backward.map((entry) => entry.change),
        ['deleted'],
      );
    });

    it('ignores files that are not gate files', () => {
      const first = head();
      plainCommit();
      assert.deepEqual(treeDifferences(repository.root, first, { label: 'the old tree' }), []);
    });

    it('throws for a ref that does not exist, so a hook fails closed', () => {
      assert.throws(() => treeDifferences(repository.root, 'no-such-ref', { label: 'nothing' }));
    });
  });

  describe('savedSessionBase', () => {
    it('is null when the repo saved no session base', () => {
      assert.equal(savedSessionBase(repository.root), null);
    });

    it('returns the saved commit', () => {
      saveSessionBase(head());
      assert.equal(savedSessionBase(repository.root), head());
    });

    it('is null for a text that is not a full commit id, or for a commit that git does not have', () => {
      for (const text of ['HEAD', 'main', head().slice(0, 12), 'f'.repeat(40), '']) {
        saveSessionBase(text);
        assert.equal(savedSessionBase(repository.root), null, text);
      }
    });

    it('is null for the id of a blob, which is not a commit', () => {
      saveSessionBase(repository.git('rev-parse', `HEAD:${GATE}`).trim());
      assert.equal(savedSessionBase(repository.root), null);
    });
  });

  describe('rewoundChanges', () => {
    it('is empty when HEAD descends from the session base', () => {
      const base = head();
      gateCommit();
      plainCommit();
      assert.deepEqual(rewoundChanges(repository.root, base), []);
    });

    it('reports the gate file after a reset past the session base', () => {
      const base = humanGateCommit();
      repository.git('reset', '-q', '--hard', 'HEAD~1');
      assert.deepEqual(summary(rewoundChanges(repository.root, base)), LOST);
    });

    it('reports the gate file after a checkout of another line', () => {
      repository.git('checkout', '-q', '-b', 'other');
      plainCommit('other line');
      repository.git('checkout', '-q', 'main');
      const base = humanGateCommit();
      repository.git('checkout', '-q', 'other');
      assert.deepEqual(summary(rewoundChanges(repository.root, base)), LOST);
    });

    it('reports a gate commit below the session base, not only at it (M..S)', () => {
      gateCommit();
      const base = plainCommit('plain work after the human commit');
      repository.git('reset', '-q', '--hard', 'HEAD~2');
      plainCommit('other work');
      assert.deepEqual(summary(rewoundChanges(repository.root, base)), LOST);
    });

    it('does not report a gate file whose content HEAD still has (the agent rewrote the commit)', () => {
      const base = humanGateCommit();
      repository.git('reset', '-q', '--soft', 'HEAD~1');
      commit('the same gate content, in a new commit');
      assert.deepEqual(rewoundChanges(repository.root, base), []);
    });

    it('does not report a gate change that the session base does not have (behind main)', () => {
      repository.git('checkout', '-q', '-b', 'feature');
      const base = plainCommit('feature work');
      repository.git('checkout', '-q', 'main');
      gateCommit();
      repository.git('checkout', '-q', 'feature');
      assert.deepEqual(rewoundChanges(repository.root, base), []);
    });

    it('does not report a rebase of an unpushed branch onto a newer main', () => {
      repository.git('checkout', '-q', '-b', 'feature');
      const base = plainCommit('feature work');
      repository.git('checkout', '-q', 'main');
      gateCommit();
      repository.git('checkout', '-q', 'feature');
      repository.git('rebase', '-q', 'main');
      assert.notEqual(head(), base, 'the rebase must make a new commit');
      assert.equal(repository.read(GATE), GATE_HUMAN);
      assert.deepEqual(rewoundChanges(repository.root, base), []);
    });

    it('known limit: does not report a reset to exactly the session base after a later human commit', () => {
      const base = head();
      gateCommit();
      repository.git('reset', '-q', '--hard', base);
      assert.deepEqual(rewoundChanges(repository.root, base), []);
    });

    it('known limit: does not report a reset below the session base after a later human commit', () => {
      plainCommit('plain work before the session');
      const base = plainCommit('the session starts here');
      gateCommit();
      repository.git('reset', '-q', '--hard', 'HEAD~2');
      plainCommit('other work');
      assert.deepEqual(rewoundChanges(repository.root, base), []);
    });

    it('throws for a session base that does not exist, so a hook fails closed', () => {
      assert.throws(() => rewoundChanges(repository.root, 'f'.repeat(40)));
    });
  });

  describe('committedSinceSession (the Stop hook warning)', () => {
    it('finds a gate file that git reset --hard reverted, which the range cannot see', () => {
      const base = humanGateCommit();
      assert.equal(repository.git('reset', '-q', '--hard', 'HEAD~1').trim(), '');
      assert.equal(repository.read(GATE), GATE_OLD, 'the reset must revert the gate file');
      plainCommit('other work');
      assert.deepEqual(range(repository.root, base), [], 'the merge base range is blind to it');
      const found = committedSinceSession(repository.root);
      assert.deepEqual(summary(found), LOST);
      assert.match(committedWarning(found), /^WARNING: .*fs-io\.mjs.*Tell the user/);
    });

    it('finds a gate file that a checkout of an older commit reverted', () => {
      humanGateCommit();
      repository.git('checkout', '-q', 'HEAD~1');
      assert.equal(repository.read(GATE), GATE_OLD);
      plainCommit('other work on a detached HEAD');
      assert.deepEqual(files(committedSinceSession(repository.root)), [GATE]);
    });

    it('finds a gate file that the human commit added and the reset removed', () => {
      repository.write(NEW_GATE, '* @me\n');
      saveSessionBase(commit('human adds a gate file'));
      repository.git('reset', '-q', '--hard', 'HEAD~1');
      plainCommit('other work');
      assert.deepEqual(summary(committedSinceSession(repository.root)), [
        [NEW_GATE, 'deleted', 'differs from the session base'],
      ]);
    });

    it('finds a gate file that the human commit deleted and the reset brought back', () => {
      fs.rmSync(path.join(repository.root, GATE));
      saveSessionBase(commit('human deletes a gate file'));
      repository.git('reset', '-q', '--hard', 'HEAD~1');
      plainCommit('other work');
      assert.deepEqual(summary(committedSinceSession(repository.root)), [
        [GATE, 'added', 'differs from the session base'],
      ]);
    });

    it('reports a normal gate commit once, with no tree difference text', () => {
      saveSessionBase(head());
      repository.write(GATE, GATE_HUMAN);
      commit('agent gate change');
      assert.deepEqual(summary(committedSinceSession(repository.root)), [
        [GATE, 'modified', undefined],
      ]);
    });

    it('reports nothing for plain commits since the session base', () => {
      saveSessionBase(head());
      plainCommit();
      assert.deepEqual(committedSinceSession(repository.root), []);
    });
  });

  describe('the push guard', () => {
    let remote;

    beforeEach(() => {
      remote = path.join(
        path.dirname(repository.root),
        `${path.basename(repository.root)}-reset.git`,
      );
      assert.equal(exec('git', ['init', '-q', '--bare', remote]).status, 0);
      repository.git('remote', 'add', 'origin', remote);
    });
    afterEach(() => fs.rmSync(remote, { recursive: true, force: true }));

    const check = (command) =>
      callHook('require-verify', bashCall(command), { root: repository.root });
    const writeState = () =>
      callHook('stop-gate', null, { root: repository.root, args: ['--write-state-only'] });

    it('does not block a branch that is behind origin/main with a gate commit on main', () => {
      repository.git('push', '-q', 'origin', 'main');
      repository.git('checkout', '-q', '-b', 'feature');
      saveSessionBase(head());
      plainCommit('feature work');
      repository.git('checkout', '-q', 'main');
      gateCommit();
      repository.git('push', '-q', 'origin', 'main');
      repository.git('checkout', '-q', 'feature');
      assert.equal(repository.read(GATE), GATE_OLD, 'the branch must not have the gate commit');
      assert.deepEqual(pushRange(repository.root).changes, []);
      const found = pushBlockers(repository.root);
      assert.equal(found.base, 'origin/main');
      assert.deepEqual(found.blocking, []);
      assert.deepEqual(found.rewound, []);
      assert.equal(found.missingBase, false);
      assert.equal(writeState().status, 0);
      const result = check('git push origin HEAD');
      assert.equal(result.status, 0, result.stderr);
    });

    it('does not block a rebase of an unpushed branch onto a newer main', () => {
      repository.git('push', '-q', 'origin', 'main');
      repository.git('checkout', '-q', '-b', 'feature');
      saveSessionBase(plainCommit('feature work'));
      repository.git('checkout', '-q', 'main');
      gateCommit();
      repository.git('push', '-q', 'origin', 'main');
      repository.git('checkout', '-q', 'feature');
      repository.git('rebase', '-q', 'main');
      assert.equal(repository.read(GATE), GATE_HUMAN, 'the rebase must bring in the gate commit');
      const found = pushBlockers(repository.root);
      assert.deepEqual(found.blocking, []);
      assert.deepEqual(found.rewound, []);
      assert.equal(writeState().status, 0);
      const result = check('git push origin HEAD');
      assert.equal(result.status, 0, result.stderr);
    });

    it('blocks a reset below an unpushed human gate commit that is before the session base', () => {
      repository.git('push', '-q', 'origin', 'main');
      gateCommit();
      saveSessionBase(plainCommit('plain work after the human commit'));
      repository.git('reset', '-q', '--hard', 'HEAD~2');
      plainCommit('other work');
      const found = pushBlockers(repository.root);
      assert.deepEqual(found.blocking, [], 'the range from origin/main is blind to it');
      assert.deepEqual(summary(found.rewound), LOST);
      assert.equal(writeState().status, 0);
      const result = check('git push origin HEAD');
      assert.equal(result.status, 2);
      assert.match(result.stderr, REWOUND);
      assert.ok(result.stderr.includes(`- ${GATE} (modified`), result.stderr);
    });

    it('blocks a reset past a human commit with no origin remote (the root commit range)', () => {
      repository.git('remote', 'remove', 'origin');
      humanGateCommit();
      repository.git('reset', '-q', '--hard', 'HEAD~1');
      plainCommit('other work');
      const found = pushBlockers(repository.root);
      assert.equal(found.base, 'the root commit');
      assert.deepEqual(found.blocking, []);
      assert.deepEqual(summary(found.rewound), LOST);
      assert.equal(writeState().status, 0);
      assert.match(check('gh pr create --fill').stderr, REWOUND);
    });

    it('blocks a push when the session base is missing, after a passing verify', () => {
      repository.git('push', '-q', 'origin', 'main');
      plainCommit();
      assert.equal(pushBlockers(repository.root).missingBase, true);
      assert.equal(writeState().status, 0);
      for (const command of ['git push origin HEAD', 'gh pr create --fill']) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, MISSING, command);
      }
    });

    it('blocks a push when the session base file does not name a commit', () => {
      repository.git('push', '-q', 'origin', 'main');
      plainCommit();
      saveSessionBase('HEAD');
      assert.equal(writeState().status, 0);
      const result = check('git push origin HEAD');
      assert.equal(result.status, 2);
      assert.match(result.stderr, MISSING);
    });

    it('keeps the verify message first when the session base is missing', () => {
      plainCommit();
      const result = check('git push origin HEAD');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /needs a passing verify/);
      assert.doesNotMatch(result.stderr, MISSING);
    });

    it('does not block a plain branch that starts at origin/main', () => {
      repository.git('push', '-q', 'origin', 'main');
      repository.git('checkout', '-q', '-b', 'feature');
      saveSessionBase(head());
      plainCommit();
      assert.deepEqual(pushRange(repository.root).changes, []);
      const found = pushBlockers(repository.root);
      assert.deepEqual(found.blocking, []);
      assert.deepEqual(found.exempt, []);
      assert.deepEqual(found.rewound, []);
      assert.equal(found.missingBase, false);
    });

    it('keeps the push exemption for a clean lock change that the branch made', () => {
      repository.git('push', '-q', 'origin', 'main');
      repository.git('checkout', '-q', '-b', 'feature');
      saveSessionBase(head());
      repository.write(LOCK, LOCK_NEW);
      commit('rush add');
      const found = pushBlockers(repository.root);
      assert.deepEqual(found.blocking, []);
      assert.deepEqual(files(found.exempt), [LOCK]);
    });

    it('still blocks a gate file that the branch changed', () => {
      repository.git('push', '-q', 'origin', 'main');
      repository.git('checkout', '-q', '-b', 'feature');
      saveSessionBase(head());
      repository.write(GATE, GATE_HUMAN);
      commit('agent gate change');
      assert.deepEqual(files(pushBlockers(repository.root).blocking), [GATE]);
    });
  });
});
