import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RootLayout, { metadata, viewport } from '../../../web/app/layout';

describe('RootLayout', () => {
  it('sets the language and starts with a skip link', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main id="main">Page</main>
      </RootLayout>,
    );
    expect(html).toMatch(
      /^<html lang="en"><head><\/head><body><a class="skip-link" href="#main">Skip to main content<\/a>/,
    );
    expect(metadata.title).toBe('National Parks Tracker');
    expect(viewport.themeColor).toHaveLength(2);
  });
});
