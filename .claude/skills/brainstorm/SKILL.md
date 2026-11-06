---
name: brainstorm
description: Turn an idea for an M or L feature into an agreed brief at docs/designs/<slug>/brief.md. Asks open questions, then runs 8 read-only lens reviewers in parallel, then records each finding with an owner decision. Use when asked to brainstorm, explore an idea, or start a new feature that is size M or L. Triggers include brainstorm, new feature idea, explore an idea, M/L feature, I have an idea.
---

# brainstorm

Design source: [design.md](../../../docs/designs/software-factory/design.md) section 6.1.

## Steps

1. Size check. XS (doc, chore, dep bump): ticket only. S (bug fix): ticket and failing test first. For XS and S, stop here. M and L: continue.
2. Ask open questions over several turns: the problem, the users, the constraints, the edge cases, today's workaround, the success measure, the hosting and deploy target, the current stack, existing auth. Ask no multiple choice. Do not propose a solution yet. If a repo doc and the owner disagree, record the owner's answer and name the doc.
3. Readiness gate. State the idea in 3 sentences. The owner confirms. If not, go back to step 2.
4. Pick a kebab-case slug. Write the draft `docs/designs/<slug>/brief.md` with the template below. If `docs/designs/<slug>/` exists, stop and ask the owner.
5. Spawn 8 agents in ONE message, with the Agent tool, `subagent_type: "lens-reviewer"`. One for each lens: YAGNI / contrarian, Cost and quota, UX and developer ergonomics, Migration and backward compatibility, Observability, Tech debt, Security and privacy, Testing and rollout. Security and privacy: `model: "opus"`. Other lenses: the default model.
   Prompt each with only: `Lens: <name>. Brief: <path>. Files: <paths the brief names>.` Send no hypothesis.
   If you cannot spawn agents (you run as a subagent), stop and give your caller the 8 prompts. The caller spawns the lenses and returns each report. Do not simulate a lens.
6. Merge duplicate findings by topic. Each row lists the lens names (with how many raw findings it merges) and the architect's recommended decision. Show the owner each row. The owner decides each one: accept (change the brief), reject (give a reason), open (add `[NEEDS CLARIFICATION]`), or defer (a later version, not this one).
7. Update `brief.md`: fill the lens table. Decision: accept, reject, open, or defer. Give the change or the reason. A deferred row does not become a constraint. Write each accepted change into the brief section it changes. Keep Chosen direction at 3 sentences. Put each open sub-point of an accepted row into Open items.
8. GATE 1: the owner agrees with the brief. Then set `status: approved`. The next stage is design. Do not start it here.

## Brief template

```markdown
---
status: draft
---

# Brief: <title>

## Problem

## Users

## Non-goals

## Constraints

## Chosen direction

<3 sentences>

## Alternatives seen

## Lens findings

| #   | Lenses | Finding | Severity | Decision | Reason or change |
| --- | ------ | ------- | -------- | -------- | ---------------- |

<N> raw findings, <M> rows: <X> accept, <Y> reject, <Z> open, <W> defer.

## Open items

- [NEEDS CLARIFICATION] <question>
```

## Done when

- [ ] The size check is stated.
- [ ] The owner confirmed the 3-sentence idea.
- [ ] 8 lens reviewers ran. Each count line is shown.
- [ ] Each finding has an owner decision in the table.
- [ ] The owner agreed with the brief (GATE 1).

## Do not

- Write `design.md` or code.
- Skip a lens, or run a lens that can write files.
- Ask multiple choice questions in the question phase.
- Send your hypothesis to a lens reviewer.
- Never run `cdk deploy` or `cdk destroy` (root CLAUDE.md rule 4).
