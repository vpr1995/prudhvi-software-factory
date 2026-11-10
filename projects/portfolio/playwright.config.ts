import { defineConfig, devices } from '@playwright/test';

// A fixed port. `rush add-part` takes the next port after the highest port of the Playwright
// configs in projects/, because Rush runs the e2e phases of projects at the same time.
const WEB_PORT = 4330;
const WEB_ORIGIN = `http://127.0.0.1:${String(WEB_PORT)}`;
const SERVER_START_TIMEOUT_MS = 60_000;

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node ../node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${String(WEB_PORT)}`,
    cwd: './web',
    url: WEB_ORIGIN,
    reuseExistingServer: false,
    timeout: SERVER_START_TIMEOUT_MS,
  },
});
