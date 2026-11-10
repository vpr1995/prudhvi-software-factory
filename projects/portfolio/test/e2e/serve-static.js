// A tiny static file server for the e2e tests: node test/e2e/serve-static.js <folder> [port].
// It serves the static export of the web app on 127.0.0.1. No dependencies.
// - `/x/` serves `/x/index.html`. `/x` (a folder without the slash) redirects to `/x/`.
// - An unknown path serves `404.html` with status 404, like CloudFront will.
// - A file response gets the headers of the folder's `_headers` file, as Cloudflare sends them.
// - A path that leaves the folder (`..`, encoded or not, or a symbolic link) gets 404.
// - Leading slashes collapse to one, so `//parks` redirects to `/parks/`, not to the host `parks`.
// It lives in test/ because it is test support code: it serves the e2e build and the screenshots.
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4320;
const STATUS_OK = 200;
const STATUS_REDIRECT = 308;
const STATUS_BAD_METHOD = 405;
const STATUS_NOT_FOUND = 404;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Gives the content type of a file from its extension.
 *
 * @param {string} filePath - The file path.
 * @returns {string} The content type.
 */
export function getContentType(filePath) {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Turns a request URL into a path inside the root folder.
 *
 * @param {string} root - The absolute root folder.
 * @param {string} url - The request URL, for example `/parks/zion/?_rsc=1`.
 * @returns {string | undefined} The absolute path, or undefined when the path is not allowed.
 */
export function resolveRequestPath(root, url) {
  const pathname = url.split(/[?#]/, 1)[0] ?? '/';
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) {
    return;
  }
  const absolute = resolve(root, `.${normalize(decoded)}`);
  if (isInside(root, absolute)) {
    return absolute;
  }
}

/**
 * Collapses the leading slashes of a request URL to one. A redirect to `//parks/` would send the
 * browser to the host `parks`.
 *
 * @param {string} url - The request URL.
 * @returns {string} The URL with one leading slash.
 */
export function collapseLeadingSlashes(url) {
  return url.replace(/^\/{2,}/, '/');
}

/**
 * Tells whether a path is the root folder or inside it.
 *
 * @param {string} root - The root folder.
 * @param {string} target - The path.
 * @returns {boolean} True when the path is inside.
 */
function isInside(root, target) {
  return target === root || target.startsWith(`${root}${sep}`);
}

/**
 * Gives the real path (symbolic links resolved) when it stays inside the real root folder.
 *
 * @param {string} root - The root folder.
 * @param {string} target - The path.
 * @returns {Promise<string | undefined>} The real path, or undefined when it leaves the root or does not exist.
 */
async function realPathInside(root, target) {
  // Check the lexical path before any file system call, then check the real path again.
  const lexicalRoot = resolve(root);
  const lexicalTarget = resolve(target);
  if (lexicalTarget !== lexicalRoot && !lexicalTarget.startsWith(`${lexicalRoot}${sep}`)) {
    return;
  }
  try {
    const realRoot = await realpath(lexicalRoot);
    // Walk the folders by name. Each name comes from the folder listing, never from the request.
    let current = realRoot;
    for (const segment of relative(lexicalRoot, lexicalTarget).split(sep).filter(Boolean)) {
      const names = await readdir(current);
      const name = names.find((entry) => entry === segment);
      if (name === undefined) return;
      current = join(current, name);
    }
    const realTarget = await realpath(current);
    return isInside(realRoot, realTarget) ? realTarget : undefined;
  } catch {
    return;
  }
}

/**
 * Reads the file information, or nothing when the path does not exist.
 *
 * @param {string} filePath - The path.
 * @returns {Promise<import('node:fs').Stats | undefined>} The information.
 */
async function tryStat(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return;
  }
}

/**
 * Reads a file, or gives a short text when the file does not exist.
 *
 * @param {string} filePath - The path.
 * @returns {Promise<Buffer>} The file content.
 */
async function readOrNotFound(filePath) {
  try {
    return await readFile(filePath);
  } catch {
    return Buffer.from('Not found');
  }
}

/**
 * Finds what to send for a request.
 *
 * @param {string} root - The absolute root folder.
 * @param {string} requestUrl - The request URL.
 * @returns {Promise<{ status: number, file?: string, location?: string }>} The answer.
 */
export async function findResponse(root, requestUrl) {
  const notFound = { status: STATUS_NOT_FOUND, file: join(root, '404.html') };
  const url = collapseLeadingSlashes(requestUrl);
  const requested = resolveRequestPath(root, url);
  // A symbolic link inside the folder can point outside it. Check the real path again.
  const target = requested === undefined ? undefined : await realPathInside(root, requested);
  if (target === undefined) {
    return notFound;
  }
  const info = await tryStat(target);
  if (info?.isFile()) {
    return { status: STATUS_OK, file: target };
  }
  if (!info?.isDirectory()) {
    return notFound;
  }
  const [pathname = '/', query] = url.split('?');
  if (!pathname.endsWith('/')) {
    // Build the location from the real folder path, not from the request text. The location is
    // always one path on this host: each segment is encoded, so no segment can start a new host.
    const segments = relative(root, target).split(sep).filter(Boolean).map(encodeURIComponent);
    const location = `/${segments.join('/')}${segments.length > 0 ? '/' : ''}`;
    return {
      status: STATUS_REDIRECT,
      location: query === undefined ? location : `${location}?${encodeURI(query)}`,
    };
  }
  const index = await realPathInside(root, join(target, 'index.html'));
  const indexInfo = index === undefined ? undefined : await tryStat(index);
  return index !== undefined && indexInfo?.isFile() ? { status: STATUS_OK, file: index } : notFound;
}

/**
 * Reads the rules of a `_headers` file, the way Cloudflare reads it. Only literal paths and `/*`
 * are supported, because `scripts/headers.ts` emits no other form. Lines that are not indented
 * start a rule. Indented lines are `Name: value` headers of the last rule.
 *
 * @param {string} text - The file text.
 * @returns {{ path: string, headers: [string, string][] }[]} The rules, in file order.
 */
export function parseHeadersFile(text) {
  /** @type {{ path: string, headers: [string, string][] }[]} */
  const rules = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const separator = line.indexOf(':');
    const current = rules.at(-1);
    if (/^\s/.test(line)) {
      if (current !== undefined && separator > 0) {
        current.headers.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
      }
    } else {
      rules.push({ path: line.trim(), headers: [] });
    }
  }
  return rules;
}

