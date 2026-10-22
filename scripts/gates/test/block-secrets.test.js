import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { callHook, editCall, makeRepository } from './harness.js';

// Secret-like values are built at run time so that no scanner sees a real-looking secret in this file.
const AWS_KEY = ['AKIA', 'QWERTYUIOPASDFGH'].join('');
const AWS_DOC_KEY = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('');
const PRIVATE_KEY = ['-----BEGIN ', 'RSA PRIVATE KEY', '-----'].join('');
const GITHUB_TOKEN = ['ghp', '_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('');
const ENV_LINE = ['DB_', 'PASS', 'WORD=', 'Zq81xKd02LmNpQr7TuVw'].join('');

describe('block-secrets', () => {
  let repository;

  before(() => {
    repository = makeRepository();
  });

  after(() => repository.remove());

  const blocked = [
    ['an AWS access key id', `const key = '${AWS_KEY}';\n`],
    ['a private key header', `${PRIVATE_KEY}\nabc\n`],
    ['a GitHub token', `const t = '${GITHUB_TOKEN}';\n`],
    ['a secret in an env line', `${ENV_LINE}\n`],
  ];
  for (const [label, text] of blocked) {
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      it(`blocks ${label} through ${tool}`, () => {
        const result = callHook(
          'block-secrets',
          editCall(tool, `${repository.root}/packages/a/src/a.ts`, text),
          { root: repository.root },
        );
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /BLOCKED by block-secrets/);
        assert.ok(
          !result.stderr.includes(AWS_KEY) && !result.stderr.includes(GITHUB_TOKEN),
          'the message must not print the secret',
        );
      });
    }
  }

  const allowed = [
    ['plain code', 'export const answer = 42;\n'],
    ['the AWS documentation example key', `const key = '${AWS_DOC_KEY}';\n`],
    ['an env read', 'const name = process.env.DB_PASSWORD;\n'],
    ['a placeholder', 'DB_PASSWORD=changeme\n'],
  ];
  for (const [label, text] of allowed) {
    it(`allows ${label}`, () => {
      const result = callHook(
        'block-secrets',
        editCall('Write', `${repository.root}/packages/a/src/a.ts`, text),
        { root: repository.root },
      );
      assert.equal(result.status, 0, result.stderr);
    });
  }

  it('allows a call with no text', () => {
    assert.equal(
      callHook(
        'block-secrets',
        { toolName: 'Write', toolInput: { filePath: 'x' } },
        { root: repository.root },
      ).status,
      0,
    );
  });

  it('blocks when the input is not JSON (fail closed)', () => {
    assert.equal(callHook('block-secrets', '{{', { root: repository.root }).status, 2);
  });
});
