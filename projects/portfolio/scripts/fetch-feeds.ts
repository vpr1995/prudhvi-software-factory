// Refreshes `content/feeds.json` from the Medium feed and the pinned GitHub repos. Run it from the
// project folder with `node scripts/fetch-feeds.ts`. Each feed is refreshed on its own: a feed that
// fails keeps its committed part of the snapshot, and the other feed is still written (R-10). The
// pure functions below are exported for the tests. `main` runs only when this file is the script
// that Node starts.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { ZodType } from 'zod';

import { createLogger } from '@vprprudhvi/shared-logger';
import type { Logger } from '@vprprudhvi/shared-logger';

import { ContentSchema } from '../src/contracts/content.ts';
import {
  FeedsSchema,
  GITHUB_FIELD,
  GithubRepositoryResponseSchema,
  MediumRssItemSchema,
} from '../src/contracts/feeds.ts';
import type {
  Feeds,
  GithubRepository,
  GithubRepositoryResponse,
  MediumItem,
  MediumRssItem,
} from '../src/contracts/feeds.ts';

import { readGithubToken, readMediumHandle } from './config.ts';
import { readText, writeText } from './fs-io.ts';

const MEDIUM_ORIGIN = 'https://medium.com/';
const GITHUB_ORIGIN = 'https://github.com/';
const GITHUB_API = 'https://api.github.com/repos/';
const GITHUB_API_HOST = 'api.github.com';
const CONTENT_PATH = 'content/portfolio.json';
const FEEDS_PATH = 'content/feeds.json';
const EPOCH = '1970-01-01T00:00:00.000Z';
const DAY_MS = 86_400_000;
const JSON_INDENT = 2;
// The first command-line argument is at index 2: index 0 is Node and index 1 is the script.
const FIRST_ARGUMENT = 2;

/** The two feeds of the snapshot. */
export type FeedName = 'medium' | 'github';

/** The part of `content/portfolio.json` that the refresh reads. */
export type FeedSources = {
  readonly medium: { readonly handle: string; readonly max: number };
  readonly pinnedRepos: readonly { readonly fullName: string }[];
};

/** A function that fetches a URL. It has the same shape as the global `fetch`. */
export type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>;

/** The result of a refresh: the next snapshot, the warnings to print and the failed feeds. */
export type RefreshResult = {
  readonly snapshot: Feeds;
  readonly warnings: string[];
  readonly failed: FeedName[];
};

/** The items that an origin check kept and dropped. */
export type OriginResult<T> = {
  readonly kept: T[];
  readonly dropped: { readonly title: string; readonly origin: string }[];
};

/** The options of `main`. The CLI passes the project folder, the arguments, `fetch` and a logger. */
export type MainOptions = {
  /** The project folder. The paths of the two JSON files are relative to it. */
  readonly dir: string;
  /** The command-line arguments after the script name. `--strict` makes a failed feed exit 1. */
  readonly argv: readonly string[];
  readonly fetchFn: FetchFunction;
  readonly logger: Logger;
  readonly now: Date;
  /** A Medium handle that replaces the handle of the content file for this run (R-12). */
  readonly mediumHandle?: string | undefined;
};

/** The refresh of one feed collects its warnings and the names of the feeds that failed. */
type Outcome = { warnings: string[]; failed: FeedName[] };

// The parser keeps the body (`content:encoded` and `description`) as raw text, as a stop node, so
// it never reads the markup of an article body.
const rssParser = new XMLParser({
  ignoreAttributes: true,
  isArray: (_name, jpath) => jpath === 'rss.channel.item',
  stopNodes: ['*.content:encoded', '*.description'],
});

// Only the three fields of each item are part of the document shape. The object schema drops the
// other fields, so the body is never copied into the result.
const RssDocumentSchema = z.object({
  rss: z
    .object({
      channel: z.object({ item: z.array(MediumRssItemSchema).optional() }).optional(),
    })
    .optional(),
});

