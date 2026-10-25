// Gate fixtures for the Claude hooks and the secret scan: protect-gates, block-secrets, guard-bash,
// require-verify and gitleaks. The hook wrappers are called the way Claude Code calls them (JSON on
// stdin, CLAUDE_PROJECT_DIR set), with the worktree as the repo. A hook blocks with exit 2.
import {
  accepts,
  append,
  bashHook,
  bashHookThenRun,
  blockFixture,
  commit,
  editHook,
  join,
  rejects,
  replace,
  resetTo,
  rewind,
  sessionBase,
  stage,
  write,
} from './gate-fixtures-kit.mjs';

// Built at run time: the real scanners must not find a key in this source file.
const AWS_KEY = join('AKIA', 'QWERTYUIOPASDFGH');
const GUARD = /BLOCKED by guard-bash/;
const PUSH = 'git push origin HEAD';
const HUMAN = /Gate changes are pushed by a human/;
const GATE_SCRIPT = 'scripts/gates/lib/fs-io.mjs';
const LOCK = 'common/config/rush/pnpm-lock.yaml';
// A gate file (the `tsconfig*.json` rule of gate-files.json) for the human commit of push-after-reset.
const TSCONFIG = 'projects/sample/tsconfig.json';
// A file that is not a gate file, for plain work commits.
const PLAIN_FILE = 'projects/sample/src/api/domain/fixture-other.ts';
// The start of a range with no gate change: the fixture builds its own commits on it.
const CLEAN_BASE = 'origin/main';
const CONTROL_SENTINEL = 'gate-fixtures-control-ran';

/**
 * A guard-bash fixture.
 *
 * @param {{ id: string, row: string, change: string, command: string, match: RegExp[], needs?: string, setup?: Record<string, unknown>[] }} spec - The fixture.
 * @returns {import('./gate-fixtures-run.mjs').Fixture} The fixture.
 */
function guardFixture(spec) {
  return blockFixture({
    id: spec.id,
    row: spec.row,
    change: spec.change,
    gate: 'guard-bash.sh',
    run: bashHook('guard-bash', spec.command),
    match: [GUARD, ...spec.match],
    ...(spec.needs === undefined ? {} : { needs: spec.needs }),
    ...(spec.setup === undefined ? {} : { setup: spec.setup }),
  });
}

/**
 * A require-verify fixture for a push that publishes a gate change.
 *
 * @param {{ id: string, row: string, change: string, setup: Record<string, unknown>[], match: RegExp[], needs?: string }} spec - The fixture.
 * @returns {import('./gate-fixtures-run.mjs').Fixture} The fixture.
 */
function pushFixture(spec) {
  return blockFixture({
    id: spec.id,
    row: spec.row,
    change: spec.change,
    gate: 'require-verify.sh (push range check)',
    setup: spec.setup,
    run: bashHook('require-verify', PUSH),
    match: [HUMAN, ...spec.match],
    ...(spec.needs === undefined ? {} : { needs: spec.needs }),
  });
}

export const EDIT_HOOK_FIXTURES = [
  blockFixture({
    id: 'protect-ci-workflow',
    row: 'Edit `.github/workflows/ci.yml`',
    change: 'a write to the CI workflow file',
    gate: 'protect-gates.sh',
    run: editHook('protect-gates', { tool: 'Write', file: '.github/workflows/ci.yml', text: 'x' }),
    match: [/BLOCKED by protect-gates/, /\.github\/workflows\/ci\.yml/],
  }),
  blockFixture({
    id: 'protect-eslint-config',
    row: 'Edit `tooling/eslint-config`',
    change: 'an edit of the shared ESLint config',
    gate: 'protect-gates.sh',
    run: editHook('protect-gates', {
      tool: 'Edit',
      file: 'tooling/eslint-config/src/index.js',
      text: 'x',
    }),
    match: [/BLOCKED by protect-gates/, /tooling\/eslint-config\/src\/index\.js/],
  }),
  blockFixture({
    id: 'protect-coverage-threshold',
    row: 'Stop after lowering a coverage threshold',
    change: 'an edit of the coverage threshold file',
    gate: 'protect-gates.sh',
    run: editHook('protect-gates', {
      tool: 'Edit',
      file: 'tooling/vitest-config/src/config.ts',
      text: 'lines: 60,',
    }),
    match: [/BLOCKED by protect-gates/, /vitest-config/],
  }),
  blockFixture({
    id: 'block-secrets-aws-key',
    row: 'Put an AWS key in code',
    change: 'a write of a source file with an AWS access key id',
    gate: 'block-secrets.sh',
    run: editHook('block-secrets', {
      tool: 'Write',
      file: 'projects/sample/src/api/domain/fixture-key.ts',
      text: `export const KEY = '${AWS_KEY}';\n`,
    }),
    match: [/BLOCKED by block-secrets/, /aws-access-token/],
  }),
];

