import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { exec, GATES, makeRepository } from './harness.js';

const BRUNO = path.join(GATES, 'bruno-coverage.mjs');
const PLAYWRIGHT = path.join(GATES, 'playwright-coverage.mjs');

const OPENAPI = JSON.stringify({
  openapi: '3.1.0',
  paths: {
    '/v1/health': { get: {} },
    '/v1/notes': { get: {}, post: {} },
    '/v1/notes/{id}': { delete: {} },
  },
});

/**
 * Makes a .bru file.
 *
 * @param {string} method - HTTP method.
 * @param {string} url - Request URL.
 * @param {string} [body] - Extra blocks.
 * @returns {string} File text.
 */
function bru(method, url, body = 'assert {\n  res.status: eq 200\n}\n') {
  return `meta {\n  name: x\n  type: http\n}\n\n${method} {\n  url: ${url}\n  body: none\n  auth: none\n}\n\n${body}`;
}

const API_FILES = {
  'projects/p/package.json': '{"name":"@vprprudhvi/p"}\n',
  'projects/p/src/api/lambda.ts': 'export const handler = 1;\n',
  'projects/p/dist/openapi.json': OPENAPI,
  'projects/p/bruno/bruno.json': '{"name":"p"}\n',
  'projects/p/bruno/environments/local.bru': 'vars {\n  baseUrl: http://localhost:3000\n}\n',
  'projects/p/bruno/health/get.bru': bru('get', '{{baseUrl}}/v1/health'),
  'projects/p/bruno/notes/list.bru': bru('get', '{{baseUrl}}/v1/notes?limit=1'),
  'projects/p/bruno/notes/create.bru': bru(
    'post',
    '{{baseUrl}}/v1/notes',
    'tests {\n  test("created", function () {\n    expect(res.status).to.equal(201);\n  });\n}\n',
  ),
  'projects/p/bruno/notes/delete.bru': bru('delete', '{{baseUrl}}/v1/notes/:id'),
};

