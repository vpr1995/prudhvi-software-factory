# Security

This document lists the security controls for the repository. It also gives the process for a false positive.

## 1. Rules

- Use only open-source tools. Each tool must run locally and in CI with no paid license.
- Run each control in the same way in the hook and in CI. One script runs the check in both places.
- CI is the final check. Run the other checks by hand.
- Do not put secrets in code, in config, or in test data.
- Do not add a dependency without the process in section 4.
- Do not add an allowlist entry, a rule skip, or a suppression comment as an agent.

## 2. Controls

Each control runs in up to two places. The places are:

- **Git hook:** the check runs on commit or push.
- **CI:** a job of `ci.yml` or `secrets.yml` on each pull request. The required checks are `ci-result` and `gitleaks` (see [testing.md](testing.md) section 6).

"No" in both columns means that nothing runs the control now. Run it by hand.

| Control                           | Tool (license)                                                                                                                                                                                                                                                                                                                                | Git hook                                                              | CI                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| Secret scan                       | gitleaks (MIT), pinned by `scripts/security/install-tools.mjs`. Custom rules: AWS keys, JWT, private keys, `.env` values.                                                                                                                                                                                                                     | pre-commit (`gitleaks git --staged`)                                  | `secrets.yml`, on the PR commits (merge base..head) |
| SAST, rules and taint             | CodeQL, extended query suite (GitHub code scanning). Set in the repository settings, not in `.github/workflows`. Our own rules are ESLint rules (`local/*`, for example `local/no-secret-in-log`) in `tooling/eslint-config`.                                                                                                                 | No                                                                    | GitHub code scanning                                |
| SAST, lint                        | `eslint-plugin-security`, `eslint-plugin-no-unsanitized` (MPL-2.0)                                                                                                                                                                                                                                                                            | pre-commit                                                            | `rush lint` (`ci.yml` job `project`)                |
| AI security review                | Claude Code `/security-review` command. The `pre-pr` skill runs it.                                                                                                                                                                                                                                                                           | No                                                                    | No                                                  |
| IaC scan                          | cdk-nag (Apache-2.0), AwsSolutions pack. It runs inside the infra unit tests.                                                                                                                                                                                                                                                                 | No                                                                    | `rush test` (cdk-nag in the infra tests)            |
| Dependency audit                  | audit-ci (Apache-2.0) with `--pnpm`, allowlist `audit-ci.jsonc`. Two passes, both must pass (see section 3.1): pass A runtime deps only, fails on high or critical. Pass B all deps, fails on critical only.                                                                                                                                  | pre-push, when `pnpm-lock.yaml` changed                               | `ci.yml` job `plan`, when `pnpm-lock.yaml` changed  |
| License check                     | license-checker-rseidelsohn (BSD-3). Strict runtime list: MIT, Apache-2.0, BSD-2, BSD-3, ISC, 0BSD (plus BlueOak-1.0.0, CC0-1.0, Unlicense). Wider tooling list for dev-only deps and `tooling/*`: MPL-2.0, LGPL-3.0-only, PSF-2.0, CC-BY-3.0, CC-BY-4.0, Python-2.0, MIT-0 and some SPDX expressions. Reasons are in `_reasons` in the file. | No (run `rush license-check`)                                         | No                                                  |
| New dependency control            | `rush add` only. `strictPeerDependencies`. `ensureConsistentVersions`.                                                                                                                                                                                                                                                                        | No                                                                    | `rush check`. CODEOWNERS on the lockfile.           |
| Malicious and typo-squat packages | `onlyBuiltDependencies` allowlist. No release age rule (owner decision, 2026-10-25). No automatic typosquat check. The PR review is the main control.                                                                                                                                                                                         | No                                                                    | `rush install` fails                                |
| Supply chain, CI                  | Actions pinned by full commit SHA with a version comment, checked by pinact (MIT). zizmor (MIT) audits workflows offline. actionlint (MIT) checks workflow syntax. All three are pinned by `scripts/security/install-tools.mjs` and run by `scripts/security/workflow-lint.sh`. OpenSSF Scorecard (Apache-2.0) is not set up.                 | pre-commit, on staged `.github/workflows` and `.github/actions` files | `ci.yml` job `workflow-lint`                        |

The repository is public. CodeQL default setup, secret scanning, push protection, and Dependabot security updates are on in the repository settings.

## 3. Rule files

These files set the security rules. A human reviews each change to them.

