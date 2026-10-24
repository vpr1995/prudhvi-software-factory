// Tests for scripts/gates/register-project.mjs and lib/rush-json-edit.mjs: the text edit of the
// `projects` array of rush.json keeps every comment, and the script refuses anything else.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { stripJsonComments } from '../lib/projects.mjs';
import { addProject, removeProject } from '../lib/rush-json-edit.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'register-project.mjs');
const NEXT_STEP = 'Next step: node common/scripts/install-run-rush.js update';

/** A rush.json in the format of the real one: comments at the top, in the array and in an entry. */
const RUSH_JSON = `/**
 * Rush monorepo configuration. Gate file.
 */
{
  "rushVersion": "5.181.0",
  /** Projects live at tooling/<name>, packages/<name>, projects/<name>. */
  "projectFolderMinDepth": 1,

  "projects": [
    // Tooling first.
    {
      "packageName": "@vprprudhvi/tooling-tsconfig",
      "projectFolder": "tooling/tsconfig",
      "shouldPublish": false,
      "tags": ["tooling"]
    },
    {
      "packageName": "@vprprudhvi/banana",
      "projectFolder": "projects/banana",
      "shouldPublish": false,
      "tags": ["project/banana"]
    },
    {
      "packageName": "@vprprudhvi/mango",
      "projectFolder": "projects/mango", // a comment in an entry
      "shouldPublish": false,
      "tags": ["project/mango"]
    },
    {
      "packageName": "@vprprudhvi/shared-result",
      "projectFolder": "packages/result",
      "shouldPublish": true,
      "tags": ["shared"]
    }
  ]
}
`;

/**
 * Parses rush.json text with the JSONC reader of the gate scripts.
 *
 * @param {string} text - rush.json text.
 * @returns {string[]} The project folders in array order.
 */
function folders(text) {
  return JSON.parse(stripJsonComments(text)).projects.map((entry) => entry.projectFolder);
}

/**
 * Makes the text of an entry in the format of the fixture.
 *
 * @param {string} name - Project name.
 * @returns {string} The entry lines, from `{` to `}`.
 */
function entryText(name) {
  return [
    '    {',
    `      "packageName": "@vprprudhvi/${name}",`,
    `      "projectFolder": "projects/${name}",`,
    '      "shouldPublish": false,',
    `      "tags": ["project/${name}"]`,
    '    }',
  ].join('\n');
}

describe('rush.json text edit', () => {
  it('adds the entry in sorted position among the projects/ entries', () => {
    const { text, index } = addProject(RUSH_JSON, 'cherry');
    assert.equal(index, 2);
    assert.deepEqual(folders(text), [
      'tooling/tsconfig',
      'projects/banana',
      'projects/cherry',
      'projects/mango',
      'packages/result',
    ]);
    assert.ok(
      text.includes(`${entryText('cherry')},\n    {\n      "packageName": "@vprprudhvi/mango"`),
    );
  });

  it('adds before the first projects/ entry, and after the last one', () => {
    assert.equal(addProject(RUSH_JSON, 'apple').index, 1);
    const { text, index } = addProject(RUSH_JSON, 'zucchini');
    assert.equal(index, 3);
    assert.deepEqual(folders(text).slice(2), [
      'projects/mango',
      'projects/zucchini',
      'packages/result',
    ]);
  });

  it('adds after the last entry, with the comma, when the projects/ entries are last', () => {
    const only = RUSH_JSON.replace(
      /,\n {4}\{\n {6}"packageName": "@vprprudhvi\/shared-result"[\s\S]*?\n {4}\}/,
      '',
    );
    const { text, index } = addProject(only, 'zucchini');
    assert.equal(index, 3);
    assert.ok(text.endsWith(`    },\n${entryText('zucchini')}\n  ]\n}\n`), text);
  });

  it('keeps every comment and every other byte', () => {
    const { text } = addProject(RUSH_JSON, 'cherry');
    const inserted = `${entryText('cherry').trimStart()},\n    `;
    const at = text.indexOf(inserted);
    assert.notEqual(at, -1);
    assert.equal(`${text.slice(0, at)}${text.slice(at + inserted.length)}`, RUSH_JSON);
    for (const comment of [
      ' * Rush monorepo configuration. Gate file.',
      '/** Projects live at tooling/<name>, packages/<name>, projects/<name>. */',
      '// Tooling first.',
      '// a comment in an entry',
    ]) {
      assert.ok(text.includes(comment), comment);
    }
  });

  it('gives back the original bytes after add and remove', () => {
    for (const name of ['apple', 'cherry', 'zucchini']) {
      const added = addProject(RUSH_JSON, name);
      assert.equal(removeProject(added.text, name).text, RUSH_JSON, name);
    }
  });

  it('refuses a duplicate package name or folder', () => {
    assert.throws(
      () => addProject(RUSH_JSON, 'banana'),
      /already has an entry for @vprprudhvi\/banana/,
    );
    const folderTaken = RUSH_JSON.replace('"@vprprudhvi/banana"', '"@vprprudhvi/other"');
    assert.throws(() => addProject(folderTaken, 'banana'), /already has an entry/);
  });

  it('removes only the one entry', () => {
    const { text, index } = removeProject(RUSH_JSON, 'banana');
    assert.equal(index, 1);
    assert.deepEqual(folders(text), ['tooling/tsconfig', 'projects/mango', 'packages/result']);
    assert.equal(text, RUSH_JSON.replace(`${entryText('banana').trimStart()},\n    `, ''));
  });

  it('refuses to remove a missing entry, or an entry with a comment in it', () => {
    assert.throws(() => removeProject(RUSH_JSON, 'cherry'), /no entry for @vprprudhvi\/cherry/);
    assert.throws(() => removeProject(RUSH_JSON, 'mango'), /a comment is inside or next to/);
  });

  it('refuses a rush.json without one top-level projects array', () => {
    assert.throws(() => addProject('{ "x": { "projects": [] } }', 'cherry'), /one top-level/);
  });
});

