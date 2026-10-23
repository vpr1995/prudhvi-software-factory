// Tests for cdk synth for changed infra (lib/synth-changed.mjs, synth-changed.mjs). The pure parts run
// on tables. The CLI runs against temp git repos with a stub cdk and a stub pnpm: no real synth.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  affectedApps,
  appTriggers,
  buildTsconfigs,
  discoverEnvironments,
  envNames,
  RUSH_PNPM_BIN,
  synthCommand,
} from '../lib/synth-changed.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'synth-changed.mjs');

const SAMPLE_CONFIG = `import { developmentConfig } from './dev.js';
const configs = { dev: developmentConfig, staging: stagingConfig, prod: productionConfig } as const;
export function loadSampleConfig(envName: unknown) { return configs[envName]; }
`;

describe('synth-changed: build tsconfigs', () => {
  it('follows npm run to the -p argument (sample: build:cdk)', () => {
    assert.deepEqual(
      buildTsconfigs(
        { build: 'npm run build:cdk --silent' },
        { scripts: { 'build:cdk': 'tsc -p tsconfig.cdk.json' } },
      ),
      ['tsconfig.cdk.json'],
    );
  });

  it('follows a chain of npm run scripts (platform: build, then _phase:build)', () => {
    assert.deepEqual(
      buildTsconfigs(
        { build: 'npm run build --silent' },
        {
          scripts: {
            build: 'npm run _phase:build',
            '_phase:build': 'tsc --project ./tsconfig.build.json',
          },
        },
      ),
      ['tsconfig.build.json'],
    );
  });

  it('returns nothing for a missing build, a missing script, or a loop', () => {
    assert.deepEqual(buildTsconfigs({}, { scripts: {} }), []);
    assert.deepEqual(buildTsconfigs({ build: 'npm run nope' }, { scripts: {} }), []);
    assert.deepEqual(buildTsconfigs({ build: 'npm run a' }, { scripts: { a: 'npm run a' } }), []);
    assert.deepEqual(buildTsconfigs(null, null), []);
  });
});

describe('synth-changed: affected apps', () => {
  const sample = appTriggers('projects/sample', 'project', ['tsconfig.cdk.json']);
  const other = appTriggers('projects/other', 'project', []);
  const platform = appTriggers('platform/infra', 'platform', ['tsconfig.build.json']);
  const apps = [sample, other, platform];

  /** @type {[string, string[]][]} */
  const table = [
    ['projects/sample/bin/app.ts', ['projects/sample']],
    ['projects/sample/lib/config/dev.ts', ['projects/sample']],
    ['projects/sample/src/api/routes.ts', ['projects/sample']],
    ['projects/sample/src/api-py/app/main.py', ['projects/sample']],
    ['projects/sample/cdk.json', ['projects/sample']],
    ['projects/sample/tsconfig.cdk.json', ['projects/sample']],
    ['projects/sample/package.json', ['projects/sample']],
    ['projects/other/tsconfig.cdk.json', ['projects/other']],
    ['platform/infra/lib/platform-stack.ts', ['platform/infra']],
    ['platform/infra/bin/app.ts', ['platform/infra']],
    ['platform/infra/tsconfig.build.json', ['platform/infra']],
    ['platform/infra/package.json', ['platform/infra']],
    [
      'packages/cdk-constructs/src/http-api.ts',
      ['projects/sample', 'projects/other', 'platform/infra'],
    ],
    [
      'packages/cdk-constructs/package.json',
      ['projects/sample', 'projects/other', 'platform/infra'],
    ],
    ['common/config/rush/pnpm-lock.yaml', ['projects/sample', 'projects/other', 'platform/infra']],
    ['packages/cdk-constructs/test/http-api.test.ts', []],
    ['packages/cdk-constructs/README.md', []],
    ['packages/cdk-constructs/vitest.config.ts', []],
    ['projects/sample/test/sample-api-stack.test.ts', []],
    ['projects/sample/web/app/page.tsx', []],
    ['projects/sample/bruno/health.bru', []],
    ['projects/sample/README.md', []],
    ['projects/sample/tsconfig.json', []],
    ['projects/sample/libx/a.ts', []],
    ['projects/samplex/lib/a.ts', []],
    ['platform/infra/src/a.ts', []],
    ['platform/infra/test/platform-stack.test.ts', []],
    ['packages/logger/src/index.ts', []],
    ['common/config/rush/command-line.json', []],
  ];
  for (const [changed, expected] of table) {
    it(`${changed} -> ${expected.length === 0 ? 'no app' : expected.join(', ')}`, () => {
      assert.deepEqual(
        affectedApps(apps, [changed]).map((entry) => entry.app.folder),
        expected,
      );
    });
  }

  it('lists the paths that hit each app', () => {
    const result = affectedApps(apps, [
      'projects/sample/lib/a.ts',
      'README.md',
      'packages/cdk-constructs/src/b.ts',
    ]);
    assert.deepEqual(result[0]?.paths, [
      'projects/sample/lib/a.ts',
      'packages/cdk-constructs/src/b.ts',
    ]);
    assert.deepEqual(result[2]?.paths, ['packages/cdk-constructs/src/b.ts']);
  });
});

