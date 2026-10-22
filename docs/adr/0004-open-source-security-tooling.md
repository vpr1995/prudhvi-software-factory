# ADR 0004: Use open-source security tools only

- Status: Accepted
- Date: 2026-10-22

## Context

The repository must run security checks at agent edit time, at commit time, in CI, and nightly. The team has no paid security license for this repository. GitHub Advanced Security features apply only to public repositories or to organizations with that license.

## Decision

- Use only open-source tools for secrets, SAST, dependency audit, license checks, IaC scanning, and supply-chain checks. Each tool must run locally and in CI.
- The tools are listed in `docs/standards/security.md`. The main tools are gitleaks, TruffleHog (CLI), Opengrep, njsscan, eslint security plugins, audit-ci, OSV-Scanner, license-checker, cdk-nag, Checkov, cfn-lint, pinact, zizmor, and OpenSSF Scorecard.
- Run each control with one script. The git hook and CI call the same script.
- Make CI the final gate. Local checks help but do not decide.
- Do not depend on GitHub Advanced Security. Turn on its features only when the repository is public or has the license.
- Allowlists and rule files are gate files. Only a human changes them.

## Consequences

- Positive: No license cost. Each check can be run by any developer.
- Positive: The same check runs in four places.
- Negative: More tools to keep up to date. Each tool version is pinned.
- Negative: Some open-source tools have licenses that need review (for example, AGPL for TruffleHog). Use them only as a CLI.
- Negative: False positives need a human review. See `docs/standards/security.md`, section 5.
