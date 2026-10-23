import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  base,
  boundaries,
  cdk,
  createRootConfig,
  next,
  node,
  react,
  scope,
  test,
} from '../src/index.js';

import { BOUNDARY_CASES, SUPPORT_FILES } from './boundary-fixtures.js';
import { CASES } from './fixtures.js';

const TSCONFIG = {
  extends: new URL('../../tsconfig/base.json', import.meta.url).pathname,
  compilerOptions: {
    module: 'ESNext',
    moduleResolution: 'Bundler',
    jsx: 'preserve',
    types: [],
    noEmit: true,
  },
  include: ['**/*.ts', '**/*.tsx'],
};

const allCases = [...CASES, ...BOUNDARY_CASES];

describe('shared ESLint config (gate fixtures)', () => {
  /** @type {string} */
  let root = '';
  /** @type {Map<string, string[]>} */
  const ruleIdsByFile = new Map();

  beforeAll(async () => {
    // realpath: on macOS the temp dir is a symlink and boundaries compares real paths.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eslint-fixtures-')));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixtures', private: true, type: 'module' }),
    );
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(TSCONFIG));
    // typescript-eslint resolves `typescript` from the fixture root; link the real install.
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(
      new URL('../node_modules/typescript', import.meta.url).pathname,
      join(root, 'node_modules', 'typescript'),
    );
    const files = {
      ...SUPPORT_FILES,
      ...Object.fromEntries(allCases.map((entry) => [entry.file, entry.code])),
    };
    for (const [file, code] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), code);
    }
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: createRootConfig({ rootPath: root }),
    });
    const results = await eslint.lintFiles(allCases.map((entry) => join(root, entry.file)));
    for (const result of results) {
      const file = result.filePath.slice(root.length + 1);
      ruleIdsByFile.set(
        file,
        result.messages.map(
          (message) => message.ruleId ?? (message.fatal ? 'parse-error' : '(directive)'),
        ),
      );
    }
  }, 120_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each(allCases)('$name', ({ file, expect: expected }) => {
    const found = ruleIdsByFile.get(file) ?? [];

    if (expected.length === 0) {
      expect(found).toStrictEqual([]);
    } else {
      expect(found).toEqual(expect.arrayContaining([...expected]));
    }
  });
});

describe('config exports', () => {
  it('exports non-empty flat config arrays', () => {
    for (const config of [base, cdk, next, node, react, test, boundaries()]) {
      expect(Array.isArray(config)).toBe(true);
      expect(config.length).toBeGreaterThan(0);
    }
  });

  it('scope keeps global blocks and restricts rule blocks', () => {
    const scoped = scope(
      ['a/**'],
      [{ ignores: ['x'] }, { files: ['**/*.ts'], rules: {} }, { rules: {} }],
    );

    expect(scoped[0]).toStrictEqual({ ignores: ['x'] });
    expect(scoped[1]?.files).toStrictEqual([['a/**', '**/*.ts']]);
    expect(scoped[2]?.files).toStrictEqual(['a/**']);
  });
});
