Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `tooling/**`.

## Scope

- `tooling/**` holds the shared config for ESLint, TypeScript, Vitest, and Opengrep. It also holds the license allowlist.
- This is a high-risk area. A human reviews each change. Agents can edit it.

## When a rule blocks you

1. Read the message. Find the rule and the file.
2. Fix the cause in your code. Do not weaken the rule.
3. If the rule is wrong, stop. Tell the human what is wrong and why.

## How to change a rule

1. Give the reason. Give one example that the rule gets wrong.
2. Put the change in its own PR. A human reviews it.
3. Never lower a threshold. Never add an allowlist entry. Never add a disable comment to pass a check.

## What lives here

- `eslint-config/`: flat config, boundaries, naming, `no-console`, restricted imports.
- `tsconfig/`: presets `base`, `node`, `library` and `web`. They hold all strictness. `scripts/check-tsconfigs.mjs` checks each tsconfig in the repo. See [coding-conventions.md](../docs/standards/coding-conventions.md) (B.18).
- `vitest-config/`: shared config and coverage thresholds (lines 80, branches 75).
- `opengrep/`: SAST rules.
- `license-allowlist.json`: allowed licenses.

## Links

- [security.md](../docs/standards/security.md)
- [testing.md](../docs/standards/testing.md)
- [coding-conventions.md](../docs/standards/coding-conventions.md)