| File                             | Purpose                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.gitleaks.toml`                 | Secret rules and allowlist                                                                                                                                                                                                                 |
| `.github/zizmor.yml`             | zizmor audit settings. One exception: the `self-repository` audit is off. Reason: actionlint 1.7.12 does not support `uses: $/...` (rhysd/actionlint#711). Owner decision, 2026-11-05. Remove the exception when actionlint supports `$/`. |
| `tooling/eslint-config/**`       | Lint rules, including the security rules                                                                                                                                                                                                   |
| `audit-ci.jsonc`                 | Dependency audit policy and allowlist, with reason and expiry per entry                                                                                                                                                                    |
| `tooling/license-allowlist.json` | Allowed licenses: `runtime` (strict), `tooling` (dev only), `_reasons`                                                                                                                                                                     |

### 3.1 Dependency audit and license policy

Human decision, 2026-10-22. Agents must not change it.

- `rush audit` runs two audit-ci passes. Both must pass. The script prints which pass failed.
  - Pass A audits runtime (production) dependencies only. It fails on high or critical. `tooling/*` projects never ship, so pass A drops them from a temp copy of the lockfile before it applies `--skip-dev`.
  - Pass B audits all dependencies, including dev and tooling. It fails on critical only.
- The `allowlist` in `audit-ci.jsonc` stays empty. High advisory GHSA-vfj7-8cjw-p6xm (braces) has no patch. It is reachable only through dev lint tooling (`@next/eslint-plugin-next`, `fast-glob`, `micromatch`, `braces`). The split policy covers it.
- `rush license-check` uses the strict `runtime` list for production dependencies of shipping projects (`packages/`, `projects/`, `platform/`). It uses `runtime` plus `tooling` for dev-only dependencies and for `tooling/*`.
- `LGPL-3.0-only` and `CC-BY-3.0` are tooling-only licenses. Each has a reason and a date in `_reasons` in `tooling/license-allowlist.json`.
- A named runtime exception is an entry in `excludePackages`, with a reason and an expiry date in `_reasons`. There is one: `caniuse-lite@1` (CC-BY-4.0, expires 2027-10-22). The entry `name@major` excludes one major version only.

## 4. Dependency process

Use this process to add a dependency.

1. The agent runs `rush add -p <package>`. Do not use `npm`, `pnpm add`, or `pnpm install`.
   - A version text must be a registry range or a tag. A URL, a git source, a tarball, or an `npm:` alias fails.
2. The pre-push hook runs `rush audit` when `common/config/rush/pnpm-lock.yaml` changed. CI runs `rush audit` in that case too. A failed audit stops the agent.
3. The agent does not need a human approval for a new dependency that passes the audit. If the audit fails, stop and ask the human.

A dependency with a known high or critical vulnerability is blocked. The fix is to choose another version or another package.

## 5. False positives

A false positive is a finding that is not a real risk. Only a human can accept one.

Use this process.

1. Read the rule that fired. Read the code at the reported line.
2. Confirm that the finding is not a real risk. Write down why.
3. Fix the code if there is a real risk. Stop here in that case.
4. Add an allowlist entry in the rule file for the tool. Use the file in section 3.
5. Write the reason in the entry.
6. For `audit-ci.jsonc`, write an expiry date. Renew or remove the entry when it expires.
7. Get approval from `@vpr1995`.

Use the smallest scope in the entry. Do not allow a whole directory when one file is enough.

An agent does not add an entry. An agent writes the reason in the PR. A human adds the entry.

## 6. Secrets

- Do not commit a `.env` file.
- Do not put a key in code, in a test fixture, or in a comment.
- Bruno environment files (`bruno/environments/*.bru`) hold no secrets. A request reads a secret as `{{process.env.X}}`.
- Playwright and Bruno tests do not log tokens. Do not print a response body that holds a token.
- Read secrets at run time from the environment or from AWS. Read them only in `config.ts`.
- If a secret leaks, do these steps in order:
  1. Revoke or rotate the secret. Do this first.
  2. Remove the secret from the code in a new commit.
  3. Tell `@vpr1995` in the PR.

Removing a secret from git history does not make it safe. Rotate it.

## 7. Infrastructure security

- Use least-privilege IAM. Do not use `*` for an action or a resource in a CDK policy.
- Encrypt each S3 bucket and each database.
- Do not expose a stateful resource to the public internet.
- cdk-nag checks these rules. A nag error fails `cdk synth`.
- Deploy rules: see root `CLAUDE.md`, rule 4. Never run `cdk deploy` or `cdk destroy`.
- Do not use long-lived AWS keys.
