// Tests for lib/lock-lint.mjs: the lint of the pnpm lock text that the push guard runs before it
// lets an agent push a changed lock (F2), and the check of repo-state.json.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lockProblems, parseLock, repositoryStateIsPlain } from '../lib/lock-lint.mjs';

const HASH_A =
  'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
const HASH_B =
  'sha512-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB==';
const HASH_C =
  'sha512-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC==';

const LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false
  excludeLinksFromLockfile: false

overrides:
  handlebars: ^4.7.10

pnpmfileChecksum: sha256-FceiOBivXBfnQ6+mNFF4or5E/6NvJXB3oz3cjl5O7OM=

importers:

  .: {}

  ../../projects/x:
    dependencies:
      '@vprprudhvi/shared':
        specifier: workspace:*
        version: link:../../packages/shared
      zod:
        specifier: ^3.0.0
        version: 3.23.8
      string-width-cjs:
        specifier: ^4.0.0
        version: string-width@4.2.3

  ../../packages/shared: {}

packages:

  '@scope/pkg@1.2.3-beta.1':
    resolution: {integrity: ${HASH_B}}
    engines: {node: ^22.22.2 || >=26.0.0}
    deprecated: Use https://example.com/new instead

  string-width@4.2.3:
    resolution: {integrity: ${HASH_C}}

  zod@3.23.8:
    resolution: {integrity: ${HASH_A}}
    engines: {node: '>=18'}

snapshots:

  '@scope/pkg@1.2.3-beta.1(zod@3.23.8)':
    dependencies:
      zod: 3.23.8
      string-width-cjs: string-width@4.2.3
    optionalDependencies:
      zod: 3.23.8
    transitivePeerDependencies:
      - zod

  string-width@4.2.3: {}

  zod@3.23.8: {}
