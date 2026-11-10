# ADR 0012: Cloudflare for static sites

- Status: Proposed
- Date: 2026-11-09

## Context

`docs/guides/repo-overview.md` lists two non-goals: "No cloud other than AWS." and "No infrastructure tool other than AWS CDK." The owner domain `vprprudhvi.dev` is already on Cloudflare. The project `projects/national-parks-tracker` already deploys to Cloudflare with Workers static assets and wrangler. The portfolio page in `docs/designs/portfolio/design.md` is a static site. The owner chose Cloudflare for it, not AWS.

The two non-goals block this choice. This ADR sets an exception for static hosting only.

## Decision

- A web-only static project can deploy to Cloudflare Workers static assets with wrangler. Follow the pattern in `projects/CLAUDE.md`, section "Deploy to Cloudflare".
- AWS CDK stays the tool for AWS resources and for any backend.
- A cloud resource other than static hosting needs a new ADR.

## Consequences

- Positive: Static hosting adds no AWS resources and no AWS cost.
- Positive: A static page needs no CDK stack.
- Negative: The repo uses a second cloud.
- Negative: The GitHub `prod` environment needs a Cloudflare token and an account ID.
- Open: The owner can rewrite this ADR later.
