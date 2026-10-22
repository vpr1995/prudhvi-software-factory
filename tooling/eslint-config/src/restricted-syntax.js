// `no-restricted-syntax` accepts one option list per file, so exemptions are applied by
// emitting one config block per exempt file group, each with the matching selectors removed.

/** @typedef {{ id: string, selector: string, message: string }} SyntaxRule */

/** @type {readonly SyntaxRule[]} */
export const SHARED_SYNTAX_RULES = [
  {
    id: 'enum',
    selector: 'TSEnumDeclaration',
    message: 'Do not use TypeScript enums. Use an `as const` object and a union type.',
  },
  {
    id: 'process-env',
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message: 'Read `process.env` only in `config.ts`. Parse it once with a Zod schema.',
  },
  {
    id: 'barrel',
    selector: 'ExportAllDeclaration, ExportNamedDeclaration[source]',
    message: 'No barrel files. Re-export only from the package root `src/index.ts`.',
  },
];

export const CONFIG_FILES = ['**/config.{ts,js}', '**/*.config.*'];
export const INDEX_FILES = ['**/src/index.{ts,tsx,js}'];

/**
 * Builds config blocks for `no-restricted-syntax`.
 *
 * @param {readonly SyntaxRule[]} rules - Every rule that applies by default.
 * @param {readonly { files: string[], skip: string[] }[]} exemptions - File groups and the rule ids they skip.
 * @returns {import('eslint').Linter.Config[]} Config blocks.
 */
export function restrictedSyntaxBlocks(rules, exemptions) {
  /**
   * @param {readonly SyntaxRule[]} list - Rules to turn into one rule entry.
   * @returns {['error', ...unknown[]]} The `no-restricted-syntax` entry.
   */
  const toEntry = (list) => [
    'error',
    ...list.map(({ selector, message }) => ({ selector, message })),
  ];
  return [
    { name: 'tooling/restricted-syntax', rules: { 'no-restricted-syntax': toEntry(rules) } },
    ...exemptions.map(({ files, skip }) => ({
      name: `tooling/restricted-syntax/${skip.join('+')}`,
      files,
      rules: { 'no-restricted-syntax': toEntry(rules.filter(({ id }) => !skip.includes(id))) },
    })),
  ];
}
