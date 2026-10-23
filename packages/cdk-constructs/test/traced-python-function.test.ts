import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DockerImage } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { describe, expect, it } from 'vitest';

import {
  PYTHON_DEFAULT_ASSET_EXCLUDES,
  PYTHON_RUNTIME,
  TracedPythonFunction,
} from '../src/traced-python-function.js';
import type { TracedPythonFunctionProps } from '../src/traced-python-function.js';

import { captureAssetCall } from './support/assets.js';
import { PATHS, newStack, pythonProps } from './support/functions.js';

/** A build image that is never used, so no Docker image is built. */
const DUMMY_IMAGE = DockerImage.fromRegistry('dummy');

/** Makes a project folder with `index.py` and the given files. */
function projectWith(...files: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'python-project-'));
  writeFileSync(join(directory, 'index.py'), 'def handler(event, context): ...\n');
  for (const file of files) {
    writeFileSync(join(directory, file), '');
  }
  return directory;
}

/** Returns the bundling command of a function that bundles, as one string. */
function commandFor(props: TracedPythonFunctionProps): string {
  const [, options] = captureAssetCall((stack) => {
    new TracedPythonFunction(stack, 'Api', props);
  });
  return (options?.bundling?.command ?? []).join(' ');
}

describe('TracedPythonFunction', () => {
  it('runs on Python 3.14 and arm64', () => {
    const stack = newStack();
    new TracedPythonFunction(stack, 'Api', pythonProps());

    expect(PYTHON_RUNTIME).toBe(Runtime.PYTHON_3_14);
    expect(
      Object.values(Template.fromStack(stack).findResources('AWS::Lambda::Function')),
    ).toMatchObject([
      { Properties: { Runtime: 'python3.14', Handler: 'index.handler', Architectures: ['arm64'] } },
    ]);
  });

  it('makes the handler path from the index file and the handler name', () => {
    const stack = newStack();
    new TracedPythonFunction(stack, 'Api', {
      ...pythonProps(),
      entry: PATHS.pythonEntry,
      index: 'index.py',
      handler: 'lambda_handler',
    });

    expect(
      Object.values(Template.fromStack(stack).findResources('AWS::Lambda::Function')),
    ).toMatchObject([{ Properties: { Handler: 'index.lambda_handler' } }]);
  });

  it('does not bundle, so it needs no Docker, when the stack does not bundle', () => {
    // `newStack` turns bundling off. The construct must not build a Docker image. The test would
    // fail on a machine with no Docker if it did.
    const stack = newStack();

    expect(() => new TracedPythonFunction(stack, 'Api', pythonProps())).not.toThrow();
  });

  it('keeps virtual environments and caches out of the bundle by default', () => {
    const command = commandFor({ ...pythonProps(), bundling: { image: DUMMY_IMAGE } });

    for (const name of PYTHON_DEFAULT_ASSET_EXCLUDES) {
      expect(command).toContain(`--exclude='${name}'`);
    }
    expect(command).toContain("--exclude='.venv'");
  });

  it('lets the caller replace the excluded names', () => {
    const command = commandFor({
      ...pythonProps(),
      bundling: { image: DUMMY_IMAGE, assetExcludes: ['docs'] },
    });

    expect(command).toContain("--exclude='docs'");
    expect(command).not.toContain('.venv');
  });

  it('installs the locked dependencies with uv when the folder has a uv.lock file', () => {
    const command = commandFor({
      ...pythonProps(),
      entry: projectWith('pyproject.toml', 'uv.lock'),
      bundling: { image: DUMMY_IMAGE },
    });

    expect(command).toContain('uv export --frozen');
    expect(command).toContain('uv pip install -r requirements.txt');
    expect(command).toContain("--exclude='.python-version'");
  });

  it('uses requirements.txt, and not the lock file, when both are in the folder', () => {
    // CDK looks for requirements.txt before uv.lock. A project must not keep both files.
    const command = commandFor({
      ...pythonProps(),
      entry: projectWith('pyproject.toml', 'uv.lock', 'requirements.txt'),
      bundling: { image: DUMMY_IMAGE },
    });

    expect(command).toContain('python -m pip install -r requirements.txt');
    expect(command).not.toContain('uv export');
  });

  it('rejects an index file that is not a Python file', () => {
    expect(
      () => new TracedPythonFunction(newStack(), 'Api', { ...pythonProps(), index: 'index.js' }),
    ).toThrow(/Only Python/);
  });

  it('rejects an index file that does not exist', () => {
    const entry = projectWith();
    mkdirSync(join(entry, 'src'));

    expect(
      () =>
        new TracedPythonFunction(newStack(), 'Api', { ...pythonProps(), entry, index: 'src/x.py' }),
    ).toThrow(/Cannot find index file/);
  });
});
