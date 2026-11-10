import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { THEME_STORAGE_KEY } from '../lib/theme';

import { siteContent } from './site-content';

const { profile, experience, awards, contact } = siteContent;
const LOCATION_LINE = `Open to relocation: ${[profile.location.primary, ...profile.location.also].join(' · ')}`;

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

test.describe('home page', () => {
  test('shows the heading and has no axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: profile.name })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);
  });

  test('shows the name, the role claim and the location line', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: profile.name })).toBeVisible();
    await expect(page.getByText(profile.headline, { exact: true })).toBeVisible();
    await expect(page.getByText(LOCATION_LINE, { exact: true })).toBeVisible();
  });

  test('shows the experience and the awards with the sample content', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 2, name: 'Experience' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: experience[0]?.role ?? '' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Awards' })).toBeVisible();
    for (const award of awards) {
      await expect(page.getByRole('heading', { level: 3, name: award.title })).toBeVisible();
    }
    await expect(page.getByRole('heading', { level: 2, name: 'Contact' })).toBeVisible();
  });

  test('the top bar links move to their sections', async ({ page }) => {
    await page.goto('/');
    const sections = page.getByRole('navigation', { name: 'Sections' });

    for (const [name, id] of [
      ['Experience', 'experience'],
      ['Awards', 'awards'],
      ['Open source', 'open-source'],
      ['Writing', 'writing'],
      ['Contact', 'contact'],
    ] as const) {
      await sections.getByRole('link', { name, exact: true }).click();
      await expect.poll(() => new URL(page.url()).hash).toBe(`#${id}`);
      await expect(page.getByRole('heading', { level: 2, name })).toBeInViewport();
    }
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`has no axe violations on the full page in ${scheme} mode`, async ({ page }) => {
      await seedTheme(page, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await expect(page.getByRole('heading', { level: 2, name: 'Open source' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Writing' })).toBeVisible();

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations).toEqual([]);
    });
  }
});

test.describe('home page with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test('still shows the name, the role, the location, the sections and the contact links', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: profile.name })).toBeVisible();
    await expect(page.getByText(profile.headline, { exact: true })).toBeVisible();
    await expect(page.getByText(LOCATION_LINE, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Experience' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: experience[0]?.role ?? '' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Awards' })).toBeVisible();
    for (const award of awards) {
      await expect(page.getByRole('heading', { level: 3, name: award.title })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: contact.email, exact: true })).toHaveAttribute(
      'href',
      `mailto:${contact.email}`,
    );
    await expect(page.getByRole('link', { name: contact.linkedin, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: contact.github, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: contact.medium, exact: true })).toBeVisible();
  });

  test('shows no theme toggle, because the toggle needs JavaScript', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('group', { name: 'Theme' })).toHaveCount(0);
  });
});

test.describe('home page layout', () => {
  test('has no horizontal scroll at the viewport of each project', async ({ page }) => {
    await page.goto('/');

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test.describe('at 360 px wide', () => {
    test.use({ viewport: { width: 360, height: 780 } });

    test('has no horizontal scroll', async ({ page }) => {
      await page.goto('/');

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    });
  });
});
