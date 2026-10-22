# Reviewer case: <short title>

## PR link

<https://github.com/vprprudhvi/projects-monorepo/pull/NNN>

## Buggy diff

Paste the smallest diff that shows the bug. Remove unrelated hunks.

```diff
- old line
+ new line that contains the bug
```

## Bug location

- File: `<path/to/file.ts>`
- Line: `<NNN>`

## Bug class

<One sentence. Name the class, not only the line. Example: "Route reads another user's record without an ownership check.">

## Expected finding

- Severity: Important | Nit | Pre-existing
- File and line: `<path/to/file.ts>:<NNN>`
- Must mention: <the bug class words the reviewer must output>
- Must not mention: <false claims the reviewer must not make>

## Fix

<Name the root cause. Link the fix PR.>

## Notes

<Optional. Why the reviewer missed or caught it. Do not write more than 5 lines.>
