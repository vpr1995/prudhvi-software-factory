// Guards against weakening the shared configs: every strict flag must stay on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));

const REQUIRED_FLAGS = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noImplicitOverride',
  'noPropertyAccessFromIndexSignature',
  'verbatimModuleSyntax',
  'noFallthroughCasesInSwitch',
  'useUnknownInCatchVariables',
];

test('base.json enables every required strict flag', () => {
  const { compilerOptions } = readJson('base.json');
  for (const flag of REQUIRED_FLAGS) {
    assert.equal(compilerOptions[flag], true, `${flag} must be true`);
  }
  assert.equal(compilerOptions.target, 'ES2023');
});

test('node.json uses NodeNext', () => {
  const { compilerOptions, extends: parent } = readJson('node.json');
  assert.equal(parent, './base.json');
  assert.equal(compilerOptions.module, 'NodeNext');
  assert.equal(compilerOptions.moduleResolution, 'NodeNext');
});

test('nextjs.json uses bundler resolution and preserves JSX', () => {
  const { compilerOptions } = readJson('nextjs.json');
  assert.equal(compilerOptions.moduleResolution, 'Bundler');
  assert.equal(compilerOptions.jsx, 'preserve');
});

test('library.json emits declarations and is composite', () => {
  const { compilerOptions } = readJson('library.json');
  assert.equal(compilerOptions.declaration, true);
  assert.equal(compilerOptions.composite, true);
});

test('no config turns a required flag off', () => {
  for (const name of ['node.json', 'nextjs.json', 'library.json']) {
    const { compilerOptions } = readJson(name);
    for (const flag of REQUIRED_FLAGS) {
      assert.notEqual(compilerOptions[flag], false, `${name} must not disable ${flag}`);
    }
  }
});