`;

const problemsOf = (change, base = LOCK) => lockProblems(base, change(base));
const rejects = (change, pattern) => {
  const found = problemsOf(change);
  assert.ok(found.length > 0, 'the lint found nothing');
  if (pattern !== undefined) {
    assert.match(found.join('\n'), pattern);
  }
};

describe('lockProblems: a generated lock', () => {
  it('has no problem, alone or against itself', () => {
    assert.deepEqual(parseLock(LOCK).problems, []);
    assert.deepEqual(lockProblems(LOCK, LOCK), []);
  });

  it('accepts a new package, a removed package and a version bump', () => {
    const added = `  'left-pad@1.3.0':\n    resolution: {integrity: ${HASH_B}}\n\n`;
    assert.deepEqual(
      problemsOf((lock) =>
        lock.replace('  string-width@4.2.3:\n    res', `${added}  string-width@4.2.3:\n    res`),
      ),
      [],
    );
    assert.deepEqual(
      problemsOf((lock) =>
        lock
          .replace('zod@3.23.8:\n    resolution', 'zod@3.24.0:\n    resolution')
          .replace('zod@3.23.8: {}', 'zod@3.24.0: {}')
          .replaceAll('3.23.8', '3.24.0')
          .replace(HASH_A, HASH_B),
      ),
      [],
    );
    assert.deepEqual(parseLock('lockfileVersion: 9\n').problems, []);
    assert.deepEqual(
      lockProblems('lockfileVersion: 9\n', 'lockfileVersion: 9\npackages: {}\n'),
      [],
    );
  });

  it('reads the packages of a lock', () => {
    const { packages } = parseLock(LOCK);
    assert.deepEqual(
      [...packages.keys()],
      ['@scope/pkg@1.2.3-beta.1', 'string-width@4.2.3', 'zod@3.23.8'],
    );
    assert.equal(packages.get('zod@3.23.8'), HASH_A);
  });
});

describe('lockProblems: a package from a tarball, git or directory (F2)', () => {
  it('rejects a tarball resolution with the registry key', () => {
    rejects(
      (lock) => lock.replace(`{integrity: ${HASH_A}}`, '{tarball: https://evil.example/zod.tgz}'),
      /not registry-only|no resolution/,
    );
  });

  it('rejects a tarball resolution that keeps an integrity hash', () => {
    rejects(
      (lock) =>
        lock.replace(
          `{integrity: ${HASH_A}}`,
          `{integrity: ${HASH_A}, tarball: https://evil.example/zod.tgz}`,
        ),
      /not registry-only|no resolution/,
    );
  });

  it('rejects a tarball package (URL key, tarball resolution, version key)', () => {
    rejects(
      (lock) =>
        lock.replace(
          '  zod@3.23.8:\n    resolution',
          `  'zod@https://evil.example/zod.tgz':\n    resolution: {tarball: https://evil.example/zod.tgz}\n    version: 3.23.8\n\n  zod@3.23.8:\n    resolution`,
        ),
      /not a registry package|not registry-only/,
    );
  });

  it('rejects a git package', () => {
    rejects(
      (lock) =>
        lock.replace(
          '  zod@3.23.8:\n    resolution',
          `  zod@github.com/evil/zod/0123456789abcdef0123456789abcdef01234567:\n    resolution: {commit: 0123456789abcdef0123456789abcdef01234567, repo: https://github.com/evil/zod.git, type: git}\n    version: 3.23.8\n\n  zod@3.23.8:\n    resolution`,
        ),
      /not a registry package|not registry-only/,
    );
    rejects(
      (lock) =>
        lock.replace(
          "'@scope/pkg@1.2.3-beta.1':",
          "'@scope/pkg@git+https://evil.example/pkg.git':",
        ),
      /not a registry package/,
    );
    rejects(
      (lock) => lock.replace('zod@3.23.8:\n    res', "'zod@github:evil/zod':\n    res"),
      /not a registry package/,
    );
  });

  it('rejects a directory resolution and a resolution of another shape', () => {
    rejects(
      (lock) => lock.replace(`{integrity: ${HASH_A}}`, '{directory: ../../evil, type: directory}'),
      /not registry-only|no resolution/,
    );
    rejects(
      (lock) =>
        lock.replace(
          `    resolution: {integrity: ${HASH_A}}`,
          `    resolution:\n      integrity: ${HASH_A}`,
        ),
      /not registry-only|no resolution/,
    );
    rejects(
      (lock) => lock.replace(`{integrity: ${HASH_A}}`, `{integrity: not-a-hash}`),
      /not registry-only|no resolution/,
    );
  });

  it('rejects a package without a resolution, and one with two', () => {
    rejects(
      (lock) => lock.replace(`    resolution: {integrity: ${HASH_A}}\n`, ''),
      /no resolution/,
    );
    rejects(
      (lock) =>
        lock.replace(
          `    resolution: {integrity: ${HASH_A}}\n`,
          `    resolution: {integrity: ${HASH_A}}\n    resolution: {integrity: ${HASH_B}}\n`,
        ),
      /more than one resolution/,
    );
  });

  it('rejects the same key twice, and a key that is not readable', () => {
    rejects(
      (lock) =>
        lock.replace(
          'snapshots:\n',
          `  zod@3.23.8:\n    resolution: {integrity: ${HASH_A}}\n\nsnapshots:\n`,
        ),
      /twice/,
    );
    rejects(
      (lock) => lock.replace("'@scope/pkg@1.2.3-beta.1':", '"@scope/pkg@1.2.3-beta.1":'),
      /not readable/,
    );
  });
});

describe('lockProblems: a changed integrity (F2)', () => {
  it('rejects a new hash for a package that the old lock has', () => {
    rejects((lock) => lock.replace(HASH_A, HASH_B), /integrity of "zod@3\.23\.8" changed/);
  });

  it('rejects a package that swaps its hash with another package', () => {
    rejects(
      (lock) =>
        lock.replace(HASH_A, 'sha512-TEMP').replace(HASH_C, HASH_A).replace('sha512-TEMP', HASH_C),
      /integrity of/,
    );
  });
});

