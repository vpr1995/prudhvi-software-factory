import { expect, test } from '@playwright/test';

import { siteContent } from './site-content';

// The security headers that Cloudflare sends for every page (the `/*` rule of _headers).
const SHARED_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

// The directives of the page policy that do not depend on the page. The base policy of `/*`
// repeats the same list.
const FIXED_DIRECTIVES = [
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
];

// A CSP hash source, for example 'sha256-abc...='.
const HASH_SOURCE = /^'sha256-[A-Za-z0-9+/]+=*'$/;

test.describe('security headers of the home page', () => {
  test('sends the CSP with its directives and the security headers', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    // Two policies: the base policy of `/*` and the policy of the page. Cloudflare joins the values
    // of the two rules with a comma, and a comma separates two policies in one CSP header. The
    // browser enforces both.
    const headerList = (await response?.headersArray()) ?? [];
    const policies = headerList
      .filter((header) => header.name.toLowerCase() === 'content-security-policy')
      .flatMap((header) => header.value.split(', '));
    expect(policies).toHaveLength(2);

    const pagePolicy = policies.find((policy) => policy.includes('script-src ')) ?? '';
    const directives = pagePolicy.split('; ');
    expect(directives).toContain("default-src 'self'");
    expect(directives).toContain("style-src 'self'");
    for (const directive of FIXED_DIRECTIVES) {
      expect(directives).toContain(directive);
    }

    const scriptSource = directives.find((directive) => directive.startsWith('script-src ')) ?? '';
    const scriptSources = scriptSource.split(' ').slice(2);
    expect(scriptSource.startsWith("script-src 'self' ")).toBe(true);
    expect(scriptSources.length).toBeGreaterThan(0);
    for (const source of scriptSources) {
      expect(source).toMatch(HASH_SOURCE);
    }
    expect(scriptSource).not.toContain('unsafe-inline');
    expect(pagePolicy).not.toContain("style-src 'self' 'unsafe-inline'");
    expect(pagePolicy).not.toContain('unsafe-eval');

    const basePolicy = policies.find((policy) => !policy.includes('script-src ')) ?? '';
    expect(basePolicy).toContain("frame-ancestors 'none'");

    const headers = response?.headers() ?? {};
    for (const [name, value] of Object.entries(SHARED_HEADERS)) {
      expect(headers[name]).toBe(value);
    }
  });

  test('a page loads with no CSP violation', async ({ page }) => {
    // The init script runs before the page scripts. It records each violation of the policy.
    await page.addInitScript(() => {
      const violations: string[] = [];
      Reflect.set(window, 'cspViolations', violations);
      document.addEventListener('securitypolicyviolation', (event) => {
        violations.push(event.effectiveDirective);
      });
    });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: siteContent.profile.name }),
    ).toBeVisible();

    const violations: unknown = await page.evaluate(() => {
      const recorded: unknown = Reflect.get(window, 'cspViolations');
      return recorded;
    });
    expect(violations).toEqual([]);
  });
});
