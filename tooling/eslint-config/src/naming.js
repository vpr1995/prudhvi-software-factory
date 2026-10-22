// Naming rules from docs/standards/coding-conventions.md, table A.
// `typed: true` adds selectors that need type information (booleans, string/number constants).

const BOOLEAN_PREFIXES = ['is', 'has', 'should', 'can', 'did', 'will'];

/**
 * Builds the `@typescript-eslint/naming-convention` options.
 *
 * @param {{ typed: boolean, react: boolean }} options - `typed` needs type information; `react` allows PascalCase functions.
 * @returns {import('eslint').Linter.RuleEntry} The rule entry.
 */
export function namingConvention({ typed, react }) {
  const functionFormats = react ? ['camelCase', 'PascalCase'] : ['camelCase'];
  const typedSelectors = typed
    ? [
        {
          // Booleans: is/has/should/can prefix. PascalCase is the format of the part after the prefix.
          selector: ['variable', 'parameter', 'parameterProperty', 'classProperty'],
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: BOOLEAN_PREFIXES,
          leadingUnderscore: 'allow',
        },
        {
          // Module-level string and number constants are UPPER_SNAKE_CASE.
          selector: 'variable',
          modifiers: ['global', 'const'],
          types: ['string', 'number'],
          format: ['UPPER_CASE'],
        },
        {
          selector: 'variable',
          modifiers: ['global', 'const'],
          types: ['function'],
          format: functionFormats,
        },
      ]
    : [];

  return [
    'error',
    {
      selector: 'default',
      format: ['camelCase'],
      leadingUnderscore: 'forbid',
      trailingUnderscore: 'forbid',
    },
    { selector: 'import', format: ['camelCase', 'PascalCase'] },
    { selector: 'variable', format: ['camelCase'], leadingUnderscore: 'allow' },
    // Module-level objects: Zod schemas and `as const` maps are PascalCase, constants UPPER_CASE.
    {
      selector: 'variable',
      modifiers: ['global', 'const'],
      format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
    },
    { selector: 'function', format: functionFormats },
    { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
    {
      selector: 'typeLike',
      format: ['PascalCase'],
      // No I prefix on interfaces and no T prefix on types (T is allowed on type parameters only).
      custom: { regex: '^[IT][A-Z]', match: false },
    },
    { selector: 'typeParameter', format: ['PascalCase'] },
    // React's raw HTML prop: `{ __html: value }`. Flagged separately by react/no-danger.
    { selector: 'objectLiteralProperty', filter: { regex: '^__html$', match: true }, format: null },
    {
      // PascalCase methods are ESLint rule visitors (`VariableDeclarator() {}`) and similar callbacks.
      selector: [
        'objectLiteralProperty',
        'objectLiteralMethod',
        'typeProperty',
        'classProperty',
        'enumMember',
      ],
      format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
      leadingUnderscore: 'allow',
    },
    {
      // Headers, paths and similar keys that need quotes are not renamed.
      selector: ['objectLiteralProperty', 'typeProperty', 'objectLiteralMethod'],
      modifiers: ['requiresQuotes'],
      format: null,
    },
    ...typedSelectors,
  ];
}
