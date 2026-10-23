import { expect } from '@playwright/test';

import { expectNoA11yViolations, test } from './support';

test.describe('404 page', () => {
  test('an unknown path shows the 404 page with status 404, with no axe violations', async ({
    page,
  }) => {
    const response = await page.goto('/no-such-trail/');
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: 'This trail does not go anywhere' }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('link', { name: 'Go to the map of all parks' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'National Parks Tracker' }),
    ).toBeVisible();
  });

  test('an unknown park id is a 404 too', async ({ page }) => {
    const response = await page.goto('/parks/atlantis/');
    expect(response?.status()).toBe(404);
  });
});