describe('synth-changed: environment names', () => {
  it('reads the keys of the configs object in source order', () => {
    assert.deepEqual(envNames(SAMPLE_CONFIG), ['dev', 'staging', 'prod']);
  });

  it('reads shorthand, quoted and multi-line keys', () => {
    assert.deepEqual(envNames("const configs = {\n  dev,\n  'qa-1': qa,\n  prod: p,\n};"), [
      'dev',
      'qa-1',
      'prod',
    ]);
  });

  it('returns nothing when there is no configs object', () => {
    assert.deepEqual(envNames('export const x = { dev: 1 };'), []);
  });

  describe('discoverEnvironments', () => {
    /** @type {ReturnType<typeof makeRepository>} */
    let repository;
    beforeEach(() => {
      repository = makeRepository();
    });
    afterEach(() => {
      repository.remove();
    });

    it('uses the configs keys when bin reads the env context', () => {
      repository.write(
        'projects/app/bin/app.ts',
        "addStack(app, app.node.tryGetContext('env'));\n",
      );
      repository.write('projects/app/lib/config/config.ts', SAMPLE_CONFIG);
      assert.deepEqual(discoverEnvironments(repository.root, 'projects/app'), [
        'dev',
        'staging',
        'prod',
      ]);
    });

    it('fails when bin reads the env context and no names are found', () => {
      repository.write('projects/app/bin/app.ts', 'app.node.tryGetContext("env");\n');
      assert.throws(
        () => discoverEnvironments(repository.root, 'projects/app'),
        /environment names are unknown/,
      );
    });

    it('synths once with no context when bin does not read env', () => {
      repository.write('projects/app/bin/app.ts', 'new App().synth();\n');
      assert.deepEqual(discoverEnvironments(repository.root, 'projects/app'), [null]);
    });
  });
});

describe('synth-changed: command', () => {
  it('builds an offline quiet synth with Rush pnpm and the app bin first on PATH', () => {
    const command = synthCommand({
      root: '/repo',
      folder: 'projects/sample',
      env: 'staging',
      outDirectory: '/tmp/synth-x',
      path: '/usr/bin:/bin',
    });
    assert.equal(command.program, '/repo/projects/sample/node_modules/.bin/cdk');
    assert.deepEqual(command.args, [
      'synth',
      '--quiet',
      '-c',
      'env=staging',
      '-o',
      '/tmp/synth-x/cdk.out',
    ]);
    assert.equal(command.cwd, '/repo/projects/sample');
    assert.equal(
      command.env.PATH,
      `/repo/${RUSH_PNPM_BIN}:/repo/projects/sample/node_modules/.bin:/usr/bin:/bin`,
    );
    assert.equal(command.env['AWS_ACCESS_KEY_ID'], '');
    assert.equal(command.env['AWS_PROFILE'], '');
    assert.equal(command.env['AWS_EC2_METADATA_DISABLED'], 'true');
    assert.equal(command.env['AWS_CONFIG_FILE'], '/tmp/synth-x/no-aws-config');
    assert.equal(command.env['AWS_SHARED_CREDENTIALS_FILE'], '/tmp/synth-x/no-aws-config');
    assert.equal('AWS_REGION' in command.env, false);
    assert.equal('CDK_DEFAULT_ACCOUNT' in command.env, false);
  });

  it('leaves out -c env when the app takes no env', () => {
    const command = synthCommand({
      root: '/r',
      folder: 'platform/infra',
      env: null,
      outDirectory: '/t',
      path: '',
    });
    assert.deepEqual(command.args, ['synth', '--quiet', '-o', '/t/cdk.out']);
    assert.equal(command.env.PATH, `/r/${RUSH_PNPM_BIN}:/r/platform/infra/node_modules/.bin`);
  });
});

// The stub cdk logs one line for each call: cwd, arguments, first PATH entry, AWS_CONFIG_FILE.
const CDK_STUB = `#!/bin/sh
printf '%s|%s|%s|%s\\n' "$PWD" "$*" "\${PATH%%:*}" "$AWS_CONFIG_FILE" >> "$STUB_LOG"
if [ -n "$STUB_LEFTOVER" ]; then printf '{}' > "$STUB_LEFTOVER"; fi
if [ -n "$STUB_FAIL" ]; then echo "stub cdk: synth error in $PWD" >&2; exit 3; fi
exit 0
`;

