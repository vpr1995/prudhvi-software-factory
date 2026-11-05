// Tests for src/add-part.js. Each test uses a temp repo root with one bare project, so the real
// repo stays unchanged.
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addPart, mergeManifest } from '../src/add-part.js';
import {
  listFiles,
  makeTemporaryFolder,
  pathExists,
  readText,
  removeFolder,
  replaceText,
  writeNewText,
} from '../src/fs-io.js';
import { scaffold } from '../src/scaffold.js';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TEMPLATES = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const REFERENCE = 'projects/sample/package.json';
const COPIED = [
  'rush.json',
  REFERENCE,
  'projects/sample/playwright.config.ts',
  'docs/templates/REVIEW.api.md',
  'docs/templates/REVIEW.web.md',
  'docs/templates/REVIEW.infra.md',
];
const FOLDER = 'projects/notes-app';

let root = '';

beforeEach(async () => {
  root = await makeTemporaryFolder();
  for (const file of COPIED) await writeNewText(root, file, await readText(REPO_ROOT, file));
  await scaffold({ root, templatesFolder: TEMPLATES, kind: 'project', name: 'notes-app' });
});

afterEach(async () => {
  await removeFolder(root);
});

const add = (part = 'node', project = 'notes-app') =>
  addPart({ root, templatesFolder: TEMPLATES, project, part });
const manifest = async () => JSON.parse(await readText(root, `${FOLDER}/package.json`));
const reference = async () => JSON.parse(await readText(root, REFERENCE));

/** Every file of the project, with the text of each one, to prove that nothing changed. */
async function snapshot() {
  const files = await listFiles(`${root}/${FOLDER}`);
  return Promise.all(files.map(async (file) => [file, await readText(root, `${FOLDER}/${file}`)]));
}

describe('add the node part', () => {
  it('writes the server, its tests, the Bruno collection and the e2e script', async () => {
    const result = await add('node');

    expect(result.packageName).toBe('@vprprudhvi/notes-app');
    for (const file of [
      'tsconfig.build.json',
      'src/api/server.ts',
      'src/api/routes/health/health-route.ts',
      'test/api/server.test.ts',
      'bruno/bruno.json',
      'bruno/health/get-health.bru',
      'scripts/e2e.mjs',
    ]) {
      expect(result.files).toContain(`${FOLDER}/${file}`);
    }
    expect(await pathExists(root, `${FOLDER}/package.json.tmpl`)).toBe(false);
    expect(await pathExists(root, `${FOLDER}/src/contracts`)).toBe(false);
    expect(await readText(root, `${FOLDER}/src/api/config.ts`)).toContain('NOTES_APP_API_PORT');
    expect(await readText(root, `${FOLDER}/bruno/health/get-health.bru`)).toContain(
      'res.body.service: eq notes-app-api',
    );
    for (const file of result.files) {
      expect(await readText(root, file)).not.toMatch(/__name__|__Name__|__NAME__|__version__/);
    }
  });

  it('adds the start script and the dependencies with the sample versions', async () => {
    await add('node');
    const sample = await reference();
    const { scripts, dependencies, devDependencies } = await manifest();

    expect(scripts.start).toBe('node dist/api/main.js');
    expect(scripts['_phase:e2e']).toBe('node scripts/phase.mjs e2e');
    expect(dependencies.fastify).toBe(sample.dependencies.fastify);
    expect(dependencies['@vprprudhvi/shared-logger']).toBe('workspace:*');
    expect(devDependencies['@usebruno/cli']).toBe(sample.devDependencies['@usebruno/cli']);
    expect(Object.keys(dependencies)).toEqual(Object.keys(dependencies).toSorted());
  });

  it('adds the api review section after the project text', async () => {
    await add('node');
    const review = await readText(root, `${FOLDER}/REVIEW.md`);

    expect(review.startsWith('# REVIEW.md: notes-app\n')).toBe(true);
    expect(review).toContain('\n\n## Review template: api (Fastify)\n');
  });
});

describe('add the web part', () => {
  it('writes the app, the tests and the Playwright config, and turns on the web tests', async () => {
    const result = await add('web');

    for (const file of [
      'web/app/page.tsx',
      'web/e2e/home.spec.ts',
      'web/.gitignore',
      'test/web/setup.ts',
      'playwright.config.ts',
      'vitest.config.ts',
    ]) {
      expect(result.files).toContain(`${FOLDER}/${file}`);
    }
    expect(await readText(root, `${FOLDER}/vitest.config.ts`)).toContain(
      'createAppVitestConfig({ web: true })',
    );
    expect((await manifest()).dependencies.next).toBe((await reference()).dependencies.next);
  });

  it('takes the next free port after the Playwright configs of the other projects', async () => {
    await add('web');
    expect(await readText(root, `${FOLDER}/playwright.config.ts`)).toContain(
      'const WEB_PORT = 4330;',
    );
  });

  it('takes a port above a high port of another project', async () => {
    await replaceText(root, 'projects/sample/playwright.config.ts', 'const WEB_PORT = 4500;\n');
    await add('web');
    expect(await readText(root, `${FOLDER}/playwright.config.ts`)).toContain(
      'const WEB_PORT = 4501;',
    );
  });
});

