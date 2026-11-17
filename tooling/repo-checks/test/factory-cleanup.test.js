// Tests for the factory clean-up (design factory-daily-run 8, task 8, #102).
// R-52: pre-pr does not run the built-in `code-review` pass. The test reads the real skill file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readRepositoryFile } from '../scripts/lib/fs-io.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PRE_PR = '.claude/skills/pre-pr/SKILL.md';

test('#102 R-52: the pre-pr skill does not name the built-in code-review pass', () => {
  const text = readRepositoryFile(ROOT, PRE_PR);
  assert.doesNotMatch(text, /code-review/);
});

test('#102 R-52: the no-ticket path of pre-pr still runs bug-hunt, simplify, and security-review', () => {
  const text = readRepositoryFile(ROOT, PRE_PR);
  const line = text.split('\n').find((row) => row.includes('No ticket, so no route output'));
  assert.ok(line, 'the no-ticket line exists');
  assert.match(line, /`bug-hunt`/);
  assert.match(line, /`simplify`/);
  assert.match(line, /`security-review`/);
});
