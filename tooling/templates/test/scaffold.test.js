// Tests for src/scaffold.js. Each test uses a temp repo root, so the real repo stays unchanged.
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  listFiles,
  makeTemporaryFolder,
  pathExists,
  readText,
  removeFolder,
  replaceText,
  writeNewText,
} from '../src/fs-io.js';
import {
  changeFileStamp,
  fillVersions,
  insertProject,
  nameProblem,
  parseProjects,
  scaffold,
} from '../src/scaffold.js';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TEMPLATES = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const REFERENCE = 'packages/result/package.json';
const NOW = new Date('2026-11-04T09:05:00Z');
const LIBRARY_FILES = [
  'README.md',
  'config/rush-project.json',
  'eslint.config.js',
  'package.json',
  'src/index.ts',
  'test/index.test.ts',
  'tsconfig.build.json',
  'tsconfig.json',
  'vitest.config.ts',
];

let root = '';

beforeEach(async () => {
  root = await makeTemporaryFolder();
  await writeNewText(root, 'rush.json', await readText(REPO_ROOT, 'rush.json'));
  await writeNewText(root, REFERENCE, await readText(REPO_ROOT, REFERENCE));
});

afterEach(async () => {
  await removeFolder(root);
});

const make = (name = 'date-utils') =>
  scaffold({ root, templatesFolder: TEMPLATES, kind: 'library', name, now: NOW });

describe('scaffold library', () => {
  it('writes every template file with the name filled', async () => {
    const result = await make();

    expect(result.folder).toBe('packages/date-utils');
    expect(result.packageName).toBe('@vprprudhvi/shared-date-utils');
    expect(await listFiles(`${root}/packages/date-utils`)).toEqual(LIBRARY_FILES);
    for (const file of LIBRARY_FILES) {
      const text = await readText(root, `packages/date-utils/${file}`);
      expect(text).not.toMatch(/__name__|__version__/);
    }
    expect(await readText(root, 'packages/date-utils/src/index.ts')).toContain(
      "return '@vprprudhvi/shared-date-utils';",
    );
  });

  it('copies scripts and dependency versions from the reference package', async () => {
    await make();
    const reference = JSON.parse(await readText(root, REFERENCE));
    const manifest = JSON.parse(await readText(root, 'packages/date-utils/package.json'));

    expect(manifest.name).toBe('@vprprudhvi/shared-date-utils');
    expect(manifest.private).toBeUndefined();
    expect(manifest.scripts).toEqual(reference.scripts);
    expect(manifest.exports).toEqual(reference.exports);
    expect(manifest.devDependencies).toEqual(reference.devDependencies);
  });

  it('adds one rush.json entry and keeps the rest of the file', async () => {
    const before = await readText(root, 'rush.json');
    await make();
    const after = await readText(root, 'rush.json');
    const entry = {
      packageName: '@vprprudhvi/shared-date-utils',
      projectFolder: 'packages/date-utils',
      shouldPublish: true,
      tags: ['shared'],
    };

    expect(parseProjects(after)).toEqual([...parseProjects(before), entry]);
    expect(
      after.startsWith(before.slice(0, before.lastIndexOf('}', before.lastIndexOf(']')))),
    ).toBe(true);
    expect(after).toContain('/**\n * Rush monorepo configuration.');
  });

  it('writes a minor change file', async () => {
    const result = await make();
    const file = 'common/changes/@vprprudhvi/shared-date-utils/new-library_2026-11-04-09-05.json';

    expect(result.files).toContain(file);
    expect(JSON.parse(await readText(root, file))).toEqual({
      changes: [
        {
          packageName: '@vprprudhvi/shared-date-utils',
          comment: 'Add the @vprprudhvi/shared-date-utils package.',
          type: 'minor',
        },
      ],
      packageName: '@vprprudhvi/shared-date-utils',
    });
  });
});

describe('scaffold errors', () => {
  it.each(['', 'Foo', 'foo_bar', '-foo', 'foo-', 'foo--bar', '1foo', 'foo/bar', '../x'])(
    'rejects the name "%s"',
    async (name) => {
      await expect(make(name)).rejects.toThrow(/is not kebab-case/);
      expect(await pathExists(root, 'packages')).toBe(true);
      expect(await readText(root, 'rush.json')).toBe(await readText(REPO_ROOT, 'rush.json'));
    },
  );

  it('rejects a name that rush.json has', async () => {
    await expect(make('result')).rejects.toThrow(
      'rush.json already has @vprprudhvi/shared-result (packages/result)',
    );
  });

  it('rejects a folder that exists and writes nothing', async () => {
    await writeNewText(root, 'packages/date-utils/keep.txt', 'x');
    await expect(make()).rejects.toThrow('folder packages/date-utils already exists');
    expect(await listFiles(`${root}/packages/date-utils`)).toEqual(['keep.txt']);
  });

  it('rejects an unknown kind', async () => {
    await expect(
      scaffold({ root, templatesFolder: TEMPLATES, kind: 'toString', name: 'x' }),
    ).rejects.toThrow('unknown kind "toString"');
  });

  it('fails when the reference has no version for a dependency, and writes nothing', async () => {
    const reference = JSON.parse(await readText(root, REFERENCE));
    delete reference.devDependencies.vitest;
    await replaceText(root, REFERENCE, JSON.stringify(reference));

    await expect(make()).rejects.toThrow(`${REFERENCE} has no version for "vitest"`);
    expect(await pathExists(root, 'packages/date-utils')).toBe(false);
  });

  it('fails when rush.json has no readable projects array', async () => {
    await replaceText(root, 'rush.json', '{ "rushVersion": "5" }\n');
    await expect(make()).rejects.toThrow(/cannot read the "projects" array \(no "projects" key\)/);
  });
});

describe('helpers', () => {
  it('nameProblem accepts kebab-case', () => {
    expect(nameProblem('a')).toBe('');
    expect(nameProblem('date-utils2')).toBe('');
  });

  it('parseProjects reports a comment in the array', () => {
    expect(() => parseProjects('{ "projects": [ // x\n ] }')).toThrow(/have no comments/);
  });

  it('insertProject fails when the projects array is not last', () => {
    expect(() =>
      insertProject('{ "projects": [], "x": 1 }', {
        packageName: 'a',
        projectFolder: 'b',
        shouldPublish: false,
        tags: [],
      }),
    ).toThrow(/Add the entry by hand/);
  });

  it('fillVersions keeps fixed versions and reads every dependency field', () => {
    const text = JSON.stringify({
      dependencies: { a: '__version__' },
      peerDependencies: { b: '^1.0.0' },
    });
    const filled = JSON.parse(fillVersions(text, { devDependencies: { a: '~2.0.0' } }, 'ref'));
    expect(filled).toEqual({ dependencies: { a: '~2.0.0' }, peerDependencies: { b: '^1.0.0' } });
  });

  it('changeFileStamp uses UTC minutes', () => {
    expect(changeFileStamp(NOW)).toBe('2026-11-04-09-05');
  });
});
