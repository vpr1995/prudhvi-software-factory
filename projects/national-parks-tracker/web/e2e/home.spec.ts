import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { expectNoA11yViolations, openHome, test } from './support';

const NARROW_WIDTH = 320;
const NARROW_HEIGHT = 720;
// The lower 48 view leaves out Alaska (8), Hawaii (2) and American Samoa (1). The wide desktop map
// also leaves out the Virgin Islands. The narrow phone map zooms out more and shows them.
const OUTSIDE_LOWER_48: Readonly<Record<string, number>> = {
  'desktop-chromium': 12,
  'mobile-chromium': 11,
};
const STATUS_OK = 200;

const rows = (page: Page): Locator =>
  page.getByRole('list', { name: 'Parks' }).getByRole('listitem');
const searchBox = (page: Page): Locator => page.getByRole('searchbox', { name: 'Search parks' });
const popup = (page: Page): Locator => page.locator('.leaflet-popup');

/**
 * Tells whether an element sits inside the map frame.
 *
 * @param page - The page.
 * @param target - The element.
 * @returns True when the center of the element is inside the map.
 */
async function isInsideMap(page: Page, target: Locator): Promise<boolean> {
  const map = await page.locator('.leaflet-container').boundingBox();
  const box = await target.boundingBox();
  if (map === null || box === null) {
    return false;
  }
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return (
    centerX >= map.x &&
    centerX <= map.x + map.width &&
    centerY >= map.y &&
    centerY <= map.y + map.height
  );
}

