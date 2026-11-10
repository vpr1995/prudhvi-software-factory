---
status: approved
---

# Brief: Personal portfolio page

Size: L (new project, public web page, build-time feeds, in-browser model).

## Problem

The owner has no public page that shows their work. Recruiters and hiring managers cannot quickly see what a senior backend and AWS engineer with 8 years of IoT and event-driven experience (now applying AI) has built. The owner wants to move to Boston and wants to build a name as a maker.

## Users

- Recruiters and hiring managers (main audience).
- Peers and other engineers who find the owner through Medium or GitHub.
- The owner, who edits the content and deploys.

## Non-goals

- No backend, no AWS resources, no login for this page.
- No analytics built from scratch. Use the Cloudflare built-in analytics only.
- No admin screen. Content changes are commits to a JSON file.
- No personal life content (partner, the reason for the move, the job search details, salary).
- No opinions about the current employer.
- No chatbot that depends on a server or a paid API.

## Constraints

Scope by version:

- **Version 1:** the static page, the JSON content, the feeds, the Cloudflare deploy.
- **Version 2:** the in-browser chat. It stays in the plan. Version 1 contains no chat code except the flag that keeps it off (see "Chat (version 2)").

Version 1:

- Single page, sleek and modern, not flashy and not a template look.
- Location line: open to relocation, with Boston first (primary), then the Bay Area, Seattle and NYC.
- Employer figures from the resume ($250K ARR, 4M+ users, 1M+ households) can be published. The owner will keep them in the content JSON. The owner will add any further awards to the JSON later, each with a source.
- Domain: `portfolio.vprprudhvi.dev`.
- Light and dark mode. The toggle has three states (system, light, dark) and persists the choice. The axe check runs in both themes. Every reveal control works by keyboard and screen reader.
- The project is web-only: created with `rush new` and `rush add-part --part web`. It has no `bin`, `lib`, `cdk.json`, `aws-cdk*`, `cdk-nag`, `constructs` or `leaflet`. It reuses from `projects/national-parks-tracker` only `wrangler`, `deploy:cloudflare`, `smoke`, `wrangler.jsonc` and `_headers`. `national-parks-tracker` is also the precedent for a Zod contract without an API.
- Static export, deployed to Cloudflare as a subdomain of `vprprudhvi.dev` (the domain is already on Cloudflare). Pattern: `projects/CLAUDE.md`, section "Deploy to Cloudflare". The owner's decision is Cloudflare, not AWS. `docs/guides/repo-overview.md` section 4 ("No cloud other than AWS") is stale. A human-reviewed ADR or a one-line PR fixes it as a separate change before the project is scaffolded.
- Content (profile, experience highlights, awards, pinned repos, contact) lives in one committed JSON file, parsed by a Zod contract. A failing contract names the JSON path and the rule. A build check rejects disallowed fields and a phone number outside the reveal structure.
- Feeds:
  - Medium articles come from `https://medium.com/feed/@vprprudhvi`. GitHub repos come from the `vpr1995` account, with a hand-picked pinned list.
  - The build parses both responses with Zod contracts, keeps only title, date and URL (and repo name and description), and allows only `https://medium.com/` and `https://github.com/` link origins.
  - The page renders all feed text as text, never as HTML. Outgoing links use `rel="noopener noreferrer"`.
  - The last good copy is a committed snapshot, `content/feeds.json`, with its own Zod contract. The build writes it only after a successful fetch. A failed fetch keeps the snapshot and prints a build warning that names the feed and the age of the copy. The snapshot carries a `fetchedAt` for each feed. A revert restores the previous snapshot.
  - Feeds refresh through a weekly scheduled GitHub Action. It runs the fetch and opens a PR that updates `content/feeds.json`. The owner merges it, and the normal deploy runs, so nothing goes live without the owner. The Action uses the built-in `GITHUB_TOKEN` (no extra secret).
