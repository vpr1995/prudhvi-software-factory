import { expect } from '@playwright/test';

import { expectNoA11yViolations, test } from './support';

test.describe('park page', () => {
  test('a visited park shows the trips, the rating and the notes, with no axe violations', async ({
    page,
  }) => {
    await page.goto('/parks/zion/');
    await expect(page).toHaveTitle('Zion · National Parks Tracker');
    await expect(page.getByRole('heading', { level: 1, name: 'Zion National Park' })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Trips, newest first' }).getByRole('listitem'),
    ).toHaveText(['May 12–15, 2023']);
    await expect(page.getByRole('img', { name: 'Rated 5 out of 5' })).toBeVisible();
    await expect(page.getByText('Golden light on the canyon walls every evening.')).toBeVisible();
    await expect(page.getByText('Hiked Angels Landing at sunrise')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Places to go' })).toBeVisible();
    await expect(page.getByText('The Narrows, day two')).toBeVisible();
    await expect(page.getByText(/^Photo: /)).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('lists the trips newest first', async ({ page }) => {
    await page.goto('/parks/yosemite/');
    await expect(
      page.getByRole('list', { name: 'Trips, newest first' }).getByRole('listitem'),
    ).toHaveText(['Aug 1–3, 2025', 'Sep 20, 2021', 'Jun 2–5, 2018']);
    await expect(page.getByText('3 trips')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What we liked' })).toHaveCount(0);
  });

  test('formats trips across months and years', async ({ page }) => {
    await page.goto('/parks/hawaii-volcanoes/');
    await expect(page.getByText('Jun 30 – Jul 2, 2023')).toBeVisible();
    await page.goto('/parks/virgin-islands/');
    await expect(page.getByText('Dec 30, 2022 – Jan 2, 2023')).toBeVisible();
    await page.goto('/parks/acadia/');
    await expect(page.getByText('Oct 2019')).toBeVisible();
    await page.goto('/parks/great-smoky-mountains/');
    await expect(page.getByText('Jul 4, 2024')).toBeVisible();
  });

  test('a park not visited shows "Not visited yet", with no axe violations in dark mode', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/parks/chiricahua/');
    await expect(page.getByText('Not visited yet')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('the Chiricahua deep link shows the 2026 date', async ({ page }) => {
    await page.goto('/parks/chiricahua/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Chiricahua');
    await expect(page.getByText('October 20, 2026')).toBeVisible();
    const nps = page.getByRole('link', { name: 'Chiricahua on nps.gov (opens in a new tab)' });
    await expect(nps).toHaveAttribute('href', 'https://www.nps.gov/chir/');
    await expect(nps).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('previous and next wrap around the name order', async ({ page }) => {
    await page.goto('/parks/zion/');
    const pager = page.getByRole('navigation', { name: 'Park pages' });
    await pager.getByRole('link', { name: /Next park/ }).click();
    await expect(page).toHaveURL(/\/parks\/acadia\/$/);
    await page
      .getByRole('navigation', { name: 'Park pages' })
      .getByRole('link', { name: /Previous park/ })
      .click();
    await expect(page).toHaveURL(/\/parks\/zion\/$/);
    await page.getByRole('link', { name: 'Back to map' }).first().click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'National Parks Tracker' }),
    ).toBeVisible();
  });

  test('a missing owner photo shows a placeholder', async ({ page }) => {
    await page.goto('/parks/denali/');
    await expect(
      page.getByRole('img', { name: 'Photo not found: Denali above the clouds' }),
    ).toBeVisible();
  });

  test('has no horizontal scroll at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/parks/wrangell-st-elias/');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(320);
  });
});

test.describe('park page when the Wikimedia photo fails', () => {
  test.use({ servers: { tileStatus: 200, wikimediaStatus: 404 } });

  test('shows the placeholder', async ({ page }) => {
    await page.goto('/parks/chiricahua/');
    await expect(page.getByRole('img', { name: 'Chiricahua' })).toContainText('No photo yet');
  });

  test('shows the owner photo when there is one', async ({ page }) => {
    await page.goto('/parks/zion/');
    await expect(
      page
        .getByRole('figure')
        .first()
        .getByRole('img', { name: /Hikers wading/ }),
    ).toBeVisible();
    await expect(page.getByText(/^Photo: /)).toHaveCount(0);
  });
});
