import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '@vprprudhvi/shared-logger';

import type { Feeds } from '../../../src/contracts/feeds.ts';
import { loadFeeds, staleFeedWarnings } from '../../../web/lib/feeds.ts';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-09T12:00:00.000Z');
const FRESH = new Date(NOW.getTime() - 2 * DAY_MS).toISOString();

/**
 * A snapshot whose two parts have the given times. The lists hold one item each, so the value is a
 * realistic snapshot.
 *
 * @param mediumFetchedAt - The time of the Medium part.
 * @param githubFetchedAt - The time of the GitHub part.
 * @returns A valid snapshot.
 */
function snapshotAt(mediumFetchedAt: string, githubFetchedAt: string): Feeds {
  return {
    medium: {
      fetchedAt: mediumFetchedAt,
      items: [
        {
          title: 'A post title',
          url: 'https://medium.com/@vprprudhvi/a-post-abc123',
          publishedAt: '2026-03-02T09:00:00.000Z',
        },
      ],
    },
    github: {
      fetchedAt: githubFetchedAt,
      repos: [
        {
          fullName: 'vpr1995/rbac-engine',
          url: 'https://github.com/vpr1995/rbac-engine',
          description: 'A repo description',
        },
      ],
    },
  };
}

/**
 * The time that is the given number of whole days before NOW, plus a part of a day.
 *
 * @param days - The age in days.
 * @param extraMs - Milliseconds to add to the age.
 * @returns The ISO time.
 */
function ageOf(days: number, extraMs = 0): string {
  return new Date(NOW.getTime() - days * DAY_MS - extraMs).toISOString();
}

/**
 * A logger that writes each line to an array, so that a test can read the lines.
 *
 * @returns The logger and the lines it wrote.
 */
function captureLogger(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger({
    serviceName: 'portfolio-web-test',
    destination: {
      write(chunk: string): void {
        lines.push(chunk);
      },
    },
  });
  return { logger, lines };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('staleFeedWarnings (R-20)', () => {
  it('warns about a feed whose snapshot is 91 days old, and names the feed and the age', () => {
    const warnings = staleFeedWarnings(snapshotAt(ageOf(91), FRESH), NOW);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('medium');
    expect(warnings[0]).toContain('91 days');
  });

  it('does not warn about a feed whose snapshot is 89 days old', () => {
    expect(staleFeedWarnings(snapshotAt(ageOf(89), FRESH), NOW)).toEqual([]);
  });

  it('does not warn about a feed whose snapshot is exactly 90 days old', () => {
    expect(staleFeedWarnings(snapshotAt(ageOf(90), FRESH), NOW)).toEqual([]);
  });

  it('does not warn about a feed whose snapshot is 90 days and part of a day old', () => {
    expect(staleFeedWarnings(snapshotAt(ageOf(90, DAY_MS - 1000), FRESH), NOW)).toEqual([]);
  });

  it('does not warn about fresh snapshots', () => {
    expect(staleFeedWarnings(snapshotAt(FRESH, FRESH), NOW)).toEqual([]);
  });

  it('gives two warnings when both snapshots are stale, one for each feed', () => {
    const warnings = staleFeedWarnings(snapshotAt(ageOf(100), ageOf(120)), NOW);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('medium');
    expect(warnings[0]).toContain('100 days');
    expect(warnings[1]).toContain('github');
    expect(warnings[1]).toContain('120 days');
  });
});

describe('loadFeeds (R-19, R-20)', () => {
  it('returns the valid snapshot and prints nothing when both parts are fresh', () => {
    const { logger, lines } = captureLogger();
    const snapshot = snapshotAt(FRESH, FRESH);

    expect(loadFeeds(snapshot, NOW, logger)).toEqual(snapshot);
    expect(lines).toEqual([]);
  });

  it('prints each stale warning through the logger and still returns the snapshot', () => {
    const { logger, lines } = captureLogger();
    const consoleWarn = vi.spyOn(console, 'warn');
    const snapshot = snapshotAt(ageOf(91), FRESH);

    expect(loadFeeds(snapshot, NOW, logger)).toEqual(snapshot);

    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(line['level']).toBe('warn');
    expect(line['service.name']).toBe('portfolio-web-test');
    expect(line['msg']).toContain('medium');
    expect(line['msg']).toContain('91 days');
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('keeps the log line free of the article title and the repo description', () => {
    const { logger, lines } = captureLogger();

    loadFeeds(snapshotAt(ageOf(91), ageOf(95)), NOW, logger);

    const output = lines.join('\n');
    expect(output).not.toContain('A post title');
    expect(output).not.toContain('A repo description');
    expect(output).not.toContain('https://medium.com/@vprprudhvi/a-post-abc123');
  });

  it('throws with the JSON path and the rule when a snapshot time is not an ISO date', () => {
    const { logger } = captureLogger();
    const broken = { ...snapshotAt(FRESH, FRESH), medium: { fetchedAt: 'yesterday', items: [] } };

    expect(() => loadFeeds(broken, NOW, logger)).toThrow(/medium\.fetchedAt: Use an ISO date/u);
  });

  it('names the file in the error when the snapshot is invalid', () => {
    const { logger } = captureLogger();

    expect(() => loadFeeds({}, NOW, logger)).toThrow(/Invalid content\/feeds\.json/u);
  });
});
