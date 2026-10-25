// Tests for the typosquat check of new dependency names (lib/typosquat.mjs, typosquat-check.mjs).
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { changedSinceBase } from '../lib/dep-checks.mjs';
import {
  addedDependencies,
  buildKnownNames,
  changedDependencies,
  checkTyposquats,
  editDistance,
  findLookalike,
  flatName,
  formatProblem,
  isManifestPath,
  loadPopularNames,
  manifestFolders,
  readDependencies,
  readDependencySpecs,
  scopeOf,
  specProblem,
} from '../lib/typosquat.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'typosquat-check.mjs');

/**
 * Builds the known names from the data file and extra names.
 *
 * @param {string[]} [extra] - Names that the repo already has.
 * @param {string[]} [allowed] - Names that are never flagged.
 * @returns {import('../lib/typosquat.mjs').KnownNames} The tables.
 */
function known(extra = [], allowed = []) {
  return buildKnownNames([...loadPopularNames().packages, ...extra], allowed);
}

describe('edit distance', () => {
  it('counts insert, delete, replace and swap as one edit each', () => {
    assert.equal(editDistance('react', 'react'), 0);
    assert.equal(editDistance('react', 'reakt'), 1);
    assert.equal(editDistance('react', 'reac'), 1);
    assert.equal(editDistance('react', 'reactt'), 1);
    assert.equal(editDistance('react', 'raect'), 1);
    assert.equal(editDistance('ab', 'ba'), 1);
    assert.equal(editDistance('', 'abc'), 3);
    assert.equal(editDistance('typescript', 'typscrpt'), 2);
    assert.equal(editDistance('abc', 'xyz'), 3);
  });
});

describe('data file of known names', () => {
  it('has 150 to 300 different names, and an allow list', () => {
    const { packages, allow } = loadPopularNames();
    assert.ok(packages.length >= 150 && packages.length <= 300, String(packages.length));
    assert.equal(new Set(packages).size, packages.length);
    assert.ok(packages.every((name) => typeof name === 'string' && name.trim() === name));
    assert.ok(packages.includes('react') && packages.includes('@types/node'));
    assert.ok(Array.isArray(allow));
  });

  it('fails when the file is missing or has no lists', () => {
    assert.throws(() => loadPopularNames('/no/such/file.json'), /missing or has no "packages"/);
  });
});

describe('typosquat lookalikes', () => {
  it('passes an exact known name', () => {
    for (const name of ['react', 'lodash', 'express', 'fastify', 'zod', '@types/node']) {
      assert.equal(findLookalike(name, known()), null, name);
    }
  });

  it('fails a one-character typo', () => {
    assert.equal(findLookalike('reakt', known()), 'react');
    assert.equal(findLookalike('expresss', known()), 'express');
    assert.equal(findLookalike('lodas', known()), 'lodash');
    assert.equal(findLookalike('chalkk', known()), 'chalk');
  });

  it('fails a transposition', () => {
    assert.equal(findLookalike('lodahs', known()), 'lodash');
    assert.equal(findLookalike('axois', known()), 'axios');
    assert.equal(findLookalike('raect', known()), 'react');
  });

  it('allows two edits only for a name of 8 characters or more', () => {
    assert.equal(findLookalike('typscrpt', known()), 'typescript');
    assert.equal(findLookalike('reakts', known()), null);
  });

  it('passes a short name and an unrelated name', () => {
    assert.equal(findLookalike('qux', known()), null);
    assert.equal(findLookalike('zzyzx-widget', known()), null);
    assert.equal(findLookalike('wss', buildKnownNames(['ws'])), null);
    assert.equal(findLookalike('qz', buildKnownNames(['qs'])), null);
  });

  it('passes a dependency name that the repo already has, and flags a lookalike of it', () => {
    const names = ['zzz-internal-kit', '@zzz/shared-core'];
    assert.equal(findLookalike('zzz-internal-kit', known(names)), null);
    assert.equal(findLookalike('zzz-internal-kti', known(names)), 'zzz-internal-kit');
    assert.equal(findLookalike('zzz-internal-kit', known()), null);
  });

  it('never flags a name of the allow list', () => {
    assert.equal(findLookalike('reakt', known([], ['reakt'])), null);
    assert.equal(findLookalike('reakt', known()), 'react');
  });

  it('handles scoped names', () => {
    // A scope that is known: nobody else can publish in it.
    assert.equal(findLookalike('@types/nodee', known()), null);
    assert.equal(findLookalike('@aws-sdk/client-s3x', known()), null);
    assert.equal(findLookalike('@vprprudhvi/new', known(['@vprprudhvi/shared-logger'])), null);
    // A scope that looks like a known scope.
    assert.equal(findLookalike('@typs/node', known()), '@types/node');
    assert.equal(findLookalike('@tpyes/node', known()), '@types/node');
    // A scoped name written flat, or with the wrong separator.
    assert.equal(findLookalike('types-node', known()), '@types/node');
    assert.equal(findLookalike('@types-node', known()), '@types/node');
    assert.equal(findLookalike('aws-sdk-client-s3', known()), '@aws-sdk/client-s3');
    // A new scope that is far from every known name.
    assert.equal(findLookalike('@zzyzx/widget', known()), null);
  });

  it('splits scope and flat name', () => {
    assert.equal(scopeOf('@types/node'), '@types');
    assert.equal(scopeOf('react'), '');
    assert.equal(scopeOf('@types-node'), '');
    assert.equal(flatName('@types/node'), 'types-node');
    assert.equal(flatName('@types-node'), 'types-node');
    assert.equal(flatName('react'), 'react');
  });

  it('writes the message', () => {
    assert.equal(
      formatProblem({ file: 'projects/a/package.json', name: 'reakt', looksLike: 'react' }),
      'projects/a/package.json: Possible typosquat: reakt looks like react. Stop and ask the human.',
    );
  });
});

