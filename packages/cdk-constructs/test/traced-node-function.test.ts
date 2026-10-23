import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { DockerImage } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BUNDLE_PACKAGE_JSON_MARKER,
  CDK_NODEJS_MODULE,
  ESBUILD_COMMAND,
  NODE_RUNTIME,
  TracedNodeFunction,
  bundlePackageJsonCommands,
  bundlePackageJsonHooks,
  esbuildBundlingEnvironment,
  resolveBundleRoots,
  resolveFrom,
} from '../src/traced-node-function.js';

import { captureAssetCall } from './support/assets.js';
import { PATHS, newStack, nodeProps } from './support/functions.js';

const folders: string[] = [];

/** Makes an empty temporary folder. The name has a space and a quote, to test the quoting. */
function newFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "bundle root's ")));
  folders.push(folder);
  return folder;
}

/**
 * Adds a fake esbuild package to `node_modules` of a folder. Its command prints `FAKE` and fails.
 *
 * @returns The folder of the fake `esbuild` command.
 */
function addFakeEsbuild(folder: string): string {
  const binFolder = join(folder, 'node_modules', 'esbuild', 'bin');
  mkdirSync(binFolder, { recursive: true });
  writeFileSync(
    join(folder, 'node_modules', 'esbuild', 'package.json'),
    '{"name":"esbuild","version":"0.0.0","bin":{"esbuild":"bin/esbuild"}}\n',
  );
  writeFileSync(join(binFolder, 'esbuild'), '#!/bin/sh\necho FAKE\nexit 1\n', { mode: 0o755 });
  return binFolder;
}

/**
 * Adds an esbuild package that exports nothing to `node_modules` of a folder, so no request into
 * it resolves. A folder with no esbuild at all does not work for this: the pnpm `.bin` shims set
 * `NODE_PATH` to the hoisted `node_modules` folder, so Node still finds an esbuild there.
 */
function addUnresolvableEsbuild(folder: string): void {
  mkdirSync(join(folder, 'node_modules', 'esbuild'), { recursive: true });
  writeFileSync(
    join(folder, 'node_modules', 'esbuild', 'package.json'),
    '{"name":"esbuild","version":"0.0.0","exports":{}}\n',
  );
}

