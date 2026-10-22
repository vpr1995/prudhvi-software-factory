---
name: explain-area
description: Write a short explainer for one slice of code into docs/explainers/<slug>.md, in ASD-STE100 style, with file paths, the main flow, and an optional Mermaid diagram. Use when asked to explain, document, or onboard someone to a module, flow, or area of the code. Triggers include explain this area, explainer, how does this work, document this module, onboarding note for code.
---

# explain-area

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Style: ASD-STE100. Use active voice and the simple present tense. Use short sentences. Use one instruction per step. Define each term once.

## Steps

1. Ask for the slice if it is unclear: a folder, a feature, or a flow. Wait for the answer.
2. Read the code in that slice. Use Grep and Glob to find entry points, exports, and callers. Read only the files you need.
3. Choose the slug: kebab-case, short, for example `order-export-flow`.
4. Write `docs/explainers/<slug>.md` with these sections:
   - `## Purpose`: 2 to 3 sentences. What this slice does.
   - `## Where it lives`: a list of `path`, each with one line of purpose.
   - `## Main flow`: a numbered list. Each step names a function and its `file:line`.
   - `## Diagram` (optional): a Mermaid `flowchart` with at most 10 nodes. Include it only when it helps.
   - `## Rules that apply`: link `docs/standards/coding-conventions.md` and the `REVIEW.md` for the area. Do not copy the rules.
   - `## Open questions`: items you could not confirm from the code.
5. Check each `file:line` reference. Open the line and confirm the text matches.
6. Check the style. Each sentence has one main verb. Remove "should", "might", and passive voice where you can.
7. Report the file path and the list of open questions.

## Done when

- [ ] `docs/explainers/<slug>.md` exists and has the six sections.
- [ ] Every `file:line` reference was checked.
- [ ] The explainer names no secret, account ID, or credential value.

## Do not

- Write code, change code, or change tests.
- Guess behavior. Put unknown items in `## Open questions`.
- Copy long code blocks. Use short references.
- Write any file other than `docs/explainers/<slug>.md`.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Py/Go: no `@pytest.mark.skip` or `xfail`, `pytest.skip(`, or `t.Skip(`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`. Py/Go: no `# noqa`, `# type: ignore`, `# nosec`, `# pragma: no cover`, `//nolint`, or `// #nosec`.
- Edit gate files. Gate files need a human: `.github/**`, `CODEOWNERS`, `.claude/settings.json`, `.claude/hooks/**`, `platform/infra/**`, `tooling/**`, `rush.json`, `common/config/rush/**`, `common/git-hooks/**`, `common/autoinstallers/**`, `scripts/check-gates.ts`, `scripts/classify-risk.ts`, `docs/standards/coding-conventions.md`, `**/REVIEW.md`, `**/rush-project.json`, `**/cdk.json`, `eslint.config.*`, `tsconfig*.json`, `vitest.config.*`, `.dependency-cruiser.*`, `.gitleaks.toml`, `audit-ci.jsonc`, `.checkov.yaml`. Full list: `docs/standards/gates.md`.
- Run `npm install` or `pnpm install`.
- Run `cdk deploy` or `cdk destroy`.
- Use `--no-verify`.
