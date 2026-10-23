// False positives of the guard-bash rules and of the anti-skip scanner on normal work. Each ALLOWED
// case came from a review finding. Each FLAGGED or BLOCKED case next to it shows that the real
// bypass is still caught after the fix.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { bashCall, callHook, exec, GATES, makeRepository } from './harness.js';

// The forbidden words are joined at run time so that this file does not hold them as plain text.
const join = (...parts) => parts.join('');
const SKIP = join('.sk', 'ip');
const ONLY = join('.on', 'ly');
const CLI = path.join(GATES, 'anti-skip.mjs');

describe('anti-skip false positives', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository();
  });
  afterEach(() => repository.remove());

  const scan = () => exec('node', [CLI, '--root', repository.root, '--base', 'HEAD']);
  const allowed = (file, content) => {
    repository.write(file, content);
    const result = scan();
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  };
  const flagged = (rule, file, content) => {
    repository.write(file, content);
    const result = scan();
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.ok(result.stderr.includes(`[${rule}]`), result.stderr);
  };

  describe('go-test-skip', () => {
    it('allows (*xml.Decoder).Skip() in Go source that is not a test', () => {
      allowed(
        'projects/x/src/api-go/internal/p/parse.go',
        'package p\n\nfunc read(dec *xml.Decoder) error {\n\tif err := dec.Skip(); err != nil {\n\t\treturn err\n\t}\n\treturn nil\n}\n',
      );
    });

    it('still flags a skip in a Go test file', () => {
      flagged(
        'go-test-skip',
        'projects/x/src/api-go/internal/p/parse_test.go',
        `package p\n\nfunc TestA(t *testing.T) {\n\tt${join('.Sk', 'ip')}("later")\n}\n`,
      );
    });
  });

  describe('skip and only calls on a receiver that is not a test', () => {
    it('allows a query builder skip in a test file', () => {
      allowed(
        'packages/a/src/query.test.ts',
        `it('pages', () => {\n  const rows = db.find()${SKIP}(10).limit(5);\n  expect(rows).toBeDefined();\n});\n`,
      );
    });

    it('allows skip and only on a query, a schema and a cursor', () => {
      allowed(
        'packages/a/src/query2.test.ts',
        `it('builds', () => {\n  const page = query${SKIP}(10);\n  const one = schema${ONLY}(['a']);\n  expect([page, one, cursor${SKIP}(2)]).toHaveLength(3);\n});\n`,
      );
    });

    it('still flags a skip on an alias of the test function', () => {
      flagged(
        'test-skip-any-receiver',
        'packages/a/src/a.test.ts',
        `const runner = test;\nrunner${ONLY}('x', () => { expect(1).toBe(1); });\n`,
      );
    });

    it('still flags a skip on t, the context of node:test', () => {
      flagged(
        'test-skip-any-receiver',
        'packages/a/src/b.test.ts',
        `it('x', (t) => {\n  t${SKIP}('later');\n  expect(1).toBe(1);\n});\n`,
      );
    });

    it('still flags a skip on a chain such as test.describe', () => {
      flagged(
        'test-skip-or-focus',
        'projects/p/web/e2e/a.spec.ts',
        `test.describe${SKIP}('x', () => { test('y', async () => { expect(1).toBe(1); }); });\n`,
      );
    });
  });

  describe('test-without-assertion', () => {
    for (const [label, body] of [
      ['getByRole', "screen.getByRole('heading', { name: 'Notes' });"],
      ['findByText', "await screen.findByText('Saved');"],
      ['getAllByRole', "screen.getAllByRole('listitem');"],
      ['findAllByRole', "await screen.findAllByRole('listitem');"],
      ['an assert helper', 'assertHeading(screen);'],
      ['an expect helper', 'expectHeading(screen);'],
    ]) {
      it(`counts ${label} as an assertion`, () => {
        allowed(
          'projects/x/web/test/a.test.tsx',
          `it('renders', async () => {\n  render(<A />);\n  ${body}\n});\n`,
        );
      });
    }

    it('still flags a test that only renders', () => {
      flagged(
        'test-without-assertion',
        'projects/x/web/test/b.test.tsx',
        "it('renders', () => {\n  render(<A />);\n});\n",
      );
    });

    it('still flags a test that only uses queryBy (it does not throw)', () => {
      flagged(
        'test-without-assertion',
        'projects/x/web/test/c.test.tsx',
        "it('renders', () => {\n  render(<A />);\n  screen.queryByRole('heading');\n});\n",
      );
    });
  });

  describe('shell-exit-zero for set +e', () => {
    it('allows set +e in a script that is not a phase script', () => {
      allowed('scripts/tools/deploy.sh', 'set +e\nrun\n');
      allowed('projects/p/scripts/generate.sh', 'set +e\nrun\n');
    });

    it('flags set +e in the phase scripts, in package.json phase commands and in git hooks', () => {
      flagged('shell-exit-zero', 'projects/p/scripts/test.sh', 'set +e\nrun_tests\n');
    });

    for (const name of ['lint', 'security', 'check-coverage', 'license-check']) {
      it(`flags set +e in scripts/${name}.sh`, () => {
        flagged('shell-exit-zero', `packages/a/scripts/${name}.sh`, 'set +e\nrun\n');
      });
    }

    it('flags set +e in a _phase command of a package.json', () => {
      flagged(
        'shell-exit-zero',
        'packages/a/package.json',
        '{\n  "name": "@t/a",\n  "scripts": {\n    "_phase:test": "set +e; vitest run"\n  }\n}\n',
      );
    });

    it('does not flag set +e in another script of a package.json', () => {
      allowed(
        'packages/a/package.json',
        '{\n  "name": "@t/a",\n  "scripts": {\n    "dev": "set +e; node a.js"\n  }\n}\n',
      );
    });

    it('flags set +e in a git hook that has no file extension', () => {
      flagged('shell-exit-zero', 'common/git-hooks/pre-commit', '#!/bin/sh\nset +e\nrun\n');
    });

    it('still flags "|| exit 0" and continue-on-error in any shell script', () => {
      flagged('shell-exit-zero', 'scripts/tools/deploy.sh', 'run_tests || exit 0\n');
    });
  });
});

