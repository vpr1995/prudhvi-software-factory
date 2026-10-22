import { describe, expect, it, vi } from 'vitest';

import { COVERAGE_THRESHOLDS, createVitestConfig } from './config.js';

describe('createVitestConfig', () => {
  it('uses v8 coverage with the fixed thresholds', () => {
    const config = createVitestConfig();

    expect(config.test?.coverage).toMatchObject({
      provider: 'v8',
      reportsDirectory: 'coverage',
      thresholds: { lines: 80, branches: 75, functions: 80, statements: 80 },
    });
  });

  it('writes lcov output', () => {
    const config = createVitestConfig();

    expect(config.test?.coverage?.reporter).toContain('lcov');
  });

  it('keeps the thresholds at the agreed minimum', () => {
    expect(COVERAGE_THRESHOLDS).toStrictEqual({
      lines: 80,
      branches: 75,
      functions: 80,
      statements: 80,
    });
  });

  it('defaults to the node environment and applies overrides', () => {
    expect(createVitestConfig().test?.environment).toBe('node');
    expect(createVitestConfig({ environment: 'jsdom' }).test?.environment).toBe('jsdom');
  });

  it('adds setup files and extra coverage excludes', () => {
    const config = createVitestConfig({
      setupFiles: ['./setup.ts'],
      coverageExclude: ['src/generated/**'],
    });

    expect(config.test?.setupFiles).toStrictEqual(['./setup.ts']);
    expect(config.test?.coverage?.exclude).toContain('src/generated/**');
  });

  it('adds the junit reporter only in continuous integration', async () => {
    expect(createVitestConfig().test?.reporters).toContain('default');
    vi.stubEnv('CI', 'true');
    vi.resetModules();
    const { createVitestConfig: freshFactory } = await import('./config.js');

    expect(freshFactory().test?.reporters).toContain('junit');
  });
});
