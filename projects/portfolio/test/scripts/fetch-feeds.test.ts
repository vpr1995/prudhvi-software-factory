import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger } from '@vprprudhvi/shared-logger';

import {
  authorizedFetch,
  filterByOrigin,
  main,
  parseGithubRepository,
  parseMediumRss,
  refreshFeeds,
} from '../../scripts/fetch-feeds.ts';
import type { FeedSources, FetchFunction } from '../../scripts/fetch-feeds.ts';
import { ContentSchema } from '../../src/contracts/content.ts';
import { FeedsSchema, GITHUB_FIELD } from '../../src/contracts/feeds.ts';
import type { Feeds } from '../../src/contracts/feeds.ts';

const MEDIUM_URL = 'https://medium.com/feed/@vprprudhvi';
const REPO_URL = 'https://api.github.com/repos/vpr1995/rbac-engine';
const MOVED_URL = 'https://api.github.com/repos/vpr1995/moved';

const PROJECT_FOLDER = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT_FILE = join(PROJECT_FOLDER, 'scripts/fetch-feeds.ts');
const PRELOAD_FILE = join(PROJECT_FOLDER, 'test/scripts/fake-fetch.mjs');
const CONTENT_FILE = join(PROJECT_FOLDER, 'content/portfolio.json');

const TOKEN = 'ghp_TEST_TOKEN_DO_NOT_LOG';
const ARTICLE_BODY = 'BODY-SECRET';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Stories by Prudhvi on Medium</title>
    <item>
      <title><![CDATA[Newer post]]></title>
      <link>https://medium.com/@vprprudhvi/newer-post-abc123</link>
      <pubDate>Mon, 02 Mar 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[<p>Summary text</p>]]></description>
      <content:encoded><![CDATA[<p>Full article ${ARTICLE_BODY}</p>]]></content:encoded>
    </item>
    <item>
      <title>Older post</title>
      <link>https://medium.com/@vprprudhvi/older-post-def456</link>
      <pubDate>Sat, 01 Feb 2026 09:00:00 GMT</pubDate>
      <content:encoded><p><link>https://evil.example/x</link></p></content:encoded>
    </item>
  </channel>
