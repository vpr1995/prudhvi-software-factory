# Risk tiers

Each pull request has one risk tier: `risk:low`, `risk:medium`, or `risk:high`. The tier tells the reviewer where to look. It does not change the number of approvals. The agent sets the label. Nothing automates it. The `main` ruleset does not read it.

## 1. Tiers

| Tier   | Label         | Typical changes                                              |
| ------ | ------------- | ------------------------------------------------------------ |
| Low    | `risk:low`    | Docs, copy, tests only. Additive change behind a flag.       |
| Medium | `risk:medium` | A normal code change in one project, with no high-tier path. |
| High   | `risk:high`   | A high-tier path (section 2), or a new dependency.           |

Review rules: see section 3.

## 2. High-tier paths

A PR that changes any path below is `risk:high`.

| Path or change                                                     | Why                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Authentication and authorization code                              | Access control.                                                                                   |
| Billing code                                                       | Money.                                                                                            |
| `platform/**`                                                      | Shared AWS resources (Cognito user pool, hosted zone, certificate, SSM parameters). Always human. |
| `packages/cdk-constructs/**`                                       | Shared infrastructure. Every project uses it.                                                     |
| `packages/**`                                                      | Shared code. A change has a wide effect.                                                          |
| `tooling/**`                                                       | Shared lint, TypeScript, test, and SAST config. Every project uses it.                            |
| New dependency, or a change to `common/config/rush/pnpm-lock.yaml` | Supply chain. `rush audit` checks it.                                                             |
| `.github/**`                                                       | CI and repository controls.                                                                       |

### 2.1 Medium-tier paths

A PR that changes the paths below, and no high-tier path, is `risk:medium`.

| Path or change                              | Why                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `projects/*/bin/**` and `projects/*/lib/**` | Cloud resources and IAM for one project. The infra reviewer and cdk-nag check them. |

`projects/*/cdk.json` stays high risk.

Changes to `CLAUDE.md` files, `REVIEW.md` files, `docs/guides/**`, and `docs/standards/**` are at least `risk:medium`. CODEOWNERS marks them for the owner's review.

## 3. Review rules

- The `main` ruleset requires a PR, the checks `ci-result` and `gitleaks`, and an up-to-date branch. It requires 0 approvals. It blocks deletion and force push.
- Agents open PRs with the owner's own GitHub user. There is no bot account.
- The owner reviews and merges each PR. This is a convention. GitHub does not enforce it.
- CODEOWNERS marks the paths that need the owner's review.
- Merge, squash, and rebase are all allowed.

## 4. How the label is set

1. The agent checks the changed paths against section 2.
2. The agent sets one label: `risk:low`, `risk:medium`, or `risk:high`. The tier is the highest tier that matches a changed path.
3. The agent writes the reason in the PR template.

## 5. Choosing the tier for a PR you write

1. Check each changed path against section 2. If one matches, the tier is `risk:high`.
2. If the change only changes docs, copy, or tests, the tier is `risk:low`.
3. If the change is additive, sits behind a flag that is off by default, and matches no path in section 2, the tier is `risk:low`. Write the flag name in the PR.
4. In all other cases, the tier is `risk:medium`.
5. Write the reason for the tier in the PR template. Do not write a tier without a reason.

## 6. Feature flags and tier

A flag does not lower the tier. A change that matches a path in section 2 stays `risk:high`, even when it sits behind a flag. Flag names are defined in `packages/flags`.