describe('package.json reading', () => {
  it('reads the four dependency sections, once for each name', () => {
    const text = JSON.stringify({
      name: 'a',
      dependencies: { one: '1' },
      devDependencies: { two: '2', one: '1' },
      peerDependencies: { three: '3' },
      optionalDependencies: { four: '4' },
      scripts: { five: 'x' },
    });
    assert.deepEqual(
      readDependencies(text, 'a/package.json').map((entry) => entry.name),
      ['one', 'two', 'three', 'four'],
    );
  });

  it('marks workspace, file and link dependencies as local, and reads an npm alias', () => {
    const text = JSON.stringify({
      dependencies: {
        a: 'workspace:*',
        b: 'file:../b',
        c: 'link:../c',
        d: 'npm:evil-pkg@^1.0.0',
        e: 'npm:@scope/evil@1.0.0',
        f: 'npm:bare',
        g: '^1.0.0',
      },
    });
    assert.deepEqual(readDependencies(text, 'p/package.json'), [
      { name: 'a', local: true },
      { name: 'b', local: true },
      { name: 'c', local: true },
      { name: 'd', local: false },
      { name: 'evil-pkg', local: false },
      { name: 'e', local: false },
      { name: '@scope/evil', local: false },
      { name: 'f', local: false },
      { name: 'bare', local: false },
      { name: 'g', local: false },
    ]);
  });

  it('throws on text that is not JSON, and reads no names from other shapes', () => {
    assert.throws(
      () => readDependencies('{', 'p/package.json'),
      /p\/package\.json is not valid JSON/,
    );
    assert.deepEqual(readDependencies('null', 'p/package.json'), []);
    assert.deepEqual(readDependencies('{"dependencies":[]}', 'p/package.json'), []);
  });

  it('picks the package.json files under projects, packages, platform and tooling', () => {
    assert.ok(isManifestPath('projects/a/package.json'));
    assert.ok(isManifestPath('projects/a/web/package.json'));
    assert.ok(isManifestPath('packages/b/package.json'));
    assert.ok(isManifestPath('platform/infra/package.json'));
    assert.ok(isManifestPath('tooling/c/package.json'));
    assert.ok(!isManifestPath('package.json'));
    assert.ok(!isManifestPath('docs/package.json'));
    assert.ok(!isManifestPath('common/autoinstallers/x/package.json'));
    assert.ok(!isManifestPath('projects/a/node_modules/x/package.json'));
    assert.ok(!isManifestPath('projects/a/web/.next/package.json'));
    assert.ok(!isManifestPath('projects/a/package-lock.json'));
    assert.ok(!isManifestPath('projects/a/src/package.json.bak'));
  });

  it('picks the package.json files of extra folders (project folders of rush.json)', () => {
    assert.ok(!isManifestPath('extra/z/package.json'));
    assert.ok(isManifestPath('extra/z/package.json', ['extra/z/']));
    assert.ok(!isManifestPath('extra/y/package.json', ['extra/z/']));
    assert.ok(!isManifestPath('extra/z/node_modules/q/package.json', ['extra/z/']));
  });

  it('applies the ignored-folder filter only below the project folder (N2)', () => {
    // A project that is named dist, node_modules or .next is a manifest folder of its own.
    assert.ok(isManifestPath('projects/dist/package.json', ['projects/', 'projects/dist/']));
    assert.ok(isManifestPath('projects/dist/web/package.json', ['projects/dist/']));
    assert.ok(isManifestPath('projects/.next/package.json', ['projects/.next/']));
    assert.ok(isManifestPath('projects/node_modules/package.json', ['projects/node_modules/']));
    // Below that folder the filter still holds.
    assert.ok(!isManifestPath('projects/dist/node_modules/x/package.json', ['projects/dist/']));
    assert.ok(!isManifestPath('projects/dist/dist/package.json', ['projects/dist/']));
    // Without its own folder entry, only the root matches, and the name below it is ignored.
    assert.ok(!isManifestPath('projects/dist/package.json'));
    assert.ok(!isManifestPath('projects/dist/package.json', ['projects/', 'projects/other/']));
  });

  it('reads each dependency with its version text, and empty text for a value that is not text', () => {
    const text = JSON.stringify({
      dependencies: { a: '^1.0.0', b: 5 },
      devDependencies: { a: 'github:x/y' },
    });
    assert.deepEqual(readDependencySpecs(text, 'p/package.json'), [
      { name: 'a', spec: '^1.0.0' },
      { name: 'b', spec: '' },
      { name: 'a', spec: 'github:x/y' },
    ]);
    assert.throws(() => readDependencySpecs('{', 'p/package.json'), /is not valid JSON/);
  });
});

