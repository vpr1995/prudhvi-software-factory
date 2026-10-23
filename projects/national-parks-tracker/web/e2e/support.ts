// Shared setup for every e2e test.
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The Playwright `test`. */
export const test = base;

/**
 * Runs axe on the page and expects no violations.
 *
 * @param page - The page.
 */
export async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}
