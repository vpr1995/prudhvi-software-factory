// The single-package layout: a project is projects/<name>/package.json, its parts are folders.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { projectTsconfigs } from '../lib/project-tools.mjs';
import {
  impactOf,
  listProjects,
  PROJECT_PARTS,
  projectParts,
  projectsWithParts,
} from '../lib/projects.mjs';
import { guessRiskTier } from '../lib/session-info.mjs';
import { fastChecks } from '../lib/stop-checks.mjs';

import { makeRepository } from './harness.js';

const MANIFEST = '{"name":"@vprprudhvi/x"}\n';
const FILE = 'export {};\n';

const FILES = {
  'rush.json': JSON.stringify({
    projects: [
      { packageName: '@vprprudhvi/full', projectFolder: 'projects/full' },
      { packageName: '@vprprudhvi/py', projectFolder: 'projects/py' },
    ],
  }),
  'projects/full/package.json': MANIFEST,
  'projects/full/src/contracts/index.ts': FILE,
  'projects/full/src/api/lambda.ts': FILE,
  'projects/full/src/api-py/pyproject.toml': 'x\n',
  'projects/full/src/api-go/go.mod': 'x\n',
  'projects/full/web/app/page.tsx': FILE,
  'projects/full/web/tsconfig.json': '{}\n',
  'projects/full/tsconfig.json': '{}\n',
  'projects/full/bin/app.ts': FILE,
  'projects/full/lib/stack.ts': FILE,
  'projects/py/package.json': MANIFEST,
  'projects/py/src/api-py/pyproject.toml': 'x\n',
  'projects/old/api/package.json': MANIFEST,
  'projects/old/web/package.json': MANIFEST,
  'projects/old/contracts/package.json': MANIFEST,
  'projects/old/infra/package.json': MANIFEST,
  'projects/empty/README.md': 'x\n',
};

describe('project parts by folder', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository(FILES);
  });

  afterEach(() => repository.remove());

  it('lists a project only when its folder has a package.json', () => {
    assert.deepEqual(listProjects(repository.root), ['full', 'py']);
  });

  it('detects every part of a full project', () => {
    assert.deepEqual(projectParts(repository.root, 'full'), [
      'contracts',
      'api',
      'api-py',
      'api-go',
      'web',
      'infra',
    ]);
    assert.deepEqual(Object.keys(PROJECT_PARTS), [
      'contracts',
      'api',
      'api-py',
      'api-go',
      'web',
      'infra',
    ]);
  });

  it('detects one part of a small project', () => {
    assert.deepEqual(projectParts(repository.root, 'py'), ['api-py']);
  });

  it('does not detect the old layout: parts are not folders at the project root', () => {
    assert.deepEqual(projectParts(repository.root, 'old'), []);
  });

  it('detects the infra part from bin or lib alone', () => {
    repository.write('projects/b/package.json', MANIFEST);
    repository.write('projects/b/bin/app.ts', FILE);
    repository.write('projects/l/package.json', MANIFEST);
    repository.write('projects/l/lib/stack.ts', FILE);
    assert.deepEqual(projectParts(repository.root, 'b'), ['infra']);
    assert.deepEqual(projectParts(repository.root, 'l'), ['infra']);
  });

  it('finds no part for a folder with no package.json, or a missing project', () => {
    assert.deepEqual(projectParts(repository.root, 'empty'), []);
    assert.deepEqual(projectParts(repository.root, 'missing'), []);
  });

  it('does not take a file named like a part folder for a part', () => {
    repository.write('projects/f/package.json', MANIFEST);
    repository.write('projects/f/web', 'not a folder\n');
    assert.deepEqual(projectParts(repository.root, 'f'), []);
  });

  it('picks the projects that have one of the wanted parts', () => {
    assert.deepEqual(projectsWithParts(repository.root, ['api', 'api-py', 'api-go']), [
      'full',
      'py',
    ]);
    assert.deepEqual(projectsWithParts(repository.root, ['web']), ['full']);
    assert.deepEqual(projectsWithParts(repository.root, ['infra']), ['full']);
  });

  it('lists the tsconfig files of a project: the root one and the web one', () => {
    const folder = `${repository.root}/projects/full`;
    assert.deepEqual(projectTsconfigs(folder), ['tsconfig.json', 'web/tsconfig.json']);
    assert.deepEqual(projectTsconfigs(`${repository.root}/projects/py`), []);
  });
});

