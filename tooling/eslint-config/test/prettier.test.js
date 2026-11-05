import { ESLint } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import { describe, expect, it } from 'vitest';

import { base, boundaries, cdk, createRootConfig, next, node, react, test } from '../src/index.js';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;

// Real file types. calculateConfigForFile reads no file, so the paths need not exist.
const FILES = [
  'projects/sample/src/api/routes.ts',
  'projects/sample/web/app/page.tsx',
  'projects/sample/lib/sample-stack.ts',
  'projects/sample/test/routes.test.ts',
];

// Rules that eslint-config-prettier turns off. A special rule such as `curly` is off here too.
const OFF_RULES = Object.entries(prettierConfig.rules)
  .filter(([, setting]) => setting === 0 || setting === 'off')
  .map(([ruleId]) => ruleId);

/**
 * Lists the rules from OFF_RULES that a config turns on for one file.
 *
 * @param {import('eslint').Linter.Config[]} config - Flat config array.
 * @param {string} file - Repo-relative file path.
 * @returns {Promise<string[]>} Rule IDs that are on.
 */
async function enabledPrettierRules(config, file) {
  const eslint = new ESLint({ cwd: REPO_ROOT, overrideConfigFile: true, overrideConfig: config });
  const resolved = await eslint.calculateConfigForFile(`${REPO_ROOT}${file}`);
  const rules = resolved?.rules ?? {};
  return OFF_RULES.filter((ruleId) => {
    const setting = rules[ruleId];
    const severity = Array.isArray(setting) ? setting[0] : setting;
    return severity !== undefined && severity !== 0 && severity !== 'off';
  });
}

// Each shared config comes last once. The block must still win.
const SHARED_CONFIGS = { base, boundaries: boundaries(), cdk, next, node, react, test };
const ORDERS = Object.entries(SHARED_CONFIGS).map(([name, last]) => ({
  name: `${name} last`,
  config: [
    ...Object.values(SHARED_CONFIGS)
      .filter((config) => config !== last)
      .flat(),
    ...last,
  ],
}));

describe('eslint-config-prettier guard', () => {
  it('has rules to check', () => {
    expect(OFF_RULES).toContain('max-len');
    expect(OFF_RULES).toContain('curly');
  });

  it.each(FILES)('createRootConfig leaves no Prettier rule on for %s', async (file) => {
    const config = createRootConfig({ rootPath: REPO_ROOT });

    expect(await enabledPrettierRules(config, file)).toStrictEqual([]);
  });

  describe.each(ORDERS)('$name', ({ config }) => {
    it.each(FILES)('leaves no Prettier rule on for %s', async (file) => {
      expect(await enabledPrettierRules(config, file)).toStrictEqual([]);
    });
  });
});
