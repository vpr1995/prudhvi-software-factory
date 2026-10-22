// Zod schemas are PascalCase and end in `Schema`. The inferred type drops the suffix.
// Example: `CreateOrderSchema` and `type CreateOrder = z.infer<typeof CreateOrderSchema>`.

const SCHEMA_NAME = /^[A-Z][A-Za-z0-9]*Schema$/;
const SUFFIX = 'Schema';
const ZOD_ROOTS = new Set(['z', 'zod']);
const SCHEMA_FACTORIES = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'date',
  'object',
  'strictObject',
  'looseObject',
  'array',
  'tuple',
  'record',
  'map',
  'set',
  'union',
  'discriminatedUnion',
  'intersection',
  'enum',
  'nativeEnum',
  'literal',
  'optional',
  'nullable',
  'nullish',
  'lazy',
  'any',
  'unknown',
  'never',
  'void',
  'null',
  'undefined',
  'nan',
  'symbol',
  'custom',
  'instanceof',
  'promise',
  'function',
  'coerce',
  'email',
  'uuid',
  'url',
  'int',
  'templateLiteral',
  'file',
  'json',
  'preprocess',
  'pipe',
  'stringbool',
  'iso',
]);
const NON_SCHEMA_RESULTS = new Set([
  'parse',
  'safeParse',
  'parseAsync',
  'safeParseAsync',
  'spa',
  'isOptional',
  'isNullable',
]);

/**
 * Finds the first `z.<factory>` call in a method chain.
 *
 * @param {import('estree').Node} node - Initializer of a variable.
 * @returns {{ factory: string, lastMethod: string | undefined } | null} The factory name, if the chain is a Zod schema.
 */
function readZodChain(node) {
  /** @type {string | undefined} */
  let lastMethod;
  /** @type {import('estree').Node} */
  let current = node;
  /** @type {string | undefined} */
  let factory;
  while (current.type === 'CallExpression' || current.type === 'MemberExpression') {
    if (current.type === 'CallExpression') {
      current = current.callee;
    } else {
      if (current.property.type === 'Identifier') {
        lastMethod ??= current.property.name;
        factory = current.property.name;
      }
      current = current.object;
    }
  }
  if (current.type !== 'Identifier' || !ZOD_ROOTS.has(current.name) || factory === undefined) {
    return null;
  }
  return { factory, lastMethod };
}

/**
 * ESLint's listener types know only ESTree nodes. TypeScript node listeners are valid at runtime.
 *
 * @param {Record<string, (node: never) => void>} listeners - Node listeners.
 * @returns {import('eslint').Rule.RuleListener} The same listeners with the ESLint type.
 */
function asListener(listeners) {
  return /** @type {import('eslint').Rule.RuleListener} */ (/** @type {unknown} */ (listeners));
}

/** @type {import('eslint').Rule.RuleModule} */
export const zodSchemaNaming = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Name Zod schemas `PascalCaseSchema` and their inferred types without the suffix.',
    },
    schema: [],
    messages: {
      schemaName: 'Zod schema `{{name}}` must be PascalCase and end in `Schema`.',
      inferredName: 'Type inferred from `{{schema}}` must be named `{{expected}}`, not `{{name}}`.',
    },
  },
  create(context) {
    return asListener({
      /** @param {import('estree').VariableDeclarator} node - Declarator. */
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !node.init) {
          return;
        }
        const chain = readZodChain(node.init);
        if (
          chain === null ||
          !SCHEMA_FACTORIES.has(chain.factory) ||
          NON_SCHEMA_RESULTS.has(chain.lastMethod ?? '')
        ) {
          return;
        }
        if (!SCHEMA_NAME.test(node.id.name)) {
          context.report({ node: node.id, messageId: 'schemaName', data: { name: node.id.name } });
        }
      },
      /** @param {import('@typescript-eslint/types').TSESTree.TSTypeAliasDeclaration} node - Type alias. */
      TSTypeAliasDeclaration(node) {
        const reference = node.typeAnnotation;
        if (reference.type !== 'TSTypeReference' || reference.typeName.type !== 'TSQualifiedName') {
          return;
        }
        const { left, right } = reference.typeName;
        if (left.type !== 'Identifier' || !ZOD_ROOTS.has(left.name) || right.name !== 'infer') {
          return;
        }
        const argument = reference.typeArguments?.params[0];
        if (argument?.type !== 'TSTypeQuery' || argument.exprName.type !== 'Identifier') {
          return;
        }
        const schema = argument.exprName.name;
        if (!schema.endsWith(SUFFIX)) {
          return;
        }
        const expected = schema.slice(0, -SUFFIX.length);
        if (node.id.name !== expected) {
          context.report({
            node: node.id,
            messageId: 'inferredName',
            data: { name: node.id.name, schema, expected },
          });
        }
      },
    });
  },
};
