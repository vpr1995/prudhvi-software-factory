import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RootLayout, { metadata } from '../../../web/app/layout';

describe('RootLayout', () => {
  it('sets the language and wraps the page', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main>Page</main>
      </RootLayout>,
    );
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<main>Page</main>');
  });

  it('sets a page title', () => {
    expect(metadata.title).toBe('Notes');
  });
});