describe('add the infra part', () => {
  it('writes the CDK app with the PascalCase names and the build:cdk script', async () => {
    const result = await add('infra');

    for (const file of [
      'cdk.json',
      'tsconfig.cdk.json',
      'bin/app.ts',
      'lib/notes-app-app.ts',
      'lib/notes-app-stack.ts',
      'test/infra/notes-app-app.test.ts',
      'test/infra/bin/app.test.ts',
    ]) {
      expect(result.files).toContain(`${FOLDER}/${file}`);
    }
    expect(await readText(root, `${FOLDER}/bin/app.ts`)).toContain('addNotesAppStack(app);');
    expect(await readText(root, `${FOLDER}/lib/notes-app-app.ts`)).toContain('AwsSolutionsChecks');
    const { scripts, dependencies, devDependencies } = await manifest();
    expect(scripts['build:cdk']).toBe('tsc -p tsconfig.cdk.json');
    expect(dependencies['aws-cdk-lib']).toBe((await reference()).dependencies['aws-cdk-lib']);
    expect(devDependencies['aws-cdk']).toBeDefined();
  });
});

describe('order', () => {
  it('adds every part in any order', async () => {
    for (const part of ['infra', 'web', 'node']) await add(part);
    const { scripts } = await manifest();

    expect(Object.keys(scripts)).toEqual(
      expect.arrayContaining(['start', 'dev:web', 'build:cdk', 'synth', '_phase:build']),
    );
    const review = await readText(root, `${FOLDER}/REVIEW.md`);
    expect(review.indexOf('infra')).toBeLessThan(review.indexOf('Review template: web'));
    expect(review.indexOf('Review template: web')).toBeLessThan(
      review.indexOf('Review template: api'),
    );
  });
});

describe('add-part errors', () => {
  it('rejects an unknown part', async () => {
    await expect(add('toString')).rejects.toThrow(
      'unknown part "toString". Use one of: node, web, infra',
    );
  });

  it.each(['', 'Notes', '../x', 'a--b'])('rejects the project name "%s"', async (name) => {
    await expect(add('node', name)).rejects.toThrow(/is not kebab-case/);
  });

  it('rejects a part that exists, and writes nothing', async () => {
    await add('web');
    const before = await snapshot();

    await expect(add('web')).rejects.toThrow(
      `${FOLDER} already has the web part (${FOLDER}/web exists)`,
    );
    expect(await snapshot()).toEqual(before);
  });

  it('rejects a project that rush.json does not have', async () => {
    await expect(add('node', 'missing')).rejects.toThrow(
      'rush.json has no @vprprudhvi/missing in projects/missing. Run rush new --project missing first',
    );
  });

  it('rejects a project that rush new --project did not make', async () => {
    await expect(add('node', 'sample')).rejects.toThrow(
      'projects/sample was not made by rush new --project (projects/sample/scripts/phase.mjs does not find parts). Add the part by hand',
    );
  });

  it('rejects a phase script without the part finder', async () => {
    await replaceText(root, `${FOLDER}/scripts/phase.mjs`, '// old script\n');
    await expect(add('node')).rejects.toThrow(/was not made by rush new --project/);
  });

  it('rejects a target file that exists, and writes nothing', async () => {
    await writeNewText(root, `${FOLDER}/bruno/bruno.json`, '{}\n');
    const before = await snapshot();

    await expect(add('node')).rejects.toThrow(`${FOLDER}/bruno/bruno.json already exists`);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects a vitest config without the default call, and writes nothing', async () => {
    await replaceText(root, `${FOLDER}/vitest.config.ts`, 'export default {};\n');
    const before = await snapshot();

    await expect(add('web')).rejects.toThrow(
      `${FOLDER}/vitest.config.ts does not have "createAppVitestConfig()". Make the web edit by hand`,
    );
    expect(await snapshot()).toEqual(before);
  });

  it('rejects a script that has another value, and writes nothing', async () => {
    const changed = await manifest();
    changed.scripts.start = 'node other.js';
    await replaceText(root, `${FOLDER}/package.json`, JSON.stringify(changed));
    const before = await snapshot();

    await expect(add('node')).rejects.toThrow(
      `${FOLDER}/package.json already has the script "start" with another value`,
    );
    expect(await snapshot()).toEqual(before);
  });

  it('fails when the sample has no version for a dependency, and writes nothing', async () => {
    const sample = await reference();
    delete sample.dependencies['cdk-nag'];
    await replaceText(root, REFERENCE, JSON.stringify(sample));
    const before = await snapshot();

    await expect(add('infra')).rejects.toThrow(`${REFERENCE} has no version for "cdk-nag"`);
    expect(await snapshot()).toEqual(before);
  });
});

describe('mergeManifest', () => {
  it('keeps an equal script, sorts the keys and adds missing fields', () => {
    /** @type {Record<string, Record<string, string>>} */
    const target = { scripts: { b: 'x', a: 'y' } };
    mergeManifest(target, { scripts: { a: 'y' }, dependencies: { z: '1', c: '2' } }, 'p');
    expect(target).toEqual({ scripts: { a: 'y', b: 'x' }, dependencies: { c: '2', z: '1' } });
    expect(Object.keys(target['dependencies'] ?? {})).toEqual(['c', 'z']);
    expect(Object.keys(target['scripts'] ?? {})).toEqual(['a', 'b']);
  });
});