describe('lockProblems: the header and the settings (F2)', () => {
  it('rejects a change of the lockfile version, the settings, the overrides or the pnpmfile checksum', () => {
    rejects((lock) => lock.replace("'9.0'", "'9.1'"), /header/);
    rejects(
      (lock) => lock.replace('excludeLinksFromLockfile: false', 'excludeLinksFromLockfile: true'),
      /header/,
    );
    rejects(
      (lock) => lock.replace('handlebars: ^4.7.10', 'handlebars: github:evil/handlebars'),
      /header/,
    );
    rejects((lock) => lock.replace('FceiOBivXBfnQ6', 'FceiOBivXBfnQ7'), /header/);
  });

  it('rejects a registry setting that is added to the header', () => {
    rejects(
      (lock) => lock.replace('settings:\n', 'settings:\n  registry: https://evil.example/\n'),
      /header/,
    );
  });

  it('rejects a lock that has another top-level section', () => {
    rejects(
      (lock) => `${lock}\npatchedDependencies:\n  zod@3.23.8:\n    path: patches/zod.patch\n`,
      /top-level key/,
    );
  });

  it('rejects text that is not a lock, and a carriage return', () => {
    rejects(() => 'packages: {}\n', /does not start with lockfileVersion/);
    rejects((lock) => lock.replaceAll('\n', '\r\n'), /carriage return/);
  });
});

describe('lockProblems: importers and snapshots', () => {
  it('rejects a link that leaves the workspace folders', () => {
    rejects(
      (lock) => lock.replace('link:../../packages/shared', 'link:../../../../etc'),
      /leaves the workspace/,
    );
    rejects(
      (lock) => lock.replace('link:../../packages/shared', 'link:../../common/temp/node_modules/x'),
      /leaves the workspace/,
    );
    rejects(
      (lock) => lock.replace('link:../../packages/shared', 'link:/etc'),
      /leaves the workspace/,
    );
  });

  it('accepts a link to a project, a package, a platform folder and a tooling folder', () => {
    for (const folder of ['projects/y', 'packages/z', 'platform/infra', 'tooling/eslint-config']) {
      assert.deepEqual(
        problemsOf((lock) => lock.replace('link:../../packages/shared', `link:../../${folder}`)),
        [],
        folder,
      );
    }
  });

  it('rejects a git, github, URL, tarball or npm alias specifier', () => {
    for (const specifier of [
      'github:evil/zod',
      'evil/zod',
      'git+https://evil.example/zod.git',
      'https://evil.example/zod.tgz',
      'file:../evil',
      'npm:evil@1.0.0',
      '^3.0.0#abcdef',
      'zod.tgz',
    ]) {
      rejects((lock) => lock.replace('specifier: ^3.0.0', `specifier: ${specifier}`), /specifier/);
    }
  });

  it('rejects an importer version that is a URL, a git source or an alias', () => {
    rejects(
      (lock) =>
        lock.replace(
          'version: 3.23.8\n      string',
          'version: https://evil.example/zod.tgz\n      string',
        ),
      /registry version/,
    );
    rejects(
      (lock) =>
        lock.replace(
          'version: 3.23.8\n      string',
          'version: github.com/evil/zod/0123456789abcdef\n      string',
        ),
      /registry version/,
    );
    rejects(
      (lock) => lock.replace('version: string-width@4.2.3', 'version: string-width@github:evil/x'),
      /registry version/,
    );
  });

  it('rejects a snapshot dependency that is a URL, a git source or a link', () => {
    rejects(
      (lock) =>
        lock.replace(
          '      zod: 3.23.8\n      string-width-cjs',
          '      zod: https://evil.example/zod.tgz\n      string-width-cjs',
        ),
      /registry version/,
    );
    rejects(
      (lock) =>
        lock.replace(
          '      zod: 3.23.8\n      string-width-cjs',
          '      zod: link:../../packages/shared\n      string-width-cjs',
        ),
      /link inside snapshots/,
    );
    rejects(
      (lock) =>
        lock.replace(
          '    optionalDependencies:\n      zod: 3.23.8',
          '    optionalDependencies:\n      zod: github:evil/zod',
        ),
      /registry version/,
    );
  });

  it('rejects a snapshot key that is not a registry package', () => {
    rejects(
      (lock) => lock.replace('  zod@3.23.8: {}', "  'zod@https://evil.example/zod.tgz': {}"),
      /not a registry package/,
    );
  });
});