- The phone number is behind a click-to-reveal. The owner accepts that it is effectively public: it is in the committed JSON and the static bundle of a public repo, and click-to-reveal only slows casual scrapers. Email and LinkedIn are public.
- The resume file is never committed (the repo is public). Only cleaned content goes into the JSON.
- Flags are build-time (`NEXT_PUBLIC_FLAG_*` through `packages/flags`). A flag rollback is a rebuild and a deploy by the owner. The chat flag defaults to off.
- Tests:
  - A Zod contract test and a feed fallback test (a failed fetch must not fail the build or empty the section).
  - A Playwright spec for light mode, dark mode, the toggle, the phone reveal and axe, run against the built `out/` folder with the real `_headers`.
  - A `smoke` spec that checks the headline, the experience section, non-empty feed sections and the CSP.
  - The trace propagation duty does not apply to the web page (it has no backend). The owner confirmed this exemption. The build and feed scripts log through `@vprprudhvi/shared-logger`, with one test.
- Owner workflow: `dev:web` is the preview. `deploy:cloudflare` is the deploy. A short owner runbook says so.
- Agents do not deploy. The owner deploys.
- Each new user-visible behavior sits behind a flag from `packages/flags` (root `CLAUDE.md`, rule 6).

## Chat (version 2)

These rules apply when the chat is built. Version 2 is a separate design and ticket group.

- Model: Gemma 3 270M, fine-tuned with LoRA on the owner's laptop (RTX Max-Q), run on-device in the browser. Weights live on Hugging Face. The page works fully without the chat, and the chat loads nothing until the visitor asks.
- The model is public. Anything in the training data counts as public. Build the training set only from the same cleaned, publishable content as the JSON plus the public articles, never from the raw resume. Scan the generated Q&A for phone, address, salary and employer opinions before the weights are published.
- Pin the model to a Hugging Face commit SHA and check a file hash before loading. Bundle the inference runtime as a dependency (`rush add`), not from a CDN script tag. Record the runtime choice in an ADR. Keep a public-safe training recipe (scripts and config, no resume) in the repo. Treat the model as a versioned artifact with an update trigger when the JSON changes materially.
- Put the model loader in one module behind the flag, so it can be deleted without touching the page.
- Visitor experience: ask for consent and show the download size before the download. Cache the weights so each visitor downloads once. Detect missing WebGPU or WASM and show a plain message. Show an error with a retry and an "email me" link on a failed download or a generation error. The core page has a load budget that excludes the model. A CI or scheduled check confirms the weights URL and the pinned revision still resolve.
- The chat shows "a small model that can be wrong" wherever it appears. It refuses private details and employer opinions. When unsure, it points to email. Render its output as plain text, with no auto-linked URLs.
- `_headers` CSP adds the Hugging Face hosts to `connect-src`, `'wasm-unsafe-eval'`, and `worker-src` if needed. An e2e spec confirms the chat loads under the real headers, and that no model request fires before the visitor clicks.

## Chosen direction

A single static page for a senior backend and AWS engineer open to roles in Boston, built from one JSON file plus a committed feed snapshot of Medium and GitHub data, deployed to Cloudflare under `vprprudhvi.dev`. It leads with the owner's strongest work (RMM, RBAC, migration, IoT scale), the Genie High-Performance Awards (2023, 2025, 2026) and articles. Version 2 adds an optional, clearly labeled in-browser fine-tuned Gemma 3 270M chat that shows the owner's applied-AI skills without any backend.

## Alternatives seen

- A hosted chat on AWS Lambda and Bedrock. Rejected by the owner: no backend, and no AWS.
- RAG over the resume with an off-the-shelf small model, with no fine-tuning. Not chosen: the owner wants to show fine-tuning.
- Full Medium articles reproduced on the page. Not chosen: titles, dates and links out are enough.
- Template portfolio themes. Not chosen: the owner wants something sleek and slightly different.
- Hand-listed Medium articles in the JSON, with no feed fetch (YAGNI lens). Not chosen: the owner wants the RSS feed.

## Lens findings