describe('bruno-coverage', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository(API_FILES);
  });

  afterEach(() => repository.remove());

  const run = (args = []) => exec('node', [BRUNO, '--root', repository.root, ...args]);

  it('passes when every route has a request with an assertion', () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /bruno-coverage: pass \(1 project\(s\) checked\)/);
  });

  it('fails with file:line for a route with no request', () => {
    repository.git('rm', '-q', '-f', 'projects/p/bruno/notes/create.bru');
    const result = run();
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /projects\/p\/dist\/openapi\.json:1: no \.bru file .* POST \/v1\/notes/,
    );
  });

  it('fails when the method does not match', () => {
    repository.write('projects/p/bruno/health/get.bru', bru('post', '{{baseUrl}}/v1/health'));
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GET \/v1\/health/);
  });

  it('fails when the path does not match', () => {
    repository.write(
      'projects/p/bruno/notes/delete.bru',
      bru('delete', '{{baseUrl}}/v1/other/:id'),
    );
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DELETE \/v1\/notes\/\{\}/);
  });

  it('fails for a request with no assertion', () => {
    repository.write(
      'projects/p/bruno/health/get.bru',
      bru('get', '{{baseUrl}}/v1/health', 'docs {\n  Purpose: x\n}\n'),
    );
    const result = run();
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /projects\/p\/bruno\/health\/get\.bru:1: .*no assert entry or test/,
    );
  });

  it('fails for an empty assert block', () => {
    repository.write(
      'projects/p/bruno/health/get.bru',
      bru('get', '{{baseUrl}}/v1/health', 'assert {\n}\n'),
    );
    assert.equal(run().status, 1);
  });

  it('treats :id, {id} and {{id}} as the same parameter, and allows a base path', () => {
    repository.write(
      'projects/p/bruno/notes/delete.bru',
      bru('delete', '{{baseUrl}}/api/v1/notes/{{noteId}}'),
    );
    assert.equal(run().status, 0);
  });

  it('fails with a hint when the OpenAPI document is missing', () => {
    repository.git('rm', '-q', '-f', 'projects/p/dist/openapi.json');
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Build the project first/);
  });

  it('skips projects with no api part', () => {
    repository.write('projects/web-only/package.json', '{}\n');
    repository.write('projects/web-only/web/app/page.tsx', 'export default 1;\n');
    assert.match(run().stdout, /1 project\(s\) checked/);
  });

  it('fails when the contracts declare no routes', () => {
    repository.write('projects/p/dist/openapi.json', '{"openapi":"3.1.0","paths":{}}\n');
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /declare no routes/);
  });

  it('fails when the only assert line is disabled with ~', () => {
    repository.write(
      'projects/p/bruno/health/get.bru',
      bru('get', '{{baseUrl}}/v1/health', 'assert {\n  ~res.status: eq 200\n}\n'),
    );
    assert.equal(run().status, 1);
  });

  it('fails when the tests block has an empty test() or only a constant check', () => {
    repository.write(
      'projects/p/bruno/health/get.bru',
      bru('get', '{{baseUrl}}/v1/health', 'tests {\n  test("ok", function () {});\n}\n'),
    );
    assert.equal(run().status, 1);
    repository.write(
      'projects/p/bruno/health/get.bru',
      bru(
        'get',
        '{{baseUrl}}/v1/health',
        'tests {\n  test("ok", function () {\n    expect(true).to.equal(true);\n  });\n}\n',
      ),
    );
    assert.equal(run().status, 1);
  });

  it('does not count an expect() that sits in a comment', () => {
    repository.write(
      'projects/p/bruno/health/get.bru',
      bru('get', '{{baseUrl}}/v1/health', 'tests {\n  // expect(res.status).to.equal(200);\n}\n'),
    );
    assert.equal(run().status, 1);
  });

  it('fails when bruno.json makes the runner ignore the folder with the requests', () => {
    repository.write(
      'projects/p/bruno/bruno.json',
      '{"name":"p","ignore":["node_modules",".git","notes"]}\n',
    );
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ignores "notes"/);
  });

  it('reads the routes from the project dist/openapi.json, not from a contracts folder', () => {
    repository.git('rm', '-q', '-f', 'projects/p/dist/openapi.json');
    repository.write('projects/p/src/contracts/dist/openapi.json', OPENAPI);
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /projects\/p\/dist\/openapi\.json:1: no dist\/openapi\.json found/);
    assert.match(result.stderr, /build --to @vprprudhvi\/p\b/);
  });

  for (const [part, manifest] of [
    ['api-py', 'pyproject.toml'],
    ['api-go', 'go.mod'],
  ]) {
    it(`checks a project whose only API part is src/${part}`, () => {
      repository.git('rm', '-q', '-r', '-f', 'projects/p/src/api');
      repository.write(`projects/p/src/${part}/${manifest}`, 'x\n');
      assert.match(run().stdout, /pass \(1 project\(s\) checked\)/);
      repository.git('rm', '-q', '-f', 'projects/p/bruno/notes/create.bru');
      assert.equal(run().status, 1);
    });
  }

  it('does not count a project that has only contracts or only a CDK app', () => {
    repository.write('projects/c/package.json', '{}\n');
    repository.write('projects/c/src/contracts/index.ts', 'export {};\n');
    repository.write('projects/i/package.json', '{}\n');
    repository.write('projects/i/lib/stack.ts', 'export {};\n');
    assert.match(run().stdout, /pass \(1 project\(s\) checked\)/);
  });

  it('ignores a folder in the old layout (no package.json at the project folder)', () => {
    repository.write('projects/old/api/package.json', '{}\n');
    repository.write('projects/old/contracts/dist/openapi.json', OPENAPI);
    assert.match(run().stdout, /pass \(1 project\(s\) checked\)/);
  });

  it('shows help and rejects bad arguments', () => {
    const help = exec('node', [BRUNO, '--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^bruno-coverage:/);
    assert.equal(exec('node', [BRUNO, '--nope']).status, 2);
  });
});

