import { expect } from '@playwright/test';

import { expectNoA11yViolations, test } from './support';

test.describe('home page', () => {
  test('has no axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'National Parks Tracker' }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
