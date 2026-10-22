## Summary

<!-- One or two sentences. What changes and why. One change per PR. -->

## Linked issue

<!-- Closes #123. Write `none` only if no issue exists and say why. -->

## Testing

<!-- Paste the real output of the commands you ran. Do not write "passes" without output. -->

Commands run:

- [ ] `node common/scripts/install-run-rush.js verify`

Output:

```
<paste output here>
```

## Risk tier

<!-- Choose one: low, medium, or high. Give a reason. See docs/standards/risk-tiers.md. -->

- [ ] low
- [ ] medium
- [ ] high

Reason:

## How to revert

<!-- Steps to undo this change. Name the flag to turn off first, if one exists. See docs/runbooks/rollback.md. -->

## Feature flag

<!-- Flag name from packages/flags. Write `none` if this change adds no user-visible behavior. -->

## Checklist

- [ ] The change does one thing.
- [ ] Each new user-visible behavior sits behind a flag, or the flag field says `none` and why.
- [ ] Each bug fix has a test that fails before the fix.
- [ ] No test was skipped, deleted, or weakened. No lint or type rule was disabled.
- [ ] No gate file changed, or the PR has a human reviewer for it.
- [ ] The commit messages follow Conventional Commits.
- [ ] The diff has no secrets, no `.env` file, and no personal data.