const SPEC = (route, axe = true) =>
  `import { expect, test } from '@playwright/test';\nimport AxeBuilder from '@axe-core/playwright';\n\ntest('${route}', async ({ page }) => {\n  await page.goto('${route}');\n${axe ? '  const results = await new AxeBuilder({ page }).analyze();\n  expect(results.violations).toEqual([]);\n' : ''}});\n`;

const WEB_FILES = {
  'projects/p/package.json': '{"name":"@vprprudhvi/p"}\n',
  'projects/p/web/app/page.tsx': 'export default function Page() { return null; }\n',
  'projects/p/web/app/notes/page.tsx': 'export default function Page() { return null; }\n',
  'projects/p/web/app/notes/[id]/page.tsx': 'export default function Page() { return null; }\n',
  'projects/p/web/app/(marketing)/about/page.tsx':
    'export default function Page() { return null; }\n',
  'projects/p/web/app/_private/page.tsx': 'export default function Page() { return null; }\n',
  'projects/p/web/app/@modal/login/page.tsx': 'export default function Page() { return null; }\n',
  'projects/p/web/e2e/home.spec.ts': SPEC('/'),
  'projects/p/web/e2e/notes.spec.ts': `${SPEC('/notes')}\ntest('detail', async ({ page }) => {\n  await page.goto(\`/notes/\${1}?x=1\`);\n  const results = await new AxeBuilder({ page }).analyze();\n  expect(results.violations).toEqual([]);\n});\n`,
  'projects/p/web/e2e/about.spec.ts': SPEC('/about'),
};

