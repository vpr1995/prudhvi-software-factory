# REVIEW.md: national-parks-tracker

This file adds rules for `projects/national-parks-tracker/`. It applies together with `REVIEW.md` at the repository root. Read `CLAUDE.md` first.

This project is one package. It has `src/contracts` and `web/` (a Next.js static export). It has no API, no Bruno collection and no CDK app. Apply each section to the changed files only.

## Contracts (`src/contracts`)

- The schemas are the only source of the shape of `web/data/*.json`. Change the schema first, then the data and the code.
- `src/contracts` imports only `zod`.
- Each object schema is `.strict()`, so a typo in a data file stops the build.
- Each error message tells a non-developer how to fix the value, for example "Use the form YYYY-MM-DD or YYYY-MM".
- Owner photo paths start with `/photos/<park-id>/`, end in `.jpg`, `.jpeg`, `.png` or `.webp`, and never contain `..`. Wikimedia photo URLs use `https://upload.wikimedia.org` only. All links use https.
- Owner photo files have no EXIF data (GPS position). The data test scans `web/public/photos/`. Never weaken that scan.
- Each schema change adds an accept case and a reject case in `test/contracts/`. The reject case checks the issue path.

## Web (`web/`)

### Static export

- `next.config.ts` keeps `output: 'export'`, `trailingSlash: true` and `images.unoptimized`. Do not add a proxy, middleware, route handlers or server actions. A static export does not support them.
- Data loads at build time only, in Server Components, through `web/lib/data.ts`. No code reads a file or the network at run time.
- `web/config.ts` is the only file that reads the environment.

### Dates

- Never format a date-only text with `new Date(text)` and local time. It shows the day before in US time zones. Use `web/lib/dates.ts`.

### Security

- No `dangerouslySetInnerHTML`. No HTML string goes into Leaflet. Build popup and marker content with DOM nodes and `textContent` (`web/lib/popup.ts`).
- Each external link that opens a new tab has `rel="noopener noreferrer"` and says "opens in a new tab" in its accessible name.
- A new image or tile host needs a change to the CSP list in `README.md`.

### Accessibility

- The list is the main way to move around. The map follows it. Each list feature works without the map.
- Each marker is a focusable button with a name, for example "Zion, visited". Visited and not visited differ by shape and color.
- Live regions (`role="status"`, `aria-live`) stay in the page. Change their text. Do not add or remove the element.
- Each page route has a Playwright spec with `page.goto` and an axe check, in light and dark mode where the colors change.

### Telemetry and flags

- Telemetry: none. The owner does not want traces, and the site has no server. Do not add analytics or a logger.
- Feature flags: none in the first version. This is a new project, not deployed; the hosting PR is the release switch. The owner decided this exception to the flag rule. After the first release, put a new user-visible behavior behind a flag from `packages/flags`.

### Tests

- Unit tests live in `test/web/` and mirror the source path. The map tests mock `leaflet` with `vi.mock`.
- E2E tests use the fixture build (`test/fixtures/visits.e2e.json`). They route the tile and photo hosts to local fixtures and fail on any other outside request.
