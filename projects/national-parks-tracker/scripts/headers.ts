// Writes web/out/_headers for Cloudflare: node scripts/headers.ts web/out
//
// The Content Security Policy of this site has no 'unsafe-inline' (see README, Hosting). Next.js puts
// inline scripts in each page, so each page needs the hashes of its own scripts. Cloudflare allows
// 2000 characters in a header line, so one policy for all pages is too long. Each page gets its own
// rule with its own hashes. The rule `/*` holds the headers that do not depend on the page. It has
// a base policy without script-src, so an unknown path (the 404 page) still gets those limits.
// Cloudflare allows 100 rules in a _headers file: this script fails when a build needs more.
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import { listFiles, readText, writeText } from './fs-io.ts';

export const MAX_RULES = 100;

/** One built page: the URL path and the inline code that the browser must be allowed to run. */
export type Page = {
  readonly urlPath: string;
  readonly scripts: readonly string[];
  readonly styleAttributes: readonly string[];
};

const FIXED_DIRECTIVES = [
  "img-src 'self' https://tile.openstreetmap.org https://upload.wikimedia.org data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
];

const SHARED_HEADERS = [
  'X-Content-Type-Options: nosniff',
  'X-Frame-Options: DENY',
  'Referrer-Policy: strict-origin-when-cross-origin',
  'Permissions-Policy: camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security: max-age=31536000; includeSubDomains',
];

const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
const STYLE_ATTRIBUTE = /\sstyle="([^"]*)"/g;

/**
 * Makes the CSP hash source of a text.
 *
 * @param text - The exact text of the script, or of the style attribute.
 * @returns For example `'sha256-abc='`.
 */
export function hashSource(text: string): string {
  return `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
}

/**
 * Reads the inline scripts of an HTML page.
 *
 * @param html - The page.
 * @returns The text of each script that has no `src`.
 */
export function inlineScripts(html: string): string[] {
  return [...html.matchAll(INLINE_SCRIPT)].map((match) => match[1] ?? '').filter(Boolean);
}

/**
 * Reads the style attributes of an HTML page. The HTML escapes are removed: the browser hashes the
 * value of the attribute, not its source text.
 *
 * @param html - The page.
 * @returns The value of each style attribute.
 */
export function styleAttributes(html: string): string[] {
  return [...html.matchAll(STYLE_ATTRIBUTE)].map((match) =>
    (match[1] ?? '')
      .replaceAll('&quot;', '"')
      .replaceAll('&#x27;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&'),
  );
}

/**
 * Builds the policy of one page.
 *
 * @param page - The page.
 * @returns The Content-Security-Policy value.
 */
function pagePolicy(page: Page): string {
  const scriptHashes = [...new Set(page.scripts.map(hashSource))];
  const styleHashes = [...new Set(page.styleAttributes.map(hashSource))];
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self'",
    ...(styleHashes.length === 0
      ? []
      : [`style-src-attr 'unsafe-hashes' ${styleHashes.join(' ')}`]),
    ...FIXED_DIRECTIVES,
  ].join('; ');
}

/**
 * Builds the text of the _headers file.
 *
 * @param pages - The built pages.
 * @returns The file text.
 * @throws When the pages need more than 100 rules.
 */
export function buildHeaders(pages: readonly Page[]): string {
  if (pages.length + 1 > MAX_RULES) {
    throw new Error(
      `${String(pages.length + 1)} rules are more than the ${String(MAX_RULES)} that Cloudflare allows in a _headers file.`,
    );
  }
  const blocks = [
    [
      '/*',
      `  Content-Security-Policy: ${FIXED_DIRECTIVES.join('; ')}`,
      ...SHARED_HEADERS.map((header) => `  ${header}`),
    ],
    ...pages.map((page) => [page.urlPath, `  Content-Security-Policy: ${pagePolicy(page)}`]),
  ];
  return `${blocks.map((lines) => lines.join('\n')).join('\n\n')}\n`;
}

/**
 * Reads the pages of a static export.
 *
 * @param outFolder - The export folder.
 * @returns One page for each `index.html` (path `/x/`). `404.html` is a page too.
 */
function readPages(outFolder: string): Page[] {
  const pages: Page[] = [];
  for (const file of listFiles(outFolder).sort()) {
    const path = relative(outFolder, file).split(sep).join('/');
    const urlPath =
      path === 'index.html'
        ? '/'
        : path.endsWith('/index.html')
          ? `/${path.slice(0, -'index.html'.length)}`
          : path === '404.html'
            ? '/404.html'
            : undefined;
    if (urlPath === undefined) {
      continue;
    }
    const html = readText(file);
    pages.push({ urlPath, scripts: inlineScripts(html), styleAttributes: styleAttributes(html) });
  }
  return pages;
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  const outFolder = argv[2];
  if (outFolder === undefined) {
    stderr.write('Usage: node scripts/headers.ts <export folder>\n');
    exit(1);
  }
  const pages = readPages(outFolder);
  writeText(join(outFolder, '_headers'), buildHeaders(pages));
  stdout.write(`headers: wrote ${String(pages.length + 1)} rules to ${outFolder}/_headers\n`);
}
