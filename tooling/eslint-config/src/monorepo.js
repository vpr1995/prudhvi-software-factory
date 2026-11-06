import { base } from './configs/base.js';
import { boundaries } from './configs/boundaries.js';
import { cdk } from './configs/cdk.js';
import { next } from './configs/next.js';
import { node } from './configs/node.js';
import { test } from './configs/test.js';

/**
 * Restricts every block that sets rules to the given directory globs. Blocks that only set
 * `ignores` or `linterOptions` stay global.
 *
 * @param {string[]} directories - Directory globs, for example `projects/*\/web/**`.
 * @param {import('eslint').Linter.Config[]} configs - Shared config blocks.
 * @returns {import('eslint').Linter.Config[]} Scoped blocks.
 */
export function scope(directories, configs) {
  return configs.map((config) => {
    if (!config.rules && !config.plugins && !config.languageOptions && !config.settings) {
      return config;
    }
    const files = config.files
      ? config.files.flatMap((pattern) => directories.map((directory) => [directory, pattern]))
      : directories;
    return { ...config, files };
  });
}

/**
 * Builds the root config. It picks the shared configs by path:
 * web and its tests (`test/web`) get `next`, src, test and scripts get `node`, bin, lib and platform get `node` + `cdk`, and boundaries apply everywhere.
 *
 * @param {{ rootPath: string, ignores?: string[] }} options - `rootPath` is the repo root.
 * @returns {import('eslint').Linter.Config[]} A flat config array.
 */
export function createRootConfig({ rootPath, ignores = [] }) {
  return [
    { name: 'tooling/root-ignores', ignores },
    ...base,
    ...test,
    ...scope(['projects/*/web/**', 'projects/*/test/web/**'], next),
    ...scope(
      [
        'projects/*/src/**',
        'projects/*/test/**',
        'projects/*/scripts/**',
        'packages/**',
        'tooling/**',
        'scripts/**',
        '*.{js,mjs}',
      ],
      node,
    ),
    ...scope(
      ['projects/*/bin/**', 'projects/*/lib/**', 'platform/**', 'packages/cdk-constructs/**'],
      [...node, ...cdk],
    ),
    ...scope(['projects/**', 'platform/**', 'packages/**', 'tooling/**'], boundaries({ rootPath })),
    fsIoException([
      'scripts/security/lib/fs-io.mjs',
      'tooling/tsconfig/scripts/lib/fs-io.mjs',
      'tooling/templates/src/fs-io.js',
      'tooling/eslint-config/scripts/fs-io.mjs',
      'tooling/repo-checks/scripts/lib/fs-io.mjs',
    ]),
    logRedactionTestException,
  ];
}

/**
 * WARNING: file-scoped security exception. Repo owner decision, 2026-10-22.
 * Each fs-io module is the one module of its script that reads or writes files with computed
 * paths (scripts/security, tooling/tsconfig/scripts, tooling/templates,
 * tooling/eslint-config/scripts and tooling/repo-checks/scripts). Keep every computed-path fs call in these files. The root config
 * and the eslint.config.js of tooling/templates and tooling/eslint-config use this block, so the
 * lint runs agree.
 *
 * @param {string[]} files - Paths of the fs-io modules, relative to the config folder.
 * @returns {import('eslint').Linter.Config} The exception block.
 */
export function fsIoException(files) {
  return {
    name: 'tooling/exception-fs-io',
    files,
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
  };
}

/**
 * File-scoped exception. The logger redaction test feeds secret keys to the logger on purpose,
 * to prove that it masks them. The rule `local/no-secret-in-log` stays on everywhere else.
 *
 * @type {import('eslint').Linter.Config}
 */
export const logRedactionTestException = {
  name: 'tooling/exception-log-redaction-test',
  files: ['packages/logger/test/**'],
  rules: { 'local/no-secret-in-log': 'off' },
};