describe('playwright-coverage', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository(WEB_FILES);
  });

  afterEach(() => repository.remove());

  const run = (args = []) => exec('node', [PLAYWRIGHT, '--root', repository.root, ...args]);

  it('passes when every page has a spec with goto and axe (groups, private and slot folders are not routes)', () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /playwright-coverage: pass \(1 web project\(s\) checked\)/);
  });

  it('fails for a page with no spec', () => {
    repository.write(
      'projects/p/web/app/settings/page.tsx',
      'export default function Page() { return null; }\n',
    );
    const result = run();
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /projects\/p\/web\/app\/settings\/page\.tsx:1: no Playwright spec calls page\.goto\('\/settings'\)/,
    );
  });

  it('fails when the spec has no axe check', () => {
    repository.write('projects/p/web/e2e/about.spec.ts', SPEC('/about', false));
    const result = run();
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /projects\/p\/web\/e2e\/about\.spec\.ts:1: the spec for \/about has no axe check/,
    );
  });

  it('accepts a dynamic route reached through a template string, and a full URL with a query', () => {
    repository.write(
      'projects/p/web/e2e/notes.spec.ts',
      `${SPEC('/notes')}\ntest('d', async ({ page }) => {\n  await page.goto('http://localhost:3000/notes/42#top');\n  const results = await new AxeBuilder({ page }).analyze();\n  expect(results.violations).toEqual([]);\n});\n`,
    );
    assert.equal(run().status, 0);
  });

  it('fails when the web part has no e2e folder', () => {
    repository.git('rm', '-q', '-r', '-f', 'projects/p/web/e2e');
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no e2e folder/);
  });

  it('fails when the e2e folder has no spec', () => {
    repository.write('projects/p/web/e2e/readme.txt', 'x\n');
    repository.git(
      'rm',
      '-q',
      '-r',
      '-f',
      'projects/p/web/e2e/home.spec.ts',
      'projects/p/web/e2e/notes.spec.ts',
      'projects/p/web/e2e/about.spec.ts',
    );
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no \*\.spec\.ts file/);
  });

  it('matches catch-all routes', () => {
    repository.write(
      'projects/p/web/app/docs/[...slug]/page.tsx',
      'export default function Page() { return null; }\n',
    );
    assert.equal(run().status, 1);
    repository.write('projects/p/web/e2e/docs.spec.ts', SPEC('/docs/a/b'));
    assert.equal(run().status, 0);
  });

  it('does not count a goto or an axe check that sits in a comment', () => {
    repository.write(
      'projects/p/web/e2e/about.spec.ts',
      "import { test } from '@playwright/test';\n// await page.goto('/about');\n// new AxeBuilder({ page }).analyze();\ntest('x', async () => {});\n",
    );
    assert.equal(run().status, 1);
  });

  it('needs the axe check in the same test as the goto', () => {
    repository.write(
      'projects/p/web/e2e/about.spec.ts',
      "import { expect, test } from '@playwright/test';\ntest('visit', async ({ page }) => {\n  await page.goto('/about');\n});\ntest('axe elsewhere', async ({ page }) => {\n  const results = await new AxeBuilder({ page }).analyze();\n  expect(results.violations).toEqual([]);\n});\n",
    );
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /the spec for \/about has no axe check/);
  });

  it('needs analyze() and an expect() for AxeBuilder', () => {
    repository.write(
      'projects/p/web/e2e/about.spec.ts',
      "test('x', async ({ page }) => {\n  await page.goto('/about');\n  new AxeBuilder({ page });\n});\n",
    );
    assert.equal(run().status, 1);
    repository.write(
      'projects/p/web/e2e/about.spec.ts',
      "test('x', async ({ page }) => {\n  await page.goto('/about');\n  await new AxeBuilder({ page }).analyze();\n});\n",
    );
    assert.equal(run().status, 1);
  });

  it('accepts a helper function in the same file that holds the axe check', () => {
    repository.write(
      'projects/p/web/e2e/about.spec.ts',
      "import { expect, test } from '@playwright/test';\nasync function checkAxe(page) {\n  const results = await new AxeBuilder({ page }).analyze();\n  expect(results.violations).toEqual([]);\n}\ntest('x', async ({ page }) => {\n  await page.goto('/about');\n  await checkAxe(page);\n});\n",
    );
    assert.equal(run().status, 0, run().stderr);
  });

  it('fails when the web part has no page route at all', () => {
    repository.git('rm', '-q', '-r', '-f', 'projects/p/web/app');
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no page route/);
  });

  it('still scans pages in web/src/app', () => {
    repository.write(
      'projects/p/web/src/app/settings/page.tsx',
      'export default function Page() { return null; }\n',
    );
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /web\/src\/app\/settings\/page\.tsx:1: no Playwright spec/);
  });

  it('checks a project that has a web folder, and fails when web/e2e is missing', () => {
    repository.write('projects/q/package.json', '{}\n');
    repository.write(
      'projects/q/web/app/page.tsx',
      'export default function Page() { return null; }\n',
    );
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /projects\/q\/web\/e2e:1: the web part has no e2e folder/);
  });

  it('does not count a project with no web folder', () => {
    repository.write('projects/api-only/package.json', '{}\n');
    repository.write('projects/api-only/src/api/lambda.ts', 'export {};\n');
    assert.match(run().stdout, /pass \(1 web project\(s\) checked\)/);
  });

  it('ignores a folder in the old layout (web/package.json, no package.json at the project folder)', () => {
    repository.write('projects/old/web/package.json', '{}\n');
    repository.write(
      'projects/old/web/app/page.tsx',
      'export default function Page() { return null; }\n',
    );
    assert.match(run().stdout, /pass \(1 web project\(s\) checked\)/);
  });

  it('shows help and rejects bad arguments', () => {
    const help = exec('node', [PLAYWRIGHT, '--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^playwright-coverage:/);
    assert.equal(exec('node', [PLAYWRIGHT, '--nope']).status, 2);
  });
});
