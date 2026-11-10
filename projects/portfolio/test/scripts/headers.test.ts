import { describe, expect, it } from 'vitest';

import {
  MAX_RULES,
  buildHeaders,
  hashSource,
  inlineScripts,
  styleAttributes,
} from '../../scripts/headers.ts';
import type { Page } from '../../scripts/headers.ts';

const HOME: Page = {
  urlPath: '/',
  scripts: ['self.__next_f.push([1,"home"])', 'window.a=1'],
  styleAttributes: ['position:absolute;height:100%'],
};

// The directives of the page rule, in the order the script emits them. The style-src-attr
// directive is present only when the page has style attributes.
const PAGE_DIRECTIVES_WITHOUT_ATTRIBUTES = [
  "default-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
];

describe('hashSource', () => {
  it('makes a sha256 source in base64', () => {
    expect(hashSource('abc')).toBe("'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='");
  });
});

describe('inlineScripts and styleAttributes', () => {
  it('reads inline scripts, skips scripts with a src, and unescapes style attributes', () => {
    const html =
      '<script src="/a.js"></script><script>one()</script><script async>two()</script>' +
      '<img style="font-family:&quot;a&quot;;width:1px&amp;2">';
    expect(inlineScripts(html)).toEqual(['one()', 'two()']);
    expect(styleAttributes(html)).toEqual(['font-family:"a";width:1px&2']);
  });
});

describe('buildHeaders', () => {
  const text = buildHeaders([HOME, { urlPath: '/about/', scripts: ['x()'], styleAttributes: [] }]);

  it('has the exact directive list of a page rule, in order', () => {
    const rule = text.split('\n\n').find((block) => block.startsWith('/\n')) ?? '';
    const policy = rule.split('\n')[1]?.trim().replace('Content-Security-Policy: ', '') ?? '';
    const directives = policy.split('; ');
    expect(directives).toEqual([
      "default-src 'self'",
      `script-src 'self' ${hashSource(HOME.scripts[0] ?? '')} ${hashSource(HOME.scripts[1] ?? '')}`,
      "style-src 'self'",
      `style-src-attr 'unsafe-hashes' ${hashSource(HOME.styleAttributes[0] ?? '')}`,
      ...PAGE_DIRECTIVES_WITHOUT_ATTRIBUTES.slice(2),
    ]);
  });

  it('puts the hashes of a page in the rule of that page and never uses unsafe-inline', () => {
    const rule = text.split('\n\n').find((block) => block.startsWith('/\n')) ?? '';
    for (const script of HOME.scripts) {
      expect(rule).toContain(hashSource(script));
    }
    expect(rule).toContain(
      `style-src-attr 'unsafe-hashes' ${hashSource(HOME.styleAttributes[0] ?? '')}`,
    );
    expect(text).not.toContain("'unsafe-inline'");
    expect(text).not.toContain("'unsafe-eval'");
  });

  it('omits style-src-attr when a page has no style attributes', () => {
    const plain = buildHeaders([{ urlPath: '/x/', scripts: ['x()'], styleAttributes: [] }]);
    expect(plain).not.toContain('style-src-attr');
  });

  it('sets the shared security headers and a base policy for every path', () => {
    const base = text.split('\n\n')[0] ?? '';
    expect(base.startsWith('/*\n')).toBe(true);
    for (const name of [
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
    ]) {
      expect(base).toContain(`\n  ${name}: `);
    }
    expect(base).not.toContain('script-src');
    expect(base).toContain("frame-ancestors 'none'");
  });

  it('allows images only from this site and inline data URIs', () => {
    expect(text).toContain("img-src 'self' data:");
    const imgSource = text.split('; ').find((directive) => directive.startsWith('img-src')) ?? '';
    expect(imgSource).toBe("img-src 'self' data:");
    expect(imgSource).not.toContain('https://');
    expect(text).not.toContain('tile.openstreetmap.org');
    expect(text).not.toContain('upload.wikimedia.org');
  });

  it('keeps every line under the 2000 characters of Cloudflare', () => {
    expect(Math.max(...text.split('\n').map((line) => line.length))).toBeLessThan(2000);
  });

  it('throws when a header line is too long for Cloudflare', () => {
    const many = Array.from({ length: 40 }, (_, index) => `a${String(index)}()`);
    const page = { urlPath: '/x/', scripts: [], styleAttributes: many };
    expect(() => buildHeaders([page])).toThrow(/Cloudflare allows less than 2000/);
  });

  it('throws when the pages need more than the rules that Cloudflare allows', () => {
    const pages = Array.from({ length: MAX_RULES }, (_, index) => ({
      urlPath: `/p${String(index)}/`,
      scripts: [],
      styleAttributes: [],
    }));
    expect(() => buildHeaders(pages)).toThrow(/more than the 100/);
    expect(() => buildHeaders(pages.slice(1))).not.toThrow();
  });
});
