# Guide: web

Part: `projects/<name>/web`. Package: `@vprprudhvi/<name>` (one package for the whole project). Next.js App Router. Read the root `CLAUDE.md` and `projects/CLAUDE.md` first.

## Folder layout

- `web/app/`: Next.js routes (`page.tsx`, `layout.tsx`, `route.ts`).
- `web/components/`: components with named exports.
- `web/features/<feature>/`: feature code.
- `web/lib/`: the API client. It parses each response with the schema from `../src/contracts` (a relative import).
- `web/e2e/`: Playwright specs.
- `web/instrumentation.ts`: registers telemetry for the server.

## Rules

- Use Server Components by default. Put `"use client"` only in leaf components. Never on a page or a layout.
- Default exports only in `page.tsx`, `layout.tsx`, `route.ts`, and config files.
- Read data through `lib/<resource>-client.ts`. Parse with `XSchema.safeParse(json)` and return a `Result`.
- Never import from `src/api` or another project.
- Read user-visible behavior flags from `@vprprudhvi/shared-flags`.
- Read config only in the config module. Never read `process.env` in a component.
- Never use `dangerouslySetInnerHTML` with unescaped input.
- Shared packages come from built `dist`. Do not use `transpilePackages`.

## Tests

- Component tests: Testing Library, in `test/web/components/`. The test path mirrors the component path. Query by role and name. The setup file is `test/web/setup.ts`.
- Each `app/**/page.tsx` route has a Playwright spec that calls `page.goto('<route>')` with the literal route and runs an axe check.
- Run `rush e2e --only @vprprudhvi/<name>`. The e2e phase runs Bruno for each API part, then builds the web app, starts `next start`, and runs Playwright.
- Rules: `docs/standards/testing.md`, sections 3.2, 10, 11.

## Telemetry

- `instrumentation.ts` calls `initTelemetry({ serviceName })` from `@vprprudhvi/shared-telemetry`.
- Server fetch (the default: Server Component and `lib/<resource>-client.ts`): the Next.js server continues the trace and sends `traceparent` to the API. Add a Vitest test of the lib client: with an active span, the request carries `traceparent`.
- Browser fetch (a client component calls the API): call `initBrowserTelemetry()` from `@vprprudhvi/shared-telemetry/browser` in `web/lib/browser-api.ts` (the browser entry that the client components load). Add a Playwright assertion that the API request carries `traceparent` (`page.waitForRequest`). Browser spans are exported only when you set the optional `tracesUrl` (OTLP/HTTP).
- If no client component calls the API, add no browser step and no Playwright `traceparent` assertion.
- Rules: `docs/standards/observability.md`.

## Links

- Conventions: `docs/standards/coding-conventions.md`, sections A.5, A.6, B.8, D.2.
- Skills: `.claude/skills/new-web-page/SKILL.md`, `.claude/skills/e2e-verify/SKILL.md`.
- Review template: `docs/templates/REVIEW.web.md`.
