import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { siteContent } from './site-content';

test.describe('home page', () => {
  test('shows the heading and has no axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: siteContent.profile.name }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);
  });
});
