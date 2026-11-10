import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import RootLayout, { metadata, viewport } from '../../../web/app/layout';
import { content } from '../../../web/lib/content';
import { THEME_SCRIPT } from '../../../web/lib/theme';

// next/font/local only runs inside the Next.js build, so the font modules are replaced here. The
// build and the Playwright specs load the real Geist fonts.
vi.mock('next/font/google', () =>
  Object.fromEntries([
    ['Space_Grotesk', () => ({ variable: '__display' })],
    ['Plus_Jakarta_Sans', () => ({ variable: '__body' })],
  ]),
);
vi.mock('geist/font/mono', () => ({ GeistMono: { variable: '__geist_mono' } }));

// The tests run from the project folder (Rush and vitest both do).
const GLOBAL_CSS_PATH = resolve(process.cwd(), 'web/app/globals.css');

/**
 * Reads the value of a design token from the rule of one selector in the global styles.
 *
 * @param selector - The selector of the rule, as written in the stylesheet, for example `:root`.
 * @param name - The token name, for example `--bg`.
 * @returns The colour value written in that rule.
 */
function tokenIn(selector: string, name: string): string {
  // Prettier may write the attribute quotes either way: compare with double quotes.
  const css = readFileSync(GLOBAL_CSS_PATH, 'utf8').replaceAll("'", '"');
  const start = css.indexOf(`${selector} {`);
  if (start === -1) {
    return '';
  }
  const block = css.slice(start, css.indexOf('}', start));
  const declaration = block.split('\n').find((line) => line.trim().startsWith(`${name}:`)) ?? '';
  return /#[0-9a-fA-F]{6}/u.exec(declaration)?.[0] ?? '';
}

describe('RootLayout', () => {
  it('sets the language, wraps the page in main and adds a skip link', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Page</p>
      </RootLayout>,
    );
    expect(html).toContain('<html lang="en"');
    expect(html).toMatch(/<main id="main"[^>]*><p>Page<\/p><\/main>/u);
    expect(html).toContain('href="#main"');
  });

  it('sets the font variables on <html>', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Page</p>
      </RootLayout>,
    );
    expect(html).toContain('class="__display __body __geist_mono"');
  });

  it('puts the pre-paint theme script in the head, unchanged', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Page</p>
      </RootLayout>,
    );
    expect(html).toContain(`<head><script>${THEME_SCRIPT}</script></head>`);
  });

  it('links the top bar to each section of the page, in section order', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Page</p>
      </RootLayout>,
    );
    expect(html).toMatch(/<nav aria-label="Sections"[^>]*>/u);
    expect(html).toContain('href="#experience"');
    expect(html).toContain('href="#skills"');
    expect(html).toContain('href="#awards"');
    expect(html).toContain('href="#certifications"');
    expect(html).toContain('href="#open-source"');
    expect(html).toContain('href="#writing"');
    expect(html).toContain('href="#contact"');
    expect(html.indexOf('href="#experience"')).toBeLessThan(html.indexOf('href="#skills"'));
    expect(html.indexOf('href="#skills"')).toBeLessThan(html.indexOf('href="#awards"'));
    expect(html.indexOf('href="#awards"')).toBeLessThan(html.indexOf('href="#certifications"'));
    expect(html.indexOf('href="#certifications"')).toBeLessThan(
      html.indexOf('href="#open-source"'),
    );
    expect(html.indexOf('href="#writing"')).toBeLessThan(html.indexOf('href="#contact"'));
  });

  it('shows the site name and the theme toggle in the top bar', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Page</p>
      </RootLayout>,
    );
    expect(html).toContain('<header');
    expect(html).toContain(content.profile.name);
  });
});

describe('page metadata', () => {
  it('takes the title and description from the content', () => {
    expect(metadata.title).toBe(content.site.title);
    expect(metadata.description).toBe(content.site.description);
    expect(metadata.metadataBase?.toString()).toBe(new URL(content.site.url).toString());
  });

  it('sets Open Graph and Twitter tags for a link preview', () => {
    expect(metadata.openGraph).toMatchObject({
      title: content.site.title,
      description: content.site.description,
      url: content.site.url,
      siteName: content.profile.name,
      type: 'website',
    });
    expect(metadata.twitter).toMatchObject({
      card: 'summary',
      title: content.site.title,
      description: content.site.description,
    });
  });

  it('sets the browser theme colours to the light and dark background tokens', () => {
    const lightBackground = tokenIn(':root[data-theme="light"]', '--bg');
    const darkBackground = tokenIn(':root[data-theme="dark"]', '--bg');
    expect(lightBackground).toMatch(/^#[0-9a-f]{6}$/u);
    expect(darkBackground).toMatch(/^#[0-9a-f]{6}$/u);
    expect(viewport.themeColor).toEqual([
      { media: '(prefers-color-scheme: light)', color: lightBackground },
      { media: '(prefers-color-scheme: dark)', color: darkBackground },
    ]);
  });
});