describe('dependency version texts (specs)', () => {
  const root = path.resolve(import.meta.dirname, '..', '..', '..');
  const problem = (name, spec) =>
    specProblem({ file: 'projects/a/package.json', name, spec }, root);

  it('passes registry ranges, tags and workspace versions', () => {
    for (const spec of [
      '1.2.3',
      '^1.2.3',
      '~1.2',
      '>=1.0.0 <2.0.0',
      '1.x || 2.x',
      '1.0.0 - 2.0.0',
      '*',
      'latest',
      'next',
      '1.0.0-beta.1',
      'workspace:*',
      'workspace:^',
    ]) {
      assert.equal(problem('left', spec), '', spec);
    }
  });

  it('fails URL, git, tarball, shorthand and alias sources', () => {
    for (const spec of [
      'https://example.com/a.tgz',
      'http://example.com/a',
      'ftp://example.com/a',
      'git+https://github.com/o/r.git',
      'git+ssh://git@github.com/o/r.git',
      'git://github.com/o/r.git',
      'git@github.com:o/r.git',
      'github:o/r',
      'gitlab:o/r',
      'bitbucket:o/r',
      'gist:abc',
      'o/r',
      'o/r#main',
      'a.tgz',
      'a.tar.gz',
      'npm:reakt@1.0.0',
      'npm:@scope/evil@1.0.0',
    ]) {
      assert.notEqual(problem('left', spec), '', spec);
    }
  });

  it('fails a version that is empty, not text, or not a registry range (fail closed)', () => {
    assert.match(problem('left', ''), /missing or is not text/);
    assert.match(problem('left', '   '), /missing or is not text/);
    assert.match(problem('left', 'catalog:default'), /not a registry version/);
    assert.match(problem('left', '1.0.0; rm -rf /'), /not a registry version/);
  });

  it('passes file: and link: inside the repo, and fails them outside it', () => {
    assert.equal(problem('left', 'file:../b'), '');
    assert.equal(problem('left', 'link:../../packages/b'), '');
    assert.match(problem('left', 'file:../../../outside'), /leaves the repo/);
    assert.match(problem('left', 'link:/etc'), /leaves the repo/);
    assert.match(problem('left', 'file:'), /leaves the repo/);
    assert.match(problem('left', 'file:../../..'), /leaves the repo/);
  });

  it('fails a file: tarball even inside the repo', () => {
    assert.match(problem('left', 'file:../vendor/a.tgz'), /tarball/);
  });

  it('needs workspace: for the own scope, and fails a registry spec for it', () => {
    assert.equal(problem('@vprprudhvi/shared-logger', 'workspace:*'), '');
    assert.match(problem('@vprprudhvi/shared-logger', '^1.0.0'), /must use a workspace:/);
    assert.match(problem('@vprprudhvi/shared-logger', 'latest'), /must use a workspace:/);
    assert.match(problem('@vprprudhvi/shared-logger', 'file:../x'), /must use a workspace:/);
    assert.match(problem('@vprprudhvi/shared-logger', 'npm:evil@1.0.0'), /must use a workspace:/);
    assert.equal(problem('@vprprudhvi-other/x', '^1.0.0'), '');
  });

  it('writes the message of a spec problem', () => {
    assert.equal(
      formatProblem({
        file: 'projects/p/package.json',
        name: 'left',
        spec: 'github:o/r',
        reason: 'a git source is not a registry package',
      }),
      'projects/p/package.json: Dependency left has a version that is not allowed (github:o/r): a git source is not a registry package. Stop and ask the human.',
    );
  });
});

