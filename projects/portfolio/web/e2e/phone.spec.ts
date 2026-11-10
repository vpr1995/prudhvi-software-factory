import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { THEME_STORAGE_KEY } from '../lib/theme';

import { siteContent } from './site-content';

const { contact } = siteContent;
const BUTTON_NAME = 'Show phone number';

/**
 * The phone of the content. The spec fails when the content has no phone, because the reveal
 * is then not tested.
 *
 * @returns The phone link of the content.
 */
function contentPhone(): { readonly display: string; readonly href: string } {
  if (contact.phone === undefined) {
    throw new Error('The content has no contact.phone, so the phone reveal cannot be tested.');
  }
  return contact.phone;
}

const PHONE = contentPhone();
const DIGITS = PHONE.href.replaceAll('tel:', '').replaceAll(/\D/gu, '').slice(-10);

/** Sets the theme choice before the page scripts run. Storage can be blocked, so it is guarded. */
async function seedTheme(page: Page, choice: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Storage is blocked. The page follows the system theme, and the test sets the scheme too.
      }
    },
    [THEME_STORAGE_KEY, choice] as const,
  );
}

test.describe('phone reveal', () => {
  test('the number is not in the page before the click', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: BUTTON_NAME })).toBeVisible();

    const html = await page.content();
    const bodyText = await page.locator('body').innerText();

    for (const text of [PHONE.display, PHONE.href, DIGITS]) {
      expect(html).not.toContain(text);
      expect(bodyText).not.toContain(text);
    }
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  });

  test('the button is a native button with aria-expanded false', async ({ page }) => {
    await page.goto('/');

    const button = page.getByRole('button', { name: BUTTON_NAME });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toHaveAttribute('type', 'button');
  });

  test('a click shows the tel link with the number', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: BUTTON_NAME }).click();

    const link = page.getByRole('link', { name: PHONE.display });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', PHONE.href);
    await expect(page.getByRole('button', { name: BUTTON_NAME })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  test('Enter on the focused button shows the number', async ({ page }) => {
    await page.goto('/');

    const button = page.getByRole('button', { name: BUTTON_NAME });
    await button.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('link', { name: PHONE.display })).toBeVisible();
    await expect(page.getByRole('link', { name: PHONE.display })).toHaveAttribute(
      'href',
      PHONE.href,
    );
  });

  test('Space on the focused button shows the number', async ({ page }) => {
    await page.goto('/');

    const button = page.getByRole('button', { name: BUTTON_NAME });
    await button.focus();
    await page.keyboard.press('Space');

    await expect(page.getByRole('link', { name: PHONE.display })).toBeVisible();
  });

  test('the number is announced: the live region holds it after the click', async ({ page }) => {
    await page.goto('/');

    const region = page.locator('#contact [aria-live="polite"]');
    await expect(region).toHaveCount(1);
    await expect(region).toHaveAttribute('aria-live', 'polite');
    // A hidden region is left out of the accessibility tree, so a screen reader would miss the
    // number that arrives in it. The region must stay rendered before the click.
    await expect(region).not.toHaveCSS('display', 'none');

    await page.getByRole('button', { name: BUTTON_NAME }).click();
    await expect(region.getByRole('link', { name: PHONE.display })).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`has no axe violations on the full page after the reveal in ${scheme} mode`, async ({
      page,
    }) => {
      await seedTheme(page, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await page.getByRole('button', { name: BUTTON_NAME }).click();
      await expect(page.getByRole('link', { name: PHONE.display })).toBeVisible();

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations).toEqual([]);
    });
  }
});

test.describe('phone reveal with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test('shows no phone number and no phone button, and keeps the other contact links', async ({
    page,
  }) => {
    await page.goto('/');

    const html = await page.content();
    const bodyText = await page.locator('body').innerText();
    for (const text of [PHONE.display, PHONE.href, DIGITS]) {
      expect(html).not.toContain(text);
      expect(bodyText).not.toContain(text);
    }
    await expect(page.getByRole('button', { name: BUTTON_NAME })).toHaveCount(0);
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
    await expect(page.getByText('Phone', { exact: true })).toHaveCount(0);

    await expect(page.getByRole('link', { name: contact.email, exact: true })).toHaveAttribute(
      'href',
      `mailto:${contact.email}`,
    );
    await expect(page.getByRole('link', { name: contact.linkedin, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: contact.github, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: contact.medium, exact: true })).toBeVisible();
  });
});
