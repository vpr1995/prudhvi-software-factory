import { describe, expect, it, vi } from 'vitest';

import { COVERAGE_THRESHOLDS, createVitestConfig } from '../src/config.js';

describe('createVitestConfig', () => {
  it('uses v8 coverage with the fixed thresholds', () => {
    const config = createVitestConfig();

    expect(config.test?.coverage).toMatchObject({
      provider: 'v8',
      reportsDirectory: 'coverage',
      thresholds: { lines: 80, branches: 75, functions: 80, statements: 80 },
    });
  });

  it('runs tests only from the test folder', () => {
    const config = createVitestConfig();

    expect(config.test?.include).toStrictEqual(['test/**/*.test.{ts,tsx,js,jsx}']);
  });

  it('measures coverage on the source folder and never on test files', () => {
    const coverage = createVitestConfig().test?.coverage;

    expect(coverage?.include).toStrictEqual(['src/**/*.{ts,tsx,js,jsx}']);
    expect(coverage?.exclude).toContain('src/**/*.test.{ts,tsx,js,jsx}');
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

  it('sets the test timeout when a project asks for one', () => {
    expect(createVitestConfig({ testTimeout: 30_000 }).test?.testTimeout).toBe(30_000);
  });

  it('keeps the Vitest default test timeout when the option is not set', () => {
    const test = createVitestConfig().test;

    expect(test?.testTimeout).toBeUndefined();
    expect(test).not.toHaveProperty('testTimeout');
  });

  it('adds the junit reporter only in continuous integration', async () => {
    expect(createVitestConfig().test?.reporters).toContain('default');
    vi.stubEnv('CI', 'true');
    vi.resetModules();
    const { createVitestConfig: freshFactory } = await import('../src/config.js');

    expect(freshFactory().test?.reporters).toContain('junit');
  });
});
