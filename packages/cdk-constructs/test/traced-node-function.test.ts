import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Template } from 'aws-cdk-lib/assertions';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BUNDLE_PACKAGE_JSON_MARKER,
  NODE_RUNTIME,
  TracedNodeFunction,
  bundlePackageJsonCommands,
  bundlePackageJsonHooks,
  resolveBundleRoots,
} from '../src/traced-node-function.js';

import { captureAssetCall } from './support/assets.js';
import { PATHS, newStack, nodeProps } from './support/functions.js';

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
  const folders: string[] = [];

  /** Makes an empty temporary folder. The name has a space and a quote, to test the quoting. */
  function newFolder(): string {
    const folder = mkdtempSync(join(tmpdir(), "bundle root's "));
    folders.push(folder);
    return folder;
  }

  /** Runs one hook command with bash in `cwd`, the same way that local bundling runs it. */
  function run(command: string, cwd: string): void {
    execFileSync('bash', ['-c', command], { cwd, stdio: 'pipe' });
  }

  afterEach(() => {
    for (const folder of folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

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
    const folder = newFolder();
    const entry = join(folder, 'handler.ts');
    const lockFile = join(folder, 'pnpm-lock.yaml');
    copyFileSync(PATHS.nodeEntry, entry);
    writeFileSync(lockFile, "lockfileVersion: '9.0'\n");

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
