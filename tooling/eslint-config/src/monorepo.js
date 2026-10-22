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
 * web gets `next`, api gets `node`, infra and platform get `node` + `cdk`, and boundaries apply everywhere.
 *
 * @param {{ rootPath: string, ignores?: string[] }} options - `rootPath` is the repo root.
 * @returns {import('eslint').Linter.Config[]} A flat config array.
 */
export function createRootConfig({ rootPath, ignores = [] }) {
  return [
    { name: 'tooling/root-ignores', ignores },
    ...base,
    ...test,
    ...scope(['projects/*/web/**'], next),
    ...scope(['projects/*/api/**', 'packages/**', 'tooling/**', 'scripts/**', '*.{js,mjs}'], node),
    ...scope(
      ['projects/*/infra/**', 'platform/**', 'packages/cdk-constructs/**'],
      [...node, ...cdk],
    ),
    ...scope(['projects/**', 'platform/**', 'packages/**', 'tooling/**'], boundaries({ rootPath })),
  ];
}
