import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// The context turns bundling off, so the app synthesizes without esbuild, Go or uv.
const NO_BUNDLING = { 'aws:cdk:bundling-stacks': [] };

/** The time that one stack build can take: it hashes the Python and Go code. */
const STACK_TIMEOUT_MS = 30_000;

describe('bin/app', () => {
  it(
    'reads the environment from the CDK context and synthesizes',
    async () => {
      const outdir = mkdtempSync(join(tmpdir(), 'sample-bin-'));
      vi.stubEnv('CDK_OUTDIR', outdir);
      vi.stubEnv('CDK_CONTEXT_JSON', JSON.stringify({ ...NO_BUNDLING, env: 'local' }));
      vi.resetModules();

      await import('../../../bin/app.js');

      expect(existsSync(join(outdir, 'SampleApi-local.template.json'))).toBe(true);
    },
    STACK_TIMEOUT_MS,
  );

  it('fails without the env context', async () => {
    vi.stubEnv('CDK_OUTDIR', mkdtempSync(join(tmpdir(), 'sample-bin-')));
    vi.stubEnv('CDK_CONTEXT_JSON', JSON.stringify(NO_BUNDLING));
    vi.resetModules();

    await expect(import('../../../bin/app.js')).rejects.toThrow(/-c env=local/);
  });
});
