# Security

This document lists the security controls for the repository. It also gives the process for a false positive.

## 1. Rules

- Use only open-source tools. Each tool must run locally and in CI with no paid license.
- Run each control in the same way in the hook and in CI. One script runs the check in both places.
- CI is the final gate. Local checks help, but CI runs every check again.
- Do not put secrets in code, in config, or in test data.
- Do not add a dependency without the process in section 4.
- Do not add an allowlist entry, a rule skip, or a suppression comment as an agent.

## 2. Controls

Each control runs in up to four places. The places are:

- **Agent edit:** the Claude hook runs the check when the agent edits a file.
- **Git hook:** the check runs on commit or push.
- **CI:** a required check on each pull request.
- **Nightly:** a scheduled check on the full repository.

| Control                                                             | Tool (license)                                                                                                                                                                                                                                                                                                                                                | Agent edit                                          | Git hook                                                                                    | CI (required)                                                        | Nightly          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------- |
| Secret scan                                                         | gitleaks (MIT). Custom rules: AWS keys, JWT, private keys, `.env` values.                                                                                                                                                                                                                                                                                     | `block-secrets.sh`                                  | pre-commit (`gitleaks protect --staged`)                                                    | `sast.yml`, PR commit range                                          | Full git history |
| Verified secret scan                                                | TruffleHog OSS (AGPL, used as a CLI only), `--only-verified`                                                                                                                                                                                                                                                                                                  | No                                                  | No                                                                                          | `sast.yml`                                                           | Full git history |
| SAST, rules and taint                                               | Opengrep (LGPL-2.1). Rulesets in `tooling/opengrep/` for TypeScript, Node, React, Next.js, Fastify, JWT, SSRF, path traversal, plus our rules.                                                                                                                                                                                                                | No                                                  | pre-push (changed JS and TS files)                                                          | `sast.yml`. SARIF goes to PR annotations. Any `ERROR` finding fails. | Full repository  |
| SAST, lint                                                          | `eslint-plugin-security`, `eslint-plugin-no-unsanitized` (MPL-2.0), `eslint-plugin-xss`                                                                                                                                                                                                                                                                       | PostToolUse lint                                    | pre-commit                                                                                  | Lint job                                                             | No               |
| SAST, Node                                                          | njsscan (LGPL-3.0)                                                                                                                                                                                                                                                                                                                                            | No                                                  | No                                                                                          | `sast.yml`                                                           | No               |
| AI security review                                                  | `anthropics/claude-code-security-review` (MIT). `/security-review` command.                                                                                                                                                                                                                                                                                   | `pre-pr` skill                                      | No                                                                                          | `claude-review.yml`. Open findings block merge.                      | No               |
| IaC scan                                                            | cdk-nag (Apache-2.0) at synth, AwsSolutions pack. Checkov (Apache-2.0) on `cdk.out` templates. cfn-lint (MIT-0).                                                                                                                                                                                                                                              | No                                                  | pre-push: `cdk synth` with cdk-nag (infra changed). Checkov and cfn-lint are not installed. | `infra.yml`                                                          | No               |
| Dependency audit                                                    | audit-ci (Apache-2.0) with `--pnpm`, allowlist `audit-ci.jsonc`. Two passes, both must pass (see section 3.1): pass A runtime deps only, fails on high or critical. Pass B all deps, fails on critical only.                                                                                                                                                  | `guard-bash.sh` blocks raw `npm` and `pnpm install` | No (nightly, `--audit-only`)                                                                | `deps.yml`                                                           | Report and issue |
| Dependency audit, second source                                     | OSV-Scanner (Apache-2.0) on `common/config/rush/pnpm-lock.yaml`                                                                                                                                                                                                                                                                                               | No                                                  | No                                                                                          | `deps.yml`                                                           | Yes              |
| License check                                                       | license-checker-rseidelsohn (BSD-3). Strict runtime list: MIT, Apache-2.0, BSD-2, BSD-3, ISC, 0BSD (plus BlueOak-1.0.0, CC0-1.0, Unlicense, MIT-0, PSF-2.0). Wider tooling list for dev-only deps and `tooling/*`: MPL-2.0, LGPL-3.0-only, PSF-2.0, CC-BY-3.0, CC-BY-4.0, Python-2.0, MIT-0 and some SPDX expressions. Reasons are in `_reasons` in the file. | No                                                  | pre-push (lock or policy changed)                                                           | `deps.yml`                                                           | No               |
| New dependency control                                              | `rush add` only. `strictPeerDependencies`. `ensureConsistentVersions`. Lockfile is a gate file. `scripts/security/new-deps.ts` posts a PR comment with name, license, downloads, age, and maintainers.                                                                                                                                                        | Hook                                                | No                                                                                          | `rush check`. CODEOWNERS on the lockfile.                            | No               |
| Malicious and typo-squat packages                                   | `onlyBuiltDependencies` allowlist. No release age rule (owner decision, 2026-10-25). Typosquat check on new names: a small static list, so the PR review is the main control (`gates.md` section 6.6).                                                                                                                                                        | No                                                  | No                                                                                          | `rush install` fails                                                 | No               |
| Supply chain, CI                                                    | Actions pinned by SHA, checked by pinact (MIT). zizmor (MIT) audits workflows. OpenSSF Scorecard (Apache-2.0).                                                                                                                                                                                                                                                | No                                                  | No                                                                                          | `sast.yml` (zizmor, pinact)                                          | Scorecard weekly |
| SBOM                                                                | cdxgen or `@cyclonedx/cyclonedx-npm` (Apache-2.0), one per deployable                                                                                                                                                                                                                                                                                         | No                                                  | No                                                                                          | `release.yml` artifact                                               | No               |
| Python SAST                                                         | bandit (Apache-2.0). Ruff `S` rules run in the lint job.                                                                                                                                                                                                                                                                                                      | Ruff on save                                        | pre-push via `rush verify` lint phase                                                       | `sast.yml`. Any `HIGH` finding fails.                                | Full repository  |
| Python dependency audit                                             | pip-audit (Apache-2.0) on `uv.lock`                                                                                                                                                                                                                                                                                                                           | No                                                  | No (nightly, `--audit-only`)                                                                | `deps.yml`                                                           | Report and issue |
| Python licenses                                                     | pip-licenses (MIT) with the license allowlist                                                                                                                                                                                                                                                                                                                 | No                                                  | pre-push (lock or policy changed)                                                           | `deps.yml`                                                           | No               |
| Go SAST                                                             | gosec (Apache-2.0), run through golangci-lint                                                                                                                                                                                                                                                                                                                 | golangci-lint `--fast` on edit                      | pre-push via `rush verify` lint phase                                                       | Lint job and `sast.yml`                                              | Full repository  |
| Go vulnerability check                                              | govulncheck (BSD-3) on `go.sum`                                                                                                                                                                                                                                                                                                                               | No                                                  | No (nightly, `--audit-only`)                                                                | `deps.yml`                                                           | Yes              |
| Go licenses                                                         | go-licenses (Apache-2.0) with the license allowlist                                                                                                                                                                                                                                                                                                           | No                                                  | pre-push (lock or policy changed)                                                           | `deps.yml`                                                           | No               |
| Container scan (only if a container runtime is added, see ADR 0006) | Trivy (Apache-2.0), image and filesystem                                                                                                                                                                                                                                                                                                                      | No                                                  | No                                                                                          | `release.yml`                                                        | Yes              |