export const GUARD_FIXTURES = [
  guardFixture({
    id: 'guard-no-verify',
    row: '`git commit --no-verify` / `git push --force`',
    change: 'a commit that skips the git hooks',
    command: 'git commit -m "x" --no-verify',
    match: [/skip git hooks/],
  }),
  guardFixture({
    id: 'guard-force-push',
    row: '`git commit --no-verify` / `git push --force`',
    change: 'a force push',
    command: 'git push --force origin main',
    match: [/Force push is blocked/],
  }),
  guardFixture({
    id: 'guard-cdk-deploy',
    row: 'Run `cdk deploy` locally',
    change: 'a `cdk deploy` call',
    command: 'cdk deploy --all',
    match: [/cdk deploy changes AWS/],
  }),
  guardFixture({
    id: 'guard-gates-base',
    row: 'New rule 2026-10-25: `GATES_BASE`',
    change: 'a command with `GATES_BASE=x` in front of it',
    command: 'GATES_BASE=x git status',
    match: [/GATES_BASE/],
  }),
  guardFixture({
    id: 'guard-copy-into-state',
    row: 'New rule (agent B): a copy tool plants `.claude/state/last-verify.json`',
    change:
      'a `ditto` copy into `.claude/state` (only the extractor rule of agent B reads `ditto`)',
    command: 'ditto /tmp/x .claude/state',
    match: [/ditto writes into \.claude\/state/],
    needs: 'B',
  }),
  {
    id: 'guard-control',
    row: 'Control',
    change: 'a read-only git command (the hook allows it, then it runs and prints a sentinel)',
    gate: 'guard-bash.sh',
    run: bashHookThenRun('guard-bash', `git status && echo ${CONTROL_SENTINEL}`),
    control: true,
    expected: accepts([new RegExp(`^${CONTROL_SENTINEL}$`, 'm')], [/BLOCKED/]),
  },
];

export const VERIFY_FIXTURES = [
  blockFixture({
    id: 'require-verify-no-state',
    row: '`gh pr create` without a passing verify on the current tree',
    change: 'a `gh pr create` call on a plain commit when no verify has passed',
    gate: 'require-verify.sh',
    // The fixture builds its own commit on origin/main, so the range holds no gate change and the
    // push range check cannot answer first, even when HEAD of the main tree has a gate commit.
    setup: [
      resetTo(CLEAN_BASE),
      write(PLAIN_FILE, 'export const VALUE = 1;\n'),
      commit('fixture: plain work'),
    ],
    run: bashHook('require-verify', 'gh pr create --fill'),
    match: [/needs a passing verify/],
  }),
  pushFixture({
    id: 'push-lock-with-tarball',
    row: 'New rule 2026-10-25: hand-edited pnpm lock with a tarball resolution',
    change: 'a committed lock change whose resolution is a tarball URL',
    setup: [
      replace(
        LOCK,
        /resolution: \{integrity: sha512-[^}]+\}/,
        'resolution: {tarball: https://example.invalid/package.tgz}',
      ),
      commit('fixture: lock with a tarball'),
    ],
    match: [/^- common\/config\/rush\/pnpm-lock\.yaml \(modified\)/m],
  }),
  pushFixture({
    id: 'push-rush-json-removal',
    row: 'New rule 2026-10-25: `rush.json` entry removal',
    change: 'a committed removal of a project entry from `rush.json`',
    setup: [
      replace(
        'rush.json',
        /\n\s*\{\s*"packageName": "@vprprudhvi\/national-parks-tracker"[^}]*\},?/,
        '',
      ),
      commit('fixture: remove a rush project'),
    ],
    match: [/^- rush\.json \(modified\)/m],
  }),
  pushFixture({
    id: 'push-gate-script',
    row: 'Gate change in the push range (an agent does not push it)',
    change: 'a committed change of a gate script',
    setup: [append(GATE_SCRIPT, '\n// fixture change\n'), commit('fixture: gate script change')],
    match: [/^- scripts\/gates\/lib\/fs-io\.mjs \(modified\)/m],
  }),
  pushFixture({
    id: 'push-after-reset',
    row: 'New rule (agent A): `git reset` past a gate commit (gate integrity)',
    change:
      'a human gate commit H (a tsconfig change) is the session base, then `git reset --hard H~1`, then other work and a push',
    // Built on origin/main, so the push range holds only the plain commit. Only the session base
    // check can find the reverted tsconfig. The session base is H: the session starts after the
    // human commit, and the reset moves HEAD off it. The state file is in the worktree
    // (.claude/state is ignored by git, so the commits do not hold it).
    setup: [
      resetTo(CLEAN_BASE),
      replace(TSCONFIG, /^\{/, '{\n  "compileOnSave": false,'),
      commit('fixture: human gate commit H (tsconfig)'),
      sessionBase(),
      rewind(1),
      write(PLAIN_FILE, 'export const VALUE = 1;\n'),
      commit('fixture: other work'),
    ],
    match: [/projects\/sample\/tsconfig\.json/, /rewound past the session base/],
    needs: 'A',
  }),
];

export const SECRET_FIXTURES = [
  {
    id: 'gitleaks-staged-aws-key',
    row: 'Put an AWS key in code',
    change: 'a staged source file with an AWS access key id',
    gate: 'pre-commit gitleaks (scripts/security/secrets-staged.sh)',
    setup: [
      write('projects/sample/src/api/domain/fixture-key.ts', `export const KEY = '${AWS_KEY}';\n`),
      stage('projects/sample/src/api/domain/fixture-key.ts'),
    ],
    run: { program: 'bash', args: ['scripts/security/secrets-staged.sh'] },
    expected: rejects([/aws-access-token/, /fixture-key\.ts/], 1),
  },
];
