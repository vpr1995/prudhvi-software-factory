import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

// R-16: while the chat flag is off (the default), the site ships no chat code and makes no request
// to Hugging Face. This spec checks the built export of the e2e build (web/out-e2e, see
// scripts/phase.mjs), so it needs the build to run first. Playwright runs from the project folder.
const EXPORT_DIRECTORY = resolve(process.cwd(), 'web/out-e2e');

// Text files of the export. Binary files (images, fonts) cannot hold these strings as text.
const TEXT_EXTENSIONS = ['.html', '.js', '.css', '.json', '.txt', '.map'];

// The strings that must not appear in the export while the flag is off.
const FORBIDDEN_MARKERS = ['huggingface.co', 'huggingface', 'portfolioChat', 'FLAG_PORTFOLIO_CHAT'];

/** Lists the files of a folder, including the files of its sub-folders. */
function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

test.describe('no chat code in the export (R-16)', () => {
  test('the built text files hold no chat marker', () => {
    const textFiles = listFiles(EXPORT_DIRECTORY).filter((file) =>
      TEXT_EXTENSIONS.some((extension) => file.endsWith(extension)),
    );
    // The scan must read real files. An empty folder would pass every check below.
    expect(textFiles.length).toBeGreaterThan(0);
    expect(textFiles.some((file) => file.endsWith('index.html'))).toBe(true);

    for (const file of textFiles) {
      const content = readFileSync(file, 'utf8');
      for (const marker of FORBIDDEN_MARKERS) {
        expect(content, `${file} holds "${marker}"`).not.toContain(marker);
      }
    }
  });

  test('the home page makes no request to another origin', async ({ page }) => {
    const requestUrls: string[] = [];
    page.on('request', (request) => {
      requestUrls.push(request.url());
    });

    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const pageOrigin = new URL(response?.url() ?? '').origin;
    const foreignUrls = requestUrls.filter((url) => new URL(url).origin !== pageOrigin);
    expect(foreignUrls).toEqual([]);
  });
});