</rss>`;

const EMPTY_RSS = '<rss version="2.0"><channel><title>Empty</title></channel></rss>';

// The GitHub API uses snake case keys, so the fixtures are JSON text.
const REPO_TEXT =
  '{"full_name": "vpr1995/rbac-engine", "html_url": "https://github.com/vpr1995/rbac-engine", "description": "RBAC engine", "stargazers_count": 12, "private": false}';

const CONTENT = {
  medium: { handle: '@vprprudhvi', max: 6 },
  pinnedRepos: [{ fullName: 'vpr1995/rbac-engine' }],
};

const SNAPSHOT: Feeds = {
  medium: {
    fetchedAt: '2026-01-01T00:00:00.000Z',
    items: [
      {
        title: 'Newer post',
        url: 'https://medium.com/@vprprudhvi/newer-post-abc123',
        publishedAt: '2026-03-02T09:00:00.000Z',
      },
      {
        title: 'Older post',
        url: 'https://medium.com/@vprprudhvi/older-post-def456',
        publishedAt: '2026-02-01T09:00:00.000Z',
      },
    ],
  },
  github: {
    fetchedAt: '2026-01-01T00:00:00.000Z',
    repos: [
      {
        fullName: 'vpr1995/rbac-engine',
        url: 'https://github.com/vpr1995/rbac-engine',
        description: 'RBAC engine',
      },
    ],
  },
};

// The snapshot of the main tests: the medium part is the live one, and the GitHub part is empty, so
// a successful GitHub fetch always changes the file.
const MAIN_SNAPSHOT: Feeds = {
  medium: SNAPSHOT.medium,
  github: { fetchedAt: '2026-01-01T00:00:00.000Z', repos: [] },
};

const NOW = new Date('2026-11-09T06:00:00.000Z');
// The age of the snapshot from 2026-01-01 at NOW, in whole days.
const SNAPSHOT_AGE = '312 days';

type Route = string | { readonly status: number; readonly body: string };

/**
 * Builds a fake `fetch` that answers from a table of URLs. An unknown URL rejects, as a network
 * error would.
 *
 * @param routes - The response for each URL. A string is a 200 response.
 * @returns A fetch function that records the calls it got.
 */
function fakeFetch(routes: Record<string, Route>): {
  fetchFn: FetchFunction;
  calls: string[];
  inits: (RequestInit | undefined)[];
} {
  const calls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  const fetchFunction: FetchFunction = (url: string, init?: RequestInit): Promise<Response> => {
    calls.push(url);
    inits.push(init);
    const route = routes[url];
    if (route === undefined) {
      return Promise.reject(new Error(`Unexpected URL in a test: ${url}`));
    }
    const { status, body } = typeof route === 'string' ? { status: 200, body: route } : route;
    return Promise.resolve(new Response(body, { status }));
  };
  return { fetchFn: fetchFunction, calls, inits };
}

/**
 * Builds the routes of the two feeds for the given content, with the outcome of each feed.
 *
 * @param content - The feed sources.
 * @param outcome - `ok`, `fail` (a 500 or a 404) or `empty` (a feed with no items) for each feed.
 * @returns The routes.
 */
function routesFor(
  content: FeedSources,
  outcome: { readonly medium: 'ok' | 'fail' | 'empty'; readonly github: 'ok' | 'fail' },
): Record<string, Route> {
  const routes: Record<string, Route> = {};
  const mediumBody = {
    ok: RSS,
    empty: EMPTY_RSS,
    fail: { status: 500, body: 'Server error' },
  }[outcome.medium];
  routes[`https://medium.com/feed/${content.medium.handle}`] = mediumBody;
  for (const pinned of content.pinnedRepos) {
    routes[`https://api.github.com/repos/${pinned.fullName}`] =
      outcome.github === 'ok'
        ? JSON.stringify({
            [GITHUB_FIELD.fullName]: pinned.fullName,
            [GITHUB_FIELD.htmlUrl]: `https://github.com/${pinned.fullName}`,
            description: `About ${pinned.fullName}`,
          })
        : { status: 404, body: 'Not Found' };
  }
  return routes;
}

/**
 * Creates a logger that keeps each line in memory.
 *
 * @returns The logger and the lines it wrote.
 */
function captureLogger(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger({
    serviceName: 'portfolio-feeds-test',
    destination: {
      write(chunk: string): void {
        lines.push(chunk);
      },
    },
  });
  return { logger, lines };
}

describe('parseMediumRss (R-7)', () => {
  it('keeps only the title, the link and the date of each item', () => {
    const items = parseMediumRss(RSS);
    expect(items).toEqual([
      {
        title: 'Newer post',
        link: 'https://medium.com/@vprprudhvi/newer-post-abc123',
        pubDate: 'Mon, 02 Mar 2026 09:00:00 GMT',
      },
      {
        title: 'Older post',
        link: 'https://medium.com/@vprprudhvi/older-post-def456',
        pubDate: 'Sat, 01 Feb 2026 09:00:00 GMT',
      },
    ]);
  });

  it('never reads the article body', () => {
    const serialized = JSON.stringify(parseMediumRss(RSS));
    expect(serialized).not.toContain(ARTICLE_BODY);
    expect(serialized).not.toContain('Summary text');
    expect(serialized).not.toContain('evil.example');
  });

  it('returns no items for a feed without items', () => {
    expect(parseMediumRss('<rss><channel><title>Empty</title></channel></rss>')).toEqual([]);
  });

  it('throws when an item has no link', () => {
    const broken = RSS.replace('<link>https://medium.com/@vprprudhvi/older-post-def456</link>', '');
    expect(() => parseMediumRss(broken)).toThrow(/link/u);
  });
});

describe('parseGithubRepository (R-7)', () => {
  it('keeps the name, the URL and the description, and ignores the other fields', () => {
    expect(parseGithubRepository(JSON.parse(REPO_TEXT))).toEqual({
      fullName: 'vpr1995/rbac-engine',
      url: 'https://github.com/vpr1995/rbac-engine',
      description: 'RBAC engine',
    });
  });

  it('throws when the response does not match the contract', () => {
    expect(() => parseGithubRepository(JSON.parse('{"full_name": "vpr1995/rbac-engine"}'))).toThrow(
      /html_url/u,
    );
  });
});

