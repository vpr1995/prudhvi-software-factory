// The site as it ships. Every other spec uses the e2e build (web/out-e2e) with the 8 fixture
// visits. This spec serves the production export in web/out, built from the real
// web/data/visits.json. The expected values come from that file, so the owner can add visits and
// the spec still passes. Today the file is empty, so the spec checks the site with 0 visits.
// Rush runs the build phase before the e2e phase, so web/out is there. Each worker starts the e2e
// static server on a free port.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';

import { expect } from '@playwright/test';

import { expectNoA11yViolations, test } from './support';

const PROJECT_DIRECTORY = fileURLToPath(new URL('../..', import.meta.url));
const HOST = '127.0.0.1';
const PARK_COUNT = 64;

/**
 * Reads a JSON data file of the web app.
 *
 * @param name - The file name in web/data.
 * @returns The parsed content.
 */
const readData = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));

// The site data validates these files at build time. Here they give the expected values only.
const visitedIds = new Set(Object.keys(readData('visits.json') ?? {}));
const parkIds = (readData('parks.json') as readonly { readonly id: string }[])
  .map((park) => park.id)
  .toSorted();
const VISITED_COUNT = visitedIds.size;
const NOT_VISITED_ID = parkIds.find((id) => !visitedIds.has(id));
// The park page to check: the first park not visited yet, or a visited park when all are visited.
const parkPage =
  NOT_VISITED_ID === undefined
    ? { id: parkIds[0] ?? '', marker: '[aria-label="Trips, newest first"]' }
    : { id: NOT_VISITED_ID, marker: 'text="Not visited yet"' };
const VISITED_EMPTY_MESSAGES = VISITED_COUNT === 0 ? 1 : 0;

/**
 * Finds a free port on 127.0.0.1.
 *
 * @returns The port.
 */
async function findFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, HOST, resolve);
  });
  const address = probe.address();
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve();
    });
  });
  if (address === null || typeof address === 'string') {
    throw new Error('No free port on 127.0.0.1.');
  }
  return address.port;
}

/**
 * Starts the e2e static server on the production export and waits until it listens.
 *
 * @param port - The port.
 * @returns The server process.
 */
async function startProductionServer(port: number): Promise<ChildProcess> {
  const child = spawn(execPath, ['test/e2e/serve-static.js', 'web/out', String(port)], {
    cwd: PROJECT_DIRECTORY,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout.once('data', () => {
      resolve();
    });
    child.once('exit', (code) => {
      reject(new Error(`The production server stopped (exit code ${String(code)}).`));
    });
  });
  return child;
}

let server: ChildProcess | undefined;
let origin = '';

test.beforeAll(async () => {
  const port = await findFreePort();
  server = await startProductionServer(port);
  origin = `http://${HOST}:${String(port)}`;
});

test.afterAll(() => {
  server?.kill();
});

test.describe('the production site with the real visits', () => {
  test('the home page shows the real visit count, with no axe violations', async ({ page }) => {
    const label = `${String(VISITED_COUNT)} of ${String(PARK_COUNT)} parks visited`;
    await page.goto(`${origin}/`);
    await expect(page.locator('.park-marker')).toHaveCount(PARK_COUNT);
    await expect(page.getByRole('progressbar', { name: label })).toHaveAttribute(
      'value',
      String(VISITED_COUNT),
    );
    await expect(page.getByText(label)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/undefined|NaN/);
    await expectNoA11yViolations(page);
  });

  test('the Visited filter shows the visited parks, or "No parks visited yet" before the first', async ({
    page,
  }) => {
    const rows = page.getByRole('list', { name: 'Parks' }).getByRole('listitem');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${origin}/`);
    await expect(page.locator('.park-marker').first()).toBeAttached();
    await page.getByRole('radio', { name: `Visited (${String(VISITED_COUNT)})` }).check();
    await expect(rows).toHaveCount(VISITED_COUNT);
    await expect(page.getByText('No parks visited yet.')).toHaveCount(VISITED_EMPTY_MESSAGES);
    await expect(page.getByRole('button', { name: 'Show all parks' })).toHaveCount(
      VISITED_EMPTY_MESSAGES,
    );
    await expect(page.getByText(/No parks match/)).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.getByRole('radio', { name: `All (${String(PARK_COUNT)})` }).check();
    await expect(rows).toHaveCount(PARK_COUNT);
    await expectNoA11yViolations(page);
  });

  test('a park page shows its visit state, with no axe violations', async ({ page }) => {
    await page.goto(`${origin}/parks/${parkPage.id}/`);
    await expect(page.locator(parkPage.marker)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/undefined|NaN/);
    await expectNoA11yViolations(page);
  });

  test('an unknown path gets the 404 page of the export, with no axe violations', async ({
    page,
  }) => {
    const response = await page.goto(`${origin}/no-such-trail/`);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: 'This trail does not go anywhere' }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
