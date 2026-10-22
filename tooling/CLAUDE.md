Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `tooling/**`.

## Gate area

- `tooling/**` holds the shared config for ESLint, TypeScript, Vitest, and Opengrep. It also holds the license allowlist.
- This is a gate area. Agents do not edit it. The `protect-gates.sh` hook blocks the edit. Do not bypass the hook.
- Planned: `tooling/python/**` (ruff, mypy, pytest) and `tooling/go/**` (golangci-lint, gofumpt) are gate areas too.

## When a rule blocks you

1. Read the message. Find the rule and the file.
2. Fix the cause in your code. Do not weaken the rule.
3. If the rule is wrong, stop. Tell the human what is wrong and why.

## How to propose a change

1. Write the change as text in your final message. Give the target path, the old rule, and the new rule.
2. Give the reason. Give one example that the rule gets wrong.
3. Ask the human to apply the change. A human opens the PR.
4. Never lower a threshold. Never add an allowlist entry. Never add a disable comment.

For a new project or package, the skills write gate-file contents to `.claude/state/handoff/`. A human copies them. See [new-project](../.claude/skills/new-project/SKILL.md).

## What lives here

- `eslint-config/`: flat config, boundaries, naming, `no-console`, restricted imports.
- `tsconfig/`: base tsconfigs.
- `vitest-config/`: shared config and coverage thresholds (lines 80, branches 75).
- `opengrep/`: SAST rules.
- `license-allowlist.json`: allowed licenses.

## Links

- [gates.md](../docs/standards/gates.md): sections 2 and 6.
- [security.md](../docs/standards/security.md)
- [testing.md](../docs/standards/testing.md)
- [coding-conventions.md](../docs/standards/coding-conventions.md)
