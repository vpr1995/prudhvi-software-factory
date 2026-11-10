import { describe, expect, it } from 'vitest';

import { loadWebConfig } from '../../web/config';

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
});
