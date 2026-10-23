import { defineConfig, devices } from '@playwright/test';

// Fixed ports, away from the defaults of other tools. The browser calls the API on its own origin,
// so the API allows the web origin through CORS.
const API_PORT = 4310;
const WEB_PORT = 4311;
const API_ORIGIN = `http://127.0.0.1:${String(API_PORT)}`;
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
  webServer: [
    {
      command: 'node dist/api/main.js',
      url: `${API_ORIGIN}/v1/health`,
      reuseExistingServer: false,
      timeout: SERVER_START_TIMEOUT_MS,
      env: {
        SAMPLE_API_PORT: String(API_PORT),
        SAMPLE_API_LOG_LEVEL: 'warn',
        SAMPLE_API_CORS_ORIGINS: WEB_ORIGIN,
      },
    },
    {
      command: `node ../node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${String(WEB_PORT)}`,
      cwd: './web',
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: SERVER_START_TIMEOUT_MS,
      env: { SAMPLE_WEB_API_URL: API_ORIGIN },
    },
  ],
});
