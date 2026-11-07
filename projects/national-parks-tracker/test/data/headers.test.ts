import { describe, expect, it } from 'vitest';

import {
  MAX_RULES,
  buildHeaders,
  hashSource,
  inlineScripts,
  styleAttributes,
} from '../../scripts/headers.ts';
import type { Page } from '../../scripts/headers.ts';

const ZION: Page = {
  urlPath: '/parks/zion/',
  scripts: ['self.__next_f.push([1,"zion"])', 'window.a=1'],
  styleAttributes: ['position:absolute;height:100%'],
};

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
  const text = buildHeaders([ZION, { urlPath: '/', scripts: ['x()'], styleAttributes: [] }]);

  it('puts the hashes of a page in the rule of that page and never uses unsafe-inline', () => {
    const rule = text.split('\n\n').find((block) => block.startsWith('/parks/zion/')) ?? '';
    for (const script of ZION.scripts) {
      expect(rule).toContain(hashSource(script));
    }
    expect(rule).toContain(
      `style-src-attr 'unsafe-hashes' ${hashSource(ZION.styleAttributes[0] ?? '')}`,
    );
    expect(text).not.toContain("'unsafe-inline'");
    expect(text).not.toContain("'unsafe-eval'");
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

  it('allows images only from this site, OpenStreetMap tiles and Wikimedia', () => {
    expect(text).toContain(
      "img-src 'self' https://tile.openstreetmap.org https://upload.wikimedia.org data:",
    );
  });

  it('keeps every line under the 2000 characters of Cloudflare', () => {
    expect(Math.max(...text.split('\n').map((line) => line.length))).toBeLessThan(2000);
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
