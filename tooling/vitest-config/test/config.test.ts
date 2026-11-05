import { describe, expect, it, vi } from 'vitest';
import type { TestProjectInlineConfiguration } from 'vitest/config';

import { COVERAGE_THRESHOLDS, createAppVitestConfig, createVitestConfig } from '../src/config.js';

/** Reads the inline test sets of an app config. */
function appProjects(options?: Parameters<typeof createAppVitestConfig>[0]): {
  readonly node: TestProjectInlineConfiguration | undefined;
  readonly web: TestProjectInlineConfiguration | undefined;
  readonly count: number;
} {
  const projects = (createAppVitestConfig(options).test?.projects ??
    []) as TestProjectInlineConfiguration[];
  return {
    count: projects.length,
    node: projects.find((project) => project.test?.name === 'node'),
    web: projects.find((project) => project.test?.name === 'web'),
  };
}

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

describe('createAppVitestConfig', () => {
  const { lines, branches, functions, statements } = COVERAGE_THRESHOLDS;
  const folderThresholds = { lines, branches, functions, statements };

  it('keeps the fixed settings of createVitestConfig', () => {
    const { test } = createAppVitestConfig();

    expect(test?.coverage).toMatchObject({ provider: 'v8', reportsDirectory: 'coverage' });
    expect(test?.coverage?.thresholds).toMatchObject(COVERAGE_THRESHOLDS);
    expect(test?.reporters).toContain('default');
    expect(test?.outputFile).toStrictEqual({ junit: 'coverage/junit.xml' });
    expect(appProjects().node?.test).toMatchObject({ restoreMocks: true, unstubEnvs: true });
  });

  it('runs one node set that skips test/web when web is off', () => {
    const { node, web, count } = appProjects();

    expect(count).toBe(1);
    expect(web).toBeUndefined();
    expect(node?.test).toMatchObject({
      name: 'node',
      environment: 'node',
      include: ['test/**/*.test.{ts,tsx,js}'],
    });
    expect(node?.test?.exclude).toStrictEqual(
      expect.arrayContaining([
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        'web/e2e/**',
        'test/web/**',
      ]),
    );
  });

  it('adds a jsdom web set when web is on', () => {
    const { node, web, count } = appProjects({ web: true });

    expect(count).toBe(2);
    expect(node?.test?.exclude).toContain('test/web/**');
    expect(web?.esbuild).toStrictEqual({ jsx: 'automatic' });
    expect(web?.test).toMatchObject({
      name: 'web',
      environment: 'jsdom',
      setupFiles: ['./test/web/setup.ts'],
      include: ['test/web/**/*.test.{ts,tsx}'],
    });
    expect(web?.test?.exclude).not.toContain('test/web/**');
  });

  it('uses a 30 000 ms test timeout and lets a project override it', () => {
    expect(appProjects({ web: true }).node?.test?.testTimeout).toBe(30_000);
    expect(appProjects({ web: true }).web?.test?.testTimeout).toBe(30_000);
    expect(appProjects({ testTimeout: 60_000 }).node?.test?.testTimeout).toBe(60_000);
  });

  it('sets the alias on both test sets', () => {
    const alias = { '@npt/visits': '/data/visits.json' };
    const { node, web } = appProjects({ web: true, alias });

    expect(node?.resolve?.alias).toStrictEqual(alias);
    expect(web?.resolve?.alias).toStrictEqual(alias);
    expect(appProjects().node?.resolve?.alias).toStrictEqual({});
  });

  it('measures src, bin and lib, and web only when web is on', () => {
    expect(createAppVitestConfig().test?.coverage?.include).toStrictEqual([
      'src/**/*.ts',
      'bin/**/*.ts',
      'lib/**/*.ts',
    ]);
    expect(createAppVitestConfig({ web: true }).test?.coverage?.include).toContain(
      'web/**/*.{ts,tsx}',
    );
  });

  it('excludes tests, type files, web build output and the extra globs from coverage', () => {
    const exclude = createAppVitestConfig({ coverageExclude: ['src/generated/**'] }).test?.coverage
      ?.exclude;

    expect(exclude).toStrictEqual(
      expect.arrayContaining([
        '**/*.test.{ts,tsx,js,jsx}',
        '**/*.d.ts',
        'web/next.config.ts',
        'web/e2e/**',
        'web/.next/**',
        'web/out/**',
        'web/out-e2e/**',
        'src/generated/**',
      ]),
    );
  });

  it('applies the global thresholds again to each folder', () => {
    expect(createAppVitestConfig().test?.coverage?.thresholds).toStrictEqual({
      ...COVERAGE_THRESHOLDS,
      'src/**': folderThresholds,
      'lib/**': folderThresholds,
    });
    expect(createAppVitestConfig({ web: true }).test?.coverage?.thresholds).toStrictEqual({
      ...COVERAGE_THRESHOLDS,
      'src/**': folderThresholds,
      'lib/**': folderThresholds,
      'web/**': folderThresholds,
    });
  });
});
