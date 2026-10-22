---
name: new-web-page
description: Add a Next.js App Router page to a project web app. Server Component by default, data fetched through a lib client that parses with project contracts, Testing Library component tests, and a mandatory Playwright spec that calls page.goto and runs an axe check. Use when asked to add a page, screen, route, UI, or component in a web app. Triggers include new page, add a screen, new route in web, build the UI, add a component, add a Next.js page.
---

# new-web-page

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rules:
- Default export only in `page.tsx`, `layout.tsx`, `route.ts`, and config files.
- Server Components by default. `"use client"` only in a leaf component.
- Every `app/**/page.tsx` route has a Playwright spec. The `playwright-coverage` gate fails without one.
- The web deploys through OpenNext. Do not use features that need a custom Node server.

## Steps

1. Read `projects/<name>/web/src/app/`, `components/`, `lib/`, and `e2e/`. Copy the existing style.
2. Add the page at `projects/<name>/web/src/app/<route>/page.tsx`. Make it a Server Component.
3. Add the data call in `projects/<name>/web/src/lib/<resource>-client.ts`. It calls the api over HTTP. It parses each response with the schema from `@vprprudhvi/<name>-contracts`, for example `XSchema.safeParse(json)`, and returns a `Result`.
   The web must not import from `@vprprudhvi/<name>-api`.
4. Add components in `projects/<name>/web/src/components/<kebab>.tsx`. Use named exports. Add `"use client"` only when the component needs state or browser APIs.
5. If the page needs login, use the project Cognito app client. Read its client ID and domain from the infra stack outputs or from SSM through the helper. Do not hard-code them.
6. If the page is user-visible, read its flag from `@vprprudhvi/shared-flags`.
7. Write a component test next to each component: `<kebab>.test.tsx`. Use Testing Library. Query by role and by name.
8. Write the Playwright spec at `projects/<name>/web/e2e/<route>.spec.ts`. It must:
   - call `page.goto('<route>')` with the literal route string, so the coverage gate can match it;
   - assert the main heading is visible;
   - run `new AxeBuilder({ page }).analyze()` and expect no violations.
   Use this shape:
   ```ts
   import { test, expect } from '@playwright/test';
   import AxeBuilder from '@axe-core/playwright';

   test('<route> renders with no axe violations', async ({ page }) => {
     await page.goto('<route>');
     await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
     const results = await new AxeBuilder({ page }).analyze();
     expect(results.violations).toEqual([]);
   });
   ```
   If `@playwright/test` or `@axe-core/playwright` is not in `web/package.json`, stop. A new dependency needs approval. After approval, run `rush add -p <pkg> --dev` from the web folder.
9. Run `rush test --to @vprprudhvi/<name>-web` and paste the output.
10. Run `rush e2e --only @vprprudhvi/<name>-web` and paste the output. It builds the app, starts `next start`, and runs Playwright.
11. Run the `verify` skill. Then run the `e2e-verify` skill and look at the screenshot of the new page.

## Done when

- [ ] The page is a Server Component, unless a leaf component needs `"use client"`.
- [ ] Data is parsed with the contracts schema at the boundary.
- [ ] The component test and the Playwright spec with axe both pass. The output is pasted.
- [ ] The spec calls `page.goto` with the route. The `verify` and `e2e-verify` skills pass.

## Do not

- Use `"use client"` on a page or a layout.
- Import from `@vprprudhvi/<name>-api` or another project.
- Use `dangerouslySetInnerHTML` with unescaped input.
- Read `process.env` in a component. Use the config module.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`, `**/pyproject.toml`, `**/.golangci.yml`, `**/uv.lock`, `**/go.sum`, `tooling/python/**`, `tooling/go/**`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`.
- Run `cdk deploy`.
- Use `--no-verify`.
