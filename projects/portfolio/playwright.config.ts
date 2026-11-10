import { defineConfig, devices } from '@playwright/test';

// A fixed port, away from the sample (4310, 4311) and national-parks-tracker (4320): Rush runs
// the e2e operations of projects at the same time. The server serves web/out-e2e: the static
// export of the e2e build, with its _headers file applied by test/e2e/serve-static.js.
const WEB_PORT = 4330;
const WEB_ORIGIN = `http://127.0.0.1:${String(WEB_PORT)}`;
const SERVER_START_TIMEOUT_MS = 30_000;

export default defineConfig({
  testDir: './web/e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node test/e2e/serve-static.js web/out-e2e ${String(WEB_PORT)}`,
    url: WEB_ORIGIN,
    reuseExistingServer: false,
    timeout: SERVER_START_TIMEOUT_MS,
  },
});
