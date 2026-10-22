import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

test.describe('home page', () => {
  test('has no axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Notes' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);
  });

  test('sends the security headers, and the CSP lets the page call the API', async ({ page }) => {
    const response = await page.goto('/');

    const headers = response?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toContain('connect-src');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('has no axe violations after a note is saved', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Title').fill(`Axe note ${String(Date.now())}`);
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByRole('status')).toContainText('Saved');

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);
  });

  test('sends traceparent to the API and shows the new note', async ({ page }) => {
    const title = `Trace note ${String(Date.now())}`;
    await page.goto('/');

    const requestPromise = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/v1/notes'),
    );
    const responsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/v1/notes'),
    );
    await page.getByLabel('Title').fill(title);
    await page.getByRole('button', { name: 'Add note' }).click();

    const request = await requestPromise;
    const sent = TRACEPARENT_PATTERN.exec(request.headers()['traceparent'] ?? '');
    expect(sent, 'the API request has a traceparent header').not.toBeNull();

    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const echoed = TRACEPARENT_PATTERN.exec(response.headers()['traceparent'] ?? '');
    expect(echoed?.[1], 'the API continues the trace of the browser').toBe(sent?.[1]);

    await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible();
  });
});
