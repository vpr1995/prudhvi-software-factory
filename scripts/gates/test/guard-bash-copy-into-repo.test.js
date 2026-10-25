// guard-bash: a recursive copy or an extraction into the repo root, `.claude`, `.claude/state` or
// another folder that holds gate files can plant a fake `.claude/state/last-verify.json`. Backlog
// item w2-fu-state-copy.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { bashCall, callHook, makeRepository } from './harness.js';

describe('guard-bash: copies and extractions into the repo root and .claude', () => {
  let repository;

  before(() => {
    repository = makeRepository({
      'scripts/gates/lib/fs-io.mjs': 'export const a = 1;\n',
      'src/app.mjs': 'export const b = 2;\n',
    });
    // The state folder is ignored by git, so no git command lists its files.
    repository.write('.claude/state/last-verify.json', '{}\n');
    repository.write('.claude/state/session-base', 'abc\n');
  });
  after(() => repository.remove());

  const check = (command) => callHook('guard-bash', bashCall(command), { root: repository.root });
  const absolute = () => repository.root;

  /** @type {[string, (() => string) | string][]} */
  const blocked = [
    // cp and rsync into the root, .claude and .claude/state, in every path spelling.
    ['cp -r into ./', 'cp -r /tmp/fake/. ./'],
    ['cp -R into .', 'cp -R /tmp/fake .'],
    ['cp -a into .claude', 'cp -a /tmp/fake/. .claude'],
    ['cp -r into .claude/ with a slash', 'cp -r /tmp/fake/ .claude/'],
    ['cp -r into ./.claude/state', 'cp -r /tmp/fake ./.claude/state'],
    ['cp -r into .claude/state/ with a slash', 'cp -r /tmp/fake/ .claude/state/'],
    ['cp -r into the absolute root', () => `cp -r /tmp/fake/. ${absolute()}`],
    ['cp -r into the absolute root with a slash', () => `cp -r /tmp/fake/. ${absolute()}/`],
    ['cp -r into the absolute .claude', () => `cp -r /tmp/fake ${absolute()}/.claude`],
    ['cp -r into $PWD', 'cp -r /tmp/fake/. $PWD'],
    ['cp -r into "$PWD/"', 'cp -r /tmp/fake/. "$PWD/"'],
    ['cp -r into ${PWD}/.claude/state', 'cp -r /tmp/fake "${PWD}/.claude/state"'],
    ['cp -r -t .', 'cp -r -t . /tmp/fake'],
    ['cp -rt .claude', 'cp -rt .claude /tmp/fake'],
    ['cp -r --target-directory=.claude/state', 'cp -r --target-directory=.claude/state /tmp/fake'],
    ['cp -r --target-directory ./', 'cp -r --target-directory ./ /tmp/fake'],
    ['cp -r with a dotdot path', 'cp -r /tmp/fake src/../.claude'],
    ['cp -r from a subfolder into ..', 'cd src && cp -r /tmp/fake ..'],
    ['cp -r from .claude into state', 'cd .claude && cp -r /tmp/fake state'],
    ['rsync -a into ./', 'rsync -a /tmp/fake/ ./'],
    ['rsync -a into the absolute root', () => `rsync -a /tmp/fake/ ${absolute()}/`],
    ['rsync -a into $PWD', 'rsync -a --exclude node_modules /tmp/fake/ $PWD'],
    ['rsync -a into .claude/state', 'rsync -a /tmp/fake/ .claude/state/'],
    ['rsync -a into .claude', 'rsync -a /tmp/fake .claude'],
    // mv of a folder onto those.
    ['mv a folder onto .', 'mv /tmp/fakedir .'],
    ['mv a folder onto ./', 'mv /tmp/fakedir ./'],
    ['mv a folder onto .claude', 'mv /tmp/fakedir .claude'],
    ['mv a folder onto .claude/state/', 'mv /tmp/fakedir .claude/state/'],
    ['mv -t .', 'mv -t . /tmp/fakedir'],
    ['mv a folder onto $PWD', 'mv /tmp/fakedir "$PWD"'],
    // tar, in every option form.
    ['tar -xf -C .', 'tar -xf /tmp/fake.tar -C .'],
    ['tar xzf in the root', 'tar xzf /tmp/fake.tgz'],
    ['tar -C . first', 'tar -C . -xf /tmp/fake.tar'],
    ['tar -C ./', 'tar -xf /tmp/fake.tar -C ./'],
    ['tar -C .claude', 'tar -xf /tmp/fake.tar -C .claude'],
    ['tar -C .claude/state/', 'tar -xf /tmp/fake.tar -C .claude/state/'],
    ['tar --directory=.claude', 'tar --directory=.claude -xf /tmp/fake.tar'],
    ['tar --directory .claude/state', 'tar -xf /tmp/fake.tar --directory .claude/state'],
    ['tar -C absolute root', () => `tar -xf /tmp/fake.tar -C ${absolute()}`],
    ['tar -C $PWD', 'tar -xf /tmp/fake.tar -C "$PWD"'],
    ['tar attached -C.claude', 'tar -xf /tmp/fake.tar -C.claude'],
    ['tar from a subfolder with -C ..', 'cd src && tar -xf /tmp/fake.tar -C ..'],
    [
      'tar from a subfolder with attached -C../.claude',
      'cd src && tar -xf /tmp/fake.tar -C../.claude',
    ],
    ['tar --file - into .claude', 'tar --extract --file - --directory=.claude'],
    ['tar cluster with C and f', 'tar -xCf .claude /tmp/fake.tar'],
    ['tar -x from stdin into .', 'tar -xf - -C .'],
    ['tar --extract from stdin', 'tar --extract --file=- --directory=.claude'],
    ['tar from a pipe', 'cat /tmp/fake.tar | tar x -C .claude/state'],
    ['gtar into .', 'gtar -xf /tmp/fake.tar -C .'],
    ['bsdtar into .claude', 'bsdtar -xf /tmp/fake.tar -C .claude'],
    ['bsdtar by full path', '/usr/bin/bsdtar -xf /tmp/fake.tar -C .claude'],
    // unzip, ditto, cpio, pax.
    ['unzip -d .', 'unzip /tmp/fake.zip -d .'],
    ['unzip -d ./', 'unzip -o /tmp/fake.zip -d ./'],
    ['unzip -d .claude/state', 'unzip -d .claude/state /tmp/fake.zip'],
    ['unzip attached -d.claude', 'unzip -d.claude /tmp/fake.zip'],
    ['unzip -qd with a folder', 'unzip -qd .claude /tmp/fake.zip'],
    ['unzip from a subfolder', 'cd src && unzip -d../.claude /tmp/fake.zip'],
    ['unzip into the absolute root', () => `unzip /tmp/fake.zip -d ${absolute()}/`],
    ['unzip with no -d in the root', 'unzip /tmp/fake.zip'],
    ['ditto into .', 'ditto /tmp/fake .'],
    ['ditto into ./', 'ditto /tmp/fake ./'],
    ['ditto -xk into .claude', 'ditto -xk /tmp/fake.zip .claude'],
    ['ditto into .claude/state/', 'ditto /tmp/fake .claude/state/'],
    ['ditto into $PWD', 'ditto /tmp/fake "$PWD"'],
    ['ditto into the absolute root', () => `ditto /tmp/fake ${absolute()}`],
    ['cpio -i in the root', 'cpio -idv < /tmp/fake.cpio'],
    ['cpio -id -D .claude', 'cpio -id -D .claude < /tmp/fake.cpio'],
    ['cpio -id -D.claude/state', 'cpio -id -D.claude/state < /tmp/fake.cpio'],
    ['cpio --extract --directory=.claude', 'cpio --extract --directory=.claude < /tmp/fake.cpio'],
    ['cpio -p into .', 'find /tmp/fake | cpio -pdm .'],
    ['cpio -pdm into .claude/', 'find /tmp/fake | cpio -pdm .claude/'],
    ['cpio -p into $PWD', 'find /tmp/fake | cpio -pdm "$PWD"'],
    ['cpio -p -D .claude', 'find /tmp/fake | cpio -pdm -D .claude state'],
    ['cpio from a pipe', 'cat /tmp/fake.cpio | cpio -i'],
    ['bsdcpio -i in the root', 'bsdcpio -id < /tmp/fake.cpio'],
    ['cpio -o writing a gate path', 'find /tmp/fake | cpio -o -O .claude/state/last-verify.json'],
    ['pax -r in the root', 'pax -r -f /tmp/fake.pax'],
    ['pax -rf in the root', 'pax -rf /tmp/fake.pax'],
    ['pax -rw into .', 'pax -rw /tmp/fake .'],
    ['pax -rw into .claude/', 'pax -rw /tmp/fake .claude/'],
    ['pax -rw into $PWD', 'pax -rw /tmp/fake "$PWD"'],
    [
      'pax -rw with a -s prefix into .claude/state',
      'pax -rw -s ",^,.claude/state/," /tmp/fake /tmp/out',
    ],
    ['pax -w to a gate path', 'pax -w -f .claude/state/last-verify.json /tmp/fake'],
  ];
  for (const [label, command] of blocked) {
    it(`blocks ${label}`, () => {
      const text = typeof command === 'function' ? command() : command;
      const result = check(text);
      assert.equal(result.status, 2, text);
      assert.match(result.stderr, /BLOCKED by guard-bash/);
    });
  }

  /** @type {[string, (() => string) | string][]} */
  const allowed = [
    ['cp -r inside src', 'cp -r /tmp/fake src/'],
    ['cp -r a folder to a new folder', 'cp -r src src-copy'],
    ['cp -r of the state folder out of the repo', 'cp -r .claude/state /tmp/state-copy'],
    ['cp -r into a temp folder', 'cp -r /tmp/fake /tmp/other'],
    ['cp -rt a temp folder', 'cp -rt /tmp/other /tmp/fake'],
    ['cp -r into $TMPDIR', 'cp -r /tmp/fake "$TMPDIR/copy"'],
    ['cp -r into absolute src', () => `cp -r /tmp/fake ${absolute()}/src/`],
    ['cp -r inside src after cd', 'cd src && cp -r /tmp/fake sub'],
    ['rsync -a inside src', 'rsync -a /tmp/fake/ src/sub/'],
    ['rsync -a to a remote host', 'rsync -a /tmp/fake user@host:.'],
    ['rsync -a into a temp folder', 'rsync -a src/ /tmp/backup/'],
    ['mv a folder inside src', 'mv src/sub src/other'],
    ['mv a folder to a temp folder', 'mv /tmp/fakedir /tmp/other'],
    ['tar extract into a temp folder', 'tar -xf /tmp/fake.tar -C /tmp/out'],
    ['tar extract into src', 'tar -xf /tmp/fake.tar -C src'],
    ['tar from stdin into a temp folder', 'tar -xf - -C /tmp/out'],
    ['tar create', 'tar -czf /tmp/out.tgz src'],
    ['tar list', 'tar -tf /tmp/fake.tar'],
    ['bsdtar into a temp folder', 'bsdtar -xf /tmp/fake.tar -C /tmp/out'],
    ['gtar create', 'gtar -cf /tmp/out.tar src'],
    ['unzip into a temp folder', 'unzip /tmp/fake.zip -d /tmp/out'],
    ['unzip into src', 'unzip -d src /tmp/fake.zip'],
    ['unzip list', 'unzip -l /tmp/fake.zip'],
    ['ditto into a temp folder', 'ditto /tmp/fake /tmp/out'],
    ['ditto from the repo into src', 'ditto src src-copy'],
    ['ditto create a zip in temp', 'ditto -c -k src /tmp/out.zip'],
    ['cpio -i into a temp folder', 'cpio -id -D /tmp/out < /tmp/fake.cpio'],
    ['cpio -p into a temp folder', 'find src | cpio -pdm /tmp/out'],
    ['cpio -o to stdout', 'find src | cpio -o > /tmp/out.cpio'],
    ['cpio -o to a temp file', 'find src | cpio -o -O /tmp/out.cpio'],
    ['pax -rw into a temp folder', 'pax -rw src /tmp/out'],
    ['pax -w to a temp file', 'pax -w -f /tmp/out.pax src'],
    ['pax -rw with a -s prefix inside src', 'pax -rw -s ",^,src/sub/," /tmp/fake /tmp/out'],
  ];
  for (const [label, command] of allowed) {
    it(`allows ${label}`, () => {
      const text = typeof command === 'function' ? command() : command;
      const result = check(text);
      assert.equal(result.status, 0, `${text}\n${result.stderr}`);
    });
  }
});