/** The snapshot that is used when `content/feeds.json` does not exist yet. */
const PLACEHOLDER: Feeds = {
  medium: { fetchedAt: EPOCH, items: [] },
  github: { fetchedAt: EPOCH, repos: [] },
};

/**
 * Checks a value against a Zod schema and throws an Error that names the failed fields.
 *
 * @param schema - The contract.
 * @param value - The value to check.
 * @param label - What the value is, for the message.
 * @returns The parsed value.
 * @throws Error that names each field that does not match.
 */
function parseWith<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`${label} does not match the contract:\n${lines.join('\n')}`);
  }
  return result.data;
}

/**
 * Reads the items of a Medium RSS feed. It keeps only the title, the link and the date of each
 * item, and never reads the article body.
 *
 * @param xml - The RSS text.
 * @returns One item for each `<item>` of the channel.
 * @throws Error when an item does not have a valid title, link or date.
 */
export function parseMediumRss(xml: string): MediumRssItem[] {
  const document = parseWith(RssDocumentSchema, rssParser.parse(xml), 'The Medium feed');
  return document.rss?.channel?.item ?? [];
}

/**
 * Reads a GitHub repo response. It keeps the name, the URL and the description, and ignores the
 * other fields.
 *
 * @param json - The parsed JSON of `GET /repos/{owner}/{name}`.
 * @returns The repo in the shape of the snapshot. Its URL is not origin-checked yet.
 * @throws Error when the response does not have a name, a URL or a description.
 */
export function parseGithubRepository(json: unknown): GithubRepository {
  const response: GithubRepositoryResponse = parseWith(
    GithubRepositoryResponseSchema,
    json,
    'A GitHub repo response',
  );
  return {
    fullName: response[GITHUB_FIELD.fullName],
    url: response[GITHUB_FIELD.htmlUrl],
    description: response.description,
  };
}

/**
 * Splits items by their URL. An item whose URL does not start with the allowed origin is dropped,
 * and its title and origin are reported, so the caller can print a warning (R-8).
 *
 * @param items - The items, each with a URL.
 * @param allowedPrefix - The start that every kept URL must have, for example `https://medium.com/`.
 * @param titleOf - The name of an item for the warning.
 * @returns The kept items and the dropped items with their title and origin.
 */
export function filterByOrigin<T extends { readonly url: string }>(
  items: readonly T[],
  allowedPrefix: string,
  titleOf: (item: T) => string,
): OriginResult<T> {
  const kept: T[] = [];
  const dropped: { title: string; origin: string }[] = [];
  for (const item of items) {
    if (item.url.startsWith(allowedPrefix)) {
      kept.push(item);
    } else {
      dropped.push({ title: titleOf(item), origin: originOf(item.url) });
    }
  }
  return { kept, dropped };
}

/**
 * The origin of a URL, for example `https://example.net`. A value that is not a URL is returned as
 * it is.
 *
 * @param url - The URL.
 * @returns The origin of the URL.
 */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Wraps a fetch function so that a request to the GitHub API carries the token. Other requests are
 * sent as they are, and without a token nothing is added.
 *
 * @param fetchFunction - The fetch function to wrap.
 * @param token - The GitHub token, or `undefined`.
 * @returns A fetch function with the same shape.
 */
export function authorizedFetch(
  fetchFunction: FetchFunction,
  token: string | undefined,
): FetchFunction {
  if (typeof token !== 'string') {
    return fetchFunction;
  }
  return (url, init) => {
    if (new URL(url).hostname !== GITHUB_API_HOST) {
      return fetchFunction(url, init);
    }
    return fetchFunction(url, { ...init, headers: { Authorization: `Bearer ${token}` } });
  };
}

/**
 * Fetches a URL. A response that is not 2xx is an Error.
 *
 * @param fetchFunction - The fetch function.
 * @param url - The URL.
 * @returns The response.
 * @throws Error when the status is not 2xx.
 */
async function fetchOk(fetchFunction: FetchFunction, url: string): Promise<Response> {
  const response = await fetchFunction(url);
  if (!response.ok) {
    throw new Error(`The fetch of ${url} failed with status ${String(response.status)}.`);
  }
  return response;
}

