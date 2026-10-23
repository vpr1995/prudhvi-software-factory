# Review template: web (Next.js)

Use this template with `REVIEW.md` for each change in `projects/<name>/web/`. Apply the rules to the changed files only.

## Checks

### Accessibility

- Each interactive element has an accessible name. Use a visible label, `aria-label`, or `aria-labelledby`.
- Each image has `alt` text. A decorative image has `alt=""`.
- Each form field has a `<label>`. Errors are linked to the field with `aria-describedby`.
- Keyboard focus is visible and reachable. Do not remove focus outlines without a replacement.
- Do not use a `<div>` or `<span>` as a button or a link. Use the native element.
- `jsx-a11y` and `axe` checks in Playwright must pass. Do not disable them.

Example of a finding:

```
Important  projects/sample/web/components/icon-button.tsx:12
Icon button has no accessible name. Screen readers read nothing.
Fix: add aria-label from the caller, or render visible text.
```

### Server and client boundary

- Components are Server Components by default.
- `"use client"` appears only in leaf components. A leaf component has no server-only import.
- A client component does not import `server-only` code or a module that reads secrets.
- Props passed from a Server Component to a Client Component are serializable. Do not pass functions or class instances.
- Data fetching happens in Server Components or route handlers. Do not fetch secrets in the browser.

### Hydration

- Output does not depend on `Date.now()`, `Math.random()`, `window`, or locale-specific formatting during render.
- A browser-only value is read in `useEffect` or a client-only leaf.
- Markup inside `<p>` or `<button>` does not nest block elements. Hydration fails on invalid nesting.

### Leaking server secrets to the client

- No `process.env` value without the `NEXT_PUBLIC_` prefix appears in client code.
- The `config.ts` file for the web project reads env once. Client code reads only public config.
- A Server Action or route handler does not return a full database record. Return only the fields the page needs.
- Error messages shown to the user do not contain stack traces, SQL, or internal IDs.

### Data and contracts

- Responses from the API are parsed with the Zod schema from the project's `contracts`.
- A failed parse shows an error state. It does not render partial data.

### Security

- Do not use `dangerouslySetInnerHTML` with input. If it is needed, sanitize with a reviewed library and state why in a comment.
- Links to external sites use `rel="noopener noreferrer"` when they open in a new tab.

### Tests

- Each new component has a Testing Library test that queries by role or label.
- Each new page has a Playwright test. Each page has an `axe` check.

### Playwright specs

- Each new or changed page has a Playwright spec in `e2e/`. Report `Important` if it does not.
- The spec calls `page.goto('<route>')` and runs an axe check with `@axe-core/playwright`.
- The spec finds elements by role or label. A CSS class selector is `Nit`.
- The spec has no `test.skip`, `test.fixme`, or `test.fail`. Report `Important` if it does.
- Changing a page without changing its spec is `Important` unless the PR gives a reason.