/**
 * Makes an executable file in the repo.
 *
 * @param {ReturnType<typeof makeRepository>} repository - The repo.
 * @param {string} name - Path from the repo root.
 * @param {string} text - Content.
 */
function writeExecutable(repository, name, text) {
  repository.write(name, text);
  fs.chmodSync(path.join(repository.root, name), 0o755);
}

/**
 * Commits one file.
 *
 * @param {ReturnType<typeof makeRepository>} repository - The repo.
 * @param {string} name - Path from the repo root.
 */
function commitFile(repository, name) {
  repository.write(name, `export const changed = ${String(Date.now())};\n`);
  repository.git('add', '-A');
  repository.git('commit', '-q', '-m', `change ${name}`);
}

describe('synth-changed CLI (stub cdk)', () => {
  /** @type {ReturnType<typeof makeRepository>} */
  let repository;
  /** @type {string} */
  let base;
  /** @type {string} */
  let log;

  beforeEach(() => {
    repository = makeRepository({
      'projects/app/package.json':
        '{"name":"app","scripts":{"build:cdk":"tsc -p tsconfig.cdk.json"}}\n',
      'projects/app/cdk.json': '{"app":"node dist/cdk/bin/app.js","build":"npm run build:cdk"}\n',
      'projects/app/bin/app.ts': "addStack(app, app.node.tryGetContext('env'));\n",
      'projects/app/lib/config/config.ts':
        'const configs = { dev: developmentConfig, prod: productionConfig } as const;\n',
      'platform/infra/package.json': '{"name":"platform"}\n',
      'platform/infra/cdk.json': '{"app":"node dist/bin/app.js"}\n',
      'platform/infra/bin/app.ts': 'new App().synth();\n',
    });
    writeExecutable(repository, 'projects/app/node_modules/.bin/cdk', CDK_STUB);
    writeExecutable(repository, 'platform/infra/node_modules/.bin/cdk', CDK_STUB);
    writeExecutable(repository, `${RUSH_PNPM_BIN}/pnpm`, '#!/bin/sh\nexit 0\n');
    base = repository.git('rev-parse', 'HEAD').trim();
    log = path.join(repository.root, 'common', 'temp', 'stub-cdk.log');
  });

  afterEach(() => {
    repository.remove();
  });

  /**
   * Runs the CLI.
   *
   * @param {Record<string, string>} [env] - Extra variables.
   * @param {string[]} [args] - Arguments. Default: --base <first commit>.
   * @returns {{ status: number, stdout: string, stderr: string }} Result.
   */
  function synth(env = {}, args = ['--base', base]) {
    return exec('node', [CLI, '--root', repository.root, ...args], {
      // GATES_FULL from the shell of a full gate run must not leak into these tests.
      env: { STUB_LOG: log, GATES_FULL: '', ...env },
    });
  }

  /** @returns {string[][]} The stub calls, each split into cwd, args, first PATH entry, AWS_CONFIG_FILE. */
  function calls() {
    const text = repository.read('common/temp/stub-cdk.log') ?? '';
    return text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split('|'));
  }

  it('prints SKIP for every app when no infra changed, and runs no cdk', () => {
    commitFile(repository, 'projects/app/test/a.test.ts');
    const result = synth();
    assert.equal(result.status, 0, result.stderr);
    const short = base.slice(0, 12);
    assert.ok(
      result.stdout.includes(`synth: SKIP projects/app (no infra change since ${short})`),
      result.stdout,
    );
    assert.ok(
      result.stdout.includes(`synth: SKIP platform/infra (no infra change since ${short})`),
      result.stdout,
    );
    assert.deepEqual(calls(), []);
  });

  it('counts committed changes only, not the working tree', () => {
    repository.write('projects/app/lib/a.ts', 'export const a = 1;\n');
    const result = synth();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /synth: SKIP projects\/app/);
    assert.deepEqual(calls(), []);
  });

  it('synths every env of a changed project app and skips the other app', () => {
    commitFile(repository, 'projects/app/src/api/routes.ts');
    const result = synth();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /synth: PASS projects\/app env=dev \(\d+\.\ds\)/);
    assert.match(result.stdout, /synth: PASS projects\/app env=prod \(\d+\.\ds\)/);
    assert.match(result.stdout, /synth: SKIP platform\/infra/);
    const made = calls();
    assert.equal(made.length, 2);
    for (const [index, env] of ['dev', 'prod'].entries()) {
      const [cwd, args, firstPath, awsConfig] = made[index] ?? [];
      assert.equal(cwd, path.join(repository.root, 'projects/app'));
      assert.ok(args?.startsWith(`synth --quiet -c env=${env} -o `), args);
      assert.match(args ?? '', /^synth --quiet -c env=\w+ -o \S+\/cdk\.out$/);
      assert.equal(firstPath, path.join(repository.root, RUSH_PNPM_BIN));
      const outDirectory = /-o (\S+)\/cdk\.out$/.exec(args ?? '')?.[1] ?? '';
      assert.equal(
        outDirectory.startsWith(repository.root),
        false,
        'the out dir is outside the repo',
      );
      assert.equal(fs.existsSync(outDirectory), false, 'the temp out dir is removed');
      assert.equal(awsConfig, path.join(outDirectory, 'no-aws-config'));
    }
  });

  it('synths every app when packages/cdk-constructs changed, platform once with no env', () => {
    commitFile(repository, 'packages/cdk-constructs/src/http-api.ts');
    const result = synth();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /synth: PASS platform\/infra env=\(none\)/);
    const platformCall = calls().find(([cwd]) => cwd?.endsWith('platform/infra'));
    assert.match(platformCall?.[1] ?? '', /^synth --quiet -o \S+\/cdk\.out$/);
  });

  it('skips every app for a test-only change in packages/cdk-constructs', () => {
    commitFile(repository, 'packages/cdk-constructs/test/http-api.test.ts');
    const result = synth();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /synth: SKIP projects\/app/);
    assert.match(result.stdout, /synth: SKIP platform\/infra/);
    assert.deepEqual(calls(), []);
  });

  it('synths every app when packages/cdk-constructs/package.json changed', () => {
    commitFile(repository, 'packages/cdk-constructs/package.json');
    const result = synth();
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /synth: projects\/app changed: packages\/cdk-constructs\/package\.json/,
    );
    assert.match(result.stdout, /synth: PASS platform\/infra env=\(none\)/);
    assert.equal(calls().length, 3);
  });

  it('forces every app with GATES_FULL=1 when nothing changed', () => {
    const result = synth({ GATES_FULL: '1' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^synth: projects\/app forced \(GATES_FULL=1\)$/m);
    assert.match(result.stdout, /^synth: platform\/infra forced \(GATES_FULL=1\)$/m);
    assert.match(result.stdout, /synth: PASS projects\/app env=dev /);
    assert.match(result.stdout, /synth: PASS projects\/app env=prod /);
    assert.match(result.stdout, /synth: PASS platform\/infra env=\(none\) /);
    assert.doesNotMatch(result.stdout, /SKIP/);
    assert.equal(calls().length, 3);
  });

  it('does not force with a GATES_FULL value other than 1', () => {
    const result = synth({ GATES_FULL: 'true' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /synth: SKIP projects\/app/);
    assert.deepEqual(calls(), []);
  });

  it('fails on the first synth error and shows the cdk output', () => {
    commitFile(repository, 'common/config/rush/pnpm-lock.yaml');
    const result = synth({ STUB_FAIL: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /synth: FAIL projects\/app env=dev \(\d+\.\ds, exit 3\)/);
    assert.match(result.stderr, /stub cdk: synth error in .*projects\/app/);
    assert.equal(calls().length, 1);
  });

  it('fails when a synth leaves a package.json at the repo root', () => {
    commitFile(repository, 'projects/app/lib/a.ts');
    const result = synth({ STUB_LEFTOVER: path.join(repository.root, 'package.json') });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /synth: FAIL after projects\/app env=dev: package\.json at the repo root/,
    );
  });

  it('fails before any synth when a bundle marker is already at the repo root', () => {
    commitFile(repository, 'projects/app/lib/a.ts');
    repository.write('.cdk-bundle-package-json', '');
    const result = synth();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /synth: FAIL before the synth: \.cdk-bundle-package-json/);
    assert.deepEqual(calls(), []);
  });

  it("fails with a clear message when Rush's pnpm is missing", () => {
    commitFile(repository, 'projects/app/lib/a.ts');
    fs.rmSync(path.join(repository.root, RUSH_PNPM_BIN, 'pnpm'));
    const result = synth();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Rush's pnpm is missing at common\/temp\/pnpm-local/);
    assert.deepEqual(calls(), []);
  });

  it('fails when the app has no local cdk', () => {
    commitFile(repository, 'projects/app/lib/a.ts');
    fs.rmSync(path.join(repository.root, 'projects/app/node_modules/.bin/cdk'));
    const result = synth();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /projects\/app\/node_modules\/\.bin\/cdk is missing/);
  });

  it('takes the base from the gates base when --base is not given', () => {
    commitFile(repository, 'projects/app/lib/a.ts');
    const head = repository.git('rev-parse', 'HEAD').trim();
    const result = synth({ GATES_BASE: head }, []);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stderr.includes(`gates: base ${head} (env: GATES_BASE=`), result.stderr);
    assert.match(result.stdout, /synth: SKIP projects\/app/);
  });

  it('exits 2 for a base that is not a commit or a bad argument', () => {
    assert.equal(synth({}, ['--base', 'no-such-ref']).status, 2);
    assert.equal(synth({}, ['--bogus']).status, 2);
  });
});
