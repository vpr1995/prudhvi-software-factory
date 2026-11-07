import { expect, test } from '@playwright/test';

const STATUS_OK = 200;
const STATUS_NOT_FOUND = 404;

test('the home page loads with the map and the security headers', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  const response = await page.goto('/');
  expect(response?.status()).toBe(STATUS_OK);
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['strict-transport-security']).toContain('max-age=');
  await expect(page).toHaveTitle('National Parks Tracker');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.park-marker').first()).toBeAttached();
  // The policy has no 'unsafe-inline'. A script or style that it blocks is a console error.
  expect(problems.filter((text) => text.includes('Content Security Policy'))).toEqual([]);
});

test('a park page loads under its own policy', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  const response = await page.goto('/parks/zion/');
  expect(response?.status()).toBe(STATUS_OK);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(problems.filter((text) => text.includes('Content Security Policy'))).toEqual([]);
});

test('an unknown path shows the not found page', async ({ page }) => {
  const response = await page.goto('/no-such-page/');
  expect(response?.status()).toBe(STATUS_NOT_FOUND);
});
