# Guide: web

Kind: `projects/<name>/web`. Package: `@vprprudhvi/<name>-web`. Next.js App Router. Read the root `CLAUDE.md` and `projects/CLAUDE.md` first.

## Folder layout

- `web/src/app/`: Next.js routes (`page.tsx`, `layout.tsx`, `route.ts`).
- `web/src/components/`: components with named exports.
- `web/src/features/<feature>/`: feature code.
- `web/src/lib/`: the API client. It parses each response with the schema from the project `contracts`.
- `web/e2e/`: Playwright specs. `web/playwright.config.ts` is a gate file.
- `web/src/instrumentation.ts`: registers telemetry for the server.

## Rules

- Use Server Components by default. Put `"use client"` only in leaf components. Never on a page or a layout.
- Default exports only in `page.tsx`, `layout.tsx`, `route.ts`, and config files.
- Read data through `lib/<resource>-client.ts`. Parse with `XSchema.safeParse(json)` and return a `Result`.
- Never import from `@vprprudhvi/<name>-api` or another project.
- Read user-visible behavior flags from `@vprprudhvi/shared-flags`.
- Read config only in the config module. Never read `process.env` in a component.
- Never use `dangerouslySetInnerHTML` with unescaped input.
- The web deploys through OpenNext. Do not use features that need a custom Node server.
- Shared packages come from built `dist`. Do not use `transpilePackages`.

## Tests

- Component tests: Testing Library, next to each component. Query by role and name.
- Each `app/**/page.tsx` route has a Playwright spec that calls `page.goto('<route>')` with the literal route and runs an axe check. The `playwright-coverage` gate fails without it.
- Run `rush e2e --only @vprprudhvi/<name>-web`. It builds, starts `next start`, and runs Playwright.
- Rules: `docs/standards/testing.md`, sections 3.2, 10, 11.

## Telemetry

- Missing package rule: if `packages/telemetry` does not exist, skip this section and list it as an open item. See `docs/standards/observability.md`, section 2.
- `instrumentation.ts` calls `initTelemetry({ serviceName })` from `@vprprudhvi/shared-telemetry` (planned).
- Server fetch (the default: Server Component and `lib/<resource>-client.ts`): the Next.js server continues the trace and sends `traceparent` to the API. Add a Vitest test of the lib client: with an active span, the request carries `traceparent`.
- Browser fetch (a client component calls the API): call `initBrowserTelemetry()` from `@vprprudhvi/shared-telemetry/browser` (planned) in `src/instrumentation-client.ts`. Add a Playwright assertion that the API request carries `traceparent` (`page.waitForRequest`). Browser spans are not exported.
- If no client component calls the API, add no browser step and no Playwright `traceparent` assertion.
- Rules: `docs/standards/observability.md`.

## Links

- Conventions: `docs/standards/coding-conventions.md`, sections A.5, A.6, B.8, D.2.
- Skills: `.claude/skills/new-web-page/SKILL.md`, `.claude/skills/e2e-verify/SKILL.md`.
- Review template: `docs/templates/REVIEW.web.md`.
