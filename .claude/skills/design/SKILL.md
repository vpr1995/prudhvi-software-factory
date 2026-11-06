---
name: design
description: Turn an approved brief into a design at docs/designs/<slug>/design.md, section by section with the owner. Writes EARS requirements with R-IDs, contracts, flag, deploy and rollback, a task plan, and a decision log. Use when asked to design a feature, write design.md, or move an approved brief to the design stage. Triggers include design, write the design, design this feature, design.md, next stage after brainstorm.
---

# design

Design source: [design.md](../../../docs/designs/software-factory/design.md) section 6.2.

## Steps

1. Input: `docs/designs/<slug>/brief.md` with `status: approved`. If it is missing or not approved, stop. Point the owner to the brainstorm skill. If `design.md` exists, stop and ask the owner.
2. Read the brief and its Open items. Read the repo files it names: project contracts, README, config. Read-only research can run in parallel subagents (`subagent_type: "Explore"`). Write only in the main session: this skill is interactive. If you run as a subagent, stop and tell your caller.
3. Copy [template.md](template.md) to `docs/designs/<slug>/design.md`. Keep `status: draft`. Replace each `<slug>` and `<title>`. Delete each `<!-- -->` prompt when you fill its section.
4. Write section by section. Draft one section. Show it. The owner agrees or edits. Then the next section. Do not draft two sections at once. Resolve each brief open item in the section it belongs to. The brief has no Goals: draft them from Chosen direction, and the owner confirms them in section 1. Take the deploy target, stack and auth from the brief Constraints. If they are missing, ask the owner. If the owner cannot decide, write `[NEEDS CLARIFICATION] <question>` there.
5. Requirements use EARS form: `R-<n>: WHEN <trigger> THE SYSTEM SHALL <response>.` Also allowed: `WHILE <state> THE SYSTEM SHALL …` and `IF <condition> THEN THE SYSTEM SHALL …`. Each R-ID is testable. Write an "Unchanged behavior" list.
6. Implementation plan: one row for each task. Give files to create or change, R-IDs covered, the risk tier ([risk-tiers.md](../../../docs/standards/risk-tiers.md)), and one verify command (`rush test --to <pkg>`, `rush e2e`, `rush verify`). Write no code.
7. Decision log: one dated line for each owner decision. Use only decisions the owner made in this session or in the brief. Date brief decisions with the date of the brief approval commit. Replace the placeholder line.
8. Gate. Run `grep -c "NEEDS CLARIFICATION" docs/designs/<slug>/design.md`. It must print 0. Check that the R-IDs of section 2 and section 8 match (no output means they match):
   `f=docs/designs/<slug>/design.md; diff <(sed -n '/^## 2\./,/^## 3\./p' "$f" | grep -o 'R-[0-9]*' | sort -u) <(sed -n '/^## 8\./,/^## 9\./p' "$f" | grep -o 'R-[0-9]*' | sort -u)`
   Each task row has at least one R-ID. Show both outputs. If not clean, fix or ask the owner.
9. The owner agrees with the design. Keep `status: draft`. The next stage is design review. Do not start it here. Do not open the PR here.

## Done when

- [ ] The brief was `status: approved`.
- [ ] The owner agreed with each of the 9 sections.
- [ ] Each brief open item is resolved or marked.
- [ ] `grep -c "NEEDS CLARIFICATION"` output is shown and is 0.
- [ ] Each R-ID is in a task. The check is shown.

## Do not

- Write code or tickets.
- Skip a section. Write "None" with a reason for a section that does not apply.
- Invent an owner decision.
- Draft the next section before the owner agrees with the last one.
- Never run `cdk deploy` or `cdk destroy` (root CLAUDE.md rule 4).
