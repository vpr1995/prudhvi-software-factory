# Reviewer evals

This folder holds cases for the AI reviewer. Each case is a real bug from a PR, a revert, or an incident. The reviewer must find the bug class in each case.

## Purpose

- Check that `REVIEW.md` and the review templates find known bug classes.
- Stop a bug class from coming back after a fix.
- Measure a change to the review rules before the change merges.

## Files

| Path               | Purpose                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `README.md`        | This file.                                                         |
| `case-template.md` | Template for a new case.                                           |
| `cases/*.md`       | One case per file. Use `cases/.gitkeep` to keep the folder in Git. |

## Add a case

Use the `incident-to-eval` skill, or follow these steps.

1. Copy `case-template.md` to `cases/<short-kebab>.md`.
2. Fill in the PR link, the buggy diff, the bug location, and the bug class.
3. Write the expected finding. Name the severity and the file and line.
4. Link the fix PR.
5. Open a PR. The case is a test file, so it is `risk:low`. The `REVIEW.md` changes it tests are a separate PR.

## Run the evals

The nightly workflow (`nightly.yml`) runs the cases. Each case passes when the reviewer reports the expected bug class at the expected file and line. A case fails when the reviewer misses the bug or reports a false claim named in the case.

## Rules

- Keep each case to the smallest diff that shows the bug.
- Do not edit a case to make the reviewer pass. Fix the reviewer rules or the review template instead, in a PR that a human approves.
- Remove a case only when the code it tests no longer exists. Write the reason in the PR.
