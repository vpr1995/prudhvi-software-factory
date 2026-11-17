---
status: approved
---

# Design: Personal portfolio page

Brief: `docs/designs/portfolio/brief.md`

## 1. Problem, Goals, Non-goals

The owner has no public page that shows their work. Recruiters and hiring managers cannot quickly see what a senior backend and AWS engineer with 8 years of experience has built, and the owner wants to move to Boston.

This design covers version 1 of the brief: the static page, the content JSON, the feeds and the Cloudflare deploy. The in-browser chat (version 2) has its own design. Version 1 only holds the flag that keeps the chat off.

### Goals

- G1: Show the owner's strongest work, awards, articles, repos and contact details on one sleek page, in light and dark mode.
- G2: Let the owner change all content by editing one JSON file, with clear errors for a wrong value.
- G3: Show the latest Medium articles and pinned GitHub repos. Keep a committed snapshot, so a failed fetch never empties a section.
- G4: Serve the page as a static site at `portfolio.vprprudhvi.dev` on Cloudflare, with no backend and no AWS resources.
- G5: Hold the chat flag (default off), so version 2 can add the chat without a change to the page.

### Non-goals

- No backend, no AWS resources, no login.
- No custom analytics. Use the Cloudflare built-in analytics only.
- No admin screen. Content changes are commits to a JSON file.
- No personal life content, no salary, no opinions about the current employer.
- No chat code in version 1.

### Minimal version

- One static page with the profile, experience highlights, awards, pinned repos, Medium articles and contact details, from one content JSON file that a Zod contract validates.
- Light and dark mode with a three-state toggle (system, light, dark).
- A committed `content/feeds.json` snapshot, refreshed by a weekly GitHub Action that opens a PR.
- Cloudflare deploy to `portfolio.vprprudhvi.dev`, with `_headers`, a `smoke` spec and an owner runbook.

## 2. Requirements

Content and page

- R-1: WHEN a visitor opens the page THE SYSTEM SHALL show the owner's name, role claim and location line (open to relocation, Boston first, then the Bay Area, Seattle and NYC) from the content JSON.
- R-2: WHEN a visitor opens the page THE SYSTEM SHALL show the experience highlights, the awards, the pinned repos, the Medium articles and the contact details, all from the content JSON and `content/feeds.json`.
- R-3: WHEN the build runs THE SYSTEM SHALL validate the content JSON with a Zod contract.
- R-4: IF the content JSON is not valid, has a field that the contract does not allow, or has a phone number outside the reveal structure, THEN THE SYSTEM SHALL fail the build with an error that names the JSON path and the rule.
- R-5: WHEN a visitor clicks the phone reveal control THE SYSTEM SHALL show the phone number. The control works with a keyboard and a screen reader. (scope: kept, owner chose the reveal in the brief)
- R-6: WHEN a visitor opens the page with JavaScript off THE SYSTEM SHALL still show all content except the phone number and the theme toggle. (scope: kept, owner agreed to the scope check)

Feeds

- R-7: WHEN the feed refresh script runs THE SYSTEM SHALL fetch the Medium feed of `@vprprudhvi` and the pinned GitHub repos of `vpr1995`, parse each response with a Zod contract, and keep only title, date and URL (for repos: name, description and URL).
- R-8: IF a feed URL is not on `https://medium.com/` or `https://github.com/` THEN THE SYSTEM SHALL drop that item, write the other items, and print a warning that names the title and the origin of each dropped item. (scope: kept, brief row 8)
- R-9: WHEN a fetch succeeds and its items differ from the snapshot THE SYSTEM SHALL write `content/feeds.json` with the new items and a new `fetchedAt` value for that feed. A fetch with the same items does not change the file.
- R-10: IF a fetch fails or returns zero items THEN THE SYSTEM SHALL keep the committed part of the snapshot for that feed, write the feed that succeeded, print a warning that names the failed feed and the age of its snapshot, and finish. WHEN the script runs with `--strict` (the weekly Action does) THE SYSTEM SHALL exit with an error after it has written the file, so GitHub notifies the owner.
- R-11: WHEN the page shows feed text THE SYSTEM SHALL render it as text, never as HTML, and give each outgoing link `rel="noopener noreferrer"`. (scope: kept, brief row 8)
- R-12: WHEN the weekly schedule fires THE SYSTEM SHALL run the refresh script with `--strict` and the built-in `GITHUB_TOKEN`. IF the items in `content/feeds.json` changed, THEN THE SYSTEM SHALL open or update one PR from the branch `feeds/weekly`, even when the script ended with an error, and then fail the job. The Action starts from `main` on each run and force-updates `feeds/weekly`, so a second PR, a same-day clash and a merge conflict cannot last. Nothing goes live until the owner merges the PR.
- R-20: WHEN the build runs and the `fetchedAt` of a feed is older than 90 days THE SYSTEM SHALL print a warning that names the feed and its age, and finish the build. `fetchedAt` moves only when the items change, so the warning means no change for 90 days. (scope: added by the architect, because brief row 7 asks for a stale-feed signal)

Look and accessibility

- R-13: WHILE the visitor chose no theme THE SYSTEM SHALL follow the system theme. WHEN the visitor picks system, light or dark THE SYSTEM SHALL apply it and keep the choice for the next visit.
- R-14: WHEN the page loads in light mode or in dark mode THE SYSTEM SHALL have no axe violations. (scope: kept, repo rule for web pages)
- R-15: WHEN a visitor shares the page URL THE SYSTEM SHALL provide a page title, a description and Open Graph tags for the link preview. (scope: kept, owner agreed to the scope check)

