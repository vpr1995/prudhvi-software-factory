import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  collapseLeadingSlashes,
  findResponse,
  headersForPath,
  parseHeadersFile,
  resolveRequestPath,
} from './serve-static.js';

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

describe('parseHeadersFile and headersForPath', () => {
  const headersFile = [
    '/*',
    "  Content-Security-Policy: default-src 'self'",
    '  X-Frame-Options: DENY',
    '',
    '/',
    "  Content-Security-Policy: script-src 'self' 'sha256-abc='",
    '',
    '/parks/zion/',
    '  X-Frame-Options: SAMEORIGIN',
    '',
  ].join('\n');

  it('reads each rule with its path and header lines', () => {
    expect(parseHeadersFile(headersFile)).toEqual([
      {
        path: '/*',
        headers: [
          ['Content-Security-Policy', "default-src 'self'"],
          ['X-Frame-Options', 'DENY'],
        ],
      },
      { path: '/', headers: [['Content-Security-Policy', "script-src 'self' 'sha256-abc='"]] },
      { path: '/parks/zion/', headers: [['X-Frame-Options', 'SAMEORIGIN']] },
    ]);
  });

  it('gives the headers of the rules that match the path, with repeated values joined by a comma', () => {
    const rules = parseHeadersFile(headersFile);
    expect(headersForPath(rules, '/')).toEqual({
      'Content-Security-Policy': "default-src 'self', script-src 'self' 'sha256-abc='",
      'X-Frame-Options': 'DENY',
    });
    expect(headersForPath(rules, '/parks/zion/')).toEqual({
      'Content-Security-Policy': "default-src 'self'",
      'X-Frame-Options': 'DENY, SAMEORIGIN',
    });
  });

  it('gives only the base rule to a path with no rule of its own', () => {
    expect(headersForPath(parseHeadersFile(headersFile), '/404/')).toEqual({
      'Content-Security-Policy': "default-src 'self'",
      'X-Frame-Options': 'DENY',
    });
  });
});
