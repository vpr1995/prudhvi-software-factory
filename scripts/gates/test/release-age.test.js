// The pnpm minimum release age must stay off (owner decision, 2026-10-25). pnpm also applies it to
// versions that the lock already pins, so `rush install` on a fresh tree fails with
// ERR_PNPM_NO_MATURE_MATCHING_VERSION when the lock pins a version that is newer than the age.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { REPOSITORY } from './harness.js';

const RUSH_CONFIG = path.join(REPOSITORY, 'common', 'config', 'rush');

/**
 * Returns the lines that set a release age, without comment lines.
 *
 * @param {string} text - File text.
 * @returns {string[]} Setting lines.
 */
function releaseAgeSettings(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#') && !line.startsWith('*') && !line.startsWith('//'))
    .filter((line) => /minimum-?release-?age/i.test(line));
}

describe('release age', () => {
  it('finds a setting line and skips a comment line', () => {
    assert.deepEqual(releaseAgeSettings('# minimum-release-age=1\nminimum-release-age=10080\n'), [
      'minimum-release-age=10080',
    ]);
    assert.deepEqual(releaseAgeSettings('"minimumReleaseAge": 4320,'), [
      '"minimumReleaseAge": 4320,',
    ]);
  });

  for (const file of ['.npmrc', 'pnpm-config.json']) {
    it(`is not set in common/config/rush/${file}`, () => {
      const text = fs.readFileSync(path.join(RUSH_CONFIG, file), 'utf8');
      assert.deepEqual(releaseAgeSettings(text), []);
    });
  }
});
