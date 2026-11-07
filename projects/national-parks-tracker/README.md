# national-parks-tracker

`national-parks-tracker` is a static website. It shows a map of the 64 US national parks, with a marker for each park. It shows the parks that the owner and their partner visited, with the trip dates, a rating, notes and photos. The Rush name is `@vprprudhvi/national-parks-tracker`. It has one `package.json`.

There is no backend. The owner edits `web/data/visits.json`, and the next build shows the change.

Read [projects/CLAUDE.md](../CLAUDE.md) and [REVIEW.md](REVIEW.md) before you change it.

## Folders

| Folder           | What it is                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/contracts/` | Zod schemas of the data files (`parks.json`, `photos.json`, `visits.json`): `park.ts` (parks and Wikimedia photos), `visit.ts` (visits) and `messages.ts` (error messages). They import only `zod`. |
| `web/`           | The Next.js app, built as a static export. `app/` holds the pages. `components/` and `lib/` hold the parts of the pages. `data/` holds the data files. `e2e/` holds the Playwright specs.           |
| `test/`          | The unit tests (`contracts/`, `data/`, `web/`), the e2e visits fixture (`fixtures/visits.e2e.json`) and the e2e static server (`e2e/serve-static.js`).                                              |
| `scripts/`       | `phase.mjs` runs each Rush phase. `headers.ts` writes `web/out/_headers` after the build (`fs-io.ts` does its file access).                                                                         |
| `config/`        | The Rush settings (`rush-project.json`).                                                                                                                                                            |

## Add a visit

1. Find the park id in `web/data/parks.json`, for example `zion`.
2. Add an entry to `web/data/visits.json`:

   ```json
   {
     "zion": {
       "trips": [{ "start": "2023-05-12", "end": "2023-05-15" }, { "start": "2019-10" }],
       "rating": 5,
       "liked": "Golden light on the canyon walls.",
       "did": "Hiked Angels Landing.",
       "placesToGo": ["The Narrows"],
       "photos": [
         {
           "src": "/photos/zion/narrows.jpg",
           "alt": "Hikers in a narrow canyon",
           "caption": "Day two"
         }
       ]
     }
   }
   ```

3. Put each photo file in `web/public/photos/<park-id>/`. Create the folder if it does not exist. The folder name must be the park id. Use a `.jpg`, `.jpeg`, `.png` or `.webp` file.
4. Remove the location data from each photo. A photo can hold EXIF or XMP metadata with the GPS position where you took it. Lightroom and Photoshop write the position into XMP too. The site is public, so that data tells strangers where you stay. Do one of these:
   - Run `exiftool -all= -overwrite_original web/public/photos/<park-id>/<file>`. Without `-overwrite_original`, exiftool keeps a copy with the metadata next to the photo.
   - In Apple Photos, export the photo again with "Location Information" turned off.

   The data test (`test/data/data.test.ts`) fails when a file under `web/public/photos/` has EXIF or XMP metadata: any JPEG APP1 segment, a PNG `eXIf` chunk or XMP text chunk, or a WebP `EXIF` or `XMP ` chunk. The message names the file.

5. Run `node common/scripts/install-run-rush.js verify -o @vprprudhvi/national-parks-tracker`.

Rules:

- `trips` has one trip or more. A date is `YYYY-MM-DD`, or `YYYY-MM` when you do not know the day. `end` is optional and is not before `start`. The trips can be in any order. The site shows the newest trip first.
- No date can be after the build date. A month-only date in the current month is correct.
- Do not write the same trip, place or photo two times.
- `rating` is optional: a whole number from 1 to 5. All text fields are optional. Remove a field instead of an empty text.
- A park with an entry counts as visited.

When a value is not valid, the build stops. The message names the file, the park and the field, for example:

```
web/data/visits.json: park "zion", field "trips[0].end": The end date must be on or after the start date.
```

## Build and test

```
node common/scripts/install-run-rush.js build -t @vprprudhvi/national-parks-tracker
node common/scripts/install-run-rush.js verify -o @vprprudhvi/national-parks-tracker
```

- `build` writes the site to `web/out/`. It uses the real `web/data/visits.json`.
- `e2e` builds the site again to `web/out-e2e/` with `NPT_VISITS_FILE=../test/fixtures/visits.e2e.json` and `NPT_OUT_DIR=out-e2e`. Then it runs Playwright against that folder. The tests send fake map tiles and photos, and they stop each request that leaves `127.0.0.1`.
- `web/config.ts` is the only file that reads the environment. Both variables apply at build time only.
- To run the site on your machine, run `npm run dev:web` in this folder.

## Hosting

The site runs on Cloudflare (Workers static assets) at https://national-parks.vprprudhvi.dev. A push to `main` that changes this project runs `.github/workflows/deploy.yml`: build, `npm run deploy:cloudflare` (`wrangler deploy`), then `npm run smoke` against the live site. `wrangler.jsonc` holds the hostname (a `custom_domain` route) and the assets folder (`web/out`). Nothing else is needed to publish a change: edit `web/data/visits.json`, merge, and the deploy runs.

The site has no proxy or middleware, because a static export does not support them. Cloudflare sets the security headers from `web/out/_headers`. `scripts/headers.ts` writes that file after `next build` (the `build` phase runs it). The policy:

```
default-src 'self';
script-src 'self' <hashes of the inline scripts of the page>;
style-src 'self';
style-src-attr 'unsafe-hashes' <hash of the style attribute of next/image>;
img-src 'self' https://tile.openstreetmap.org https://upload.wikimedia.org data:;
connect-src 'self';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
form-action 'none'
```

- `script-src`: Next.js puts inline scripts in each page, and the scripts differ from page to page. The script reads each `index.html`, hashes its inline scripts, and writes one rule for each page, because a header line may have 2000 characters at most. The file may have 100 rules at most (now 69). The script fails the build when a build needs more. `'unsafe-inline'` is not acceptable: it lets an injected script run.
- `style-src`: `next/image` writes one inline style attribute on each photo. The script hashes it like the scripts.
- `/*` holds the other headers (`Referrer-Policy: strict-origin-when-cross-origin`, which the OpenStreetMap tile policy needs, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`, `Strict-Transport-Security`) and a base policy without `script-src`. An unknown path (the 404 page) gets only this base policy.
- `img-src`: a new image host or tile host needs a change to `FIXED_DIRECTIVES` in `scripts/headers.ts`.

The smoke test (`web/smoke/smoke.spec.ts`, config `playwright.smoke.config.ts`) checks the headers and fails on a Content Security Policy error in the browser console. To run it against a local server: `npx wrangler dev --port 8799`, then `SMOKE_BASE_URL=http://127.0.0.1:8799 npm run smoke`.

## Telemetry and flags

- Telemetry: none. The owner does not want traces, and the static site has no server. The site sends no analytics.
- Feature flags: none. This is a new project, not deployed; the hosting PR is the release switch. The owner decided this exception to the flag rule. After the first release, put new user-visible behavior behind a flag from `packages/flags`.

## Data sources

Park facts and photos come from Wikipedia, Wikimedia Commons and the National Park Service. Each park page names the photographer and the license of its photo. The map uses OpenStreetMap tiles through Leaflet, with the "© OpenStreetMap contributors" attribution.
