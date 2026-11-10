import { describe, expect, it } from 'vitest';

import { loadFlagEnvironment, loadWebConfig } from '../../web/config';

describe('loadWebConfig', () => {
  it('uses the default export folder when nothing is set', () => {
    expect(loadWebConfig({})).toEqual({ outDir: undefined });
    expect(loadWebConfig({ PORTFOLIO_OUT_DIR: '' })).toEqual({ outDir: undefined });
  });

  it('accepts the e2e export folder', () => {
    expect(loadWebConfig({ PORTFOLIO_OUT_DIR: 'out-e2e' })).toEqual({ outDir: 'out-e2e' });
  });

  it.each(['../out', 'dist', 'out/x', 'OUT', 'out-E2E'])(
    'rejects the export folder %s',
    (value) => {
      expect(() => loadWebConfig({ PORTFOLIO_OUT_DIR: value })).toThrow(
        'Use a folder name that starts with',
      );
    },
  );

  it('reads the process environment by default', () => {
    expect(loadWebConfig()).toHaveProperty('outDir');
  });

  it('passes only the FLAG_ variables to the flag provider', () => {
    expect(
      loadFlagEnvironment({
        FLAG_PORTFOLIO_CHAT: 'true',
        PORTFOLIO_OUT_DIR: 'out-e2e',
        SECRET_TOKEN: 'not-a-flag',
      }),
    ).toEqual({ FLAG_PORTFOLIO_CHAT: 'true' });
  });

  it('returns an empty flag record when no flag is set', () => {
    expect(loadFlagEnvironment({ PORTFOLIO_OUT_DIR: 'out-e2e' })).toEqual({});
  });
});
