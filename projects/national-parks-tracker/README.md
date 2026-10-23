# national-parks-tracker

`national-parks-tracker` is a static website. It shows a map of the 64 US national parks, with a marker for each park. It shows the parks that the owner and their partner visited, with the trip dates, a rating, notes and photos. The Rush name is `@vprprudhvi/national-parks-tracker`. It has one `package.json`.

There is no backend. The owner edits `web/data/visits.json`, and the next build shows the change.

Read [projects/CLAUDE.md](../CLAUDE.md) and [REVIEW.md](REVIEW.md) before you change it.

## Folders

| Folder           | What it is                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/contracts/` | Zod schemas of the three data files: `park.ts` (parks and Wikimedia photos) and `visit.ts` (visits). They import only `zod`.                                                              |
| `web/`           | The Next.js app, built as a static export. `app/` holds the pages. `components/` and `lib/` hold the parts of the pages. `data/` holds the data files. `e2e/` holds the Playwright specs. |
| `test/`          | The unit tests (`contracts/`, `data/`, `web/`), the e2e visits fixture (`fixtures/visits.e2e.json`) and the e2e static server (`e2e/serve-static.js`).                                    |
| `scripts/`       | `phase.mjs` runs each Rush phase.                                                                                                                                                         |
| `config/`        | The Rush settings (`rush-project.json`).                                                                                                                                                  |

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

The site is a folder of static files. A later change adds the S3 and CloudFront hosting. The host must:

- serve `/x/index.html` for `/x/`, and send `404.html` with status 404 for an unknown path.
- set the security headers. The site has no proxy or middleware, because a static export does not support them.

The CloudFront change must set this Content Security Policy:

```
default-src 'self';
script-src 'self' <hashes of the inline scripts>;
style-src 'self';
img-src 'self' https://tile.openstreetmap.org https://upload.wikimedia.org data:;
connect-src 'self';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
form-action 'none'
```

- `script-src`: Next.js puts inline scripts in each page. When you deploy, calculate a `'sha256-...'` hash for each inline script in `web/out/**/*.html`. Add the hashes to `script-src`. Do not use `'unsafe-inline'`. It lets an injected script run, so it is not acceptable.
- `style-src`: `next/image` writes one inline style attribute on each photo (`position:absolute;height:100%;...`). `style-src 'self'` blocks it, and then the photos lose their layout. Add `style-src-attr 'unsafe-hashes' 'sha256-...'` with the hash of that attribute. Calculate the hash when you deploy, like the script hashes.
- `img-src`: a new image host or tile host needs a change to this list.

The host must also set this header:

```
Referrer-Policy: strict-origin-when-cross-origin
```

The OpenStreetMap tile policy needs a referrer on each tile request. This policy sends only the origin, not the full path.

## Telemetry and flags

- Telemetry: none. The owner does not want traces, and the static site has no server. The site sends no analytics.
- Feature flags: none. This is a new project, not deployed; the hosting PR is the release switch. The owner decided this exception to the flag rule. After the first release, put new user-visible behavior behind a flag from `packages/flags`.

## Data sources

Park facts and photos come from Wikipedia, Wikimedia Commons and the National Park Service. Each park page names the photographer and the license of its photo. The map uses OpenStreetMap tiles through Leaflet, with the "© OpenStreetMap contributors" attribution.
