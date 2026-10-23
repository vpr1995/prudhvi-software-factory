# Risk tiers

Each pull request has one risk tier: `risk:low`, `risk:medium`, or `risk:high`. The tier sets the number of human approvals.

The `risk-classify.yml` workflow runs `scripts/gates/classify-risk.mjs` on each PR. The script uses path rules and a Claude classifier. It sets the label.

## 1. Tiers and approvals

| Tier   | Label         | Human approvals | Typical changes                                                 |
| ------ | ------------- | --------------- | --------------------------------------------------------------- |
| Low    | `risk:low`    | 0               | Docs, copy, tests only. Additive change behind a flag.          |
| Medium | `risk:medium` | 1               | A normal code change in one project, with no high-tier path.    |
| High   | `risk:high`   | 2               | A high-tier path (section 2), a new dependency, or a gate file. |

Single-maintainer rule: see section 3.

## 2. High-tier paths

A PR that changes any path below is `risk:high`.

| Path or change                                                     | Why                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Authentication and authorization code                              | Access control.                                                                                   |
| Billing code                                                       | Money.                                                                                            |
| `platform/**`                                                      | Shared AWS resources (Cognito user pool, hosted zone, certificate, SSM parameters). Always human. |
| `projects/*/bin/**` and `projects/*/lib/**`                        | Cloud resources and IAM for one project.                                                          |
| `packages/cdk-constructs/**`                                       | Shared infrastructure. Every project uses it.                                                     |
| `packages/**`                                                      | Shared code. A change has a wide effect.                                                          |
| New dependency, or a change to `common/config/rush/pnpm-lock.yaml` | Supply chain.                                                                                     |
| `.github/**`                                                       | CI and release controls.                                                                          |
| Gate files in `docs/standards/gates.md`, section 2.1               | Controls for all other changes.                                                                   |

Changes to the human-reviewed documents in `docs/standards/gates.md`, section 2.2, are at least `risk:medium`. They need a CODEOWNERS approval.

## 3. Approval rules

- A bot approval does not count. This includes the AI reviewer and the security action.
- The person who prompted the agent counts as a required reviewer.
- Each new commit clears the approvals. A human approves the latest commit.
- Open review threads block merge. Resolve each thread before merge.
- The `main` ruleset enforces these rules. Admins do not bypass them.

### 3.1 Single maintainer (current state)

The repository has one human maintainer, `@vprprudhvi`. GitHub does not let an author approve their own pull request. Without a change, the maintainer cannot approve a PR that the maintainer's own account opened.

Use this setup:

1. Agents open PRs from a separate bot account or a GitHub App. The human account does not open agent PRs.
2. The maintainer reviews and approves each PR from the human account.
3. Section 1 requires two approvals for `risk:high`. Until a second maintainer exists, `risk:high` needs:
   - one human approval from `@vprprudhvi`, and
   - all automated reviews that pass: AI review (`claude-review.yml`), security review, and `check-gates`.
4. The PR must name this degraded rule in the Risk tier section. Write: "Single maintainer: 1 human approval plus passing automated reviews."
5. When a second maintainer exists, restore the two-approval rule in the ruleset and in this section.

This degraded rule is a known gap. Record the change in a new ADR when the second maintainer joins.

## 4. How the label is set

1. `risk-classify.yml` runs on each PR event.
2. `scripts/gates/classify-risk.mjs` checks the changed paths against section 2.
3. The script asks the classifier for a second opinion on the change.
4. The workflow sets one label: `risk:low`, `risk:medium`, or `risk:high`.
5. The ruleset reads the label and requires the number of approvals in section 1.

If a PR has a high-tier path, the label is `risk:high`. An agent cannot set or remove a risk label. See `docs/standards/gates.md`, section 5.

## 5. Choosing the tier for a PR you write

1. Check each changed path against section 2. If one matches, the tier is `risk:high`.
2. If the change only changes docs, copy, or tests, the tier is `risk:low`.
3. If the change is additive, sits behind a flag that is off by default, and matches no path in section 2, the tier is `risk:low`. Write the flag name in the PR.
4. In all other cases, the tier is `risk:medium`.
5. Write the reason for the tier in the PR template. Do not write a tier without a reason.

## 6. Feature flags and tier

A flag does not lower the tier. A change that matches a path in section 2 stays `risk:high`, even when it sits behind a flag. Flag names are defined in `packages/flags`.