Flag, deploy and operations

- R-16: WHILE the chat flag is off (the default) THE SYSTEM SHALL ship no chat code and make no request to Hugging Face. (scope: kept, root rule 6 and brief row 11)
- R-17: WHEN a change merges to `main` THE SYSTEM SHALL deploy the static export to `portfolio.vprprudhvi.dev` with a `_headers` file that sets a CSP and the security headers.
- R-18: WHEN the post-deploy `smoke` spec runs THE SYSTEM SHALL pass only if the page shows the headline, the experience section, non-empty feed sections and the CSP header.
- R-19: WHEN the build and feed scripts run THE SYSTEM SHALL log only through `@vprprudhvi/shared-logger`, with no secret and no personal data in a log line. (scope: kept, root rule 9)

### Unchanged behavior

- No other project changes. `national-parks-tracker` and `sample` keep their code, config and deploy.
- No change in `packages/**`, `platform/**` or `tooling/**`. The fix to the "No cloud other than AWS" non-goal in `docs/guides/repo-overview.md` is a separate, human-reviewed change.
- The deploy workflow, `deploy-check` and `deploy-plan` keep their rules. The new project meets them and does not change them.
- Agents still do not deploy.

## 3. Critical user journeys

### J1: A recruiter reads the page

1. The recruiter opens `portfolio.vprprudhvi.dev` from a LinkedIn message or a search result (R-15, R-17).
2. The page shows the name, the role claim and the location line (R-1).
3. The recruiter scrolls through the experience, awards, pinned repos and Medium articles (R-2).
4. The recruiter picks email or LinkedIn, or clicks the phone reveal and sees the number (R-5).
5. The recruiter opens a repo or an article. The link opens on `github.com` or `medium.com` (R-8, R-11).

Failure path: with JavaScript off, steps 2 and 3 still work. Only the phone reveal and the theme toggle do not work (R-6). If the last feed fetch failed, the sections show the committed snapshot, not an empty list (R-10).

### J2: A visitor changes the theme

1. The page follows the system theme on the first visit (R-13).
2. The visitor picks system, light or dark with the toggle.
3. The page applies the choice at once and keeps it for the next visit (R-13).

Failure path: if the browser cannot store the choice, the page follows the system theme on each visit. It still works.

### J3: The owner edits the content

1. The owner edits the content JSON, for example to add an award or a new figure.
2. The owner runs `dev:web` and checks the page on localhost.
3. The owner commits the change and opens a PR. CI builds the page (R-3).
4. The owner merges the PR. The merge to `main` starts the deploy (R-17).

Failure path: if a value is wrong, the build fails with an error that names the JSON path and the rule (R-4). If the owner adds a phone number outside the reveal structure, the build fails the same way (R-4).

### J4: The feeds refresh each week

1. The weekly schedule starts the GitHub Action (R-12).
2. The Action fetches the Medium feed and the pinned GitHub repos with `GITHUB_TOKEN` and parses them (R-7, R-8).
3. If an item changed, the Action writes `content/feeds.json` with the new `fetchedAt` values and opens or updates the PR `feeds/weekly`. If nothing changed, no PR opens and the run ends green (R-9, R-12).
4. The owner closes and reopens the PR to start its checks, reviews it and merges it. The merge to `main` starts the deploy. Nothing goes live before the merge (R-12, R-17).

Failure path: if one fetch fails, the script keeps the old part of the snapshot for that feed, writes the feed that worked and prints a warning that names the failed feed and the age of its snapshot (R-10). The Action still opens or updates the PR when the file changed, then ends the run with an error (`--strict`), so GitHub notifies the owner (R-10, R-12). If both fetches fail, the file does not change, no PR opens and the run ends with an error.

### J5: The owner deploys and rolls back

1. A merge to `main` starts `deploy.yml`. It builds the project, checks `_headers` and runs `deploy:cloudflare` (R-17).
2. The `smoke` spec checks the live page: the headline, the experience section, non-empty feeds and the CSP (R-18).

Failure path: if `smoke` fails, the auto-revert PR opens per `docs/runbooks/rollback.md`. The owner merges it and the previous version returns. A revert also restores the previous `content/feeds.json` snapshot.

## 4. Contracts, data, infra

### Project shape

Project: `projects/portfolio`, package `@vprprudhvi/portfolio`. The project gets `"factory": { "deploy": "cloudflare" }` only in the last task (task 13), because each merge to `main` deploys every changed project that has that key. Parts: `web` only. It has no `bin`, no `lib`, no `cdk.json`, no API and no Bruno collection. There is no infra part, so there are no AWS resources and no SSM platform values.