describe('register-project CLI', () => {
  /** @type {ReturnType<typeof makeRepository>} */
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      'rush.json': RUSH_JSON,
      'projects/cherry/package.json': '{ "name": "@vprprudhvi/cherry", "private": true }\n',
    });
  });

  afterEach(() => {
    repository.remove();
  });

  const run = (...args) => exec('node', [CLI, ...args], { cwd: repository.root });

  it('adds the project, writes rush.json and prints the next step', () => {
    const result = run('cherry');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /added @vprprudhvi\/cherry \(projects\/cherry\) to rush\.json/);
    assert.ok(result.stdout.includes(NEXT_STEP));
    assert.equal(repository.read('rush.json'), addProject(RUSH_JSON, 'cherry').text);
  });

  it('works from a folder below the repo root', () => {
    const result = exec('node', [CLI, 'cherry'], {
      cwd: path.join(repository.root, 'projects', 'cherry'),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(folders(repository.read('rush.json') ?? '').slice(1, 4), [
      'projects/banana',
      'projects/cherry',
      'projects/mango',
    ]);
  });

  it('refuses a duplicate and leaves rush.json as it was', () => {
    repository.write('projects/banana/package.json', '{ "name": "@vprprudhvi/banana" }\n');
    const result = run('banana');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refused: rush\.json already has an entry/);
    assert.equal(repository.read('rush.json'), RUSH_JSON);
  });

  it('refuses a bad name with exit 2', () => {
    for (const name of [
      'Cherry',
      'c',
      '1cherry',
      'cherry_pie',
      '../cherry',
      'a/b',
      `a${'b'.repeat(41)}`,
    ]) {
      const result = run(name);
      assert.equal(result.status, 2, name);
      assert.match(result.stderr, /bad project name|exactly one project name/, name);
    }
    assert.equal(run().status, 2);
    assert.equal(run('cherry', 'mango').status, 2);
    assert.equal(repository.read('rush.json'), RUSH_JSON);
  });

  it('refuses a project with no package.json', () => {
    repository.write('projects/kiwi/README.md', 'kiwi\n');
    const noFile = run('kiwi');
    assert.equal(noFile.status, 1);
    assert.match(noFile.stderr, /projects\/kiwi\/package\.json does not exist/);
    const noFolder = run('lime');
    assert.equal(noFolder.status, 1);
    assert.match(noFolder.stderr, /projects\/lime is not a folder/);
    assert.equal(repository.read('rush.json'), RUSH_JSON);
  });

  it('refuses a package.json with another name', () => {
    repository.write('projects/kiwi/package.json', '{ "name": "@other/kiwi" }\n');
    const result = run('kiwi');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has the name "@other\/kiwi", not "@vprprudhvi\/kiwi"/);
    assert.equal(repository.read('rush.json'), RUSH_JSON);
  });

  it('removes the entry and prints the next step', () => {
    const result = run('--remove', 'banana');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /removed @vprprudhvi\/banana \(projects\/banana\) from rush\.json/);
    assert.ok(result.stdout.includes(NEXT_STEP));
    assert.deepEqual(folders(repository.read('rush.json') ?? ''), [
      'tooling/tsconfig',
      'projects/mango',
      'packages/result',
    ]);
  });

  it('refuses to remove a missing entry', () => {
    const result = run('--remove', 'cherry');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refused: rush\.json has no entry for @vprprudhvi\/cherry/);
    assert.equal(repository.read('rush.json'), RUSH_JSON);
  });

  it('adds, then removes, back to the original file', () => {
    assert.equal(run('cherry').status, 0);
    assert.equal(run('--remove', 'cherry').status, 0);
    assert.equal(repository.read('rush.json'), RUSH_JSON);
  });
});
