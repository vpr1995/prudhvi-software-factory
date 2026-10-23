// Tests for the shared test helpers in harness.js.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { exec } from './harness.js';

describe('harness exec', () => {
  it('returns the status and the output of a program that ends in time', () => {
    const result = exec('bash', ['-c', 'echo out; echo err >&2; exit 3'], { timeout: 10_000 });
    assert.deepEqual(result, { status: 3, stdout: 'out\n', stderr: 'err\n' });
  });

  it('throws with the command when a stalled child runs longer than the timeout', () => {
    // A background grandchild keeps stdout open, like a stalled node child of a hook wrapper.
    const script = '(sleep 20; echo late) & echo started >&2; sleep 20; echo done';
    const start = Date.now();
    assert.throws(
      () => exec('bash', ['-c', script], { timeout: 500 }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /^exec: bash -c \(sleep 20; echo late\) & .* timed out after 500 ms/,
        );
        assert.match(error.message, /started/);
        return true;
      },
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 10_000, `exec returned after ${elapsed} ms, not soon after the timeout`);
  });
});
