import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

/** The time that the app import and synth can take when other projects build at the same time. */
const STACK_TIMEOUT_MS = 30_000;

describe('bin/app', () => {
  it(
    'synthesizes the stack',
    async () => {
      const outdir = mkdtempSync(join(tmpdir(), 'national-parks-tracker-bin-'));
      vi.stubEnv('CDK_OUTDIR', outdir);
      vi.resetModules();

      await import('../../../bin/app.js');

      expect(existsSync(join(outdir, 'NationalParksTracker.template.json'))).toBe(true);
    },
    STACK_TIMEOUT_MS,
  );
});