test.describe('home page', () => {
  test('shows 64 parks and the progress of the fixture visits', async ({ page }, testInfo) => {
    await openHome(page, '/');
    await expect(rows(page)).toHaveCount(64);
    await expect(page.getByText('Showing 64 of 64 parks')).toBeVisible();
    await expect(page.getByText('8 of 64 parks visited')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: '8 of 64 parks visited' })).toHaveAttribute(
      'value',
      '8',
    );
    await expect(page.getByText('Yosemite · Aug 1, 2025')).toBeVisible();
    await expect(page.locator('.park-marker')).toHaveCount(64);
    const outside = OUTSIDE_LOWER_48[testInfo.project.name];
    expect(outside, `the expected count for ${testInfo.project.name}`).toBeDefined();
    await expect(
      page.getByText(`+${String(outside)} parks outside this view:`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alaska (8)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hawaii (2)' })).toBeVisible();
  });

  test('has no axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.park-marker').first()).toBeAttached();
    await expect(
      page.getByRole('heading', { level: 1, name: 'National Parks Tracker' }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('has no axe violations in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openHome(page, '/');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe('rgb(16, 22, 18)');
    await expectNoA11yViolations(page);
  });

  test('finds parks without accents, and by state', async ({ page }) => {
    await openHome(page, '/');
    await searchBox(page).fill('haleakala');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Haleakalā');
    await searchBox(page).fill('utah');
    await expect(rows(page)).toHaveCount(5);
    await expect(page.getByText('Showing 5 of 64 parks')).toBeVisible();
    await expect(page.locator('.park-marker')).toHaveCount(5);
  });

  test('shows the empty state, and "Clear filters" brings every park back', async ({ page }) => {
    await openHome(page, '/');
    await searchBox(page).fill('qwertyuiop');
    await expect(page.getByText('No parks match your search and filter.')).toBeVisible();
    await expect(page.getByText('Showing 0 of 64 parks')).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows(page)).toHaveCount(64);
    await expect(searchBox(page)).toHaveValue('');
  });

  test('filters by status, with the counts', async ({ page }) => {
    await openHome(page, '/');
    await expect(page.getByRole('radio', { name: 'All (64)' })).toBeChecked();
    await page.getByRole('radio', { name: 'Visited (8)' }).check();
    await expect(rows(page)).toHaveCount(8);
    await page.getByRole('radio', { name: 'Not yet (56)' }).check();
    await expect(rows(page)).toHaveCount(56);
    await searchBox(page).fill('utah');
    await expect(page.getByRole('radio', { name: 'Visited (2)' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Not yet (3)' })).toBeChecked();
  });

  test('sorts by rating, best first, with unrated parks last', async ({ page }) => {
    await openHome(page, '/');
    await page.getByRole('combobox', { name: 'Sort by' }).selectOption('rating');
    const names = rows(page).getByRole('heading');
    await expect(names.nth(0)).toHaveText('Hawaiʻi Volcanoes');
    await expect(names.nth(1)).toHaveText('Zion');
    await expect(names.nth(6)).toHaveText('Virgin Islands');
  });

  test('keeps the list state in the URL and restores it on reload', async ({ page }) => {
    await openHome(page, '/');
    await searchBox(page).fill('utah');
    await page.getByRole('radio', { name: 'Visited (2)' }).check();
    await page.getByRole('combobox', { name: 'Sort by' }).selectOption('rating');
    await expect(page).toHaveURL(/\/\?q=utah&status=visited&sort=rating$/);
    await page.reload();
    await expect(searchBox(page)).toHaveValue('utah');
    await expect(page.getByRole('radio', { name: 'Visited (2)' })).toBeChecked();
    await expect(rows(page).getByRole('heading')).toHaveText(['Zion', 'Arches']);
  });

  test('ignores invalid values in the URL', async ({ page }) => {
    await openHome(page, '/?status=maybe&sort=height');
    await expect(rows(page)).toHaveCount(64);
    await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name');
  });

  test('"Show on map" opens the popup with a working "View park" link', async ({ page }) => {
    await openHome(page, '/');
    await page.getByRole('button', { name: 'Show Zion on map' }).click();
    await expect(popup(page)).toContainText('Zion');
    await expect(popup(page)).toContainText('Visited · Last visit May 12, 2023');
    await expect(popup(page).getByRole('img', { name: 'Rated 5 out of 5' })).toBeVisible();
    await expect(page.locator('.leaflet-container')).toBeInViewport();
    await expectNoA11yViolations(page);
    await popup(page).getByRole('link', { name: 'View park' }).click();
    await expect(page).toHaveURL(/\/parks\/zion\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Zion National Park' })).toBeVisible();
  });

  test('the Alaska button moves the map to the Alaska parks', async ({ page }) => {
    await openHome(page, '/');
    const denali = page.getByRole('button', { name: 'Denali, visited' });
    expect(await isInsideMap(page, denali)).toBe(false);
    await page.getByRole('button', { name: 'Alaska', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Alaska', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(async () => isInsideMap(page, denali)).toBe(true);
    await expect
      .poll(async () =>
        isInsideMap(page, page.getByRole('button', { name: /^Gates of the Arctic/ })),
      )
      .toBe(true);
  });

  test('a region button shows pressed only while the map shows its view', async ({
    page,
  }, testInfo) => {
    await openHome(page, '/');
    const views = page.getByRole('group', { name: 'Map view' });
    await expect(views.getByRole('button', { name: 'Lower 48', pressed: true })).toBeVisible();
    await views.getByRole('button', { name: 'Hawaii' }).click();
    await expect(views.getByRole('button', { name: 'Hawaii', pressed: true })).toBeVisible();
    // The move ends: the note counts the parks outside the Hawaii view.
    await expect(page.getByText('+62 parks outside this view:', { exact: true })).toBeVisible();
    // A park selection moves the map away from the region view.
    await page.getByRole('button', { name: 'Show Zion on map' }).click();
    await expect(popup(page)).toContainText('Zion');
    await expect(views.getByRole('button', { pressed: true })).toHaveCount(0);
    await expect(views.getByRole('button', { pressed: false })).toHaveCount(6);
    // A zoom by the user also leaves the view.
    await views.getByRole('button', { name: 'Lower 48' }).click();
    await expect(views.getByRole('button', { name: 'Lower 48', pressed: true })).toBeVisible();
    const outside = String(OUTSIDE_LOWER_48[testInfo.project.name]);
    await expect(
      page.getByText(`+${outside} parks outside this view:`, { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(views.getByRole('button', { pressed: true })).toHaveCount(0);
  });

  for (const key of ['Enter', 'Space']) {
    test(`a marker opens with the keyboard (${key})`, async ({ page }) => {
      await openHome(page, '/?q=zion');
      await expect(page.locator('.park-marker')).toHaveCount(1);
      await page.getByRole('button', { name: 'All parks' }).focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Zion, visited' })).toBeFocused();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await page.keyboard.press(key);
      await expect(popup(page)).toContainText('Zion');
      await expect(popup(page).getByRole('link', { name: 'View park' })).toBeFocused();
      // Space selects the marker. It does not scroll the page.
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    });
  }

  test('has no horizontal scroll at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: NARROW_HEIGHT });
    await openHome(page, '/');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(NARROW_WIDTH);
  });
});

test.describe('when the map tiles fail', () => {
  test.use({ servers: { tileStatus: 500, wikimediaStatus: 200 } });

  test('shows a banner, and the list keeps working', async ({ page }) => {
    await openHome(page, '/');
    await expect(page.getByRole('status')).toHaveText('Map tiles could not load. Use the list.');
    await searchBox(page).fill('utah');
    await expect(rows(page)).toHaveCount(5);
  });

  test('hides the banner again when the tiles load again', async ({ page, tiles }) => {
    await openHome(page, '/');
    const banner = page.getByRole('status');
    await expect(banner).toHaveText('Map tiles could not load. Use the list.');
    tiles.status = STATUS_OK;
    // A new view needs new tiles.
    await page.getByRole('button', { name: 'Alaska', exact: true }).click();
    await expect(banner).toHaveText('');
    await expect(page.getByRole('status')).toHaveCount(1);
  });
});

test.describe('when the Wikimedia photos fail', () => {
  test.use({ servers: { tileStatus: 200, wikimediaStatus: 404 } });

  test('the list shows placeholders instead of thumbnails', async ({ page }) => {
    await openHome(page, '/?q=zion');
    await expect(rows(page).first().locator('img')).toHaveCount(0);
  });
});
