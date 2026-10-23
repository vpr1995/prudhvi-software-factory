import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';

import { zodSchemaNaming } from '../../src/rules/zod-schema-naming.js';

// eslint types declare describe, it and itOnly but not afterAll.
Object.assign(RuleTester, { afterAll });
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
});

ruleTester.run('zod-schema-naming', zodSchemaNaming, {
  valid: [
    'const CreateOrderSchema = z.object({ id: z.string() });',
    'const NameSchema = z.string().min(1).max(50);',
    "const StatusSchema = z.enum(['open', 'closed']);",
    'const ItemListSchema = z.array(ItemSchema);',
    'const parsed = CreateOrderSchema.parse(input);',
    'const value = z.string().parse(input);',
    'const result = z.string().safeParse(input);',
    'const other = something.object({});',
    'const count = 3;',
    'let declared;',
    'type CreateOrder = z.infer<typeof CreateOrderSchema>;',
    'type Unrelated = z.infer<typeof schema>;',
    'type Input = z.input<typeof CreateOrderSchema>;',
    'type Plain = string;',
    'type Wrapped = Array<string>;',
    'type Dynamic = z.infer<Something>;',
    'type Namespaced = a.b.infer<typeof CreateOrderSchema>;',
    'type Shortcut = infer2<typeof CreateOrderSchema>;',
  ],
  invalid: [
    {
      code: 'const createOrder = z.object({ id: z.string() });',
      errors: [{ messageId: 'schemaName', data: { name: 'createOrder' } }],
    },
    {
      code: 'const CreateOrder = z.object({});',
      errors: [{ messageId: 'schemaName' }],
    },
    {
      code: 'const nameSchema = z.string().min(1);',
      errors: [{ messageId: 'schemaName' }],
    },
    {
      code: 'const order_schema = zod.object({});',
      errors: [{ messageId: 'schemaName' }],
    },
    {
      code: 'type Order = z.infer<typeof CreateOrderSchema>;',
      errors: [
        {
          messageId: 'inferredName',
          data: { name: 'Order', schema: 'CreateOrderSchema', expected: 'CreateOrder' },
        },
      ],
    },
    {
      code: 'type CreateOrderSchemaType = z.infer<typeof CreateOrderSchema>;',
      errors: [{ messageId: 'inferredName' }],
    },
  ],
});
