// Shared setup for every e2e test. The tests never reach the internet:
// - OpenStreetMap tiles get a 1x1 PNG, Wikimedia photos and owner photos get a small JPEG.
// - Any other request that leaves 127.0.0.1 is stopped, and the test fails.
// Generated fixtures: fixtures/tile.png (zlib) and fixtures/photo.jpg (a Chromium canvas).
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const TILE_PNG = {
  path: fileURLToPath(new URL('fixtures/tile.png', import.meta.url)),
  contentType: 'image/png',
};
const PHOTO_JPEG = {
  path: fileURLToPath(new URL('fixtures/photo.jpg', import.meta.url)),
  contentType: 'image/jpeg',
};
const LOCAL_HOST = '127.0.0.1';
const STATUS_OK = 200;
const STATUS_NOT_FOUND = 404;

/** How the fake image servers answer. */
export type ImageServers = {
  /** HTTP status of the OpenStreetMap tiles. */
  readonly tileStatus: number;
  /** HTTP status of the Wikimedia photos. */
  readonly wikimediaStatus: number;
};

/** The tile server of one test. A test changes `status` to make the tiles fail or recover. */
export type TileServer = { status: number };

/** An image file to send. */
type ImageFile = { readonly path: string; readonly contentType: string };

const fulfillImage = async (route: Route, status: number, image: ImageFile): Promise<void> => {
  await (status === STATUS_OK
    ? route.fulfill({ status, path: image.path, contentType: image.contentType })
    : route.fulfill({ status, body: 'error', contentType: 'text/plain' }));
};

/**
 * Sends the fake answers for the image servers and stops every other outside request.
 *
 * @param page - The page.
 * @param servers - How the image servers answer. The tile status is read on each request.
 * @param outside - The list that collects stopped requests.
 */
async function routeRequests(
  page: Page,
  servers: ImageServers & { readonly tiles: TileServer },
  outside: string[],
): Promise<void> {
  // Playwright tries the newest route first, so the catch-all comes first.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === LOCAL_HOST) {
      await route.fallback();
      return;
    }
    outside.push(url.href);
    await route.abort('blockedbyclient');
  });
  await page.route('https://tile.openstreetmap.org/**', async (route) => {
    await fulfillImage(route, servers.tiles.status, TILE_PNG);
  });
  await page.route('https://upload.wikimedia.org/**', async (route) => {
    await fulfillImage(route, servers.wikimediaStatus, PHOTO_JPEG);
  });
  // Owner photos are not in the repo. A file name with "missing" gets 404, to test the placeholder.
  const isOwnerPhoto = (url: URL): boolean =>
    url.hostname === LOCAL_HOST && url.pathname.startsWith('/photos/');
  await page.route(isOwnerPhoto, async (route) => {
    const isMissing = new URL(route.request().url()).pathname.includes('missing');
    await fulfillImage(route, isMissing ? STATUS_NOT_FOUND : STATUS_OK, PHOTO_JPEG);
  });
}

/**
 * The Playwright `test` with the request rules. Set `servers` with `test.use` to make a server fail.
 * The `tiles` fixture changes the tile status during a test.
 */
export const test = base.extend<{ servers: ImageServers; tiles: TileServer }>({
  servers: [{ tileStatus: STATUS_OK, wikimediaStatus: STATUS_OK }, { option: true }],
  tiles: async ({ servers }, provide) => {
    await provide({ status: servers.tileStatus });
  },
  page: async ({ page, servers, tiles }, provide) => {
    const outside: string[] = [];
    await routeRequests(page, { ...servers, tiles }, outside);
    await provide(page);
    expect(outside, 'requests that left 127.0.0.1').toEqual([]);
  },
});

/**
 * Opens a page of the site and waits until React has hydrated it: the map shows its markers.
 *
 * @param page - The page.
 * @param path - The path, for example `/?q=utah`.
 */
export async function openHome(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('.park-marker').first()).toBeAttached();
}

/**
 * Runs axe on the page and expects no violations.
 *
 * @param page - The page.
 */
export async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}