/** Makes a bundle root with a lock file, a copy of the fixture handler and an esbuild package. */
function newBundleRoot(esbuild: 'fake' | 'unresolvable' = 'fake'): {
  readonly folder: string;
  readonly entry: string;
  readonly lockFile: string;
  readonly binFolder: string;
} {
  const folder = newFolder();
  const entry = join(folder, 'handler.ts');
  const lockFile = join(folder, 'pnpm-lock.yaml');
  copyFileSync(PATHS.nodeEntry, entry);
  writeFileSync(lockFile, "lockfileVersion: '9.0'\n");
  if (esbuild === 'unresolvable') {
    addUnresolvableEsbuild(folder);
    return { folder, entry, lockFile, binFolder: '' };
  }
  return { folder, entry, lockFile, binFolder: addFakeEsbuild(folder) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** Reads the handler of the one function in the stack. */
function handlerOf(stack: ReturnType<typeof newStack>): unknown {
  const [resource] = Object.values(
    Template.fromStack(stack).findResources('AWS::Lambda::Function'),
  );
  return (resource?.['Properties'] as Record<string, unknown> | undefined)?.['Handler'];
}

describe('TracedNodeFunction', () => {
  it('runs on Node.js 24', () => {
    expect(NODE_RUNTIME).toBe(Runtime.NODEJS_24_X);
  });

  it('points the handler at the exported name in the bundle file index.mjs', () => {
    const stack = newStack();
    new TracedNodeFunction(stack, 'Api', nodeProps());

    expect(handlerOf(stack)).toBe('index.handler');
  });

  it('takes the handler name from the props', () => {
    const stack = newStack();
    new TracedNodeFunction(stack, 'Api', { ...nodeProps(), handler: 'main' });

    expect(handlerOf(stack)).toBe('index.main');
  });

  it('bundles with esbuild as an ES module with source maps for Node.js 24', () => {
    const [directory, options] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', nodeProps());
    });
    const command = (options?.bundling?.command ?? []).join(' ');

    expect(directory).toBe(PATHS.nodeProjectRoot);
    expect(command).toContain("'--format=esm'");
    expect(command).toContain("'--sourcemap'");
    expect(command).toContain("'--target=node24'");
    expect(command).toContain("'--outfile=/asset-output/index.mjs'");
    expect(command).toContain("'--main-fields=module,main'");
    expect(command).toContain('--banner:js=import { createRequire as __createRequire }');
    expect(command).toContain('__createRequire(import.meta.url)');
  });

  it('turns on source maps at run time, and lets the caller set NODE_OPTIONS', () => {
    const variables = (stack: ReturnType<typeof newStack>): unknown => {
      const [resource] = Object.values(
        Template.fromStack(stack).findResources('AWS::Lambda::Function'),
      );
      return (resource?.['Properties'] as { Environment: { Variables: unknown } }).Environment
        .Variables;
    };
    const first = newStack();
    new TracedNodeFunction(first, 'Api', nodeProps());
    const second = newStack();
    new TracedNodeFunction(second, 'Api', nodeProps({ environment: { NODE_OPTIONS: '--x' } }));

    expect(variables(first)).toMatchObject({ NODE_OPTIONS: '--enable-source-maps' });
    expect(variables(second)).toMatchObject({ NODE_OPTIONS: '--x' });
  });

  it('bundles on this machine first', () => {
    const [, options] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', nodeProps());
    });

    expect(options?.bundling?.local).toBeDefined();
  });

  it('keeps the format and the source map when the caller passes more settings', () => {
    const [, options] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', {
        ...nodeProps(),
        bundling: { externalModules: ['sharp'], minify: true },
      });
    });
    const command = (options?.bundling?.command ?? []).join(' ');

    expect(command).toContain("'--external:sharp'");
    expect(command).toContain("'--minify'");
    expect(command).toContain("'--format=esm'");
    expect(command).toContain("'--sourcemap'");
  });

  it('lets the caller replace the banner', () => {
    const [, options] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', {
        ...nodeProps(),
        bundling: { banner: '/* custom */' },
      });
    });
    const command = (options?.bundling?.command ?? []).join(' ');

    expect(command).toContain('/* custom */');
    expect(command).not.toContain('createRequire');
  });

  it('needs a lock file inside the project root', () => {
    const stack = newStack();

    expect(
      () =>
        new TracedNodeFunction(stack, 'Api', {
          ...nodeProps(),
          projectRoot: PATHS.nodeProjectRoot.concat('/packages/cdk-constructs/test/fixtures'),
        }),
    ).toThrow(/should be under projectRoot/);
  });
});

