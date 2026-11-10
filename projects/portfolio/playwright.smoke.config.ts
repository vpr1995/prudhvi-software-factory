import { defineConfig, devices } from '@playwright/test';

// The smoke test of a deploy. It tests the live site at SMOKE_BASE_URL. deploy.yml sets the variable
// after `wrangler deploy`. The e2e phase also runs the same spec against the local static server
// (playwright.config.ts). Without the variable, page.goto fails at once.
export default defineConfig({
  testDir: './web/smoke',
  fullyParallel: false,
  forbidOnly: true,
  retries: 2,
  reporter: [['list']],
  use: { baseURL: process.env['SMOKE_BASE_URL'], trace: 'retain-on-failure' },
  projects: [{ name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } }],
});