| #   | Lenses                                                              | Finding                                                                                                                              | Severity | Decision | Reason or change                                                                                                                                       |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Security (1)                                                        | Public weights trained on the resume can leak private data.                                                                          | Blocker  | accept   | Chat section: train only on cleaned content and public articles, scan the Q&A, treat training data as public.                                          |
| 2   | Security (1), Migration (1)                                         | Click-to-reveal does not protect the phone number in a public repo and bundle.                                                       | High     | reject   | The owner keeps the phone number behind click-to-reveal and accepts that it is effectively public. Written into Constraints.                           |
| 3   | YAGNI (1)                                                           | The chat is the largest unit of work. Ship the page first.                                                                           | High     | defer    | The chat moves to version 2 and stays in the plan. Version 1 has only the flag.                                                                        |
| 4   | Security (1), Tech debt (1), Migration (1)                          | The model has no owner, pin or recipe.                                                                                               | High     | accept   | Chat section: pinned SHA and hash check, bundled runtime, ADR, public-safe recipe, versioned artifact, one deletable module.                           |
| 5   | UX (1), Observability (1), Cost (1)                                 | The chat has no consent, capability check, failure states, caching or load budget.                                                   | High     | accept   | Chat section: visitor experience bullet.                                                                                                               |
| 6   | Security (1), Testing (1), Observability (1)                        | The existing CSP blocks the model.                                                                                                   | High     | accept   | Chat section: CSP additions and an e2e spec under the real headers.                                                                                    |
| 7   | UX (1), Observability (1), Cost (1), Tech debt (1), YAGNI (1), Migration (1), Security (1) | The last good copy of the feeds has no storage, refresh trigger or stale signal.                                    | High     | accept   | Constraints: committed `content/feeds.json` snapshot with a Zod contract, `fetchedAt`, a build warning, refresh on redeploy. Open sub-points below.    |
| 8   | Security (1)                                                        | Feed data is untrusted input.                                                                                                        | Medium   | accept   | Constraints: Zod parse, keep only needed fields, origin allowlist, text-only rendering, `rel="noopener noreferrer"`.                                   |
| 9   | Tech debt (1), YAGNI (1), Migration (1)                             | The Cloudflare "conflict" is stale. The non-goal needs a proper fix.                                                                 | Medium   | accept   | Constraints: separate human-reviewed ADR or one-line PR before scaffolding. The "conflict" wording is dropped.                                         |
| 10  | Tech debt (1), YAGNI (1)                                            | Copying `national-parks-tracker` brings unused CDK parts.                                                                            | Medium   | accept   | Constraints: web-only project with named reuse and the contracts precedent.                                                                            |
| 11  | Testing (1)                                                         | Flags do not work at runtime in a static export.                                                                                     | Medium   | accept   | Constraints: build-time flags, the chat flag defaults to off, a rollback is a rebuild.                                                                 |
| 12  | Testing (3), Observability (2)                                      | The brief has no test plan.                                                                                                          | Medium   | accept   | Constraints: the Tests bullet. Open sub-point below: the trace test exemption.                                                                         |
| 13  | UX (1), Testing (1)                                                 | The edit loop has no error path, preview or content gate.                                                                            | Medium   | accept   | Constraints: contract errors name the path, a build check on disallowed fields, `dev:web` and `deploy:cloudflare` in a short runbook.                   |
| 14  | UX (1)                                                              | Dark mode and accessibility are unspecified.                                                                                         | Low      | accept   | Constraints: three-state persisted toggle, axe in both themes, keyboard and screen reader.                                                             |
| 15  | Cost (1)                                                            | The training-data generator, its cost and its license are unknown.                                                                   | Low      | open     | Open items.                                                                                                                                            |

32 raw findings, 15 rows: 12 accept, 1 reject, 1 open, 1 defer.

## Open items

- [NEEDS CLARIFICATION] Row 15 (version 2): which model generates the training Q&A, is it paid or local, and does its license allow using its output as training data?
- [NEEDS CLARIFICATION] Row 15 (version 2): do the Gemma terms of use allow a public fine-tuned demo?
