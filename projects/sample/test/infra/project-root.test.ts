import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findProjectRoot } from '../../lib/project-root.js';

describe('findProjectRoot', () => {
  it('finds the project folder from this module', () => {
    const root = findProjectRoot();

    expect(existsSync(join(root, 'package.json'))).toBe(true);
    expect(existsSync(join(root, 'src', 'contracts'))).toBe(true);
  });

  it('finds it from the compiled app folder', () => {
    expect(findProjectRoot(pathToFileURL('/work/sample/dist/cdk/lib/x.js'))).toBe('/work/sample');
  });

  it('finds it from the source folder', () => {
    expect(findProjectRoot(pathToFileURL('/work/sample/lib/x.ts'))).toBe('/work/sample');
  });

  it.each(['/work/sample/x.js', '/work/sample/lib/config/x.js', '/work/sample/mylib/x.js'])(
    'throws for a module in %s',
    (path) => {
      expect(() => findProjectRoot(pathToFileURL(path))).toThrow(/Expected a module in lib/);
    },
  );
});
