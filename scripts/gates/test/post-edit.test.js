import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { callHook, editCall, exec, makeRepository } from './harness.js';

const HAS_GLOBAL_PRETTIER = exec('sh', ['-c', 'command -v prettier']).status === 0;

/**
 * Writes an executable stub that logs its arguments and then runs a decision script.
 *
 * @param {string} file - Absolute path of the stub.
 * @param {string} name - Name used in the call log.
 * @param {string} body - Shell lines run after logging (they can use $MODE and $LOG).
 * @returns {void}
 */
function writeStub(file, name, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const script = `#!/bin/sh\nTEMP="$(dirname "$0")/__TEMP__"\nLOG="$TEMP/calls.log"\necho "${name} $*" >> "$LOG"\n${body}\n`;
  fs.writeFileSync(file, script, { mode: 0o755 });
}

describe('post-edit and typecheck-project', () => {
  let repository;
  let temporary;

  const install = (tool, body) => {
    const files = {
      prettier: 'common/autoinstallers/rush-lint-staged/node_modules/.bin/prettier',
      eslint: 'tooling/eslint-config/node_modules/.bin/eslint',
      tsc: 'packages/a/node_modules/.bin/tsc',
    };
    const file = path.join(repository.root, files[tool]);
    writeStub(file, tool, body);
    const relative = path.relative(path.dirname(file), temporary);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('__TEMP__', relative));
  };
  const calls = () =>
    fs.existsSync(path.join(temporary, 'calls.log'))
      ? fs.readFileSync(path.join(temporary, 'calls.log'), 'utf8').trim().split('\n')
      : [];
  const edit = (hook, file, tool = 'Write') =>
    callHook(
      hook,
      {
        ...editCall(tool, path.isAbsolute(file) ? file : path.join(repository.root, file)),
        hookEventName: 'PostToolUse',
      },
      { root: repository.root },
    );
  const context = (result) => JSON.parse(result.stdout).hookSpecificOutput.additionalContext;

  beforeEach(() => {
    repository = makeRepository({ 'packages/a/tsconfig.json': '{}\n', 'docs/a.md': '# a\n' });
    temporary = path.join(repository.root, 'common', 'temp');
    install('prettier', 'exit 0');
    install(
      'eslint',
      'if [ -f "$TEMP/eslint-mode" ]; then MODE="$(cat "$TEMP/eslint-mode")"; else MODE=0; fi\nif [ "$MODE" = 1 ]; then echo "src/a.ts:1:1 error stub-rule broke"; exit 1; fi\nexit "$MODE"',
    );
    install(
      'tsc',
      'if [ -f "$TEMP/tsc-mode" ] && [ "$(cat "$TEMP/tsc-mode")" = fail ]; then echo "src/a.ts(1,1): error TS2322: stub type error"; exit 2; fi\nif [ -f "$TEMP/tsc-mode" ] && [ "$(cat "$TEMP/tsc-mode")" = option ] && echo "$*" | grep -q -- --incremental; then echo "error TS5055: stub option error"; exit 1; fi\nexit 0',
    );
  });

  afterEach(() => repository.remove());

  describe('post-edit', () => {
    it('runs prettier, then eslint --fix --max-warnings 0, and passes silently', () => {
      const result = edit('post-edit', 'packages/a/src/a.ts');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
      const log = calls();
      assert.match(log[0], /^prettier --write --ignore-unknown \.\/packages\/a\/src\/a\.ts$/);
      assert.match(
        log[1],
        /^eslint --fix --max-warnings 0 --no-warn-ignored .*packages\/a\/src\/a\.ts$/,
      );
    });

    it('exits 2 and names the file when eslint leaves errors', () => {
      fs.writeFileSync(path.join(temporary, 'eslint-mode'), '1');
      const result = edit('post-edit', 'packages/a/src/a.ts');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /eslint found problems in packages\/a\/src\/a\.ts/);
      assert.match(result.stderr, /stub-rule broke/);
      assert.match(result.stderr, /Do not add disable comments or weaken rules/);
    });

    it('does not block when eslint itself crashes (exit 2), and adds a notice', () => {
      fs.writeFileSync(path.join(temporary, 'eslint-mode'), '2');
      const result = edit('post-edit', 'packages/a/src/a.ts');
      assert.equal(result.status, 0);
      assert.match(context(result), /eslint could not run/);
    });

    it('skips with a notice when eslint is not installed', () => {
      fs.rmSync(path.join(repository.root, 'tooling'), { recursive: true });
      const result = edit('post-edit', 'packages/a/src/a.ts');
      assert.equal(result.status, 0);
      assert.match(context(result), /eslint is not installed/);
    });

    it(
      'skips with a notice when prettier is not installed',
      { skip: HAS_GLOBAL_PRETTIER && 'prettier is on PATH' },
      () => {
        fs.rmSync(path.join(repository.root, 'common', 'autoinstallers'), { recursive: true });
        const result = edit('post-edit', 'packages/a/src/a.ts');
        assert.equal(result.status, 0);
        assert.match(context(result), /prettier is not installed/);
      },
    );

    it('runs prettier only for a Markdown file', () => {
      const result = edit('post-edit', 'docs/a.md');
      assert.equal(result.status, 0);
      assert.deepEqual(
        calls().map((line) => line.split(' ')[0]),
        ['prettier'],
      );
    });

    it('does nothing for generated folders, state files, missing files and files outside the repo', () => {
      for (const file of [
        'packages/a/dist/x.ts',
        'packages/a/node_modules/x/index.js',
        '.claude/state/last-verify.json',
        'packages/a/rush-logs/x.ts',
        'packages/a/src/missing.ts',
      ]) {
        repository.write(file, 'x\n');
      }
      fs.rmSync(path.join(repository.root, 'packages/a/src/missing.ts'));
      for (const file of [
        'packages/a/dist/x.ts',
        'packages/a/node_modules/x/index.js',
        '.claude/state/last-verify.json',
        'packages/a/rush-logs/x.ts',
        'packages/a/src/missing.ts',
        '/tmp/outside-the-repo.ts',
      ]) {
        const result = edit('post-edit', file);
        assert.equal(result.status, 0, file);
        assert.equal(result.stdout + result.stderr, '', file);
      }
      assert.deepEqual(calls(), []);
    });

    it('checks the notebook_path of a NotebookEdit call', () => {
      const result = edit('post-edit', 'packages/a/src/a.ts', 'NotebookEdit');
      assert.equal(result.status, 0);
      assert.equal(calls().length, 2);
    });

    it('never blocks when the input is not JSON', () => {
      const result = callHook('post-edit', '{"toolInput":', { root: repository.root });
      assert.notEqual(result.status, 2);
    });
  });

  describe('typecheck-project', () => {
    it('runs tsc --noEmit --incremental in the owning project and passes silently', () => {
      const result = edit('typecheck-project', 'packages/a/src/a.ts');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(
        calls()[0],
        /^tsc -p tsconfig\.json --noEmit --incremental --tsBuildInfoFile .*claude-typecheck\.tsbuildinfo$/,
      );
    });

    it('exits 2 with the compiler output when tsc fails', () => {
      fs.writeFileSync(path.join(temporary, 'tsc-mode'), 'fail');
      const result = edit('typecheck-project', 'packages/a/src/a.ts');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /typecheck failed in packages\/a/);
      assert.match(result.stderr, /TS2322: stub type error/);
      assert.match(result.stderr, /Do not use any, @ts-ignore or @ts-expect-error/);
    });

    it('retries without the incremental flags on a TS5xxx option error', () => {
      fs.writeFileSync(path.join(temporary, 'tsc-mode'), 'option');
      const result = edit('typecheck-project', 'packages/a/src/a.ts');
      assert.equal(result.status, 0, result.stderr);
      const log = calls();
      assert.equal(log.length, 2);
      assert.match(log[0], /--incremental/);
      assert.doesNotMatch(log[1], /--incremental/);
    });

    it('uses the tsc arguments of the _phase:typecheck script', () => {
      repository.write(
        'packages/a/package.json',
        JSON.stringify({
          name: '@t/a',
          scripts: { '_phase:typecheck': 'tsc -p tsconfig.build.json --noEmit --pretty false' },
        }),
      );
      edit('typecheck-project', 'packages/a/src/a.ts');
      assert.match(
        calls()[0],
        /^tsc -p tsconfig\.build\.json --noEmit --pretty false --incremental/,
      );
    });

    it('skips with a notice when tsc is not installed in the project', () => {
      fs.rmSync(path.join(repository.root, 'packages/a/node_modules'), { recursive: true });
      const result = edit('typecheck-project', 'packages/a/src/a.ts');
      assert.equal(result.status, 0);
      assert.match(context(result), /tsc or tsconfig\.json is missing/);
    });

    it('does nothing for a Markdown file, a generated file and a file outside the repo', () => {
      for (const file of ['docs/a.md', 'packages/a/dist/x.ts', '/tmp/outside-the-repo.ts']) {
        const result = edit('typecheck-project', file);
        assert.equal(result.status, 0, file);
        assert.equal(result.stdout + result.stderr, '', file);
      }
      assert.deepEqual(calls(), []);
    });
  });
});
