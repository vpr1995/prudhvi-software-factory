// Refreshes `content/feeds.json` from the Medium feed and the pinned GitHub repos. Run it from the
// project folder with `node scripts/fetch-feeds.ts`. The pure functions below are exported for the
// tests. `main` runs only when this file is the script that Node starts.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { ZodType } from 'zod';

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

const MEDIUM_ORIGIN = 'https://medium.com/';
const GITHUB_ORIGIN = 'https://github.com/';
const GITHUB_API = 'https://api.github.com/repos/';
const JSON_INDENT = 2;

/** The part of `content/portfolio.json` that the refresh reads. */
export type FeedSources = {
  readonly medium: { readonly handle: string; readonly max: number };
  readonly pinnedRepos: readonly { readonly fullName: string }[];
};

/** A function that fetches a URL. It has the same shape as the global `fetch`. */
export type FetchFunction = (url: string) => Promise<Response>;

/** The result of a refresh: the next snapshot and the warnings to print. */
export type RefreshResult = {
  readonly snapshot: Feeds;
  readonly warnings: string[];
};

/** The items that an origin check kept and dropped. */
export type OriginResult<T> = {
  readonly kept: T[];
  readonly dropped: { readonly title: string; readonly origin: string }[];
};

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
 * Builds the next snapshot from the two feeds. A feed whose items changed gets the new items and
 * the time `now` as its `fetchedAt`. A feed whose items did not change keeps its old snapshot as it
 * is, so the file does not change (R-9). A failed fetch, a failed parse or a feed with no items
 * throws an Error. Handling of those failures comes in a later change.
 *
 * @param options - The fetch function, the parsed content, the current snapshot and the time.
 * @param options.fetchFn - Fetches a URL. The tests pass a fake.
 * @param options.content - The parts of `content/portfolio.json` that the refresh reads.
 * @param options.snapshot - The current `content/feeds.json`.
 * @param options.now - The time to write as `fetchedAt` for a changed feed.
 * @returns The next snapshot and the warnings.
 * @throws Error when a fetch fails, a response does not match, or a feed has no items.
 */
export async function refreshFeeds(options: {
  readonly fetchFn: FetchFunction;
  readonly content: FeedSources;
  readonly snapshot: Feeds;
  readonly now: Date;
}): Promise<RefreshResult> {
  const { fetchFn: fetchFunction, content, snapshot, now } = options;
  const warnings: string[] = [];
  const fetchedAt = now.toISOString();

  // Medium: newest first, up to content.medium.max.
  const mediumResponse = await fetchOk(
    fetchFunction,
    `https://medium.com/feed/${content.medium.handle}`,
  );
  const rssItems = parseMediumRss(await mediumResponse.text());
  const mediumChecked = filterByOrigin(
    rssItems.map(toMediumItem),
    MEDIUM_ORIGIN,
    (item) => item.title,
  );
  for (const dropped of mediumChecked.dropped) {
    warnings.push(
      `Dropped the Medium item "${dropped.title}" from ${dropped.origin}: its link is not on ${MEDIUM_ORIGIN}.`,
    );
  }
  const mediumItems = mediumChecked.kept
    .toSorted((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, content.medium.max);
  if (mediumItems.length === 0) {
    throw new Error('The Medium feed has no items to keep. Check the handle and the feed.');
  }

  // GitHub: one request for each pinned repo, in the order of the content file.
  const repositories: GithubRepository[] = [];
  for (const pinned of content.pinnedRepos) {
    const response = await fetchOk(fetchFunction, `${GITHUB_API}${pinned.fullName}`);
    repositories.push(parseGithubRepository(await response.json()));
  }
  const repositoryChecked = filterByOrigin(
    repositories,
    GITHUB_ORIGIN,
    (repository) => repository.fullName,
  );
  for (const dropped of repositoryChecked.dropped) {
    warnings.push(
      `Dropped the GitHub repo "${dropped.title}" from ${dropped.origin}: its link is not on ${GITHUB_ORIGIN}.`,
    );
  }
  if (repositoryChecked.kept.length === 0) {
    throw new Error('The GitHub feed has no repos to keep. Check the pinned repos.');
  }

  const medium =
    mediumKey(mediumItems) === mediumKey(snapshot.medium.items)
      ? snapshot.medium
      : { fetchedAt, items: mediumItems };
  const github =
    repositoriesKey(repositoryChecked.kept) === repositoriesKey(snapshot.github.repos)
      ? snapshot.github
      : { fetchedAt, repos: repositoryChecked.kept };

  return { snapshot: { medium, github }, warnings };
}

/**
 * Reads the two JSON files, refreshes the feeds, prints the warnings and writes `content/feeds.json`
 * only when the items changed. The paths are relative to the project folder.
 *
 * @throws Error when a file cannot be read or a feed cannot be refreshed.
 */
async function main(): Promise<void> {
  const content = ContentSchema.parse(JSON.parse(await readFile('content/portfolio.json', 'utf8')));
  const snapshot = FeedsSchema.parse(JSON.parse(await readFile('content/feeds.json', 'utf8')));

  const result = await refreshFeeds({ fetchFn: fetch, content, snapshot, now: new Date() });
  for (const warning of result.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }
  if (JSON.stringify(result.snapshot) !== JSON.stringify(snapshot)) {
    await writeFile(
      'content/feeds.json',
      `${JSON.stringify(result.snapshot, null, JSON_INDENT)}\n`,
    );
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
