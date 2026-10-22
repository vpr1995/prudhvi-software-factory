// The hooks skip only real build and vendor folders. A source folder that is named temp (or
// coverage, under src) is code, so Opengrep, the post-edit lint and anti-skip must see it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldSkipFile } from '../lib/project-tools.mjs';

describe('scan scope', () => {
  it('skips build and vendor folders', () => {
    for (const file of [
      'projects/x/web/node_modules/a/index.js',
      'projects/x/web/dist/a.js',
      'projects/x/web/.next/server/a.js',
      'projects/x/api/coverage/lcov.info',
      'common/temp/pnpm-lock.yaml',
      'projects/x/api-py/.venv/lib/a.py',
      'projects/x/api-py/src/__pycache__/a.py',
      'projects/x/web/test-results/a.json',
      'projects/x/web/playwright-report/index.html',
      '.claude/state/last-verify.json',
    ]) {
      assert.equal(shouldSkipFile(file), true, file);
    }
  });

  it('scans source in a folder that is only named temp', () => {
    for (const file of [
      'projects/x/web/src/app/temp/page.tsx',
      'projects/x/web/app/temp/page.tsx',
      'projects/x/api-go/internal/temp/x.go',
      'projects/x/infra/lib/temp/stack.ts',
      'packages/logger/temp/a.ts',
      'projects/x/api/src/coverage/a.ts',
    ]) {
      assert.equal(shouldSkipFile(file), false, file);
    }
  });
});
