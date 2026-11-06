---
name: plan-tickets
description: Split an approved, merged design at docs/designs/<slug>/design.md into one parent GitHub issue and one sub-issue for each task row. Scores each task, proposes splits above 5, links blockers, drafts all text for the owner, then creates the issues. Use when asked to plan tickets, create issues from a design, or move a merged design to GATE 3. Triggers include plan tickets, split the design, create the issues, tickets from design, next stage after design review.
---

# plan-tickets

Design source: [design.md](../../../docs/designs/software-factory/design.md) section 6.4. Rules: wiki [Ticket Workflow](https://github.com/vpr1995/prudhvi-software-factory/wiki/Ticket-Workflow) and [Definition of Done](https://github.com/vpr1995/prudhvi-software-factory/wiki/Definition-of-Done).

## Steps

1. Input check. `docs/designs/<slug>/design.md` has `status: approved`, and `git log main --oneline -1 -- docs/designs/<slug>/design.md` prints a line. If not, stop. Point the owner to the design-review skill. Section 1 must have `### Minimal version`. If not, the design is older than the scope rules: stop. Point the owner to the design skill. Get the repo: `gh repo view --json nameWithOwner -q .nameWithOwner`. Duplicate guard: `gh issue list --state all --search "<slug> in:title" --json number,title`. A title that starts with `<slug>:` means stop and ask the owner.
2. Read sections 1, 2 and 8 of `design.md`. One sub-issue for each section 8 task row. Add no task that the table does not have. Do not edit `design.md`. Check the table. Show the output.
   - Each R-ID of section 2 is in at least one task row. Reuse the R-ID `diff` of the design skill step 9.
   - Each task row has at least one R-ID. Each task R-ID exists in section 2.
   - Any failure: stop. Send the owner back to the design-review skill.
   - Resolve each path in the Files cell with the prefix that the section 8 intro gives. No prefix: ask the owner. In Verify cells, resolve `<pkg>` to the package name and `rush` to `node common/scripts/install-run-rush.js`.
   - Owner task: Verify is `manual:` and the task changes no repo file. It gets no size score.
3. Size score for each task. Fixed rubric: same input, same score. Show the breakdown, the raw total and the capped total (minimum 1, maximum 10).
   - 1 point for each layer. Layers by path: contracts = `src/contracts/`. Domain or lib = other `src/` code and `web/lib/`. API route = `src/api/routes/` and the API base files (`server.ts`, `lambda.ts`, auth hook). Web page = `web/app/` and `web/components/`. Infra = `bin/`, `lib/`. Shared = `packages/`, `platform/`, `tooling/`, `.github/`. Tests, Bruno files, README and config files (`package.json`, `wrangler.jsonc`) are not layers. A task with 0 layers gets 1 point.
   - +1 for each R-ID after the 2nd.
   - +1 for each full 4 files in the Files cell. One concrete path or named artifact is 1 file. A directory is 1 file. "Bruno request for each route" is 1 file for each route. Tests count.
   - +2 when Risk is high.
   - Risk: compute the tier from the resolved paths with [risk-tiers.md](../../../docs/standards/risk-tiers.md). Use the higher of the cell and the computed tier. Show each difference. Do not edit `design.md`.
   - Score above 5: propose a split. Split ids: `<id>a`, `<id>b`. Each split task gets its files, its R-IDs, its own Risk and its own score. Each R-ID stays in at least one split task. If an R-ID is in more than one, add `(part: <what this task covers>)` after it in Acceptance. If each split puts 2 tasks on the same file, the owner can keep the task whole: write `Size: <n>, kept whole: <owner reason>` in Notes.
4. Dependencies. Task B is blocked by task A when B needs a file, contract or resource that A creates, or when the design states an order ("before T11"). List direct blockers only. A blocker outside this design with no issue goes in Notes as text: `Blocked by (outside): <what>`. No link, no `blocked` label. You propose. Steps 3 and 4 do not stop.
5. Draft in chat before any `gh` write. Show a summary table first (id, title, raw score, capped score, risk, blocked by). Then the full body of each issue. Use the form headings exactly: `### Context`, `### Acceptance`, `### Risk tier (guess)`, `### Notes`, `### Definition of Done`. The last one holds `- [x] The Definition of Done applies to this ticket.`
   - Parent. Title: the design H1 without a `Design: ` prefix, as `<slug>: <title>`. Context: link `https://github.com/<repo>/blob/main/docs/designs/<slug>/design.md`, the problem in 2 sentences, the Minimal version. Acceptance: one line for each R-ID with the ID only (`- [ ] R-3`), then `- [ ] All sub-issues are closed`. Risk: the highest of the tasks.
   - Sub-issue. Title: `<slug>: <task name>`. Context: Why (one sentence, from the design section that defines the task), link to that section, `Paths:` the Files cell. Acceptance: one line for each R-ID: `- [ ] R-<n>: <EARS text>. Proof: <types>`. Types, comma separated: Vitest test, Bruno request, Playwright spec, CDK assertion test, `manual: <who> <what>`. A route R-ID needs Bruno (root CLAUDE.md rule 10). Risk tier: the final tier. Notes: `Commands:` the Verify cell, `Size: <score> (<breakdown>)`, `Blocked by: <task names>`.
   - Owner task. Title: `<slug>: [owner] <task name>`. Notes: "Owner task. No PR. The owner closes it." No `Size`.
   - GATE: the owner approves scores, splits, dependencies, risk differences and text together. Apply the owner edits. Only then go to step 6. The owner approves here. This replaces "owner writes" for designed work.
6. Create the issues from body files under `/tmp`. Order: parent first, then children in dependency order. Use `gh issue create --title … --body-file …`. Then:
   - Sub-issue link: `gh api -X POST repos/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child database id>`. Get the id with `gh api repos/<repo>/issues/<n> -q .id`.
   - Blocked-by link: `gh api -X POST repos/<repo>/issues/<n>/dependencies/blocked_by -F issue_id=<blocker database id>`. Add the label `blocked` to each child with an open blocker.
   - Board: `gh project item-add 2 --owner vpr1995 --url <issue url>` for each issue.
   - If a call fails: stop. List what exists and what is missing. Do not retry blindly. Do not create duplicates.
7. Report a table: issue number, title, score, blocked by. Tell the owner: add `agent:ready` to each ticket you accept (GATE 3). Never tell the owner to add it to an owner task. The next stage is `/work-ticket`. Do not start it here.

## Done when

- [ ] The score breakdown is shown for each task.
- [ ] Each R-ID of section 2 is in at least one sub-issue.
- [ ] The owner approved the draft text.
- [ ] Each issue URL is shown. The sub-issue and blocked-by links are in place.
- [ ] The links match the approved dependency list.
- [ ] No issue has `agent:ready`.

## Do not

- Add `agent:ready`.
- Edit Acceptance after creation. Ask in a comment (Ticket Workflow rule 3).
- Close issues.
- Write code.
- Edit `design.md` or `brief.md`.
- Create issues before the owner approves the text.
- Never run `cdk deploy` or `cdk destroy` (root CLAUDE.md rule 4).