describe('TracedNodeFunction bundle root', () => {
  /** Runs one hook command with bash in `cwd`, the same way that local bundling runs it. */
  function run(command: string, cwd: string): void {
    execFileSync('bash', ['-c', command], { cwd, stdio: 'pipe' });
  }

  it('defaults the bundle root to this repo root and the lock file to the Rush lock file', () => {
    expect(resolveBundleRoots({})).toStrictEqual({
      projectRoot: PATHS.nodeProjectRoot,
      depsLockFilePath: PATHS.lockFile,
    });

    const [directory] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', nodeProps());
    });

    expect(directory).toBe(PATHS.nodeProjectRoot);
  });

  it('uses the Rush lock file by default when the bundle copies node_modules', () => {
    const [, options] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', {
        ...nodeProps(),
        bundling: { nodeModules: ['constructs'] },
      });
    });
    const command = (options?.bundling?.command ?? []).join(' ');

    expect(command).toContain('/asset-input/common/config/rush/pnpm-lock.yaml');
  });

  it('lets an override win, and defaults only the missing value', () => {
    const { folder, entry, lockFile } = newBundleRoot();

    expect(resolveBundleRoots({ projectRoot: folder, depsLockFilePath: lockFile })).toStrictEqual({
      projectRoot: folder,
      depsLockFilePath: lockFile,
    });
    expect(resolveBundleRoots({ projectRoot: folder })).toStrictEqual({
      projectRoot: folder,
      depsLockFilePath: PATHS.lockFile,
    });
    expect(resolveBundleRoots({ depsLockFilePath: lockFile })).toStrictEqual({
      projectRoot: PATHS.nodeProjectRoot,
      depsLockFilePath: lockFile,
    });

    const [directory] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', {
        ...nodeProps(),
        entry,
        projectRoot: folder,
        depsLockFilePath: lockFile,
      });
    });

    expect(directory).toBe(folder);
  });

  it('adds the package.json first and removes it last, around the hooks of the caller', () => {
    const [, options] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', {
        ...nodeProps(),
        bundling: {
          commandHooks: {
            beforeBundling: () => ['echo CALLER_BEFORE'],
            beforeInstall: () => ['echo CALLER_INSTALL'],
            afterBundling: () => ['echo CALLER_AFTER'],
          },
        },
      });
    });
    const command = (options?.bundling?.command ?? []).join(' ');
    const { create, remove } = bundlePackageJsonCommands('/asset-input');
    const positions = [create, 'echo CALLER_BEFORE', 'esbuild', 'echo CALLER_AFTER', remove].map(
      (part) => command.indexOf(part),
    );

    expect(positions).not.toContain(-1);
    expect(positions).toStrictEqual(positions.toSorted((a, b) => a - b));
  });

  it('keeps the beforeInstall hook of the caller, and adds only its own steps without one', () => {
    const caller = bundlePackageJsonHooks({
      beforeBundling: () => ['echo CALLER_BEFORE'],
      beforeInstall: (inputDirectory) => [`echo install ${inputDirectory}`],
      afterBundling: () => ['echo CALLER_AFTER'],
    });
    const own = bundlePackageJsonHooks();
    const { create, remove } = bundlePackageJsonCommands('/in');

    expect(caller.beforeBundling('/in', '/out')).toStrictEqual([create, 'echo CALLER_BEFORE']);
    expect(caller.beforeInstall('/in', '/out')).toStrictEqual(['echo install /in']);
    expect(caller.afterBundling('/in', '/out')).toStrictEqual(['echo CALLER_AFTER', remove]);
    expect(own.beforeBundling('/in', '/out')).toStrictEqual([create]);
    expect(own.beforeInstall('/in', '/out')).toStrictEqual([]);
    expect(own.afterBundling('/in', '/out')).toStrictEqual([remove]);
  });

  it('writes an empty package.json while bundling and leaves no file after', () => {
    const folder = newFolder();
    const { create, remove } = bundlePackageJsonCommands(folder);

    run(create, '/');

    expect(JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))).toStrictEqual({});
    expect(existsSync(join(folder, BUNDLE_PACKAGE_JSON_MARKER))).toBe(true);

    run(remove, '/');

    expect(existsSync(join(folder, 'package.json'))).toBe(false);
    expect(existsSync(join(folder, BUNDLE_PACKAGE_JSON_MARKER))).toBe(false);
  });

  it('never changes or removes a package.json that it did not make', () => {
    const folder = newFolder();
    const packageJson = join(folder, 'package.json');
    writeFileSync(packageJson, '{"name":"real"}\n');
    const { create, remove } = bundlePackageJsonCommands(folder);

    run(create, folder);
    run(remove, folder);

    expect(readFileSync(packageJson, 'utf8')).toBe('{"name":"real"}\n');
    expect(existsSync(join(folder, BUNDLE_PACKAGE_JSON_MARKER))).toBe(false);
  });

  it('cleans up the files that a failed bundle left behind', () => {
    const folder = newFolder();
    const { create, remove } = bundlePackageJsonCommands(folder);

    // A failed bundle runs `create` but never `remove`.
    run(create, folder);
    run(create, folder);
    run(remove, folder);

    expect(existsSync(join(folder, 'package.json'))).toBe(false);
    expect(existsSync(join(folder, BUNDLE_PACKAGE_JSON_MARKER))).toBe(false);
  });
});

