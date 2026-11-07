// Deploy revert: decide whether a failed deploy needs a revert PR, and write its text.
//
// The deploy workflow (deploy.yml, job `revert`) runs this after the `cloudflare` job fails. Mode
// `decide <subject>` reads the jobs of the run (`gh run view <run> --json jobs`) on stdin and takes
// the subject of the pushed commit. Output: GITHUB_OUTPUT lines (or stdout when that variable is
// not set): `revert=true|false`, `projects=<names>`, `reason=<why not>`.
//
// Rules (design.md, 6.7: "one revert per commit, never revert a revert"):
// - Only a failed smoke test counts. A failed build or a failed `wrangler deploy` did not change
//   the live site, so there is nothing to revert.
// - A commit that is a revert, or the merge of a revert branch, is never reverted again.
// - One revert PR for each commit. The workflow skips the PR when the branch exists already.
//
// `deploy-revert.mjs title <subject> <body>` prints the title of the revert PR. `deploy-revert.mjs body <sha>
// <projects> <run-url>` prints its body.
//
// Run: gh run view <run-id> --json jobs | node tooling/repo-checks/scripts/deploy-revert.mjs decide "<subject>"
import { pathToFileURL } from 'node:url';

import { githubOutputFile } from './lib/deploy-plan.config.mjs';
import { appendToFile, readStdin } from './lib/fs-io.mjs';

const CLOUDFLARE_JOB = 'cloudflare ';
const SMOKE_STEP = 'Smoke test';
const MERGE_SUBJECT = /^Merge pull request #\d+ /;
// `Revert "..."` (git) or `revert: ...` (the repo convention), or the merge of a revert/<name> branch.
const REVERT_SUBJECT = /^revert\b|^Merge pull request #\d+ from \S*\/revert\//i;

/**
 * @param {{ name: string, conclusion: string | null, steps?: { name: string, conclusion: string | null }[] }[]} jobs - The jobs of the run.
 * @returns {string[]} The projects whose smoke test failed.
 */
export function findSmokeFailures(jobs) {
  return jobs
    .filter(
      (job) =>
        job.name.startsWith(CLOUDFLARE_JOB) &&
        (job.steps ?? []).some((step) => step.name === SMOKE_STEP && step.conclusion === 'failure'),
    )
    .map((job) => job.name.slice(CLOUDFLARE_JOB.length));
}

/** @returns {boolean} True when the commit is a revert, or the merge of a revert branch. */
export function isRevert(subject) {
  return REVERT_SUBJECT.test(subject.trim());
}

/**
 * @param {string} subject - The first line of the commit message.
 * @param {string} body - The rest of the message. A merge commit holds the pull request title there.
 * @returns {string} The title of the revert PR.
 */
export function revertTitle(subject, body) {
  const title = MERGE_SUBJECT.test(subject)
    ? (body.split('\n').find((line) => line.trim() !== '') ?? subject)
    : subject;
  return `revert: ${title.trim()}`;
}

/**
 * @param {string} subject - The first line of the pushed commit.
 * @param {{ name: string, conclusion: string | null, steps?: object[] }[]} jobs - The jobs of the run.
 * @returns {{ revert: boolean, projects: string[], reason: string }} The decision.
 */
export function decide(subject, jobs) {
  const projects = findSmokeFailures(jobs);
  if (projects.length === 0) {
    return {
      revert: false,
      projects,
      reason: 'no smoke test failed (the live site did not change)',
    };
  }
  if (isRevert(subject)) {
    return { revert: false, projects, reason: 'the commit is a revert: never revert a revert' };
  }
  return { revert: true, projects, reason: '' };
}

/** @returns {string[]} The lines for GITHUB_OUTPUT. */
export function outputLines(decision) {
  return [
    `revert=${String(decision.revert)}`,
    `projects=${decision.projects.join(',')}`,
    `reason=${decision.reason}`,
  ];
}

/**
 * @param {{ sha: string, projects: string[], runUrl: string }} input - The failed commit, projects and run.
 * @returns {string} The body of the revert PR.
 */
export function revertBody({ sha, projects, runUrl }) {
  return [
    '## Summary',
    '',
    `The smoke test failed after the deploy of ${sha} for: ${projects.join(', ')}. This PR reverts that commit. Run: ${runUrl}`,
    '',
    '## Linked issue',
    '',
    'None.',
    '',
    '## Testing',
    '',
    'The workflow made this PR with `git revert`. The checks of the PR run like for any other PR.',
    '',
    '## Risk tier',
    '',
    'Set the label to the tier of the original PR (see docs/standards/risk-tiers.md).',
    '',
    '## How to revert',
    '',
    'Revert this PR. Do not revert a revert: fix the cause in a new PR instead.',
    '',
    '## Feature flag',
    '',
    'None.',
    '',
    '## Notes for the owner',
    '',
    'Checks do not start on a PR that GitHub Actions opens. Close and reopen this PR to run them.',
    'Read the failed run first. The smoke test can also fail for a reason that the commit did not cause (a DNS or certificate delay, an outage). Then close this PR and run the failed job again.',
    '',
  ].join('\n');
}

/** Run from the workflow. Return the exit code. */
export function main() {
  const subject = process.argv[3] ?? '';
  const jobs = JSON.parse(readStdin()).jobs ?? [];
  const decision = decide(subject, jobs);
  const lines = `${outputLines(decision).join('\n')}\n`;
  const target = githubOutputFile();
  if (target === '') process.stdout.write(lines);
  else appendToFile(target, lines);
  process.stderr.write(
    `deploy-revert: ${decision.revert ? `revert for ${decision.projects.join(', ')}` : `no revert, ${decision.reason}`}\n`,
  );
  return 0;
}

/** @returns {number} The exit code 1, after a usage message. */
function usage() {
  process.stderr.write(
    'Usage: deploy-revert.mjs decide <subject> | title <subject> <body> | body <sha> <projects> <run-url>\n',
  );
  return 1;
}

/** Print the title or the body of the revert PR. Return the exit code. */
function printText(mode, [first = '', second = '', third = '']) {
  process.stdout.write(
    mode === 'title'
      ? `${revertTitle(first, second)}\n`
      : `${revertBody({ sha: first, projects: second.split(','), runUrl: third })}\n`,
  );
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...rest] = process.argv.slice(2);
  process.exitCode =
    mode === 'decide'
      ? main()
      : mode === 'title' || mode === 'body'
        ? printText(mode, rest)
        : usage();
}
