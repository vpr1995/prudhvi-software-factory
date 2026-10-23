import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { collapseLeadingSlashes, findResponse, resolveRequestPath } from './serve-static.js';

// A small site in a temporary folder, with a secret file next to it and links that point out.
let root = '';
let secret = '';

beforeAll(async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'npt-serve-')));
  root = join(base, 'site');
  secret = join(base, 'secret');
  await mkdir(join(root, 'parks', 'zion'), { recursive: true });
  await mkdir(join(secret, 'folder'), { recursive: true });
  await writeFile(join(root, 'index.html'), 'home');
  await writeFile(join(root, '404.html'), 'not found');
  await writeFile(join(root, 'parks', 'zion', 'index.html'), 'zion');
  await writeFile(join(secret, 'key.txt'), 'secret');
  await writeFile(join(secret, 'folder', 'index.html'), 'secret page');
  await symlink(join(secret, 'key.txt'), join(root, 'leak.txt'));
  await symlink(join(secret, 'folder'), join(root, 'leak'));
  await symlink(join(root, 'parks', 'zion', 'index.html'), join(root, 'zion.html'));
});

describe('findResponse', () => {
  it('serves a folder index and a file', async () => {
    expect(await findResponse(root, '/parks/zion/')).toEqual({
      status: 200,
      file: join(root, 'parks', 'zion', 'index.html'),
    });
    expect(await findResponse(root, '/index.html?x=1')).toEqual({
      status: 200,
      file: join(root, 'index.html'),
    });
  });

  it('redirects a folder without the slash, and keeps the query', async () => {
    expect(await findResponse(root, '/parks/zion?q=1')).toEqual({
      status: 308,
      location: '/parks/zion/?q=1',
    });
  });

  it('collapses leading slashes, so a redirect never names another host', async () => {
    expect(await findResponse(root, '//parks')).toEqual({ status: 308, location: '/parks/' });
    expect(await findResponse(root, '///parks/zion')).toEqual({
      status: 308,
      location: '/parks/zion/',
    });
  });

  it('gives 404 for a symbolic link that points outside the folder', async () => {
    const notFound = { status: 404, file: join(root, '404.html') };
    expect(await findResponse(root, '/leak.txt')).toEqual(notFound);
    expect(await findResponse(root, '/leak/')).toEqual(notFound);
    expect(await findResponse(root, '/leak/index.html')).toEqual(notFound);
  });

  it('serves a symbolic link that stays inside the folder', async () => {
    expect(await findResponse(root, '/zion.html')).toEqual({
      status: 200,
      file: join(root, 'parks', 'zion', 'index.html'),
    });
  });

  it('gives 404 for a path that leaves the folder or does not exist', async () => {
    const notFound = { status: 404, file: join(root, '404.html') };
    expect(await findResponse(root, '/../secret/key.txt')).toEqual(notFound);
    expect(await findResponse(root, '/%2e%2e/secret/key.txt')).toEqual(notFound);
    expect(await findResponse(root, '/parks/atlantis/')).toEqual(notFound);
  });
});

describe('collapseLeadingSlashes and resolveRequestPath', () => {
  it('keeps one leading slash', () => {
    expect(collapseLeadingSlashes('//a//b')).toBe('/a//b');
    expect(collapseLeadingSlashes('/a')).toBe('/a');
  });

  it('rejects bad encodings, NUL and backslashes', () => {
    expect(resolveRequestPath(root, '/%E0%A4%A')).toBeUndefined();
    expect(resolveRequestPath(root, '/a%00b')).toBeUndefined();
    expect(resolveRequestPath(root, '/a%5Cb')).toBeUndefined();
  });
});
