import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findRepositoryRoot } from '../src/repository-root.js';

import { PATHS } from './support/functions.js';

describe('findRepositoryRoot', () => {
  it('finds this repo root from this package', () => {
    expect(findRepositoryRoot()).toBe(PATHS.nodeProjectRoot);
  });

  it('finds the repo root from a module in src', () => {
    expect(findRepositoryRoot('file:///work/repo/packages/cdk-constructs/src/index.ts')).toBe(
      '/work/repo',
    );
  });

  it('finds the repo root from a module in dist', () => {
    expect(
      findRepositoryRoot(new URL('file:///work/repo/packages/cdk-constructs/dist/index.js')),
    ).toBe('/work/repo');
  });

  it('throws a clear error for a module outside packages/cdk-constructs/src or dist', () => {
    const foreign = pathToFileURL('/work/repo/node_modules/cdk-constructs/lib/index.js');

    expect(() => findRepositoryRoot(foreign)).toThrow(
      /Expected a module in packages\/cdk-constructs\/src or packages\/cdk-constructs\/dist, got: \/work\/repo\/node_modules\/cdk-constructs\/lib\. Set projectRoot and depsLockFilePath\./,
    );
    expect(() => findRepositoryRoot('file:///work/repo/packages/cdk-constructs/test/x.ts')).toThrow(
      /Set projectRoot and depsLockFilePath/,
    );
  });
});