GitHub-only features need GitHub Advanced Security on private repositories. Do not depend on them. If the repository is public or has GitHub Advanced Security, turn on CodeQL, secret scanning with push protection, and dependency review as an extra layer. See `scripts/gh-setup.sh`.

## 3. Rule files (gate files)

These files set the security rules. Agents must not edit them. See `docs/standards/gates.md`.

| File                                 | Purpose                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `.gitleaks.toml`                     | Secret rules and allowlist                                                             |
| `tooling/opengrep/**`                | SAST rules                                                                             |
| `audit-ci.jsonc`                     | Dependency audit policy and allowlist, with reason and expiry per entry                |
| `tooling/license-allowlist.json`     | Allowed licenses: `runtime` (strict), `tooling` (dev only), `_reasons`                 |
| `uv.lock`, `go.sum`                  | Python and Go dependency locks. Changes need a human (see `docs/standards/gates.md`).  |
| `**/.golangci.yml`                   | Go lint rules                                                                          |
| `tooling/python/**`, `tooling/go/**` | Shared Python and Go tool settings                                                     |
| `**/pyproject.toml`                  | Python project and tool settings (`[tool.*]` sections). The whole file is a gate file. |
| `.checkov.yaml`                      | IaC scan settings                                                                      |

### 3.1 Dependency audit and license policy