describe('filterByOrigin (R-8)', () => {
  it('drops the items that are not on the allowed origin and reports them', () => {
    const items = [
      { title: 'Good', url: 'https://medium.com/@vprprudhvi/good' },
      { title: 'Mirror copy', url: 'https://example.net/mirror/copy' },
    ];
    const result = filterByOrigin(items, 'https://medium.com/', (item) => item.title);
    expect(result.kept).toEqual([items[0]]);
    expect(result.dropped).toEqual([{ title: 'Mirror copy', origin: 'https://example.net' }]);
  });
});

describe('authorizedFetch (R-19)', () => {
  it('sends the token as an Authorization header to api.github.com only', async () => {
    const { fetchFn, inits } = fakeFetch({ [REPO_URL]: REPO_TEXT, [MEDIUM_URL]: RSS });
    const authorized = authorizedFetch(fetchFn, TOKEN);
    await authorized(REPO_URL);
    await authorized(MEDIUM_URL);
    expect(new Headers(inits[0]?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(inits[1]).toBeUndefined();
  });

  it('sends no header when there is no token', async () => {
    const { fetchFn, inits } = fakeFetch({ [REPO_URL]: REPO_TEXT });
    await authorizedFetch(fetchFn, undefined)(REPO_URL);
    expect(inits[0]).toBeUndefined();
  });
});

describe('refreshFeeds (R-7, R-8, R-9, R-10)', () => {
  it('fetches both feeds and returns the items with only the kept fields', async () => {
    const { fetchFn, calls } = fakeFetch({ [MEDIUM_URL]: RSS, [REPO_URL]: REPO_TEXT });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(calls.toSorted()).toEqual([MEDIUM_URL, REPO_URL].toSorted());
    expect(result.snapshot.medium.items).toEqual(SNAPSHOT.medium.items);
    expect(result.snapshot.github.repos).toEqual(SNAPSHOT.github.repos);
    expect(FeedsSchema.safeParse(result.snapshot).success).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('keeps only the newest items up to content.medium.max', async () => {
    const { fetchFn } = fakeFetch({ [MEDIUM_URL]: RSS, [REPO_URL]: REPO_TEXT });
    const result = await refreshFeeds({
      fetchFn,
      content: { ...CONTENT, medium: { handle: '@vprprudhvi', max: 1 } },
      snapshot: SNAPSHOT,
      now: NOW,
    });
    expect(result.snapshot.medium.items.map((item) => item.title)).toEqual(['Newer post']);
  });

  it('keeps the GitHub snapshot and warns when a GitHub response does not match the contract', async () => {
    const { fetchFn } = fakeFetch({
      [MEDIUM_URL]: RSS,
      [REPO_URL]: '{"full_name": "vpr1995/rbac-engine"}',
    });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(result.failed).toEqual(['github']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('html_url');
  });

  it('keeps the old snapshot of a failed feed and warns with its name and age', async () => {
    const { fetchFn } = fakeFetch({
      [MEDIUM_URL]: { status: 500, body: 'Server error' },
      [REPO_URL]: REPO_TEXT,
    });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(result.failed).toEqual(['medium']);
    expect(result.snapshot.medium).toEqual(SNAPSHOT.medium);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('medium');
    expect(result.warnings[0]).toContain(SNAPSHOT_AGE);
  });

  it('writes the GitHub feed that succeeded when the Medium feed fails', async () => {
    const changed = JSON.stringify({
      [GITHUB_FIELD.fullName]: 'vpr1995/rbac-engine',
      [GITHUB_FIELD.htmlUrl]: 'https://github.com/vpr1995/rbac-engine',
      description: 'A new description',
    });
    const { fetchFn } = fakeFetch({
      [MEDIUM_URL]: { status: 500, body: 'Server error' },
      [REPO_URL]: changed,
    });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(result.failed).toEqual(['medium']);
    expect(result.snapshot.medium).toEqual(SNAPSHOT.medium);
    expect(result.snapshot.github.fetchedAt).toBe(NOW.toISOString());
    expect(result.snapshot.github.repos[0]?.description).toBe('A new description');
  });

  it('keeps both snapshots and reports both feeds when both fetches fail', async () => {
    const { fetchFn } = fakeFetch({
      [MEDIUM_URL]: { status: 500, body: 'Server error' },
      [REPO_URL]: { status: 404, body: 'Not Found' },
    });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(result.failed).toEqual(['medium', 'github']);
    expect(result.snapshot).toEqual(SNAPSHOT);
    expect(result.warnings).toHaveLength(2);
  });

  it('treats a network error as a failed feed', async () => {
    const { fetchFn } = fakeFetch({ [REPO_URL]: REPO_TEXT });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(result.failed).toEqual(['medium']);
    expect(result.warnings[0]).toContain('Unexpected URL in a test');
  });

  it('treats a feed with zero items as a failed feed', async () => {
    const { fetchFn } = fakeFetch({ [MEDIUM_URL]: EMPTY_RSS, [REPO_URL]: REPO_TEXT });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(result.failed).toEqual(['medium']);
    expect(result.snapshot.medium).toEqual(SNAPSHOT.medium);
    expect(result.warnings[0]).toContain('no items');
  });

  it('treats a GitHub feed with no pinned repos as a failed feed', async () => {
    const { fetchFn } = fakeFetch({ [MEDIUM_URL]: RSS });
    const result = await refreshFeeds({
      fetchFn,
      content: { ...CONTENT, pinnedRepos: [] },
      snapshot: SNAPSHOT,
      now: NOW,
    });

    expect(result.failed).toEqual(['github']);
    expect(result.snapshot.github).toEqual(SNAPSHOT.github);
  });

  it('says that there is no snapshot yet when the placeholder is the old snapshot', async () => {
    const placeholder: Feeds = {
      medium: { fetchedAt: '1970-01-01T00:00:00.000Z', items: [] },
      github: { fetchedAt: '1970-01-01T00:00:00.000Z', repos: [] },
    };
    const { fetchFn } = fakeFetch({
      [MEDIUM_URL]: { status: 500, body: '' },
      [REPO_URL]: REPO_TEXT,
    });
    const result = await refreshFeeds({
      fetchFn,
      content: CONTENT,
      snapshot: placeholder,
      now: NOW,
    });

    expect(result.warnings[0]).toContain('no snapshot yet');
  });

  it('drops an off-origin Medium item, keeps the others and warns with its title and origin', async () => {
    const withMirror = RSS.replace(
      '<item>\n      <title>Older post',
      `<item>
      <title>Mirror copy</title>
      <link>https://example.net/mirror/copy</link>
      <pubDate>Sun, 01 Mar 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Older post`,
    );
    const { fetchFn } = fakeFetch({ [MEDIUM_URL]: withMirror, [REPO_URL]: REPO_TEXT });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(result.snapshot.medium.items.map((item) => item.title)).toEqual([
      'Newer post',
      'Older post',
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Mirror copy');
    expect(result.warnings[0]).toContain('https://example.net');
    expect(result.failed).toEqual([]);
  });

  it('drops an off-origin GitHub repo and warns with its name and origin', async () => {
    const content = {
      ...CONTENT,
      pinnedRepos: [{ fullName: 'vpr1995/rbac-engine' }, { fullName: 'vpr1995/moved' }],
    };
    const { fetchFn } = fakeFetch({
      [MEDIUM_URL]: RSS,
      [REPO_URL]: REPO_TEXT,
      [MOVED_URL]:
        '{"full_name": "vpr1995/moved", "html_url": "https://gitlab.com/vpr1995/moved", "description": null}',
    });
    const result = await refreshFeeds({ fetchFn, content, snapshot: SNAPSHOT, now: NOW });

    expect(result.snapshot.github.repos.map((repository) => repository.fullName)).toEqual([
      'vpr1995/rbac-engine',
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('vpr1995/moved');
    expect(result.warnings[0]).toContain('https://gitlab.com');
  });

  it('treats a Medium feed whose items are all off-origin as a failed feed', async () => {
    const allOff = RSS.replaceAll('https://medium.com/', 'https://example.net/');
    const { fetchFn } = fakeFetch({ [MEDIUM_URL]: allOff, [REPO_URL]: REPO_TEXT });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(result.failed).toEqual(['medium']);
    expect(result.snapshot.medium).toEqual(SNAPSHOT.medium);
    expect(result.warnings.join('\n')).toContain('no items');
  });

  it('writes a new fetchedAt for a feed whose items changed and keeps the other feed', async () => {
    const changed = RSS.replace('Newer post', 'Brand new post');
    const { fetchFn } = fakeFetch({ [MEDIUM_URL]: changed, [REPO_URL]: REPO_TEXT });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(result.snapshot.medium.fetchedAt).toBe(NOW.toISOString());
    expect(result.snapshot.medium.items[0]?.title).toBe('Brand new post');
    expect(result.snapshot.github).toEqual(SNAPSHOT.github);
  });

  it('leaves the snapshot byte-identical when the items did not change', async () => {
    const { fetchFn } = fakeFetch({ [MEDIUM_URL]: RSS, [REPO_URL]: REPO_TEXT });
    const later = new Date('2026-11-16T06:00:00.000Z');
    const result = await refreshFeeds({
      fetchFn,
      content: CONTENT,
      snapshot: SNAPSHOT,
      now: later,
    });

    expect(JSON.stringify(result.snapshot)).toBe(JSON.stringify(SNAPSHOT));
    expect(result.snapshot.medium.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('main (R-9, R-10, R-19)', () => {
  let folder: string;
  let feedsFile: string;

  /**
   * Writes the snapshot file of the project copy.
   *
   * @param snapshot - The snapshot to write.
   * @param indent - The indent of the JSON text.
   */
  function writeFeeds(snapshot: Feeds, indent = 2): void {
    writeFileSync(feedsFile, `${JSON.stringify(snapshot, null, indent)}\n`);
  }

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'portfolio-feeds-'));
    mkdirSync(join(folder, 'content'));
    copyFileSync(CONTENT_FILE, join(folder, 'content/portfolio.json'));
    feedsFile = join(folder, 'content/feeds.json');
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  const content = ContentSchema.parse(JSON.parse(readFileSync(CONTENT_FILE, 'utf8')));

  it('writes the file with pretty JSON and a trailing newline when both feeds succeed', async () => {
    const { fetchFn } = fakeFetch(routesFor(content, { medium: 'ok', github: 'ok' }));
    const { logger } = captureLogger();

    const code = await main({ dir: folder, argv: [], fetchFn, logger, now: NOW });

    expect(code).toBe(0);
    const text = readFileSync(feedsFile, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    expect(FeedsSchema.parse(JSON.parse(text)).github.fetchedAt).toBe(NOW.toISOString());
  });

  it('fetches the Medium feed of the handle option instead of the handle of the content file', async () => {
    const routes = routesFor(content, { medium: 'ok', github: 'ok' });
    routes['https://medium.com/feed/@someone-else'] = { status: 404, body: 'Not Found' };
    const { fetchFn, calls } = fakeFetch(routes);
    const { logger } = captureLogger();

    const code = await main({
      dir: folder,
      argv: ['--strict'],
      fetchFn,
      logger,
      now: NOW,
      mediumHandle: '@someone-else',
    });

    expect(calls).toContain('https://medium.com/feed/@someone-else');
    expect(calls).not.toContain(MEDIUM_URL);
    expect(code).toBe(1);
    const written = FeedsSchema.parse(JSON.parse(readFileSync(feedsFile, 'utf8')));
    expect(written.medium.items).toHaveLength(0);
    expect(written.github.repos).toHaveLength(1);
  });

  it('keeps the failed feed, writes the other one and exits 0 without --strict', async () => {
    writeFeeds(MAIN_SNAPSHOT);
    const { fetchFn } = fakeFetch(routesFor(content, { medium: 'fail', github: 'ok' }));
    const { logger } = captureLogger();

    const code = await main({ dir: folder, argv: [], fetchFn, logger, now: NOW });

    expect(code).toBe(0);
    const written = FeedsSchema.parse(JSON.parse(readFileSync(feedsFile, 'utf8')));
    expect(written.medium).toEqual(MAIN_SNAPSHOT.medium);
    expect(written.github.fetchedAt).toBe(NOW.toISOString());
    expect(written.github.repos).toHaveLength(1);
  });

  it('exits 1 with --strict after it has written the file when one feed failed', async () => {
    writeFeeds(MAIN_SNAPSHOT);
    const { fetchFn } = fakeFetch(routesFor(content, { medium: 'fail', github: 'ok' }));
    const { logger } = captureLogger();

    const code = await main({ dir: folder, argv: ['--strict'], fetchFn, logger, now: NOW });

    expect(code).toBe(1);
    const written = FeedsSchema.parse(JSON.parse(readFileSync(feedsFile, 'utf8')));
    expect(written.github.repos).toHaveLength(1);
  });

  it('leaves the file as it was when both feeds fail, and exits 1 only with --strict', async () => {
    writeFeeds(MAIN_SNAPSHOT, 4);
    const before = readFileSync(feedsFile, 'utf8');
    const { fetchFn } = fakeFetch(routesFor(content, { medium: 'fail', github: 'fail' }));
    const { logger } = captureLogger();

    expect(await main({ dir: folder, argv: [], fetchFn, logger, now: NOW })).toBe(0);
    expect(readFileSync(feedsFile, 'utf8')).toBe(before);

    expect(await main({ dir: folder, argv: ['--strict'], fetchFn, logger, now: NOW })).toBe(1);
    expect(readFileSync(feedsFile, 'utf8')).toBe(before);
  });

  it('writes the placeholder-based file when no snapshot exists and one feed succeeds', async () => {
    expect(existsSync(feedsFile)).toBe(false);
    const { fetchFn } = fakeFetch(routesFor(content, { medium: 'ok', github: 'fail' }));
    const { logger } = captureLogger();

    const code = await main({ dir: folder, argv: [], fetchFn, logger, now: NOW });

    expect(code).toBe(0);
    const written = FeedsSchema.parse(JSON.parse(readFileSync(feedsFile, 'utf8')));
    expect(written.medium.fetchedAt).toBe(NOW.toISOString());
    expect(written.github).toEqual({ fetchedAt: '1970-01-01T00:00:00.000Z', repos: [] });
  });

  it('does not write the file when nothing changed', async () => {
    const { fetchFn } = fakeFetch(routesFor(content, { medium: 'ok', github: 'ok' }));
    const { logger } = captureLogger();
    await main({ dir: folder, argv: [], fetchFn, logger, now: NOW });

    // The same data in another indent: a write would restore the two-space indent.
    const current = FeedsSchema.parse(JSON.parse(readFileSync(feedsFile, 'utf8')));
    writeFeeds(current, 4);
    const before = readFileSync(feedsFile, 'utf8');

    await main({ dir: folder, argv: [], fetchFn, logger, now: new Date('2026-11-16T06:00:00Z') });
    expect(readFileSync(feedsFile, 'utf8')).toBe(before);
  });

  it('logs a warning and a summary, and never the token or the article text', async () => {
    writeFeeds(MAIN_SNAPSHOT);
    const { fetchFn } = fakeFetch(routesFor(content, { medium: 'fail', github: 'ok' }));
    const { logger, lines } = captureLogger();

    await main({
      dir: folder,
      argv: ['--strict'],
      fetchFn: authorizedFetch(fetchFn, TOKEN),
      logger,
      now: NOW,
    });

    const output = lines.join('');
    expect(output).toContain('medium');
    expect(output).toContain(SNAPSHOT_AGE);
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain(ARTICLE_BODY);
  });

  it('returns 1 and logs the reason when the content file cannot be read', async () => {
    rmSync(join(folder, 'content/portfolio.json'));
    const { fetchFn } = fakeFetch({});
    const { logger, lines } = captureLogger();

    const code = await main({ dir: folder, argv: [], fetchFn, logger, now: NOW });

    expect(code).toBe(1);
    expect(lines.join('')).toContain('portfolio.json');
  });
});

describe('the fetch-feeds CLI (R-10)', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'portfolio-cli-'));
    mkdirSync(join(folder, 'content'));
    copyFileSync(CONTENT_FILE, join(folder, 'content/portfolio.json'));
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  /**
   * Runs `node scripts/fetch-feeds.ts` in the temp folder. A test-only preload replaces the global
   * fetch with the routes, so the child process makes no network call.
   *
   * @param routes - The routes that the preload answers from.
   * @param args - The command-line arguments.
   * @returns The exit code and the text of the two output streams.
   */
  function runCli(
    routes: Record<string, Route>,
    args: readonly string[],
    extraEnv: Record<string, string> = {},
  ): { status: number | null; output: string } {
    writeFileSync(join(folder, 'fake-fetch.json'), JSON.stringify(routes));
    const result = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(PRELOAD_FILE).href, SCRIPT_FILE, ...args],
      {
        cwd: folder,
        encoding: 'utf8',
        env: { GITHUB_TOKEN: TOKEN, ...extraEnv },
      },
    );
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it('exits 1 with --strict after the write when one feed failed, and prints no token', () => {
    const routes = routesFor(content(), { medium: 'fail', github: 'ok' });
    const result = runCli(routes, ['--strict']);

    expect(result.status).toBe(1);
    const written = FeedsSchema.parse(
      JSON.parse(readFileSync(join(folder, 'content/feeds.json'), 'utf8')),
    );
    expect(written.github.repos).toHaveLength(1);
    expect(result.output).toContain('medium');
    expect(result.output).not.toContain(TOKEN);
  });

  it('exits 0 without --strict when one feed failed', () => {
    const result = runCli(routesFor(content(), { medium: 'fail', github: 'ok' }), []);
    expect(result.status).toBe(0);
  });

  it('exits 0 with --strict when both feeds succeed', () => {
    const result = runCli(routesFor(content(), { medium: 'ok', github: 'ok' }), ['--strict']);
    expect(result.status).toBe(0);
    expect(existsSync(join(folder, 'content/feeds.json'))).toBe(true);
  });

  it('exits 1 with --strict and writes nothing when both feeds fail', () => {
    const result = runCli(routesFor(content(), { medium: 'fail', github: 'fail' }), ['--strict']);
    expect(result.status).toBe(1);
    expect(existsSync(join(folder, 'content/feeds.json'))).toBe(false);
  });

  it('reads the handle of the FEEDS_MEDIUM_HANDLE variable and exits 1 with --strict when it fails', () => {
    const routes = routesFor(content(), { medium: 'ok', github: 'ok' });
    routes['https://medium.com/feed/@no-such-user'] = { status: 404, body: 'Not Found' };
    const result = runCli(routes, ['--strict'], { FEEDS_MEDIUM_HANDLE: '@no-such-user' });

    expect(result.status).toBe(1);
    const written = FeedsSchema.parse(
      JSON.parse(readFileSync(join(folder, 'content/feeds.json'), 'utf8')),
    );
    expect(written.github.repos).toHaveLength(1);
  });

  it('uses the handle of the content file when FEEDS_MEDIUM_HANDLE is empty', () => {
    const result = runCli(routesFor(content(), { medium: 'ok', github: 'ok' }), ['--strict'], {
      FEEDS_MEDIUM_HANDLE: '',
    });
    expect(result.status).toBe(0);
  });

  it('exits 1 and fetches nothing when FEEDS_MEDIUM_HANDLE is not a valid handle', () => {
    const result = runCli({}, ['--strict'], { FEEDS_MEDIUM_HANDLE: 'x/../../evil?y=1' });
    expect(result.status).toBe(1);
    expect(existsSync(join(folder, 'content/feeds.json'))).toBe(false);
  });

  /**
   * Reads the content file of the temp folder.
   *
   * @returns The parsed content.
   */
  function content(): FeedSources {
    return ContentSchema.parse(
      JSON.parse(readFileSync(join(folder, 'content/portfolio.json'), 'utf8')),
    );
  }
});
