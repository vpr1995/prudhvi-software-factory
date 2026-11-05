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

Each control runs in up to three places. The places are:

- **Git hook:** the check runs on commit or push.
- **CI:** a required check on each pull request.
- **Nightly:** a scheduled check on the full repository.

| Control                                                             | Tool (license)                                                                                                                                                                                                                                                                                                                                | Git hook                                 | CI (required)                                                        | Nightly          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- | ---------------- |
| Secret scan                                                         | gitleaks (MIT). Custom rules: AWS keys, JWT, private keys, `.env` values.                                                                                                                                                                                                                                                                     | pre-commit (`gitleaks protect --staged`) | `sast.yml`, PR commit range                                          | Full git history |
| Verified secret scan                                                | TruffleHog OSS (AGPL, used as a CLI only), `--only-verified`                                                                                                                                                                                                                                                                                  | No                                       | `sast.yml`                                                           | Full git history |
| SAST, rules and taint                                               | Opengrep (LGPL-2.1). Rulesets in `tooling/opengrep/` for TypeScript, Node, React, Next.js, Fastify, JWT, SSRF, path traversal, plus our rules.                                                                                                                                                                                                | No                                       | `sast.yml`. SARIF goes to PR annotations. Any `ERROR` finding fails. | Full repository  |
| SAST, lint                                                          | `eslint-plugin-security`, `eslint-plugin-no-unsanitized` (MPL-2.0), `eslint-plugin-xss`                                                                                                                                                                                                                                                       | pre-commit                               | Lint job                                                             | No               |
| SAST, Node                                                          | njsscan (LGPL-3.0)                                                                                                                                                                                                                                                                                                                            | No                                       | `sast.yml`                                                           | No               |
| AI security review                                                  | `anthropics/claude-code-security-review` (MIT). `/security-review` command.                                                                                                                                                                                                                                                                   | No                                       | `claude-review.yml`. Open findings block merge.                      | No               |
| IaC scan                                                            | cdk-nag (Apache-2.0) at synth, AwsSolutions pack. Checkov (Apache-2.0) on `cdk.out` templates. cfn-lint (MIT-0).                                                                                                                                                                                                                              | No                                       | `infra.yml`                                                          | No               |
| Dependency audit                                                    | audit-ci (Apache-2.0) with `--pnpm`, allowlist `audit-ci.jsonc`. Two passes, both must pass (see section 3.1): pass A runtime deps only, fails on high or critical. Pass B all deps, fails on critical only.                                                                                                                                  | pre-push, when `pnpm-lock.yaml` changed  | `ci.yml`, when `pnpm-lock.yaml` changed                              | Report and issue |
| Dependency audit, second source                                     | OSV-Scanner (Apache-2.0) on `common/config/rush/pnpm-lock.yaml`                                                                                                                                                                                                                                                                               | No                                       | `deps.yml`                                                           | Yes              |
| License check                                                       | license-checker-rseidelsohn (BSD-3). Strict runtime list: MIT, Apache-2.0, BSD-2, BSD-3, ISC, 0BSD (plus BlueOak-1.0.0, CC0-1.0, Unlicense). Wider tooling list for dev-only deps and `tooling/*`: MPL-2.0, LGPL-3.0-only, PSF-2.0, CC-BY-3.0, CC-BY-4.0, Python-2.0, MIT-0 and some SPDX expressions. Reasons are in `_reasons` in the file. | No (run `rush license-check`)            | `deps.yml`                                                           | No               |
| New dependency control                                              | `rush add` only. `strictPeerDependencies`. `ensureConsistentVersions`. `scripts/security/new-deps.ts` posts a PR comment with name, license, downloads, age, and maintainers.                                                                                                                                                                 | No                                       | `rush check`. CODEOWNERS on the lockfile.                            | No               |
| Malicious and typo-squat packages                                   | `onlyBuiltDependencies` allowlist. No release age rule (owner decision, 2026-10-25). No automatic typosquat check. The PR review is the main control.                                                                                                                                                                                         | No                                       | `rush install` fails                                                 | No               |
| Supply chain, CI                                                    | Actions pinned by SHA, checked by pinact (MIT). zizmor (MIT) audits workflows. OpenSSF Scorecard (Apache-2.0).                                                                                                                                                                                                                                | No                                       | `sast.yml` (zizmor, pinact)                                          | Scorecard weekly |
| SBOM                                                                | cdxgen or `@cyclonedx/cyclonedx-npm` (Apache-2.0), one per deployable                                                                                                                                                                                                                                                                         | No                                       | `release.yml` artifact                                               | No               |
| Container scan (only if a container runtime is added, see ADR 0006) | Trivy (Apache-2.0), image and filesystem                                                                                                                                                                                                                                                                                                      | No                                       | `release.yml`                                                        | Yes              |

GitHub-only features need GitHub Advanced Security on private repositories. Do not depend on them. If the repository is public or has GitHub Advanced Security, turn on CodeQL, secret scanning with push protection, and dependency review as an extra layer. See `scripts/gh-setup.sh`.

## 3. Rule files

These files set the security rules. A human reviews each change to them.

| File                             | Purpose                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| `.gitleaks.toml`                 | Secret rules and allowlist                                              |
| `tooling/opengrep/**`            | SAST rules                                                              |
| `audit-ci.jsonc`                 | Dependency audit policy and allowlist, with reason and expiry per entry |
| `tooling/license-allowlist.json` | Allowed licenses: `runtime` (strict), `tooling` (dev only), `_reasons`  |
| `.checkov.yaml`                  | IaC scan settings                                                       |

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
3. CI posts the new-dependency report on the PR.
4. Check the report. Check the license, the age, the weekly downloads, and the maintainers.
5. A code owner approves the merge. The agent does not need a human approval for a new dependency that passes the audit.

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
- cdk-nag and Checkov check these rules. A nag error fails `cdk synth`.
- Do not run `cdk deploy` or `cdk destroy` from a laptop.
- Use OIDC roles in CI. Do not use long-lived AWS keys.
