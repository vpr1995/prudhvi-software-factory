---
name: e2e-verify
description: Run the end-to-end checks for changed web and api parts with rush e2e, run the Bruno collections with bru run, check Playwright failure traces, and run cdk synth plus a read-only cdk diff for changed infra including platform/infra. Use when asked to run the app, confirm a change in the real app, run e2e, or check a route or stack end to end. Triggers include e2e, playwright, bruno, bru run, trace, check the running app, cdk diff.
---

# e2e-verify

Alias (define it in every Bash call): `rush() { node "$(git rev-parse --show-toplevel)/common/scripts/install-run-rush.js" "$@"; }`

Rules: use localhost by default. Use a deployed URL only for a project stack that you deployed in step 7. Never call a production URL. The checks run through `rush e2e`, so CI runs the same commands.

## Steps

1. Run `mkdir -p .claude/state`.
2. Build the impacted parts and all their dependencies, then run `rush e2e` for the impacted parts:
   `rush build --from git:origin/main > .claude/state/e2e-output.log 2>&1 && rush e2e --impacted-by git:origin/main >> .claude/state/e2e-output.log 2>&1; echo "exit=$?"; tail -n 120 .claude/state/e2e-output.log`
   `--impacted-by` does not select the dependencies of the changed projects. `rush build --from` builds them, so each dependency has its `dist/` folder, also on a fresh clone.
   If `origin/main` does not exist, use `git:main` in both commands. For one project, run `rush e2e --to @vprprudhvi/<name>`. `--to` also builds the dependencies of the project.
   The project `_phase:e2e` starts the api server on a free port, runs the Bruno folder, and stops the server. It then runs `next start` and Playwright for web.
3. If the e2e run fails, read the first failing request or test in the log. Fix the cause, then run step 2 again.
4. Run the Bruno collections by hand when you need to inspect one API. Start the API with its dev script first, then run:
   `(cd projects/<name>/bruno && npx bru run --env local --env-var baseUrl=http://localhost:<port> --reporter-junit ../../../.claude/state/bruno-<name>.xml)`
   Paste the summary lines.
5. Playwright keeps a trace for each failed test under `projects/<name>/test-results/`. Read the failure output first. Open a trace artifact only when the output does not show the cause. Do not claim a visual pass.
6. For each changed infra app (`projects/<name>` when `bin` or `lib` changed, and `platform/infra`):
   - `(cd <folder> && npx cdk synth --quiet)`
   - `(cd <folder> && npx cdk diff <StackName>)`. This is read-only.
   - If AWS credentials are missing, write "cdk diff not available: <error>" and skip the diff.
   - Report every `Replacement` and every `destroy` line. A platform diff needs human review.
7. Optional: when the change needs a real API (for example a new route behind the authorizer), deploy the project stack as root CLAUDE.md rule 4 allows: `(cd projects/<name> && npx cdk deploy <StackName>)`. Never deploy `platform/infra`. Run the Bruno collection with `--env-var baseUrl=<stack output ApiUrl>` and a token from an env var. Paste the summary lines.
8. Report. Paste the exit codes, the rush e2e summary, the Bruno summary, the trace findings, the cdk diff summary, and the deploy result if you deployed.

## Done when

- [ ] `rush e2e` exits 0 for the impacted parts, and the output is pasted.
- [ ] Every changed Bruno collection runs with no failed assertion.
- [ ] Each failed Playwright test has its cause read from the output or trace.
- [ ] `cdk synth` passes for each changed infra app. The diff is pasted or marked not available.

## Do not

- Run `cdk deploy` only as root CLAUDE.md rule 4 allows. Never run `cdk destroy`.
- Call a production URL, or a deployed URL of a stack that you did not deploy.
- Skip a failing Playwright test, or mark it `test.skip` or `test.fixme`.
- Run a Bruno request with no assertion, or put a secret value in a command or an env file. Read secrets from env vars.
- Skip, delete, or weaken tests. Do not add `.skip`, `.only`, or `.todo`. Playwright: no `test.skip` or `test.fixme`. Bruno: no request without an assertion.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`.
- Run `npm install` or `pnpm install`.
- Use `--no-verify`.
