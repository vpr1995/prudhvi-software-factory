---
name: design-review
description: Review a draft design at docs/designs/<slug>/design.md with 5 read-only fresh agents (comprehension, critic, code fit, readiness, consistency). The owner decides each finding. Then fix design.md and open a design PR with risk:low. Use when asked to review a design, check design.md, or move a design to GATE 2. Triggers include design review, review the design, review design.md, next stage after design.
---

# design-review

Design source: [design.md](../../../docs/designs/software-factory/design.md) section 6.3.

## Steps

1. Input: `docs/designs/<slug>/design.md` with `status: draft`, and its `brief.md` with `status: approved`. If not, stop. Point the owner to the design skill or the brainstorm skill. Run the gate of the design skill (step 9) first:
   `grep -c "NEEDS CLARIFICATION" docs/designs/<slug>/design.md` must print 0.
   `f=docs/designs/<slug>/design.md; diff <(sed -n '/^## 2\./,/^## 3\./p' "$f" | grep -oE 'R-[0-9]+' | sort -u) <(sed -n '/^## 8\./,/^## 9\./p' "$f" | grep -oE 'R-[0-9]+' | sort -u)` must print nothing.
   Show both outputs. If the gate fails, stop. Send the owner back to the design skill.
2. Spawn 5 agents in ONE message, with the Agent tool, `subagent_type: "design-reviewer"`. One for each stage: Comprehension, Critic, Code fit, Readiness, Consistency. Critic: `model: "opus"`. Other stages: the default model.
   Prompt each with only: `Stage: <name>. Design: <path>. Brief: <path>.` For Comprehension, leave out the brief. Send no hypothesis.
   If you cannot spawn agents (you run as a subagent), stop and give your caller the 5 prompts. The caller spawns the agents and returns each report. Do not simulate a stage.
3. Merge duplicate findings by topic. Each row lists the stage names (with how many raw findings it merges) and the recommended decision. Show the table. The Comprehension explanation goes above it. The owner decides each row: fix, reject (give a reason), or defer (a later version, not this one).
4. Fix each accepted finding in `design.md`. The main session writes. The design skill rules apply: EARS form, no code, and the scope check if a requirement changes. Add one dated decision log line for each decision (fix, reject, defer). Rerun the gate from step 1. Show the output.
5. Max 3 review rounds (root CLAUDE.md rule 12). Round 2 and 3 review only the changed sections: add `Sections: <numbers>` to each prompt. After round 3 with open Blockers, stop and ask the owner about the approach.
6. Design PR, when the owner agrees and the gate is clean:
   - Set `status: approved` in `design.md` only now. The owner merging the PR is GATE 2.
   - `git switch -c docs/<slug>-design main`. Commit `docs/designs/<slug>/brief.md` and `design.md` only. Use a `docs(<slug>): add the design` message.
   - Open the PR with the [pr-description](../pr-description/SKILL.md) skill. Label `risk:low`. Do not merge. This PR changes docs only. It overrides pr-description step 3: no verify log. In `## Testing`, paste the gate output and the `node tooling/repo-checks/scripts/doc-lint.mjs` output. Linked issue: `none` (tickets come later). Risk tier: low (`docs/designs/` only).
7. The next stage is tickets. Do not start it here.

## Done when

- [ ] The gate output is shown, before and after the fixes.
- [ ] 5 stages ran. Each count line is shown.
- [ ] Each merged row has an owner decision and a decision log line.
- [ ] The PR URL is shown. The label is `risk:low`. The PR is not merged.

## Do not

- Write code or tickets.
- Edit `brief.md`. If a finding needs a brief change, stop and ask the owner.
- Merge the PR or approve it.
- Skip a stage, or run a stage that can write files.
- Send your hypothesis to a reviewer.
- Set `status: approved` before the owner agrees.
- Never run `cdk deploy` or `cdk destroy` (root CLAUDE.md rule 4).
