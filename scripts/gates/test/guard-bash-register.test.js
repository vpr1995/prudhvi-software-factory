// guard-bash and scripts/gates/register-project.mjs. The guard reads the script that an interpreter
// runs, and blocks it when the script can write a gate file. It does not read a script that is
// itself a gate file (bash-rules-files.mjs, scriptText): an agent cannot change such a script, so
// what it writes was decided by a human. register-project.mjs is under scripts/gates/**, so the
// guard allows it, and the same code at a path that is not a gate is still blocked.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { bashCall, callHook, makeRepository } from './harness.js';

const WRITES_RUSH_JSON = `import fs from 'node:fs';\nfs.writeFileSync('rush.json', '{}');\n`;

describe('guard-bash and register-project', () => {
  /** @type {ReturnType<typeof makeRepository>} */
  let repository;

  before(() => {
    repository = makeRepository({
      'scripts/gates/register-project.mjs': WRITES_RUSH_JSON,
      'tools/write-rush.mjs': WRITES_RUSH_JSON,
      'packages/a/src/write-rush.mjs': WRITES_RUSH_JSON,
    });
  });

  after(() => {
    repository.remove();
  });

  const guard = (command) => callHook('guard-bash', bashCall(command), { root: repository.root });

  for (const command of [
    'node scripts/gates/register-project.mjs demo',
    'node scripts/gates/register-project.mjs --remove demo',
    'node ./scripts/gates/register-project.mjs demo',
    'cd projects && node ../scripts/gates/register-project.mjs demo',
    'node scripts/gates/register-project.mjs demo && node common/scripts/install-run-rush.js update',
  ]) {
    it(`allows: ${command}`, () => {
      const result = guard(command);
      assert.equal(result.status, 0, result.stderr);
    });
  }

  for (const command of [
    'node tools/write-rush.mjs',
    'node packages/a/src/write-rush.mjs demo',
    'cd tools && node write-rush.mjs',
  ]) {
    it(`blocks another script that writes rush.json: ${command}`, () => {
      const result = guard(command);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /may write rush\.json, which is a gate file/);
    });
  }

  it('still blocks a direct write to rush.json next to the script', () => {
    const result = guard('node scripts/gates/register-project.mjs demo && echo x >> rush.json');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /writes rush\.json, which is a gate file/);
  });

  it('still blocks inline code that writes rush.json', () => {
    const result = guard(`node -e "require('fs').writeFileSync('rush.json', '{}')"`);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /may write rush\.json/);
  });
});
