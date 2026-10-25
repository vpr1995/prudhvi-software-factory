// Gate fixtures for the dependency policy, the commit message and the diff checks (check-gates).
import {
  accepts,
  addDependency,
  commit,
  gateScript,
  rejects,
  removeTracked,
} from './gate-fixtures-kit.mjs';

const COMMITLINT = '{main}/common/autoinstallers/rush-commitlint/node_modules/.bin/commitlint';

/**
 * A commitlint fixture. The message goes on stdin, so no commit (and no git hook) runs.
 *
 * @param {{ id: string, change: string, message: string, control?: boolean }} spec - The fixture.
 * @returns {import('./gate-fixtures-run.mjs').Fixture} The fixture.
 */
function commitlintFixture(spec) {
  return {
    id: spec.id,
    row: spec.control === true ? 'Control' : 'Bad commit message',
    change: spec.change,
    gate: 'commit-msg (commitlint)',
    run: {
      program: COMMITLINT,
      args: ['--config', 'commitlint.config.cjs'],
      input: `${spec.message}\n`,
    },
    // A control has no sentinel: commitlint prints nothing for a good message.
    ...(spec.control === true
      ? { control: true }
      : { expected: rejects([/\[(?:type|subject)-empty\]/], 1) }),
  };
}

export const COMMIT_FIXTURES = [
  commitlintFixture({
    id: 'commitlint-bad-message',
    change: 'a message that is not Conventional Commits',
    message: 'fixed some stuff',
  }),
  commitlintFixture({
    id: 'commitlint-control',
    change: 'a Conventional Commits message',
    message: 'feat(sample): add a thing',
    control: true,
  }),
];

/**
 * A typosquat-check fixture (step b of the local gate runner).
 *
 * @param {{ id: string, row: string, change: string, name: string, version: string, rule: RegExp }} spec - The fixture.
 * @returns {import('./gate-fixtures-run.mjs').Fixture} The fixture.
 */
function dependencyFixture(spec) {
  return {
    id: spec.id,
    row: spec.row,
    change: spec.change,
    gate: 'typosquat-check.mjs (dependency policy)',
    setup: [addDependency(spec.name, spec.version)],
    run: gateScript('typosquat-check.mjs', ['--base', 'HEAD', '--root', '{worktree}']),
    expected: rejects([spec.rule, /projects\/sample\/package\.json/], 1),
  };
}

export const DEPENDENCY_FIXTURES = [
  dependencyFixture({
    id: 'deps-typosquat-name',
    row: 'New rule 2026-10-25: typosquat dependency name',
    change: 'a new dependency named `lodahs`, one letter from `lodash`',
    name: 'lodahs',
    version: '^4.17.21',
    rule: /Possible typosquat: lodahs/,
  }),
  dependencyFixture({
    id: 'deps-git-url-spec',
    row: 'New rule 2026-10-25: git URL dependency spec',
    change: 'a dependency whose version is a GitHub URL',
    name: 'left-pad',
    version: 'github:example/left-pad',
    rule: /a git source is not a registry package/,
  }),
  {
    ...dependencyFixture({
      id: 'deps-control',
      row: 'Control',
      change: 'a popular package with a plain registry version',
      name: 'date-fns',
      version: '^4.1.0',
      rule: /unused/,
    }),
    control: true,
    // The check must pass AND see the new name: a count of 0 names is not a pass of this control.
    expected: accepts([/typosquat-check: pass \([1-9]\d* new dependency names\)/]),
  },
];

export const DIFF_FIXTURES = [
  {
    id: 'check-gates-test-deletion',
    row: 'Delete a test',
    change: 'a committed deletion of a test file',
    gate: 'check-gates.mjs (test-deletion)',
    setup: [
      removeTracked('projects/sample/test/api', '.test.ts'),
      commit('fixture: delete a test'),
    ],
    run: gateScript('check-gates.mjs', [
      '--root',
      '{worktree}',
      '--base',
      '{base}',
      '--head',
      'HEAD',
    ]),
    expected: rejects([/FAIL test-deletion/, /test file deleted/], 1),
  },
];