describe('typosquat check in a repo', () => {
  /** @type {ReturnType<typeof makeRepository>} */
  let repository;
  /** @type {string} */
  let base;

  beforeEach(() => {
    repository = makeRepository({
      'projects/q/package.json': JSON.stringify({
        name: 'q',
        dependencies: { 'zzz-internal-kit': '1.0.0', zod: '^4.0.0' },
      }),
    });
    base = repository.git('rev-parse', 'HEAD').trim();
  });

  afterEach(() => {
    repository.remove();
  });

  /**
   * Writes the package.json of a project.
   *
   * @param {string} project - Folder name under projects/.
   * @param {Record<string, string>} dependencies - The dependencies.
   * @returns {void}
   */
  function writeProject(project, dependencies) {
    repository.write(
      `projects/${project}/package.json`,
      JSON.stringify({ name: project, dependencies }),
    );
  }

  /**
   * Runs the check on the working tree.
   *
   * @returns {ReturnType<typeof checkTyposquats>} The result.
   */
  function check() {
    return checkTyposquats(repository.root, base, changedSinceBase(repository.root, base));
  }

  it('lists only the names that a package.json gained', () => {
    writeProject('q', { 'zzz-internal-kit': '2.0.0', left: '1', right: '1' });
    repository.write('projects/p/package.json', '{"name":"p","devDependencies":{"mid":"1"}}\n');
    assert.deepEqual(
      addedDependencies(repository.root, base, changedSinceBase(repository.root, base)),
      [
        { file: 'projects/p/package.json', name: 'mid' },
        { file: 'projects/q/package.json', name: 'left' },
        { file: 'projects/q/package.json', name: 'right' },
      ],
    );
  });

  it('reads no file when no package.json changed', () => {
    repository.write('projects/q/README.md', 'react\n');
    assert.deepEqual(check(), { added: [], problems: [] });
  });

  it('passes an exact known name and a name that the repo already has', () => {
    writeProject('p', { react: '19', 'zzz-internal-kit': '1.0.0' });
    const { added, problems } = check();
    assert.deepEqual(
      added.map((entry) => entry.name),
      ['react', 'zzz-internal-kit'],
    );
    assert.deepEqual(problems, []);
  });

  it('fails a typo of a known name and a typo of a name that the repo has', () => {
    writeProject('p', { reakt: '19', 'zzz-internal-kti': '1.0.0', lodahs: '4' });
    assert.deepEqual(check().problems, [
      { file: 'projects/p/package.json', name: 'reakt', looksLike: 'react' },
      { file: 'projects/p/package.json', name: 'zzz-internal-kti', looksLike: 'zzz-internal-kit' },
      { file: 'projects/p/package.json', name: 'lodahs', looksLike: 'lodash' },
    ]);
  });

  it('fails an npm alias by its version, and skips a workspace link', () => {
    writeProject('p', { fine: 'npm:reakt@1.0.0', '@zzz/other': 'workspace:*' });
    assert.deepEqual(check().problems, [
      {
        file: 'projects/p/package.json',
        name: 'fine',
        spec: 'npm:reakt@1.0.0',
        reason: 'an npm: alias hides the real package name',
      },
    ]);
  });

  it('fails a new dependency with a git, URL, tarball or shorthand source', () => {
    writeProject('p', {
      'left-a': 'git+https://github.com/o/r.git',
      'left-b': 'github:o/r',
      'left-c': 'https://example.com/b.tgz',
      'left-d': 'o/r#main',
      'left-e': 'file:../../../outside',
      'left-f': '^1.0.0',
    });
    assert.deepEqual(
      check().problems.map((problem) => problem.name),
      ['left-a', 'left-b', 'left-c', 'left-d', 'left-e'],
    );
  });

  it('fails a dependency that the base had when its version changes to a git source', () => {
    writeProject('q', { 'zzz-internal-kit': 'github:attacker/zzz-internal-kit', zod: '^4.0.0' });
    const { added, problems } = check();
    assert.deepEqual(added, []);
    assert.equal(problems.length, 1);
    assert.equal(problems[0]?.name, 'zzz-internal-kit');
    assert.equal(problems[0]?.spec, 'github:attacker/zzz-internal-kit');
  });

  it('passes a version change inside the registry, and a move to another section', () => {
    repository.write(
      'projects/q/package.json',
      JSON.stringify({
        name: 'q',
        dependencies: { 'zzz-internal-kit': '2.0.0' },
        devDependencies: { zod: '^4.0.0' },
      }),
    );
    assert.deepEqual(check(), { added: [], problems: [] });
    assert.deepEqual(
      changedDependencies(repository.root, base, changedSinceBase(repository.root, base)),
      [{ file: 'projects/q/package.json', name: 'zzz-internal-kit', spec: '2.0.0', isNew: false }],
    );
  });

  it('reports a version change as changed and not as added', () => {
    writeProject('q', { 'zzz-internal-kit': '1.0.0', zod: 'github:o/zod' });
    const changed = changedSinceBase(repository.root, base);
    assert.deepEqual(addedDependencies(repository.root, base, changed), []);
    assert.deepEqual(changedDependencies(repository.root, base, changed), [
      { file: 'projects/q/package.json', name: 'zod', spec: 'github:o/zod', isNew: false },
    ]);
  });

  it('passes file: and link: inside the repo for a new dependency', () => {
    writeProject('p', { 'local-a': 'file:../q', 'local-b': 'link:../../packages/a' });
    assert.deepEqual(check().problems, []);
  });

  it('needs workspace: for a package of the own scope, new or changed', () => {
    writeProject('p', {
      '@vprprudhvi/shared-logger': '^1.0.0',
      '@vprprudhvi/shared-result': 'workspace:*',
    });
    assert.deepEqual(
      check().problems.map((problem) => problem.name),
      ['@vprprudhvi/shared-logger'],
    );
    repository.write(
      'projects/q/package.json',
      JSON.stringify({ name: 'q', dependencies: { '@vprprudhvi/shared-result': 'workspace:*' } }),
    );
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', 'own scope');
    const next = repository.git('rev-parse', 'HEAD').trim();
    repository.write(
      'projects/q/package.json',
      JSON.stringify({ name: 'q', dependencies: { '@vprprudhvi/shared-result': '^1.0.0' } }),
    );
    const problems = checkTyposquats(
      repository.root,
      next,
      changedSinceBase(repository.root, next),
    ).problems;
    assert.equal(problems.length, 1);
    assert.match(formatProblem(problems[0]), /must use a workspace: version/);
  });

  it('fails a project folder of rush.json outside the four roots, even with no package.json change', () => {
    for (const folder of ['common/x', 'x', '../x', 'projects/../x', 'projects']) {
      repository.write(
        'rush.json',
        JSON.stringify({ projects: [{ packageName: '@t/a', projectFolder: folder }] }),
      );
      assert.throws(check, /project folder .* must be inside/, folder);
    }
  });

  it('fails a rush.json that is not JSON or has a project with no folder', () => {
    repository.write('rush.json', '{');
    assert.throws(check, /rush\.json is not valid JSON/);
    repository.write('rush.json', JSON.stringify({ projects: [{ packageName: '@t/a' }] }));
    assert.throws(check, /no projectFolder/);
    repository.write('rush.json', JSON.stringify({ projects: {} }));
    assert.throws(check, /no projectFolder/);
  });

  it('reads project folders from rush.json at HEAD and at the base, not only the working tree', () => {
    const bad = JSON.stringify({ projects: [{ packageName: '@t/a', projectFolder: 'common/x' }] });
    repository.write('rush.json', bad);
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', 'bad folder');
    repository.write(
      'rush.json',
      JSON.stringify({ projects: [{ packageName: '@t/a', projectFolder: 'packages/a' }] }),
    );
    assert.throws(check, /project folder "common\/x"/);
  });

  it('derives the manifest folders from rush.json, with the four roots', () => {
    const commit = repository.git('rev-parse', 'HEAD').trim();
    repository.write(
      'rush.json',
      `// comment\n${JSON.stringify({
        projects: [{ packageName: '@t/a', projectFolder: './packages/a/' }],
      })}\n`,
    );
    assert.deepEqual(manifestFolders(repository.root, commit).sort(), [
      'packages/',
      'packages/a/',
      'platform/',
      'projects/',
      'tooling/',
    ]);
  });

  it('CLI exits 1 for a git source and for a version change to a git source', () => {
    writeProject('p', { 'left-a': 'github:o/r' });
    const added = exec('node', [CLI, '--root', repository.root, '--base', base]);
    assert.equal(added.status, 1);
    assert.match(
      added.stderr,
      /projects\/p\/package\.json: Dependency left-a has a version that is not allowed \(github:o\/r\)/,
    );
    repository.remove();
    repository = makeRepository({
      'projects/q/package.json': JSON.stringify({ name: 'q', dependencies: { zod: '^4.0.0' } }),
    });
    base = repository.git('rev-parse', 'HEAD').trim();
    writeProject('q', { zod: 'https://example.com/zod.tgz' });
    const changed = exec('node', [CLI, '--root', repository.root, '--base', base]);
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /Dependency zod has a version that is not allowed/);
  });

  it('CLI exits 2 for a rush.json project folder outside the four roots', () => {
    repository.write(
      'rush.json',
      JSON.stringify({ projects: [{ packageName: '@t/a', projectFolder: 'common/x' }] }),
    );
    const result = exec('node', [CLI, '--root', repository.root, '--base', base]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /could not check: rush\.json has the project folder "common\/x"/);
  });

  it('works for a committed change', () => {
    writeProject('p', { reakt: '19' });
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', 'dep');
    assert.equal(check().problems.length, 1);
  });

  it('fails when a changed package.json is not JSON', () => {
    repository.write('projects/p/package.json', '{"dependencies":');
    assert.throws(check, /projects\/p\/package\.json is not valid JSON/);
  });

  it('CLI exits 1 and prints the message for a lookalike', () => {
    writeProject('p', { reakt: '19' });
    const result = exec('node', [CLI, '--root', repository.root, '--base', base]);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /projects\/p\/package\.json: Possible typosquat: reakt looks like react\. Stop and ask the human\./,
    );
  });

  it('CLI exits 0 for known names and for no change', () => {
    const none = exec('node', [CLI, '--root', repository.root, '--base', base]);
    assert.equal(none.status, 0, none.stderr);
    assert.match(none.stdout, /typosquat-check: pass \(0 new dependency names\)/);
    writeProject('p', { react: '19', zod: '4' });
    const some = exec('node', [CLI, '--root', repository.root, '--base', base]);
    assert.equal(some.status, 0, some.stderr);
    assert.match(some.stdout, /pass \(2 new dependency names\)/);
  });

  it('CLI exits 2 without --base, on a bad base, on bad JSON and on a bad argument', () => {
    assert.equal(exec('node', [CLI, '--root', repository.root]).status, 2);
    assert.equal(exec('node', [CLI, '--root', repository.root, '--base', 'nope']).status, 2);
    assert.equal(exec('node', [CLI, '--bad']).status, 2);
    repository.write('projects/p/package.json', 'not json');
    const result = exec('node', [CLI, '--root', repository.root, '--base', base]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /typosquat-check: could not check: projects\/p\/package\.json/);
  });

  it('CLI prints the help', () => {
    const result = exec('node', [CLI, '--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:\n {2}node scripts\/gates\/typosquat-check\.mjs --base/);
  });
});