describe('guard-bash false positives', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      'projects/x/src/api-py/pyproject.toml': '[tool.pytest]\n',
      'scripts/gates/lib/stop-run.mjs': 'export const a = 1;\n',
      'packages/a/src/a.ts': 'export const a = 1;\n',
      'packages/a/src/b.ts': 'export const b = 1;\n',
    });
    // An untracked gate file, as in a repo where a human has not committed the hooks yet.
    repository.write('.claude/hooks/new-hook.sh', '#!/usr/bin/env bash\n');
  });
  afterEach(() => repository.remove());

  const check = (command) => callHook('guard-bash', bashCall(command), { root: repository.root });
  const allowed = (command) => {
    const result = check(command);
    assert.equal(result.status, 0, `${command}\n${result.stderr}`);
  };
  const blocked = (command) => {
    const result = check(command);
    assert.equal(result.status, 2, command);
    assert.match(result.stderr, /BLOCKED by guard-bash/);
  };
  const edit = (file, text) => fs.writeFileSync(path.join(repository.root, file), text);

  describe('git stash', () => {
    beforeEach(() => edit('packages/a/src/a.ts', 'export const a = 2;\n'));

    it('allows a stash when the only gate file is untracked', () => {
      allowed('git stash');
      allowed('git stash push');
      allowed('git stash push -m wip');
      allowed('git stash -m wip');
    });

    it('allows a stash limited to a pathspec of plain source, even when a gate file is changed', () => {
      edit('rush.json', '{"projects":[],"x":1}\n');
      allowed('git stash push -- packages/a/src/a.ts');
      allowed('git stash push -m wip packages/a/src/a.ts');
      allowed('git stash push -m wip -- packages/a');
      allowed('git stash push --message wip packages/a/src');
    });

    it('blocks a stash that sets aside a tracked gate file', () => {
      edit('rush.json', '{"projects":[],"x":1}\n');
      blocked('git stash');
      blocked('git stash push');
      blocked('git stash save wip');
      blocked('git stash push -- rush.json');
      blocked('git stash push -m wip rush.json');
      blocked('git stash push -- .');
    });

    it('blocks a stash that takes untracked gate files with -u, --include-untracked or -a', () => {
      blocked('git stash -u');
      blocked('git stash push -u');
      blocked('git stash push --include-untracked');
      blocked('git stash -a');
      blocked('git stash push --all -m wip');
      blocked('git stash push -u -- .claude/hooks');
      blocked('git stash push -um wip');
      blocked('git stash -am wip');
      blocked('git stash push -uq -m wip');
    });

    it('allows -u when the pathspec holds no gate file', () => {
      allowed('git stash push -u -- packages/a/src/a.ts');
      allowed('git stash push -mua packages/a/src/a.ts');
    });
  });

  describe('inline code that only names a gate path', () => {
    it('allows reading and importing a gate path', () => {
      allowed(`python3 -c "print(open('projects/x/src/api-py/pyproject.toml').read())"`);
      allowed(
        `node -e "import('./scripts/gates/lib/stop-run.mjs').then(m=>console.log(Object.keys(m)))"`,
      );
      allowed(
        `node -e "console.log(require('fs').readFileSync('scripts/gates/gate-files.json','utf8'))"`,
      );
      allowed(`python3 -c "import json;print(json.load(open('rush.json')))"`);
      allowed(`python3 - <<'EOF'\nprint(open('rush.json', 'r').read())\nEOF`);
      allowed(`python3 -c "print(open('rush.json', encoding='utf-8').read())"`);
      allowed(`python3 -c "print(open('rush.json', 'rb').read())"`);
      allowed(
        `node -e "console.log(require('fs').readFileSync(require('path').join('scripts','gates'),'utf8'))"`,
      );
    });

    const writes = [
      `node -e "require('fs').writeFileSync('rush.json','')"`,
      `node -e "require('fs').appendFileSync('rush.json','x')"`,
      `node -e "require('fs').promises.writeFile('rush.json','')"`,
      `node -e "require('fs').rmSync('scripts/gates',{recursive:true})"`,
      `node -e "require('fs').unlinkSync('rush.json')"`,
      `node -e "require('fs').renameSync('/tmp/x','rush.json')"`,
      `node -e "require('fs').copyFileSync('/tmp/x','rush.json')"`,
      `node -e "require('fs').openSync('rush.json','w')"`,
      `node -e "require('fs')['write'+'FileSync']('rush.json','x')"`,
      `node -e "require('child_process').execSync('mv /tmp/e rush.json')"`,
      `python3 -c "open('rush.json','w').write('')"`,
      `python3 -c "open('rush.json', mode='a').write('x')"`,
      `python3 -c "import os;os.remove('rush.json')"`,
      `python3 -c "import os;os.rename('/tmp/x','rush.json')"`,
      `python3 -c "import shutil;shutil.copy('/tmp/x','rush.json')"`,
      `python3 -c "import pathlib;pathlib.Path('rush.json').write_text('')"`,
      `python3 -c "import os;getattr(os,'rem'+'ove')('rush.json')"`,
      `python3 - <<'EOF'\nopen('rush.json','w').write('')\nEOF`,
      // A flag that is a number or a variable: open() then truncates or writes without a mode string.
      `python3 -c "import os;os.open('rush.json', 577)"`,
      `python3 -c "import os;os.open('rush.json', os.O_RDONLY|os.O_TRUNC)"`,
      `python3 -c "import os;m=577;os.open('rush.json', m)"`,
      `python3 -c "f='w';open('rush.json', f)"`,
      `python3 -c "f='w';open('rush.json', mode=f)"`,
      `python3 -c "import os;os.open(os.path.join('rush.json'), 577)"`,
      `node -e "require('fs').openSync('rush.json', 0o1101)"`,
      `node -e "const f='w';require('fs').openSync('rush.json', f)"`,
      `node -e "require('fs').openSync('rush.json', require('fs').constants.O_TRUNC)"`,
      `perl -e "open(F, '>', 'rush.json')"`,
      `python3 -c "import shelve;shelve.open('rush.json')"`,
      `python3 -c "import sqlite3;sqlite3.connect('rush.json')"`,
    ];
    for (const command of writes) {
      it(`still blocks ${command.slice(0, 70).replaceAll('\n', ' ')}`, () => {
        blocked(command);
      });
    }
  });
});
