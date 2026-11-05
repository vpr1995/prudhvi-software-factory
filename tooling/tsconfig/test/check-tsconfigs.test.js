// Tests for scripts/check-tsconfigs.mjs: the JSONC parser and the three rules.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseJsonc, stripJsonc, validateConfig } from '../scripts/check-tsconfigs.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/check-tsconfigs.mjs', import.meta.url));
const PRESET = '@vprprudhvi/tooling-tsconfig/node.json';

// A fake repository: file name -> parsed config. `load` follows relative extends inside it.
const makeLoad = (repository) => (fromFile, ref) => {
  const folder = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/') + 1) : '';
  const target = new URL(ref, `file:///${folder}`).pathname.slice(1);
  return target in repository ? { file: target, config: repository[target] } : undefined;
};

const check = (config, repository = {}) =>
  validateConfig('a/tsconfig.json', config, makeLoad(repository));

test('parseJsonc strips line and block comments', () => {
  const text = '{\n// line\n"a": 1, /* block\nmulti */ "b": 2\n}';
  assert.deepEqual(parseJsonc(text), { a: 1, b: 2 });
});

test('parseJsonc strips trailing commas', () => {
  assert.deepEqual(parseJsonc('{"a": [1, 2,], "b": {"c": 1,},}'), { a: [1, 2], b: { c: 1 } });
  assert.deepEqual(parseJsonc('{"a": [1, // note\n],\n}'), { a: [1] });
});

test('parseJsonc keeps comment markers and commas inside strings', () => {
  const text = '{"url": "https://example.com/a", "glob": "src/**/*.ts", "c": "/* x */", "d": ",}"}';
  assert.deepEqual(parseJsonc(text), {
    url: 'https://example.com/a',
    glob: 'src/**/*.ts',
    c: '/* x */',
    d: ',}',
  });
});

test('parseJsonc handles escaped quotes in strings', () => {
  assert.deepEqual(parseJsonc('{"a": "say \\"hi\\" // not a comment"} // real comment'), {
    a: 'say "hi" // not a comment',
  });
});

test('stripJsonc leaves plain JSON unchanged', () => {
  const text = '{"a":[1,2],"b":"c"}';
  assert.equal(stripJsonc(text), text);
});

test('allowed options and keys pass', () => {
  const config = {
    $schema: 'https://json.schemastore.org/tsconfig',
    extends: PRESET,
    compilerOptions: { noEmit: true, rootDir: 'src', outDir: 'dist', paths: { '@x/*': ['./x/*'] } },
    include: ['src'],
    exclude: ['dist'],
  };
  assert.deepEqual(check(config), []);
});

test('missing extends fails', () => {
  const reasons = check({ compilerOptions: { noEmit: true } });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /no "extends"/);
});

test('extends of a non-shared package fails', () => {
  const reasons = check({ extends: '@tsconfig/node20/tsconfig.json' });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /use a preset/);
});

test('extends array needs every entry to pass', () => {
  assert.deepEqual(check({ extends: [PRESET, '@vprprudhvi/tooling-tsconfig/web.json'] }), []);
  assert.equal(check({ extends: [PRESET, 'some-other-pkg/tsconfig.json'] }).length, 1);
});

test('relative extends chain to a preset passes', () => {
  const repository = {
    'a/web/tsconfig.json': { extends: PRESET },
    'a/test/tsconfig.json': { extends: '../web/tsconfig.json' },
  };
  assert.deepEqual(check({ extends: './web/tsconfig.json' }, repository), []);
  assert.deepEqual(
    validateConfig('a/x/tsconfig.json', { extends: '../test/tsconfig.json' }, makeLoad(repository)),
    [],
  );
});

test('relative extends chain that never reaches a preset fails', () => {
  const repository = { 'a/base/tsconfig.json': { compilerOptions: {} } };
  const reasons = check({ extends: './base/tsconfig.json' }, repository);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /does not reach/);
});

test('relative extends to a file outside the repo set fails', () => {
  const reasons = check({ extends: '../../tooling/tsconfig/base.json' });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /not a tsconfig of this repo/);
});

test('circular extends fails', () => {
  const repository = {
    'a/one.json': { extends: './two.json' },
    'a/two.json': { extends: './one.json' },
  };
  const reasons = validateConfig('a/one.json', repository['a/one.json'], makeLoad(repository));
  assert.equal(reasons.length, 1);
});

test('forbidden top-level key fails', () => {
  const reasons = check({ extends: PRESET, compileOnSave: true });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /top-level key "compileOnSave"/);
});

test('forbidden compilerOptions fail', () => {
  const reasons = check({
    extends: PRESET,
    compilerOptions: { strict: false, noPropertyAccessFromIndexSignature: false, noEmit: true },
  });
  assert.equal(reasons.length, 2);
  assert.match(reasons[0], /compilerOption "strict"/);
  assert.match(reasons[1], /compilerOption "noPropertyAccessFromIndexSignature"/);
});

test('compilerOptions names match without regard to case', () => {
  assert.equal(check({ extends: PRESET, compilerOptions: { Strict: false } }).length, 1);
  assert.deepEqual(check({ extends: PRESET, compilerOptions: { NOEMIT: true } }), []);
});

test('the real repo passes the check', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /files ok/);
});
