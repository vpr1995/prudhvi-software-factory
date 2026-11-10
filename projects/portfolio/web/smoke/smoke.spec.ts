import { expect, test } from '@playwright/test';

import { siteContent } from '../e2e/site-content';

const STATUS_OK = 200;
const MEDIUM_LINK = 'a[href^="https://medium.com/"]';
const GITHUB_LINK = 'a[href^="https://github.com/"]';
// The directives that headers.spec.ts checks. The base policy and the page policy both send them.
const CSP_DIRECTIVES = ["default-src 'self'", "frame-ancestors 'none'"];

test('the site shows the headline, the experience, the feeds and the security headers', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  const response = await page.goto('/');
  expect(response?.status()).toBe(STATUS_OK);

  const headers = response?.headers() ?? {};
  const policy = headers['content-security-policy'] ?? '';
  for (const directive of CSP_DIRECTIVES) {
    expect(policy).toContain(directive);
  }
  expect(headers['x-content-type-options']).toBe('nosniff');

  await expect(
    page.getByRole('heading', { level: 1, name: siteContent.profile.name }),
  ).toBeVisible();
  await expect(page.getByText(siteContent.profile.headline, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Experience' })).toBeVisible();

  await expect(page.getByRole('heading', { level: 2, name: 'Writing' })).toBeVisible();
  await expect(page.locator(`section#writing ${MEDIUM_LINK}`).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Open source' })).toBeVisible();
  await expect(page.locator(`section#open-source ${GITHUB_LINK}`).first()).toBeVisible();

  // The policy has no 'unsafe-inline'. A script or style that it blocks is a console error.
  expect(problems.filter((text) => text.includes('Content Security Policy'))).toEqual([]);
});