Human decision, 2026-10-22. Agents must not change it.

- `rush audit` runs two audit-ci passes. Both must pass. The script prints which pass failed.
  - Pass A audits runtime (production) dependencies only. It fails on high or critical. `tooling/*` projects never ship, so pass A drops them from a temp copy of the lockfile before it applies `--skip-dev`.
  - Pass B audits all dependencies, including dev and tooling. It fails on critical only.
- The `allowlist` in `audit-ci.jsonc` stays empty. High advisory GHSA-vfj7-8cjw-p6xm (braces) has no patch. It is reachable only through dev lint tooling (`@next/eslint-plugin-next`, `fast-glob`, `micromatch`, `braces`). The split policy covers it.
- `rush license-check` uses the strict `runtime` list for production dependencies of shipping projects (`packages/`, `projects/`, `platform/`). It uses `runtime` plus `tooling` for dev-only dependencies and for `tooling/*`.
- `LGPL-3.0-only` and `CC-BY-3.0` are tooling-only licenses. Each has a reason and a date in `_reasons` in `tooling/license-allowlist.json`.
- `MIT-0` and `PSF-2.0` are allowed for runtime dependencies (decision of 2026-10-22). `aws-lambda-powertools` uses MIT-0. `typing_extensions` uses PSF-2.0.
- A named runtime exception is an entry in `excludePackages`, with a reason and an expiry date in `_reasons`. There are two: `caniuse-lite@1` (CC-BY-4.0) and `certifi@2026` (MPL-2.0, expires 2027-10-22). The entry `name@major` excludes one major version only.
- The `lint` phase of a project runs the Python and Go license checks (`pip-licenses`, `go-licenses`) of each part against the same file.

## 4. Dependency process

Use this process to add a dependency.

1. The agent runs `rush add -p <package>`. Do not use `npm`, `pnpm add`, or `pnpm install`.
   - A version text must be a registry range or a tag. A URL, a git source, a tarball, or an `npm:` alias fails.
2. The pre-push hook runs the license checks when a lock or the license policy changed.
   - The audits run nightly (planned in CI) or with `bash scripts/gates/local-gates.sh --audit-only`.
   - The automatic policy in `docs/standards/gates.md` section 6.6 runs before the merge. A failed check stops the agent.
3. CI posts the new-dependency report on the PR.
4. Check the report. Check the license, the age, the weekly downloads, and the maintainers.
5. A code owner approves the merge. The agent does not need a human approval for a new dependency that passes the policy.

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

- Do not commit a `.env` file. The pre-commit hook blocks it.
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
- Do not run `cdk deploy` or `cdk destroy` from a laptop. The guard hook blocks it.
- Use OIDC roles in CI. Do not use long-lived AWS keys.

## 8. Python and Go notes

- Opengrep, gitleaks, TruffleHog, and OSV-Scanner cover Python and Go. Their rule sets include Python and Go rules, and their lockfile scans include `uv.lock` and `go.sum`.
- The license allowlist in `tooling/license-allowlist.json` applies to Python and Go dependencies too.
- Python and Go tools come from `uv.lock` and the Go module files. Do not install them globally for a gate.