/**
 * Turns a parsed RSS item into a snapshot item with an ISO date.
 *
 * @param item - The parsed RSS item.
 * @returns The snapshot item.
 * @throws Error when the date of the item is not a valid date.
 */
function toMediumItem(item: MediumRssItem): MediumItem {
  const date = new Date(item.pubDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`The date of the Medium item "${item.title}" is not valid: ${item.pubDate}`);
  }
  return { title: item.title, url: item.link, publishedAt: date.toISOString() };
}

/**
 * The comparable form of Medium items: the fields that the snapshot stores, in a fixed order.
 *
 * @param items - The items.
 * @returns A text that is equal for two lists with the same items in the same order.
 */
function mediumKey(items: readonly MediumItem[]): string {
  return JSON.stringify(items.map((item) => [item.title, item.url, item.publishedAt]));
}

/**
 * The comparable form of GitHub repos: the fields that the snapshot stores, in a fixed order.
 *
 * @param repositories - The repos.
 * @returns A text that is equal for two lists with the same repos in the same order.
 */
function repositoriesKey(repositories: readonly GithubRepository[]): string {
  return JSON.stringify(
    repositories.map((repository) => [repository.fullName, repository.url, repository.description]),
  );
}

/**
 * The age of a snapshot in whole days.
 *
 * @param fetchedAt - The time of the snapshot, as an ISO text.
 * @param now - The current time.
 * @returns The number of whole days between the two times.
 */
function ageInDays(fetchedAt: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(fetchedAt)) / DAY_MS);
}

/**
 * The warning for a feed that failed. It names the feed, the reason and the age of the snapshot
 * that is kept. The placeholder has no age, so it says that there is no snapshot yet.
 *
 * @param options - The feed, its kept snapshot time, the current time and the reason.
 * @param options.name - The feed.
 * @param options.fetchedAt - The time of the kept snapshot part.
 * @param options.now - The current time.
 * @param options.error - The reason for the failure.
 * @returns The warning text.
 */
function staleWarning(options: {
  readonly name: FeedName;
  readonly fetchedAt: string;
  readonly now: Date;
  readonly error: unknown;
}): string {
  const { name, fetchedAt, now, error } = options;
  const reason = error instanceof Error ? error.message : String(error);
  if (fetchedAt === EPOCH) {
    return `The ${name} feed failed: ${reason} There is no snapshot yet, so the list stays empty.`;
  }
  const days = ageInDays(fetchedAt, now);
  const unit = days === 1 ? 'day' : 'days';
  return `The ${name} feed failed: ${reason} Kept its snapshot from ${fetchedAt}, ${String(days)} ${unit} old.`;
}

/**
 * Refreshes the Medium part. Its items are the newest ones up to `content.medium.max`.
 *
 * @param options - The inputs of the refresh.
 * @param options.fetchFn - The fetch function.
 * @param options.content - The feed sources.
 * @param options.previous - The Medium part of the current snapshot.
 * @param options.fetchedAt - The time to write for a changed part.
 * @param options.warnings - The list that receives the origin warnings.
 * @returns The Medium part.
 * @throws Error when the fetch or the parse fails, or no item is kept.
 */
