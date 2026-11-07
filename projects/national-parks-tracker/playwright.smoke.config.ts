import { defineConfig, devices } from '@playwright/test';

// The smoke test of a deploy. It tests the live site at SMOKE_BASE_URL. deploy.yml sets the variable
// after `wrangler deploy`. There is no web server: the site is already running. Without the
// variable, page.goto fails at once.
export default defineConfig({
  testDir: './web/smoke',
  fullyParallel: false,
  forbidOnly: true,
  retries: 2,
  reporter: [['list']],
  use: { baseURL: process.env['SMOKE_BASE_URL'], trace: 'retain-on-failure' },
  projects: [{ name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } }],
});
