import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { THEME_STORAGE_KEY } from '../lib/theme';

import { siteContent } from './site-content';

type ThemeName = 'System' | 'Light' | 'Dark';

const themeButton = (page: Page, name: ThemeName) =>
  page.getByRole('group', { name: 'Theme' }).getByRole('button', { name, exact: true });

const html = (page: Page) => page.locator('html');

/** The computed background of the page, as the browser paints it. */
async function backgroundOf(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/** The stored theme choice, or null when no choice is stored. */
async function storedChoice(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), THEME_STORAGE_KEY);
}

test.describe('theme', () => {
  test('follows the system theme when no choice is stored', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');

    await expect(themeButton(page, 'System')).toHaveAttribute('aria-pressed', 'true');
    await expect(html(page)).not.toHaveAttribute('data-theme');
    const lightBackground = await backgroundOf(page);

    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await backgroundOf(page)).not.toBe(lightBackground);
  });

  test('applies the picked theme at once and keeps it after a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const lightBackground = await backgroundOf(page);

    await themeButton(page, 'Dark').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    const darkBackground = await backgroundOf(page);
    expect(darkBackground).not.toBe(lightBackground);
    expect(await storedChoice(page)).toBe('dark');

    await page.reload();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(themeButton(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');

    await themeButton(page, 'Light').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    expect(await backgroundOf(page)).toBe(lightBackground);
    expect(await storedChoice(page)).toBe('light');
  });

  test('system removes the attribute and the stored choice', async ({ page }) => {
    await page.goto('/');

    await themeButton(page, 'Dark').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');

    await themeButton(page, 'System').click();
    await expect(html(page)).not.toHaveAttribute('data-theme');
    expect(await storedChoice(page)).toBeNull();
  });

  test('applies the stored choice before the first paint', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    // Seeds the choice once, before the page scripts run. The stored choice is kept on later loads.
    await page.addInitScript((key) => {
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, 'dark');
      }
    }, THEME_STORAGE_KEY);

    // domcontentloaded comes after the blocking script in <head> has run, and before the first
    // paint of a page that waited for scripts. The attribute must already be set at this point.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('dark');
  });

  test('has the title, description and Open Graph tags for a link preview', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(siteContent.site.title);
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute(
      'content',
      siteContent.site.description,
    );
    await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute(
      'content',
      siteContent.site.title,
    );
    await expect(page.locator('head meta[property="og:description"]')).toHaveAttribute(
      'content',
      siteContent.site.description,
    );
    // The canonical URL of the home page: Next.js adds the trailing slash of the root path.
    await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute(
      'content',
      new URL(siteContent.site.url).toString(),
    );
    await expect(page.locator('head meta[property="og:type"]')).toHaveAttribute(
      'content',
      'website',
    );
    await expect(page.locator('head meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary',
    );
  });

  for (const name of ['Light', 'Dark'] as const) {
    test(`has no axe violations in the ${name.toLowerCase()} theme`, async ({ page }) => {
      await page.goto('/');
      await themeButton(page, name).click();
      await expect(html(page)).toHaveAttribute('data-theme', name.toLowerCase());
      await expect(
        page.getByRole('heading', { level: 1, name: siteContent.profile.name }),
      ).toBeVisible();

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations).toEqual([]);
    });
  }

  test('loads with no CSP violation while the theme changes', async ({ page }) => {
    // The init script runs before the page scripts. It records each violation of the policy.
    await page.addInitScript(() => {
      const violations: string[] = [];
      Reflect.set(window, 'cspViolations', violations);
      document.addEventListener('securitypolicyviolation', (event) => {
        violations.push(event.effectiveDirective);
      });
    });
    await page.goto('/');
    await themeButton(page, 'Dark').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');

    const violations: unknown = await page.evaluate(() => {
      const recorded: unknown = Reflect.get(window, 'cspViolations');
      return recorded;
    });
    expect(violations).toEqual([]);
  });
});