describe('impact of changed paths in the single-package layout', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository(FILES);
  });

  afterEach(() => repository.remove());

  const impact = (...paths) => impactOf(repository.root, paths);

  it('maps any file in the project folder to the Rush project', () => {
    for (const file of [
      'projects/full/src/api/a.ts',
      'projects/full/web/app/page.tsx',
      'projects/full/src/api-py/src/a.py',
      'projects/full/bruno/a.bru',
    ]) {
      assert.deepEqual(impact(file).projects, ['@vprprudhvi/full'], file);
      assert.deepEqual(impact(file).infraFolders, [], file);
    }
  });

  it('treats bin, lib and cdk.json of a project as its infra folder (the project folder)', () => {
    for (const file of [
      'projects/full/bin/app.ts',
      'projects/full/lib/stack.ts',
      'projects/full/lib/nested/construct.ts',
      'projects/full/cdk.json',
    ]) {
      assert.deepEqual(impact(file).infraFolders, ['projects/full'], file);
    }
  });

  it('does not take web/lib or src/lib for infra', () => {
    for (const file of ['projects/full/web/lib/client.ts', 'projects/full/src/api/lib/a.ts']) {
      assert.deepEqual(impact(file).infraFolders, [], file);
    }
  });

  it('does not take the old projects/<name>/infra folder for infra', () => {
    assert.deepEqual(impact('projects/full/infra/stack.ts').infraFolders, []);
  });

  it('keeps platform/infra as an infra folder', () => {
    assert.deepEqual(impact('platform/infra/lib/a.ts').infraFolders, ['platform/infra']);
  });
});

describe('risk tier in the single-package layout', () => {
  const never = () => false;
  const tier = (file) => guessRiskTier([file], never).tier;

  it('is high for the CDK app folders and cdk.json', () => {
    for (const file of [
      'projects/p/bin/app.ts',
      'projects/p/lib/stack.ts',
      'projects/p/lib/a/b.ts',
      'projects/p/cdk.json',
    ]) {
      assert.equal(tier(file), 'high', file);
    }
  });

  it('is medium for web, api and Python source, even under a folder named lib', () => {
    for (const file of [
      'projects/p/web/lib/client.ts',
      'projects/p/web/app/page.tsx',
      'projects/p/src/api/a.ts',
      'projects/p/src/api-py/src/a.py',
      'projects/p/src/api-go/a.go',
    ]) {
      assert.equal(tier(file), 'medium', file);
    }
  });

  it('is medium for the old projects/<name>/infra folder (it is not a layout folder any more)', () => {
    assert.equal(tier('projects/p/infra/stack.ts'), 'medium');
  });
});

describe('subagent stop typecheck in the single-package layout', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository(FILES);
    const log = path.join(repository.root, 'tsc-calls.log');
    const stub = path.join(repository.root, 'projects/full/node_modules/.bin/tsc');
    fs.mkdirSync(path.dirname(stub), { recursive: true });
    fs.writeFileSync(stub, `#!/bin/sh\necho "$*" >> '${log}'\nexit 0\n`, { mode: 0o755 });
  });

  afterEach(() => repository.remove());

  it('runs tsc for the root tsconfig and for web/tsconfig.json of a changed project', () => {
    const checks = fastChecks(repository.root, ['projects/full/web/app/page.tsx']);
    const names = checks.map((check) => check.name).filter((name) => name.startsWith('typecheck'));
    assert.deepEqual(names, [
      'typecheck: @vprprudhvi/full',
      'typecheck: @vprprudhvi/full (web/tsconfig.json)',
    ]);
    const calls = fs
      .readFileSync(path.join(repository.root, 'tsc-calls.log'), 'utf8')
      .trim()
      .split('\n');
    assert.equal(calls.length, 2);
    assert.match(calls[0], /^-p tsconfig\.json --noEmit /);
    assert.match(calls[1], /^-p web\/tsconfig\.json --noEmit /);
  });
});
