// Build time only: the feed snapshot is read while `next build` renders the pages, like the content.
// The JSON file is bundled with the module, so no file is read at run time: the site is static.
import { createLogger } from '@vprprudhvi/shared-logger';
import type { Logger } from '@vprprudhvi/shared-logger';

import feedsJson from '../../content/feeds.json';
import { FeedsSchema } from '../../src/contracts/feeds.ts';
import type { Feeds } from '../../src/contracts/feeds.ts';

import { formatContentIssues } from './content.ts';

/** A snapshot older than this many whole days gets a build warning (R-20). */
const STALE_AFTER_DAYS = 90;
const DAY_MS = 86_400_000;

/** The feeds of the snapshot, by the name the warning uses. */
const FEED_NAMES = ['medium', 'github'] as const;

/**
 * The whole days between a snapshot time and now.
 *
 * @param fetchedAt - The time of the snapshot, as an ISO text.
 * @param now - The current time.
 * @returns The number of whole days. The value is negative when the time is in the future.
 */
function ageInWholeDays(fetchedAt: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(fetchedAt)) / DAY_MS);
}

/**
 * Lists the feeds whose snapshot is older than 90 whole days. A snapshot of exactly 90 days does
 * not warn. `fetchedAt` moves only when the items change, so a warning means that a feed has not
 * changed for a long time (R-20).
 *
 * @param feeds - The valid snapshot.
 * @param now - The current time.
 * @returns One warning for each stale feed. The warning names the feed and its age in days.
 */
export function staleFeedWarnings(feeds: Feeds, now: Date): string[] {
  return FEED_NAMES.flatMap((name) => {
    const days = ageInWholeDays(feeds[name].fetchedAt, now);
    if (days <= STALE_AFTER_DAYS) {
      return [];
    }
    return [
      `The ${name} feed has not changed for ${String(days)} days. The weekly refresh may still be running fine and the source may have no new items. If you expect new items, check the refresh workflow or run npm run fetch-feeds.`,
    ];
  });
}

/**
 * Parses a value with the feed snapshot contract, and prints a warning through the logger for each
 * stale feed. A stale feed does not stop the build.
 *
 * @param value - The parsed JSON of `content/feeds.json`.
 * @param now - The current time.
 * @param logger - The logger that prints the warnings.
 * @returns The valid snapshot.
 * @throws Error whose message names the file and gives one line for each issue.
 */
export function loadFeeds(value: unknown, now: Date, logger: Logger): Feeds {
  const result = FeedsSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid content/feeds.json. Fix each line below.\n${formatContentIssues(result.error.issues)}`,
    );
  }
  for (const warning of staleFeedWarnings(result.data, now)) {
    logger.warn({ event: 'feeds.stale' }, warning);
  }
  return result.data;
}

const logger = createLogger({ serviceName: 'portfolio-web' });

/** The validated feed snapshot of the site. The build fails here when the file is not valid. */
export const feeds: Feeds = loadFeeds(feedsJson, new Date(), logger);
