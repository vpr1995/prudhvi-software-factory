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
    // WARNING: file-scoped security exception. Repo owner decision, 2026-10-22.
    // fs-io.mjs is the one module in the gate scripts that reads and writes files with computed
    // paths. Keep every computed-path fs call in that file. Do not add files to this block
    // without a human review.
    {
      name: 'tooling/exception-gates-fs-io',
      files: ['scripts/gates/lib/fs-io.mjs'],
      rules: { 'security/detect-non-literal-fs-filename': 'off' },
    },
  ];
}