async function refreshMedium(options: {
  readonly fetchFn: FetchFunction;
  readonly content: FeedSources;
  readonly previous: Feeds['medium'];
  readonly fetchedAt: string;
  readonly warnings: string[];
}): Promise<Feeds['medium']> {
  const { fetchFn, content, previous, fetchedAt, warnings } = options;
  const response = await fetchOk(fetchFn, `${MEDIUM_ORIGIN}feed/${content.medium.handle}`);
  const rssItems = parseMediumRss(await response.text());
  const checked = filterByOrigin(rssItems.map(toMediumItem), MEDIUM_ORIGIN, (item) => item.title);
  for (const dropped of checked.dropped) {
    warnings.push(
      `Dropped the Medium item "${dropped.title}" from ${dropped.origin}: its link is not on ${MEDIUM_ORIGIN}.`,
    );
  }
  const items = checked.kept
    .toSorted((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, content.medium.max);
  if (items.length === 0) {
    throw new Error('The Medium feed has no items to keep. Check the handle and the feed.');
  }
  return mediumKey(items) === mediumKey(previous.items) ? previous : { fetchedAt, items };
}

/**
 * Refreshes the GitHub part: one request for each pinned repo, in the order of the content file.
 *
 * @param options - The inputs of the refresh.
 * @param options.fetchFn - The fetch function.
 * @param options.content - The feed sources.
 * @param options.previous - The GitHub part of the current snapshot.
 * @param options.fetchedAt - The time to write for a changed part.
 * @param options.warnings - The list that receives the origin warnings.
 * @returns The GitHub part.
 * @throws Error when a fetch or a parse fails, or no repo is kept.
 */
async function refreshGithub(options: {
  readonly fetchFn: FetchFunction;
  readonly content: FeedSources;
  readonly previous: Feeds['github'];
  readonly fetchedAt: string;
  readonly warnings: string[];
}): Promise<Feeds['github']> {
  const { fetchFn, content, previous, fetchedAt, warnings } = options;
  const repositories: GithubRepository[] = [];
  for (const pinned of content.pinnedRepos) {
    const response = await fetchOk(fetchFn, `${GITHUB_API}${pinned.fullName}`);
    repositories.push(parseGithubRepository(await response.json()));
  }
  const checked = filterByOrigin(repositories, GITHUB_ORIGIN, (repository) => repository.fullName);
  for (const dropped of checked.dropped) {
    warnings.push(
      `Dropped the GitHub repo "${dropped.title}" from ${dropped.origin}: its link is not on ${GITHUB_ORIGIN}.`,
    );
  }
  if (checked.kept.length === 0) {
    throw new Error('The GitHub feed has no repos to keep. Check the pinned repos.');
  }
  return repositoriesKey(checked.kept) === repositoriesKey(previous.repos)
    ? previous
    : { fetchedAt, repos: checked.kept };
}

/**
 * Runs the refresh of one feed. When it fails, the old part is kept, the feed is named in
 * `failed`, and a warning with the age of the kept part is added.
 *
 * @param options - The inputs of the refresh.
 * @param options.name - The feed.
 * @param options.previous - The part of the current snapshot.
 * @param options.now - The current time.
 * @param options.outcome - The warnings and the failed feeds of the whole refresh.
 * @param options.refresh - Refreshes the feed. It receives the list for its origin warnings.
 * @returns The new part, or the old part when the feed failed.
 */
async function refreshOrKeep<T extends { readonly fetchedAt: string }>(options: {
  readonly name: FeedName;
  readonly previous: T;
  readonly now: Date;
  readonly outcome: Outcome;
  readonly refresh: (warnings: string[]) => Promise<T>;
}): Promise<T> {
  const { name, previous, now, outcome, refresh } = options;
  const feedWarnings: string[] = [];
  try {
    const next = await refresh(feedWarnings);
    outcome.warnings.push(...feedWarnings);
    return next;
  } catch (error: unknown) {
    outcome.failed.push(name);
    outcome.warnings.push(staleWarning({ name, fetchedAt: previous.fetchedAt, now, error }));
    return previous;
  }
}

/**
 * Builds the next snapshot from the two feeds. Each feed is refreshed on its own. A feed whose items
 * changed gets the new items and the time `now` as its `fetchedAt`. A feed whose items did not change
 * keeps its old part as it is (R-9). A feed whose fetch fails, whose response does not match, or
 * that has no items keeps its old part, is listed in `failed` and gets a warning with the age of its
 * snapshot (R-10).
 *
 * @param options - The fetch function, the parsed content, the current snapshot and the time.
 * @param options.fetchFn - Fetches a URL. The tests pass a fake.
 * @param options.content - The parts of `content/portfolio.json` that the refresh reads.
 * @param options.snapshot - The current `content/feeds.json`.
 * @param options.now - The time to write as `fetchedAt` for a changed feed.
 * @returns The next snapshot, the warnings and the names of the failed feeds.
 */
export async function refreshFeeds(options: {
  readonly fetchFn: FetchFunction;
  readonly content: FeedSources;
  readonly snapshot: Feeds;
  readonly now: Date;
}): Promise<RefreshResult> {
  const { fetchFn, content, snapshot, now } = options;
  const fetchedAt = now.toISOString();
  const outcome: Outcome = { warnings: [], failed: [] };

  const medium = await refreshOrKeep({
    name: 'medium',
    previous: snapshot.medium,
    now,
    outcome,
    refresh: (warnings) =>
      refreshMedium({ fetchFn, content, previous: snapshot.medium, fetchedAt, warnings }),
  });
  const github = await refreshOrKeep({
    name: 'github',
    previous: snapshot.github,
    now,
    outcome,
    refresh: (warnings) =>
      refreshGithub({ fetchFn, content, previous: snapshot.github, fetchedAt, warnings }),
  });

  return { snapshot: { medium, github }, warnings: outcome.warnings, failed: outcome.failed };
}

/**
 * Reads a JSON file. The error for invalid JSON does not include the text of the file.
 *
 * @param path - The file.
 * @returns The parsed value.
 * @throws Error when the file cannot be read or is not JSON.
 */
function readJson(path: string): unknown {
  const text = readText(path);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
}

/**
 * Reads `content/feeds.json`. A missing file is the placeholder, with no snapshot yet.
 *
 * @param path - The file.
 * @returns The current snapshot.
 * @throws Error when the file exists but does not match the contract.
 */
function readSnapshot(path: string): Feeds {
  try {
    return parseWith(FeedsSchema, readJson(path), FEEDS_PATH);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return PLACEHOLDER;
    }
    throw error;
  }
}