/**
 * Gives the headers of one request path. Every rule that matches adds its headers. When two
 * rules set the same header, the values are joined with a comma, as Cloudflare does. A CSP
 * joined this way is two policies, and the browser enforces both.
 *
 * @param {{ path: string, headers: [string, string][] }[]} rules - The rules, in file order.
 * @param {string} pathname - The request path, for example `/parks/zion/`.
 * @returns {Record<string, string>} The header names and values.
 */
export function headersForPath(rules, pathname) {
  /** @type {Record<string, string>} */
  const result = {};
  for (const rule of rules) {
    if (rule.path !== '/*' && rule.path !== pathname) {
      continue;
    }
    for (const [name, value] of rule.headers) {
      result[name] = result[name] === undefined ? value : `${result[name]}, ${value}`;
    }
  }
  return result;
}

/**
 * Reads the `_headers` file of the served folder. A folder with no file has no rules.
 *
 * @param {string} root - The absolute root folder.
 * @returns {Promise<{ path: string, headers: [string, string][] }[]>} The rules.
 */
async function readHeaderRules(root) {
  try {
    return parseHeadersFile(await readFile(join(root, '_headers'), 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Sends the file, the redirect or the 404 page for one GET or HEAD request. A file response gets the
 * headers of the `_headers` file. A redirect does not.
 *
 * @param {import('node:http').IncomingMessage} request - The request.
 * @param {import('node:http').ServerResponse} response - The response.
 * @param {string} absoluteRoot - The absolute root folder.
 * @returns {Promise<void>} Resolves when the response is sent.
 */
async function answerRequest(request, response, absoluteRoot) {
  const url = request.url ?? '/';
  const answer = await findResponse(absoluteRoot, url);
  if (answer.location !== undefined) {
    response.writeHead(answer.status, { location: answer.location }).end();
    return;
  }
  const file = answer.file ?? join(absoluteRoot, '404.html');
  const body = await readOrNotFound(file);
  const pathname = collapseLeadingSlashes(url).split(/[?#]/, 1)[0] ?? '/';
  const fromHeadersFile = headersForPath(await readHeaderRules(absoluteRoot), pathname);
  response.writeHead(answer.status, {
    'content-type': getContentType(file),
    'content-length': body.length,
    'cache-control': 'no-store',
    ...fromHeadersFile,
  });
  if (request.method === 'HEAD') {
    response.end();
  } else {
    response.end(body);
  }
}

/**
 * Creates the server.
 *
 * @param {string} root - The folder to serve.
 * @returns {import('node:http').Server} The server. Call `listen`.
 */
export function createStaticServer(root) {
  const absoluteRoot = resolve(root);
  return createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(STATUS_BAD_METHOD, { allow: 'GET, HEAD' }).end();
      return;
    }
    const send = async () => {
      try {
        await answerRequest(request, response, absoluteRoot);
      } catch {
        response.writeHead(STATUS_NOT_FOUND).end();
      }
    };
    void send();
  });
}

const isMain = import.meta.filename === argv[1];
if (isMain) {
  const [, , folder, portText] = argv;
  if (folder === undefined) {
    stderr.write('Usage: node test/e2e/serve-static.js <folder> [port]\n');
    exit(2);
  }
  const port = portText === undefined ? DEFAULT_PORT : Number(portText);
  createStaticServer(folder).listen(port, HOST, () => {
    stdout.write(`Serving ${folder} at http://${HOST}:${String(port)}/\n`);
  });
}