```
projects/portfolio/
  content/portfolio.json        the owner's content (hand-edited)
  content/feeds.json            the feed snapshot (written by the refresh script)
  src/contracts/content.ts      Zod: content/portfolio.json
  src/contracts/feeds.ts        Zod: content/feeds.json and the feed responses
  scripts/fetch-feeds.ts        fetches Medium and GitHub, writes the snapshot
  scripts/headers.ts            writes web/out/_headers (hashes of inline scripts)
  scripts/fs-io.ts              file helper that headers.ts imports (copied)
  scripts/phase.mjs             the phase runner from `rush new`. The build step also runs headers.ts
  test/e2e/serve-static.js      static server for e2e. It applies web/out/_headers
  playwright.config.ts          e2e config with its own port
  playwright.smoke.config.ts    smoke config. It reads SMOKE_BASE_URL
  web/app/                      layout.tsx, page.tsx, not-found.tsx, globals.css
  web/components/               one component for each section, theme toggle, phone reveal
  web/lib/content.ts            reads and parses both JSON files at build time
  web/lib/flags.ts              the chat flag definition
  web/next.config.ts            static export settings: output export, trailing slash, unoptimized images, out folder
  web/config.ts                 the only place that reads the environment (the out folder, then the flag record)
  web/e2e/ web/smoke/           Playwright specs
  wrangler.jsonc                static assets from ./web/out, route portfolio.vprprudhvi.dev (task 13)
```

A project does not import another project. So `scripts/headers.ts` and `scripts/fs-io.ts` are copies of the ones in `projects/national-parks-tracker`. The copy changes `img-src` to `'self' data:`, because this page has no map tiles or Wikimedia images. A move to `packages/*` needs a human and is out of scope. Each task adds with `rush add -p` only the dependencies that it uses, so `knip` finds no unused dependency. `rush add-part --part web` already supplies `next`, `react`, `react-dom`, Playwright, axe and the test tools. The `package.json` script `fetch-feeds` runs `node scripts/fetch-feeds.ts`, the same way `headers.ts` runs.

### Contracts (Zod, in `src/contracts`)

Each object is `.strict()`: a field that the contract does not name fails the build (R-4).

`content.ts`, the schema of `content/portfolio.json`:

| Field | Shape |
| ----- | ----- |
| `site` | `title`, `description`, `url` (https), optional `ogImage` (path) |
| `profile` | `name`, `headline`, `summary` (up to 400 characters), `location: { primary, also[] }` |
| `contact` | `email`, `linkedin` (https, `linkedin.com`), `github` (https, `github.com`), `medium` (https, `medium.com`), optional `phone: { display, href }` |
| `experience[]` | `company`, `role`, `location`, `start` (`YYYY-MM`), `end` (`YYYY-MM` or `null`), `bullets[]` (1 to 6), optional `metrics[]` (`label`, `value`) |
| `awards[]` | `title`, `year`, optional `issuer`, `source` (https URL, required) |
| `pinnedRepos[]` | `fullName` (`owner/name`), optional `blurb` (the owner's one line) |
| `medium` | `handle`, `max` (1 to 10) |

A `superRefine` rejects a phone-number shape in any string field except `contact.phone`. A phone-number shape is an optional country code, then 10 digits in 3-3-4 groups, with optional spaces, dots, dashes or brackets between the groups. The rule does not match a year range, a date, a percentage or a figure. Task 1 tests this table:

| Text | Result |
| ---- | ------ |
| `2019 - 2023`, `2021-11`, `$250K ARR`, `4M+ users`, `500M+ events a day`, `99.99% uptime`, `1M+ households`, `12 epics over 2 years`, `https://github.com/vpr1995/rbac-engine` | passes |
| `+1 (360) 685-3897`, `360-685-3897`, `360.685.3897`, `3606853897` | fails in any field except `contact.phone` |

An award without `source` fails, so no award appears without a source. A helper turns each Zod issue into one line: the JSON path, then the rule.

`feeds.ts`, the schema of `content/feeds.json` and of the two responses:

| Field | Shape |
| ----- | ----- |
| `medium` | `fetchedAt` (ISO time), `items[]`: `title`, `url` (must start with `https://medium.com/`), `publishedAt` (ISO time) |
| `github` | `fetchedAt` (ISO time), `repos[]`: `fullName`, `url` (must start with `https://github.com/`), `description` (text or `null`) |

The fetch script parses the Medium RSS with `fast-xml-parser` (added with `rush add -p`). It reads only title, link and date of each item. It never reads the article body. It reads the GitHub fields `full_name`, `html_url` and `description` of each pinned repo, with one request for each pinned repo. The response schemas accept any `https` URL, and the script then filters the items by origin (R-8). Only the snapshot schema has the strict origin rule, so one off-origin link never rejects a whole feed.

### Data flow

1. `scripts/fetch-feeds.ts` reads `content/portfolio.json` for the Medium handle and the pinned repos. It fetches, parses and writes `content/feeds.json`. A failed feed, or a feed with zero items, keeps its old part of the file (R-9, R-10).
2. `web/lib/content.ts` reads both files while `next build` runs and parses them with the contracts. An error fails the build with the path and the rule (R-3, R-4).
3. Server Components render all text into the HTML. Nothing is fetched in the browser. This is why the content shows with JavaScript off (R-6).
4. The page shows a pinned repo with the `blurb` of the owner first, then the fetched `description`. A pinned repo that is not yet in the snapshot shows its name and a link built from `fullName`. Zero items counts as a failed fetch, so the refresh script never writes an empty list. If a section is empty anyway, the page shows one line with a link to the owner's Medium or GitHub profile, not an empty box.

### Web part decisions (the owner delegated these)

- D-1: Next.js 16 static export with React 19 and Server Components, the same as `national-parks-tracker`. The repo tooling for it exists (Playwright, axe, `headers.ts`).
- D-2: Plain CSS: global design tokens (CSS custom properties) and CSS Modules. No Tailwind, no UI kit, no animation library. The CSP of this repo has no `'unsafe-inline'` for styles, and fewer dependencies mean less upkeep for a page that lives for years. Motion uses CSS only and stops when the visitor sets `prefers-reduced-motion`.
- D-3: The theme is a `data-theme` attribute on `<html>` with three states (system, light, dark). A small inline script sets it before the first paint, so the page does not flash. `scripts/headers.ts` puts the hash of that script in the CSP. The choice is kept in `localStorage`, inside `try/catch` (R-13).
- D-4: One sans font and one mono font (Geist Sans for text, Geist Mono for small labels and tags), from the `geist` npm package (added with `rush add -p` in task 4). The package serves the font files from the site's own files, so the build makes no network call to Google and the CSP needs no font origin.
- D-5: Visual direction: restrained and editorial. Near-black and near-white surfaces, one accent colour, large headline type, hairline borders, wide spacing. No stock gradients, no hero illustration, no scroll animation library. The owner reviews the look with `dev:web` before the first deploy.
- D-6: Section order: hero, experience, awards, open source (pinned repos), writing (Medium), contact. A slim top bar links to each section and holds the theme toggle.

### Weekly feed refresh

`.github/workflows/portfolio-feeds.yml` runs weekly and on `workflow_dispatch`. It starts from `main`, runs `npm run fetch-feeds -- --strict` with `GITHUB_TOKEN` and, when the items in `content/feeds.json` changed, force-updates the branch `feeds/weekly` and opens the PR or updates the PR that is already open (R-12). The PR step runs even when the script ended with an error, because one feed can succeed while the other fails. The last step then fails the job, so GitHub notifies the owner. Because the Action starts from `main` each time, a rerun on the same day, a manual run while last week's PR is open and a merge conflict all end with one up-to-date PR. The repo rule applies: checks do not start on a PR that GitHub Actions opens, so the owner closes and reopens the PR to start them, then merges (`docs/runbooks/rollback.md`). The job needs the repo setting "Allow GitHub Actions to create and approve pull requests", which the `revert` job of `deploy.yml` already needs. `.github/**` is high risk, so the owner reviews this file. `actionlint`, `zizmor` and `pinact` check it. The workflow has `concurrency: { group: portfolio-feeds, cancel-in-progress: false }`, so a scheduled run and a manual run cannot race on the force-push. If the PR step fails (for example, the setting "Allow GitHub Actions to create and approve pull requests" is off), the job fails and GitHub notifies the owner. The next run force-updates the branch again. The manual trigger has one optional input, `handle`, which replaces the Medium handle for that run. The owner uses it to test a failing feed.

### Cloudflare

`wrangler.jsonc` follows `projects/national-parks-tracker`: `workers_dev` and `preview_urls` are false, `assets.directory` is `./web/out`, `assets.not_found_handling` is `"404-page"`, and the route is `portfolio.vprprudhvi.dev` with `custom_domain: true`. No Worker script runs. Task 13 adds this file, the `deploy:cloudflare` script and `factory.deploy`.

## 5. Alternatives considered

- Host on AWS (S3 and CloudFront with CDK): the owner chose Cloudflare. The page has no backend, and the repo already deploys static sites to Cloudflare.
- Copy `projects/national-parks-tracker` whole: it carries `aws-cdk`, `cdk-nag`, `constructs` and `leaflet`, which this page does not use. The new project is web-only.
- Share `headers.ts` through `packages/*`: it needs a human and widens the diff. A copy in the project is enough for now.
- Fetch Medium and GitHub in the browser: Medium blocks cross-site requests, GitHub limits anonymous calls to 60 an hour for each visitor, and the content would not show with JavaScript off. The build fetches instead.
- Fetch at build time only, with no committed snapshot: a failed fetch would empty a section or fail the deploy. The snapshot keeps the page whole and a revert restores it.
- Refresh the feeds only when the owner deploys: the article list would go stale. The weekly PR keeps it fresh and the owner still decides what goes live.
- Refresh with a token or an app that starts checks by itself: it adds a secret. The owner closes and reopens the PR, as the repo already does for revert PRs.
- Add `factory.deploy` in the scaffold task: each merge to `main` would deploy a project that is not ready. The deploy would fail at the `_headers` check, and later the sample content would go live. The key comes in the last task.
- Hand-list the Medium articles in the JSON: the owner wants the RSS feed.
- Tailwind, a UI kit or an animation library: the CSP has no `'unsafe-inline'` for styles, and each dependency needs upkeep for years. Plain CSS is enough for one page.
- A template portfolio theme: the owner wants a sleek page that does not look like a template.
- Client-side theme state only (no inline script): the page would flash the wrong theme on load. A small hashed inline script avoids it.
- Hide the phone number off the page (email and LinkedIn only): the owner kept the click-to-reveal and accepts that the number is effectively public (brief row 2).
- Put the chat in this design: the owner deferred it to version 2. This design holds only the flag (brief row 3).
- Custom analytics or the Cloudflare Web Analytics script: a script needs CSP changes and adds weight. The Cloudflare dashboard analytics need no script (section 6).

## 6. Flag, observability, cost, security, migration

### Flag

- Name: `portfolioChat`. Default `false`. The project defines it in `web/lib/flags.ts` with `defineFlags` and `createFlagClient` from `@vprprudhvi/shared-flags` (a dependency that task 9 adds). `packages/flags` does not change.
- `web/config.ts` is the only file that reads `process.env`. It passes a validated record to `createEnvFlagProvider(source, 'FLAG_')`. Only Server Components read the flag, so the variable is `FLAG_PORTFOLIO_CHAT`, not a `NEXT_PUBLIC_` variable.
- The flag is build-time. A static export has no runtime, so a change needs a rebuild and a merge to `main`. A flag rollback is a rebuild.
- Version 1 defines the flag and tests it (default off, the variable turns it on). The page does not read it until version 2 adds the chat. A built-output test checks that the export holds no `huggingface.co` string and no chat code (R-16). It runs in the e2e phase, on the `out-e2e` export. If `rush knip` reports the flag because it has no reader, task 9 adds one targeted entry for `web/lib/flags.ts` in `knip.jsonc`. The owner accepted this in design review.
- The page itself has no flag. This is an exception to root rule 6 that the owner confirmed in design review. The page is a new project that nothing links to, and the PR that adds `factory.deploy` (task 13) is the switch.

### Logs and traces

- The page has no backend and no runtime logs. The owner confirmed that the trace propagation duty does not apply to the web page.
- `scripts/fetch-feeds.ts` and the build helpers log only through `@vprprudhvi/shared-logger` (R-19). A log line has the feed name, the result and the age. It never has the token or the text of an article.
- Signals that tell the owner about a problem:
  - A feed failure ends the weekly Action with an error, and GitHub notifies the owner (R-10). This is the main signal.
  - A feed with no change for 90 days prints a build warning (R-20). The warning prints only when a build runs, so it is a second signal at deploy time.
  - A broken deploy fails the `smoke` spec, and the revert PR opens (R-18).
  - Traffic: the analytics of the Cloudflare dashboard. They run on the server side, need no script in the page and need no CSP change.
- No script collects errors from the visitor's browser in version 1. Version 1 has no code that can fail there except the theme toggle and the phone reveal.

### Cost

About 0 dollars a month. Static assets on the Cloudflare Workers Free plan have no request charge. The custom domain uses the zone that the owner already has. GitHub Actions on a public repository cost nothing. Version 1 has no Hugging Face cost. The owner pays nothing new.

### Security

Rules: `docs/standards/security.md`.

- No secret in the repository. The Action uses only the built-in `GITHUB_TOKEN`, with `contents: write` and `pull-requests: write` for that one job. The deploy secrets stay in the `prod` environment.
- Feed data is untrusted. The contracts parse it, the origin allowlist drops other links, and the page renders it as text (R-7, R-8, R-11). The page never uses `dangerouslySetInnerHTML`. The XML parser reads only title, link and date, and never the body.
- CSP from `scripts/headers.ts`: `default-src 'self'`, `script-src 'self'` plus the hash of each inline script, `style-src 'self'`, `img-src 'self' data:`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'none'`. When a page has `style=` attributes, the script also adds `style-src-attr 'unsafe-hashes'` with the hash of each value, as in `national-parks-tracker`. Fonts load from the site itself, so `default-src` covers them. The CSP unit test of the headers task asserts the exact directive list. There is no `'unsafe-inline'` and no third-party origin. The page also sends the shared security headers (R-17).
- The repo is public, so the content JSON is public. The phone number is effectively public (brief row 2). The build rejects a phone-like string outside `contact.phone` (R-4). Nobody commits the resume file.
- A new dependency (`fast-xml-parser`, the Playwright and test tools) triggers `rush audit`. A failed audit means stop and ask the owner. `gitleaks` is a required check.

### Migration

None. This is a new project. It has no data to move and no old client. A later change of a contract must change the JSON files in the same PR, because the build fails on a file that does not match.

## 7. Deploy and rollback

### Deploy

- Target: `"factory": { "deploy": "cloudflare" }`. Hostname: `portfolio.vprprudhvi.dev` (web). There is no API, so there is no API hostname.
- A merge to `main` starts `deploy.yml`. `deploy-plan` deploys each changed project that has `factory.deploy`. The `cloudflare` job then builds the project, checks `_headers`, runs `npm run deploy:cloudflare`, waits for the site and runs `npm run smoke` (R-17, R-18). Agents do not deploy. The owner merges.
- The project has no `factory.deploy` until task 13. Tasks 1 to 12 therefore never deploy. The real content (task 12) merges before the key (task 13), so sample content never reaches `main` with a deploy target set.
- The first deploy creates the custom domain on the owner's Cloudflare zone through the `custom_domain` route. `deploy-check` validates the route.
- Before the owner merges task 13, the owner checks that the GitHub environment `prod` holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Before task 1 (task 0, outside the table): a human-reviewed ADR ("Cloudflare for static sites") and a one-line change of the non-goal in `docs/guides/repo-overview.md`. It is a separate PR (brief row 9). Task 1 cannot start until that PR merges.

### Build and CI checks

- `rush build --to @vprprudhvi/portfolio` runs the build phase: `next build` writes the static export to `web/out`, then `node scripts/headers.ts web/out` writes `_headers`. `deploy.yml` runs the same build, then its own `_headers` check, then `wrangler deploy`.
- `rush e2e --only @vprprudhvi/portfolio` builds a second export, `web/out-e2e` (the folder name comes from `web/config.ts`), writes its `_headers`, serves it with `test/e2e/serve-static.js` (which applies those headers) and runs all Playwright specs against it. That includes the smoke spec, so a wrong CSP fails it before any deploy.
- `rush test --to @vprprudhvi/portfolio` runs the unit and component tests.

### Rollback

1. Follow `docs/runbooks/rollback.md`: a revert PR, `git revert <merge-sha>`, no force push.
2. A failed `smoke` spec opens a revert PR by itself. The owner closes and reopens it to start its checks, then merges it.
3. A revert restores the previous page and the previous `content/feeds.json` snapshot, because both are in git.
4. A bad feed PR is a normal PR. Revert it the same way.
5. The chat flag has no effect in version 1, so a flag rollback is not needed.
6. If the first deploy fails (for example, the custom domain clashes or a `prod` secret is missing), the owner reverts the PR of task 13. `factory.deploy` goes with it, so the page stays undeployed.

## 8. Implementation plan

One task is one PR. The API has no routes, so there is no Bruno request. The page has Playwright spec files with axe checks. Tasks run one at a time, in this order. The package name is `@vprprudhvi/portfolio`.

Task 0 (outside the table, no R-ID): a human-reviewed ADR ("Cloudflare for static sites") and a one-line change of the non-goal in `docs/guides/repo-overview.md`. Task 1 cannot start until that PR merges.

Rules for all tasks:

- A task adds with `rush add -p` only the dependencies that it uses. `rush add-part --part web` supplies `next`, `react`, `react-dom`, Playwright, axe and the test tools. Check `package.json` after the scaffold before any `rush add -p`. Any task that adds a dependency is `risk:high` (`docs/standards/risk-tiers.md`).
- The project has no `factory.deploy` until task 13. Tasks 1 to 12 do not deploy.
- Sample values in `content/portfolio.json` exist only until task 12.

| Task | Files | R-IDs | Risk | Verify |
| ---- | ----- | ----- | ---- | ------ |
| 1. Scaffold, content contract and loader | `rush new --project portfolio`, `rush add-part --part web`, dependency `zod`, `src/contracts/content.ts`, `web/lib/content.ts` (content only), the issue formatter, the phone-shape rule with its pass and fail table, `content/portfolio.json` with sample values, tests | R-3, R-4 | high (new dependency) | `rush verify --to @vprprudhvi/portfolio` |
| 2. Feeds contract and refresh script | `src/contracts/feeds.ts`, `scripts/fetch-feeds.ts`, the `fetch-feeds` script in `package.json`, dependencies `fast-xml-parser` and `@vprprudhvi/shared-logger`, tests with a fake fetch (both ok, one ok and one fails, both fail, zero items counts as a failure, `--strict` exit code after the write, one off-origin item dropped and the others written with a warning, a run with no change leaves the file as it was, a log line without token or article text), a CLI test of the exit code | R-7, R-8, R-9, R-10, R-19 | high (new dependencies) | `rush test --to @vprprudhvi/portfolio` |
| 3. Snapshot in the loader and first real snapshot | `web/lib/content.ts` reads `content/feeds.json` and prints the R-20 warning through the logger, `content/feeds.json` from one real successful run of `npm run fetch-feeds`, tests (a 91-day-old `fetchedAt` warns, a fresh one does not) | R-19, R-20 | medium | `rush test --to @vprprudhvi/portfolio`, then manual: owner or agent runs `npm run fetch-feeds` once with network and checks that `fetchedAt` is recent and each list is non-empty |
| 4. Export config, headers and e2e setup | `web/next.config.ts` (`output: 'export'`, `trailingSlash`, `images.unoptimized`, `distDir` from `config.outDir`), `web/config.ts` (the out-folder variable only), `scripts/headers.ts`, `scripts/fs-io.ts`, `phase.mjs` (the build runs `headers.ts`, the e2e step builds `out-e2e`), `test/e2e/serve-static.js`, `playwright.config.ts` (replaces the scaffold `next start` server, own port), `web/e2e/headers.spec.ts`, a CSP unit test of the exact directive list and the script hash | R-17 | medium | `rush e2e --only @vprprudhvi/portfolio` |
| 5. Layout, design tokens, theme, page metadata | `web/app/layout.tsx`, `globals.css`, the theme script and toggle, `geist` fonts (dependency), page title, description and Open Graph tags, `web/e2e/theme.spec.ts` (system default, three states, kept choice, no flash, meta tags) | R-13, R-15 | high (new dependency) | `rush e2e --only @vprprudhvi/portfolio` |
| 6. Hero, experience and awards sections | `web/app/page.tsx`, `web/components/` for hero, experience and awards, component tests, `web/e2e/home.spec.ts` (axe on the full page in light and dark mode, a test with `javaScriptEnabled: false`) | R-1, R-2, R-6, R-14 | medium | `rush e2e --only @vprprudhvi/portfolio` |
| 7. Repos and articles sections | `web/components/` for repos and articles, the zero-items fallback line, component tests, `web/e2e/feeds.spec.ts` (`<script>` text in a feed fixture shows as text, every outgoing link has `rel="noopener noreferrer"`, a link outside the two origins is absent), the axe check of `home.spec.ts` now covers these sections | R-2, R-8, R-11, R-14 | medium | `rush e2e --only @vprprudhvi/portfolio` |
| 8. Phone reveal | `web/components/phone-reveal.tsx`, component test, `web/e2e/phone.spec.ts` (keyboard and screen reader name) | R-5 | medium | `rush e2e --only @vprprudhvi/portfolio` |
| 9. Chat flag | `web/lib/flags.ts`, `web/config.ts` (adds the flag record), dependency `@vprprudhvi/shared-flags`, a flag unit test (default off, `FLAG_PORTFOLIO_CHAT` turns it on), `web/e2e/no-chat.spec.ts` (reads the `out-e2e` files: no `huggingface.co`, no chat code), a `knip.jsonc` entry for `web/lib/flags.ts` only if `rush knip` reports it | R-16 | high (new dependency) | `rush verify --to @vprprudhvi/portfolio` |
| 10. Smoke spec and owner runbook | `web/smoke/smoke.spec.ts` (headline, experience section, non-empty feed sections, CSP header), `playwright.smoke.config.ts`, the `smoke` script, `docs/runbooks/portfolio-content.md`. The e2e phase also runs the smoke spec against the local static server with the real `_headers` | R-18 | medium | `rush e2e --only @vprprudhvi/portfolio` |
| 11. Weekly feed workflow | `.github/workflows/portfolio-feeds.yml` (starts from `main`, `concurrency` group `portfolio-feeds`, runs `npm run fetch-feeds -- --strict`, the PR step runs after a failed script, the last step fails the job, branch `feeds/weekly`, optional `handle` input) | R-12 | high (`.github/**`) | manual: owner runs the workflow with `workflow_dispatch` and checks the PR that opens. Owner runs it again and checks that the same PR updates. Owner runs it with an invalid `handle` and checks: a PR with the feed that worked, a red job, an email. `workflow-lint` runs in CI |
| 12. Real content | `content/portfolio.json` with the owner's profile, experience, awards, pinned repos and figures. The owner pastes the cleaned text into the ticket. An agent does not invent content | R-1, R-2 | low (content) | `rush verify --to @vprprudhvi/portfolio`, then manual: owner reads each line and each figure with `dev:web` |
| 13. Enable the deploy | `package.json` (`factory.deploy`, `deploy:cloudflare`), dependency `wrangler`, `wrangler.jsonc` | R-17, R-18 | high (new dependency) | `rush verify --to @vprprudhvi/portfolio`, then manual: owner checks the `prod` secrets, merges, reads the `smoke` result, and opens `portfolio.vprprudhvi.dev` on a phone and a laptop in light and dark mode |

## 9. Decision log

The brief ships in the same PR as this design (`docs/designs/portfolio/brief.md`). Its decisions carry the date of the design session. The brief rows that this design cites:

- Row 2: the phone number stays behind a click-to-reveal and is effectively public.
- Row 3: the chat is version 2.
- Row 7: a committed feed snapshot and a weekly refresh PR.
- Row 8: feed data is untrusted input.
- Row 9: a separate ADR for Cloudflare.
- Row 10: a web-only project.
- Row 11: build-time flags.

- 2026-11-09: Version 1 is the static page, the content JSON, the feeds and the Cloudflare deploy. The chat is version 2 and stays in the plan (owner, brief row 3: deferred).
- 2026-11-09: Host on Cloudflare at `portfolio.vprprudhvi.dev`, with no backend and no AWS resources (owner).
- 2026-11-09: The phone number stays behind a click-to-reveal. The owner accepts that it is effectively public (owner, brief row 2: rejected the removal).
- 2026-11-09: The page says the owner is open to relocation, with Boston first, then the Bay Area, Seattle and NYC (owner).
- 2026-11-09: The page can show the employer figures. The awards are the Genie High-Performance Awards of 2023, 2025 and 2026. Any other award needs a source in the JSON (owner).
- 2026-11-09: Feeds use a committed `content/feeds.json` snapshot. A weekly GitHub Action with the built-in `GITHUB_TOKEN` opens a PR, and the owner merges it (owner, brief row 7).
- 2026-11-09: The trace propagation duty does not apply to the web page. The build and feed scripts log through `@vprprudhvi/shared-logger` (owner).
- 2026-11-09: The resume file is never committed. Only cleaned content goes into the JSON (owner).
- 2026-11-09: The owner delegated the front-end decisions to the architect. D-1 to D-6 in section 4 (Next.js static export, plain CSS, three-state theme with a pre-paint script, Geist fonts, restrained look, section order) are the architect's choices. The owner agreed with section 4.
- 2026-11-09: Scope check: the owner kept R-5, R-6, R-8, R-11, R-14, R-15, R-16 and R-19. Nothing was cut.
- 2026-11-09: The fetch runs in a separate refresh script, not in the build. The Action runs it with `--strict`. R-20 (stale-feed warning, later changed to 90 days since the last change in round 2) is new. The architect proposed both, and the owner agreed with sections 6 to 8 (architect, accepted by owner).
- 2026-11-09: The project is web-only, with no CDK parts and no copy of the map code. `headers.ts` is copied, not shared (owner, brief rows 9 and 10, and section 5).
- 2026-11-09: A human-reviewed ADR and a one-line fix of the "No cloud other than AWS" non-goal come first, as a separate PR (owner, brief row 9).
- 2026-11-09: Version 2 keeps these open items: the Q&A generator model and license, and the Gemma terms for a public fine-tuned demo. The owner is researching them.
- 2026-11-09: The owner agreed with sections 1 to 8 of this design.

Design review, round 1 (26 raw findings, 12 rows: 11 fix, 1 reject, 0 defer). The owner accepted all recommendations.

- 2026-11-09: Row 1, fix: a merge to `main` deploys, so `factory.deploy`, `deploy:cloudflare`, `wrangler` and `wrangler.jsonc` come only in the last task. R-17, J3, J4, J5 and section 7 say that a merge deploys. Sample content never reaches `main` with a deploy target set (owner).
- 2026-11-09: Row 2, fix: when one feed fails, the script writes the feed that worked. The Action opens or updates one PR from `feeds/weekly`, then fails the job. The Action starts from `main` each run. R-10, R-12, J4 and the workflow section say so (owner).
- 2026-11-09: Row 3, fix: the headers and e2e setup come before the layout. The static server applies `_headers`. The axe check moved to the sections tasks (owner).
- 2026-11-09: Row 4, fix: task 5 names the specs for R-6 (JavaScript off), R-11 (feed text as text) and the link `rel` check (owner).
- 2026-11-09: Row 5, fix: the ADR and the non-goal fix are task 0, outside the table, and block task 1. The scaffold joined the contracts task, so no task lists an R-ID that it does not build or test (owner).
- 2026-11-09: Row 6, fix: keep the flag. `web/config.ts` reads the environment and passes it to `createEnvFlagProvider(source, 'FLAG_')`. Only the server reads it, so the variable is `FLAG_PORTFOLIO_CHAT`. The flag is local, so `packages/flags` does not change. The flag task adds a targeted `knip.jsonc` entry only if `rush knip` reports the flag (owner).
- 2026-11-09: Row 7, fix: the page has no flag. This is an owner exception to root rule 6. The PR that adds `factory.deploy` is the switch (owner).
- 2026-11-09: Row 8, fix: the phone rule matches only a phone-number shape (3-3-4 digits). Task 1 tests a table of strings that pass and strings that fail (owner).
- 2026-11-09: Row 9, fix: GitHub's failed-run email is the main stale-feed signal and R-20 is the second. The first snapshot comes from a real fetch. A feed with zero items shows one line with a profile link (owner).
- 2026-11-09: Row 10, reject: the design PR commits `brief.md` together with `design.md`, so the cited brief rows are in the PR (owner).
- 2026-11-09: Row 11, fix: headers and smoke are separate tasks. The e2e phase runs the smoke spec against the local static server with the real `_headers` (owner).
- 2026-11-09: Row 12, fix: copy `scripts/fs-io.ts` and edit `phase.mjs`. `img-src` is `'self' data:`. Fonts come from the `geist` package. Each task adds only the dependencies that it uses. `wrangler.jsonc` has `not_found_handling: "404-page"` (owner).

Design review, round 2 (19 raw findings, 12 rows: 12 fix, 0 reject, 0 defer). The owner delegated the decisions to the architect ("go with your guts"). The architect fixed all rows.

- 2026-11-09: Row 1, fix: zero items counts as a failed fetch, so the snapshot is never empty after the first real fetch and `smoke` can require non-empty feed sections. The placeholder `feeds.json` is gone (architect, owner delegated).
- 2026-11-09: Row 2, fix: the response schemas accept any `https` URL. The script drops off-origin items and prints a warning with the title and the origin. Only the snapshot schema is strict. All 8 current Medium links start with `https://medium.com/@vprprudhvi/` (architect, owner delegated).
- 2026-11-09: Row 3, fix: the Action opens a PR only when items change. `fetchedAt` moves only on a change, so R-20 warns after 90 days, not 21 (architect, owner delegated).
- 2026-11-09: Row 4, fix: task 1 holds the scaffold, the content contract and the loader (R-3, R-4). The feeds contract and the refresh script are task 2. The snapshot in the loader and the stale warning are task 3 (R-19, R-20) (architect, owner delegated).
- 2026-11-09: Row 5, fix: the sections task splits into hero, experience and awards (task 6) and repos and articles (task 7). Task 7 lists R-8 and R-14 (architect, owner delegated).
- 2026-11-09: Row 6, fix: a `fetch-feeds` script in `package.json`. The workflow has a `concurrency` group, a `handle` input to test a failing feed, and a rule for a failed PR step (architect, owner delegated).
- 2026-11-09: Row 7, fix: the owner pastes the cleaned text for the real content task. The owner checks the `prod` secrets before the deploy task. A failed first deploy is a revert of that PR (architect, owner delegated).
- 2026-11-09: Row 8, fix: the built-output test for R-16 runs in the e2e phase on `out-e2e`, so it has a real build (architect, owner delegated).
- 2026-11-09: Row 9, fix: `web/next.config.ts` and `web/config.ts` (the out-folder variable) are in the headers and e2e task. The flag task only extends `web/config.ts` (architect, owner delegated).
- 2026-11-09: Row 10, fix: task 1 adds only `zod`. `rush add-part --part web` supplies the rest (architect, owner delegated).
- 2026-11-09: Row 11, fix: section 6 lists the CSP as the copied script emits it, with `base-uri`, `form-action` and the conditional `style-src-attr`. The CSP test asserts the exact list (architect, owner delegated).
- 2026-11-09: Row 12, fix: section 9 lists the cited brief rows. Section 7 has a "Build and CI checks" part (architect, owner delegated).