/**
 * Refreshes the feeds of the project in `options.dir`, logs the warnings and a summary, and writes
 * `content/feeds.json` only when the items changed. Each line goes through the logger. A line never
 * holds a token, a header or the text of an article.
 *
 * @param options - The project folder, the arguments, the fetch function, the logger and the time.
 * @returns The exit code: 1 when the file could not be refreshed, or when `--strict` is given and a
 * feed failed. The file is written before the exit code is decided.
 */
export async function main(options: MainOptions): Promise<number> {
  const { dir, argv, fetchFn, logger, now, mediumHandle } = options;
  const isStrict = argv.includes('--strict');
  try {
    const parsed = parseWith(ContentSchema, readJson(join(dir, CONTENT_PATH)), CONTENT_PATH);
    const content: FeedSources =
      mediumHandle === undefined
        ? parsed
        : { ...parsed, medium: { ...parsed.medium, handle: mediumHandle } };
    const snapshot = readSnapshot(join(dir, FEEDS_PATH));

    const result = await refreshFeeds({ fetchFn, content, snapshot, now });
    for (const warning of result.warnings) {
      logger.warn({ event: 'feeds.warning' }, warning);
    }

    const hasChanged = JSON.stringify(result.snapshot) !== JSON.stringify(snapshot);
    if (hasChanged) {
      writeText(join(dir, FEEDS_PATH), `${JSON.stringify(result.snapshot, null, JSON_INDENT)}\n`);
    }
    logger.info(
      { event: 'feeds.finished', written: hasChanged, failed: result.failed, strict: isStrict },
      'Feed refresh finished.',
    );
    return isStrict && result.failed.length > 0 ? 1 : 0;
  } catch (error: unknown) {
    logger.error(
      { event: 'feeds.failed' },
      error instanceof Error ? error.message : 'The feed refresh failed.',
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main({
    dir: process.cwd(),
    argv: process.argv.slice(FIRST_ARGUMENT),
    fetchFn: authorizedFetch(fetch, readGithubToken()),
    logger: createLogger({ serviceName: 'portfolio-feeds' }),
    now: new Date(),
    mediumHandle: readMediumHandle(),
  });
}
