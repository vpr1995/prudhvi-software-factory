import prettierConfig from 'eslint-config-prettier/flat';

/**
 * Turns off every rule that conflicts with Prettier. Put it at the end of each shared config, so
 * no later block can turn a formatting rule back on. Prettier owns formatting.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const prettier = [{ name: 'tooling/prettier', rules: prettierConfig.rules }];
