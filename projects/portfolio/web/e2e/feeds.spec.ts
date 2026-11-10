import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const MEDIUM_ORIGIN = 'https://medium.com/';
const GITHUB_ORIGIN = 'https://github.com/';
const SECTION_ORIGINS = [MEDIUM_ORIGIN, GITHUB_ORIGIN] as const;
const FEED_SECTIONS = ['open-source', 'writing'] as const;

/** The overflow of the page: the scroll width against the visible width. */
async function horizontalOverflow(
  page: Page,
): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test.describe('feed sections', () => {
  test('show the open source and writing headings, each with at least one item', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 2, name: 'Open source' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Writing' })).toBeVisible();
    await expect(page.locator('section#open-source li').first()).toBeVisible();
    await expect(page.locator('section#writing li').first()).toBeVisible();
  });

  test('gives every outgoing link rel noopener noreferrer', async ({ page }) => {
    await page.goto('/');

    const links = page.locator('a[href^="http"]');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const relationship = (await links.nth(index).getAttribute('rel')) ?? '';
      expect(relationship.split(/\s+/u)).toEqual(
        expect.arrayContaining(['noopener', 'noreferrer']),
      );
    }
  });

  test('keeps every link of the feed sections on the Medium or GitHub origin', async ({ page }) => {
    await page.goto('/');

    for (const id of FEED_SECTIONS) {
      const links = page.locator(`section#${id} a[href]`);
      const count = await links.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const href = (await links.nth(index).getAttribute('href')) ?? '';
        expect(SECTION_ORIGINS.some((origin) => href.startsWith(origin))).toBe(true);
      }
    }
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`has no axe violations in the feed sections in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 2, name: 'Open source' })).toBeVisible();

      const results = await new AxeBuilder({ page })
        .include('#open-source')
        .include('#writing')
        .analyze();

      expect(results.violations).toEqual([]);
    });
  }

  test('has no horizontal scroll at 360 px wide', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/');

    const overflow = await horizontalOverflow(page);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});
