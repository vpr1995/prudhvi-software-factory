Read the root CLAUDE.md first ([../CLAUDE.md](../CLAUDE.md)). This file covers `docs/`.

## Where each document goes

| Content                                                                 | Folder                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Rules for all code (naming, tests, security, Git, gates, risk, tracing) | `docs/standards/`                                                                          |
| How to work in one part (web, api, api-py, api-go, contracts, infra)    | `docs/guides/`                                                                             |
| A decision with its reason                                              | `docs/adr/`                                                                                |
| Steps for an incident or a rollback                                     | `docs/runbooks/`                                                                           |
| Review templates for each part                                          | `docs/templates/`                                                                          |
| An explainer for one slice of code                                      | `docs/explainers/` (use the [explain-area](../.claude/skills/explain-area/SKILL.md) skill) |
| Setup for a new machine                                                 | `docs/onboarding.md`                                                                       |

Put detail here. Keep the root `CLAUDE.md` and the nested `CLAUDE.md` files short. They link to documents in this folder.

## Writing rules (ASD-STE100)

- Use active voice and simple present tense. Write short sentences. Give one instruction in each sentence.
- Use the imperative in procedures. Example: "Run `rush verify`."
- Use one word for one meaning. Use the same word for the same thing in the whole repo.
- Do not use "should", "may", or "ensure". Use "must", "can", "do not", or a plain verb.
- Write full words. Do not use idioms or contractions.
- Put commands, paths, and code in backticks or code blocks. The style rules do not apply to code.
- Link to the source of a rule. Do not copy a rule into a second document.

## ADR format

File: `docs/adr/NNNN-<kebab-title>.md`. Use the next free number. Never reuse a number.

```
# ADR NNNN: <Title>

- Status: Proposed | Accepted | Superseded by ADR NNNN
- Date: YYYY-MM-DD

## Context
## Decision
## Consequences
```

- Context: the problem and the limits.
- Decision: what the team does. Use bullets.
- Consequences: use Positive, Negative, and Open bullets.
- Do not edit an accepted ADR to change the decision. Write a new ADR that supersedes it.

## Who approves

- `docs/standards/coding-conventions.md` is a gate file. Agents do not edit it.
- A human reviews other files in `docs/`. Agents can propose edits in a PR. See [gates.md](standards/gates.md), section 2.2.

## Links

- [onboarding.md](onboarding.md)
- [repo-overview.md](guides/repo-overview.md)
- [observability.md](standards/observability.md)
- [git-workflow.md](standards/git-workflow.md)