describe('TracedNodeFunction esbuild', () => {
  /** The `PATH` of the bundling environment of a function. */
  function bundlingPath(props: Parameters<typeof captureAssetCall>[0]): string | undefined {
    const [, options] = captureAssetCall(props);
    return options?.bundling?.environment?.['PATH'];
  }

  it('puts the folder of the esbuild that resolves from the entry first in PATH', () => {
    const { entry, lockFile, folder, binFolder } = newBundleRoot();
    vi.stubEnv('PATH', '/usr/bin:/bin');

    const path = bundlingPath((stack) => {
      new TracedNodeFunction(stack, 'Api', {
        ...nodeProps(),
        entry,
        projectRoot: folder,
        depsLockFilePath: lockFile,
      });
    });

    expect(path).toBe(`${binFolder}${delimiter}/usr/bin:/bin`);
  });

  it('runs the esbuild version that this package pins, from the fixture handler', () => {
    const path = bundlingPath((stack) => {
      new TracedNodeFunction(stack, 'Api', nodeProps());
    });
    const [binFolder] = (path ?? '').split(delimiter);
    const pinned = (
      JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        devDependencies: Record<string, string>;
      }
    ).devDependencies['esbuild'];
    const version = execFileSync(join(binFolder ?? '', 'esbuild'), ['--version'], {
      encoding: 'utf8',
    }).trim();

    expect(binFolder).toMatch(/\/esbuild\/bin$/);
    expect(version).toBe(pinned);
  });

  it('keeps the environment of the caller, with its PATH after the esbuild folder', () => {
    const { entry, binFolder } = newBundleRoot();
    vi.stubEnv('PATH', '/process/bin');

    expect(esbuildBundlingEnvironment(entry, { FOO: 'bar', PATH: '/caller/bin' })).toStrictEqual({
      FOO: 'bar',
      PATH: `${binFolder}${delimiter}/caller/bin`,
    });
    expect(esbuildBundlingEnvironment(entry, { FOO: 'bar' })).toStrictEqual({
      FOO: 'bar',
      PATH: `${binFolder}${delimiter}/process/bin`,
    });
    expect(esbuildBundlingEnvironment(entry)).toStrictEqual({
      PATH: `${binFolder}${delimiter}/process/bin`,
    });
    expect(esbuildBundlingEnvironment(entry, { PATH: '' })).toStrictEqual({
      PATH: `${binFolder}${delimiter}/process/bin`,
    });
  });

  it('sets PATH to the esbuild folder alone when no PATH is set', () => {
    const { entry, binFolder } = newBundleRoot();
    vi.stubEnv('PATH', undefined);

    expect(esbuildBundlingEnvironment(entry)).toStrictEqual({ PATH: binFolder });
  });

  it('passes the environment of the caller to the bundle', () => {
    const [, options] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', {
        ...nodeProps(),
        bundling: { environment: { FOO: 'bar' } },
      });
    });

    expect(options?.bundling?.environment).toMatchObject({ FOO: 'bar' });
    expect(options?.bundling?.environment?.['PATH']).toMatch(/\/esbuild\/bin(:|$)/);
  });

  it('fails when no esbuild resolves from the entry, and does not fall back to Docker', () => {
    const { folder, entry, lockFile } = newBundleRoot('unresolvable');

    expect(resolveFrom(entry, ESBUILD_COMMAND)).toBeUndefined();
    expect(
      () =>
        new TracedNodeFunction(newStack(), 'Api', {
          ...nodeProps(),
          entry,
          projectRoot: folder,
          depsLockFilePath: lockFile,
        }),
    ).toThrow(/The esbuild command does not resolve from the entry .*devDependencies/);
  });

  it('fails when aws-cdk-lib cannot resolve esbuild, because CDK would bundle in Docker', () => {
    const { entry, folder } = newBundleRoot();
    const cdkFolder = newFolder();
    addUnresolvableEsbuild(cdkFolder);
    const cdkModule = join(cdkFolder, 'index.js');

    expect(resolveFrom(CDK_NODEJS_MODULE, 'esbuild/package.json')).toBeDefined();
    expect(() => esbuildBundlingEnvironment(entry, {}, cdkModule)).toThrow(
      /aws-cdk-lib cannot resolve esbuild .*Docker/,
    );
    expect(() => esbuildBundlingEnvironment(entry, {}, join(folder, 'index.js'))).not.toThrow();
  });

  it('leaves the environment of the caller as it is when it forces Docker', () => {
    const { folder, entry, lockFile } = newBundleRoot('unresolvable');
    const props = {
      ...nodeProps(),
      entry,
      projectRoot: folder,
      depsLockFilePath: lockFile,
    };
    const dockerImage = DockerImage.fromRegistry('dummy');

    const [, withEnvironment] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', {
        ...props,
        bundling: { forceDockerBundling: true, dockerImage, environment: { FOO: 'bar' } },
      });
    });
    const [, withoutEnvironment] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', {
        ...props,
        bundling: { forceDockerBundling: true, dockerImage },
      });
    });

    expect(withEnvironment?.bundling?.environment).toStrictEqual({ FOO: 'bar' });
    expect(withEnvironment?.bundling?.local).toBeUndefined();
    expect(withoutEnvironment?.bundling?.environment).toBeUndefined();
  });
});
