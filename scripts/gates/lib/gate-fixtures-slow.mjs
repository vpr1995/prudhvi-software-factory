// Slow gate fixtures (cdk-nag, run with --slow) and the rows that only CI can prove (listed, not run).
import { join, rejects, replace, vitestRun } from './gate-fixtures-kit.mjs';

const STACK = 'projects/sample/lib/sample-api-stack.ts';
const STACK_TEST = 'test/infra/sample-api-stack.test.ts';
const NAG_TIMEOUT_MS = 600_000;
const IMPORT_LINE = "import { CfnOutput, Stack } from 'aws-cdk-lib';";
const SUPER_LINE = 'super(scope, id, stackProps);';

const IAM_STATEMENTS = [
  SUPER_LINE,
  "const fixtureRole = new fixtureIam.Role(this, 'FixtureRole', {",
  "  assumedBy: new fixtureIam.ServicePrincipal('lambda.amazonaws.com'),",
  '});',
  "fixtureRole.addToPolicy(new fixtureIam.PolicyStatement({ actions: ['*'], resources: ['*'] }));",
].join('\n    ');

const BUCKET_STATEMENTS = [SUPER_LINE, "new fixtureS3.Bucket(this, 'FixtureBucket');"].join(
  '\n    ',
);

/**
 * A cdk-nag fixture. It edits the real stack and runs the real nag test of the project
 * (`has zero AwsSolutions violations`), which needs no build and no AWS call.
 *
 * @param {{ id: string, row: string, change: string, imports: string, statements: string, rule: RegExp }} spec - The fixture.
 * @returns {import('./gate-fixtures-run.mjs').Fixture} The fixture.
 */
function nagFixture(spec) {
  return {
    id: spec.id,
    row: spec.row,
    change: spec.change,
    gate: 'cdk-nag AwsSolutions (project nag test)',
    slow: true,
    setup: [replace(STACK, IMPORT_LINE, spec.imports), replace(STACK, SUPER_LINE, spec.statements)],
    run: vitestRun([STACK_TEST, '-t', 'zero AwsSolutions'], NAG_TIMEOUT_MS),
    expected: rejects([spec.rule, /AwsSolutions/]),
  };
}

export const SLOW_FIXTURES = [
  nagFixture({
    id: 'nag-iam-wildcard',
    row: 'IAM policy with `*` action in CDK',
    change: 'a role with a policy statement that allows every action on every resource',
    imports: "import { aws_iam as fixtureIam, CfnOutput, Stack } from 'aws-cdk-lib';",
    statements: IAM_STATEMENTS,
    rule: /AwsSolutions-IAM5/,
  }),
  nagFixture({
    id: 'nag-s3-bucket',
    row: 'S3 bucket without encryption in CDK',
    change:
      'a bucket with no hardening (the AwsSolutions pack has no encryption rule, because S3 encrypts by default: it flags the missing access logs and SSL rule)',
    imports: "import { aws_s3 as fixtureS3, CfnOutput, Stack } from 'aws-cdk-lib';",
    statements: BUCKET_STATEMENTS,
    rule: /AwsSolutions-S(?:1|10)\b/,
  }),
  {
    id: 'nag-control',
    row: 'Control',
    change: 'the stack as it is',
    gate: 'cdk-nag AwsSolutions (project nag test)',
    slow: true,
    setup: [],
    run: vitestRun([STACK_TEST, '-t', 'zero AwsSolutions'], NAG_TIMEOUT_MS),
    control: true,
  },
];

/**
 * A row that only CI can prove.
 *
 * @param {string} id - Id.
 * @param {string} row - The plan row.
 * @param {string} gate - The CI job.
 * @returns {import('./gate-fixtures-run.mjs').Fixture} The fixture.
 */
function ciRow(id, row, gate) {
  return { id, row, change: 'not planted: no CI yet', gate, ciLater: true };
}

export const CI_LATER_FIXTURES = [
  ciRow(
    'ci-lint',
    'Add `any`, a focused test, an unexplained lint disable, a ts directive comment (the CI half)',
    'CI lint',
  ),
  ciRow(
    'ci-disable-count',
    `Add \`// ${join('eslint-', 'disable')}\` without description (the CI half)`,
    'CI disable-count',
  ),
  ciRow(
    'ci-boundaries',
    'Import `api` from `web` (the dependency-cruiser half)',
    'dependency-cruiser in CI',
  ),
  ciRow('ci-sast', 'Opengrep and njsscan half; AWS key half (TruffleHog)', 'sast.yml'),
  ciRow('ci-deps-cve', 'Add a dep with a known high CVE', 'deps.yml: audit-ci and OSV-Scanner'),
  ciRow('ci-deps-license', 'Add a GPL-licensed dep', 'deps.yml: license check'),
  ciRow('ci-checkov', 'IAM policy with `*` action in CDK (the Checkov half)', 'Checkov in CI'),
  ciRow('ci-rulesets', '`git push --force` (the ruleset half)', 'GitHub rulesets'),
  ciRow(
    'ci-codeowners-label',
    'Edit `.github/workflows/ci.yml` or `tooling/eslint-config` (CODEOWNERS and `risk:high`)',
    'CODEOWNERS and the risk label',
  ),
  ciRow('ci-new-dep', 'Add a new dep at all', 'CODEOWNERS and `risk:high` on the lock file'),
  ciRow(
    'ci-rush-change',
    'Change a published package with no change file',
    '`rush change --verify` (needs a remote)',
  ),
  ciRow('ci-diff-coverage', 'Lower coverage on changed lines', 'diff-coverage check'),
  ciRow(
    'ci-cross-project-import',
    'Import another project from `web` (not possible: one package for each project now)',
    'eslint-plugin-boundaries and dependency-cruiser',
  ),
];