describe('lockProblems: own-scope packages (N3)', () => {
  it('accepts an own-scope dependency that is a link: to a workspace folder', () => {
    assert.match(LOCK, /'@vprprudhvi\/shared':\n {8}specifier: workspace:\*\n {8}version: link:/);
    assert.deepEqual(parseLock(LOCK).problems, []);
  });

  it('rejects an own-scope key in packages, in any letter case', () => {
    const added = (name) =>
      `  '${name}@1.0.0':\n    resolution: {integrity: ${HASH_B}}\n\n  zod@3.23.8:\n    res`;
    rejects(
      (lock) => lock.replace('  zod@3.23.8:\n    res', added('@vprprudhvi/shared')),
      /own-scope package/,
    );
    rejects(
      (lock) => lock.replace('  zod@3.23.8:\n    res', added('@VprPrudhvi/shared')),
      /own-scope package/,
    );
  });

  it('rejects an own-scope key in snapshots', () => {
    rejects(
      (lock) => lock.replace('  zod@3.23.8: {}', "  '@vprprudhvi/shared@1.0.0': {}"),
      /own-scope package/,
    );
  });

  it('rejects an own-scope importer dependency that is a registry version', () => {
    rejects(
      (lock) => lock.replace('version: link:../../packages/shared', 'version: 1.0.0'),
      /own-scope dependency/,
    );
    rejects(
      (lock) => lock.replace('version: link:../../packages/shared', "version: 'zod@3.23.8'"),
      /own-scope dependency/,
    );
  });

  it('rejects an alias to an own-scope package, in importers and in snapshots', () => {
    rejects(
      (lock) => lock.replace('version: string-width@4.2.3', "version: '@vprprudhvi/evil@1.0.0'"),
      /alias to an own-scope/,
    );
    rejects(
      (lock) =>
        lock.replace(
          '      string-width-cjs: string-width@4.2.3\n',
          "      string-width-cjs: '@vprprudhvi/evil@1.0.0'\n",
        ),
      /alias to an own-scope/,
    );
  });

  it('rejects an own-scope dependency name in snapshots', () => {
    rejects(
      (lock) =>
        lock.replace(
          '      zod: 3.23.8\n      string',
          "      '@vprprudhvi/shared': 1.0.0\n      string",
        ),
      /own-scope dependency/,
    );
  });

  it('keeps a dependency name from leaking into the next importer entry', () => {
    const next = LOCK.replace(
      '  ../../packages/shared: {}',
      '  ../../packages/other:\n    devDependencies:\n      zod:\n        specifier: ^3.0.0\n        version: 3.23.8\n\n  ../../packages/shared: {}',
    );
    assert.deepEqual(parseLock(next).problems, []);
  });
});

describe('repositoryStateIsPlain', () => {
  const repositoryState = `// DO NOT MODIFY THIS FILE MANUALLY BUT DO COMMIT IT. It is generated and used by Rush.
{
  "pnpmShrinkwrapHash": "00cbf822b43f8ceeabc186b34e4c7c0099004c94",
  "preferredVersionsHash": "bf21a9e8fbc5a3846fb05b4fa0859e0917b2202f"
}
`;

  it('accepts the file that Rush writes', () => {
    assert.equal(repositoryStateIsPlain(repositoryState), true);
    assert.equal(
      repositoryStateIsPlain('{"pnpmShrinkwrapHash":"00cbf822b43f8ceeabc186b34e4c7c0099004c94"}'),
      true,
    );
  });

  it('rejects another key, a value that is not a hash, an array, and a broken text', () => {
    assert.equal(
      repositoryStateIsPlain(repositoryState.replace('"preferredVersionsHash"', '"extra"')),
      false,
    );
    assert.equal(
      repositoryStateIsPlain(
        repositoryState.replace('00cbf822b43f8ceeabc186b34e4c7c0099004c94', 'not a hash'),
      ),
      false,
    );
    assert.equal(
      repositoryStateIsPlain(
        repositoryState.replace('"bf21a9e8fbc5a3846fb05b4fa0859e0917b2202f"', '1'),
      ),
      false,
    );
    assert.equal(repositoryStateIsPlain('[]'), false);
    assert.equal(repositoryStateIsPlain('null'), false);
    assert.equal(repositoryStateIsPlain('{'), false);
    assert.equal(repositoryStateIsPlain(''), false);
  });
});
