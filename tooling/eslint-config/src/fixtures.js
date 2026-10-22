// Gate fixtures: code that the shared configs must reject (or accept). Used by configs.test.js.
// Each case names a repo-relative path because the rules depend on the path.

const DECLARE_PROCESS =
  'declare const process: { readonly env: Record<string, string | undefined> };\n';

const CLEAN = `/** Adds two numbers. */
export function addNumbers(first: number, second: number): number {
  return first + second;
}
`;

/** @type {readonly { name: string, file: string, code: string, expect: readonly string[] }[]} */
export const CASES = [
  { name: 'clean file passes', file: 'packages/sample/src/clean.ts', code: CLEAN, expect: [] },
  {
    name: 'any',
    file: 'packages/sample/src/any.ts',
    code: 'export const parse = (value: any): unknown => value;\n',
    expect: ['@typescript-eslint/no-explicit-any'],
  },
  {
    name: 'enum',
    file: 'packages/sample/src/enum.ts',
    code: 'export enum Status { Open }\n',
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'default export in a normal file',
    file: 'packages/sample/src/default.ts',
    code: 'const value = 1;\nexport default value;\n',
    expect: ['import-x/no-default-export'],
  },
  {
    name: 'default export in a Next.js page',
    file: 'projects/sample/web/src/app/page.tsx',
    code: '/** Home page. */\nexport default function Page(): null {\n  return null;\n}\n',
    expect: [],
  },
  {
    name: 'snake_case variable',
    file: 'packages/sample/src/snake.ts',
    code: 'export const compute = (): number => {\n  const user_name = 2;\n  return user_name;\n};\n',
    expect: ['@typescript-eslint/naming-convention'],
  },
  {
    name: 'I prefix on a type',
    file: 'packages/sample/src/prefix.ts',
    code: 'export type IUser = { readonly id: string };\n',
    expect: ['@typescript-eslint/naming-convention'],
  },
  {
    name: 'boolean without prefix',
    file: 'packages/sample/src/boolean.ts',
    code: 'export const check = (active: boolean): boolean => active;\n',
    expect: ['@typescript-eslint/naming-convention'],
  },
  {
    name: 'module constant not UPPER_CASE',
    file: 'packages/sample/src/constant.ts',
    code: "export const maxRetry = 'three';\n",
    expect: ['@typescript-eslint/naming-convention'],
  },
  {
    name: 'PascalCase file name',
    file: 'packages/sample/src/UserService.ts',
    code: CLEAN,
    expect: ['unicorn/filename-case'],
  },
  {
    name: '@ts-ignore',
    file: 'packages/sample/src/ignore.ts',
    code: '// @ts-ignore because it is easier\nexport const VALUE: number = "x";\n',
    expect: ['@typescript-eslint/ban-ts-comment'],
  },
  {
    name: '@ts-expect-error without description',
    file: 'packages/sample/src/expect-error.ts',
    code: '// @ts-expect-error\nexport const VALUE: number = "x";\n',
    expect: ['@typescript-eslint/ban-ts-comment'],
  },
  {
    name: 'it.only',
    file: 'packages/sample/src/focus.test.ts',
    code: "import { it } from 'vitest';\n\nit.only('runs', () => {});\n",
    expect: ['vitest/no-focused-tests'],
  },
  {
    name: 'it.skip',
    file: 'packages/sample/src/skip.test.ts',
    code: "import { it } from 'vitest';\n\nit.skip('runs', () => {});\n",
    expect: ['vitest/no-disabled-tests'],
  },
  {
    name: 'test without expect',
    file: 'packages/sample/src/empty.test.ts',
    code: "import { it } from 'vitest';\n\nit('runs', () => {});\n",
    expect: ['vitest/expect-expect'],
  },
  {
    name: 'eslint-disable without description',
    file: 'packages/sample/src/disable.ts',
    code: '// eslint-disable-next-line no-console\nconsole.log(1);\n',
    expect: ['@eslint-community/eslint-comments/require-description'],
  },
  {
    name: 'eslint-disable without a rule',
    file: 'packages/sample/src/disable-all.ts',
    code: '/* eslint-disable -- reason given here */\nexport const VALUE = 1;\n',
    expect: ['@eslint-community/eslint-comments/no-unlimited-disable'],
  },
  {
    name: 'unused eslint-disable',
    file: 'packages/sample/src/unused-disable.ts',
    code: '// eslint-disable-next-line no-console -- not needed here\nexport const VALUE = 1;\n',
    expect: ['(directive)'],
  },
  {
    name: 'TODO without an issue',
    file: 'packages/sample/src/todo.ts',
    code: '// TODO fix this later\nexport const VALUE = 1;\n',
    expect: ['local/todo-with-issue'],
  },
  {
    name: 'TODO with an issue',
    file: 'packages/sample/src/todo-ok.ts',
    code: '// TODO(#12): fix this later\nexport const VALUE = 1;\n',
    expect: [],
  },
  {
    name: 'process.env outside config.ts',
    file: 'projects/sample/api/src/routes/user.ts',
    code:
      DECLARE_PROCESS +
      '/** Reads the key. */\nexport const readKey = (): string | undefined => process.env["KEY"];\n',
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'process.env in config.ts',
    file: 'projects/sample/api/src/config.ts',
    code: DECLARE_PROCESS + 'export const KEY = process.env["KEY"];\n',
    expect: [],
  },
  {
    name: 'console.log',
    file: 'packages/sample/src/console.ts',
    code: 'export const run = (): void => {\n  console.log(1);\n};\n',
    expect: ['no-console'],
  },
  {
    name: 'throw a literal',
    file: 'packages/sample/src/throw.ts',
    code: "export const run = (): never => {\n  throw 'bad';\n};\n",
    expect: ['@typescript-eslint/only-throw-error'],
  },
  {
    name: 'type cast with as',
    file: 'packages/sample/src/cast.ts',
    code: 'export const run = (value: unknown): string => value as string;\n',
    expect: ['@typescript-eslint/consistent-type-assertions'],
  },
  {
    name: 'non-null assertion',
    file: 'packages/sample/src/bang.ts',
    code: 'export const run = (value: string | undefined): string => value!;\n',
    expect: ['@typescript-eslint/no-non-null-assertion'],
  },
  {
    name: 'interface instead of type',
    file: 'packages/sample/src/interface.ts',
    code: 'export interface User { readonly id: string }\n',
    expect: ['@typescript-eslint/consistent-type-definitions'],
  },
  {
    name: 'loose equality',
    file: 'packages/sample/src/equality.ts',
    code: 'export const run = (value: number): boolean => value == 2;\n',
    expect: ['eqeqeq'],
  },
  {
    name: 'lodash import',
    file: 'packages/sample/src/lodash.ts',
    code: "import { map } from 'lodash';\n\nexport const run = map;\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'barrel file',
    file: 'packages/sample/src/utils/barrel.ts',
    code: "export * from './clean.js';\n",
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'barrel at the package root',
    file: 'packages/sample/src/index.ts',
    code: "export { addNumbers } from './clean.js';\n",
    expect: [],
  },
  {
    name: 'commented-out code',
    file: 'packages/sample/src/commented.ts',
    code: '// const total = compute(1, 2);\nexport const VALUE = 1;\n',
    expect: ['sonarjs/no-commented-code'],
  },
  {
    name: 'magic number',
    file: 'packages/sample/src/magic.ts',
    code: 'export const area = (radius: number): number => radius * 3.14159;\n',
    expect: ['@typescript-eslint/no-magic-numbers'],
  },
  {
    name: 'more than 3 parameters',
    file: 'packages/sample/src/params.ts',
    code: 'export const run = (first: number, second: number, third: number, fourth: number): number => first + second + third + fourth;\n',
    expect: ['max-params'],
  },
  {
    name: 'then chain',
    file: 'packages/sample/src/then.ts',
    code: 'export const run = (task: Promise<number>): Promise<number> => task.then((value) => value);\n',
    expect: ['promise/prefer-await-to-then'],
  },
  {
    name: 'floating promise',
    file: 'packages/sample/src/floating.ts',
    code: 'export const run = async (): Promise<void> => {\n  Promise.resolve(1);\n  await Promise.resolve(2);\n};\n',
    expect: ['@typescript-eslint/no-floating-promises'],
  },
  {
    name: 'missing jsdoc on an export',
    file: 'packages/sample/src/nodoc.ts',
    code: 'export function addNumbers(first: number, second: number): number {\n  return first + second;\n}\n',
    expect: ['jsdoc/require-jsdoc'],
  },
  {
    name: 'missing return type',
    file: 'packages/sample/src/return-type.ts',
    code: '/** Adds. */\nexport const addNumbers = (first: number, second: number) => first + second;\n',
    expect: ['@typescript-eslint/explicit-module-boundary-types'],
  },
  {
    name: 'zod schema name',
    file: 'projects/sample/contracts/src/shape.ts',
    code: "import { z } from 'zod';\n\n/** Order. */\nexport const orderShape = z.object({ id: z.string() });\n",
    expect: ['local/zod-schema-naming'],
  },
  {
    name: 'eval',
    file: 'packages/sample/src/eval.ts',
    code: 'export const run = (code: string): unknown => eval(code);\n',
    expect: ['no-eval', 'security/detect-eval-with-expression'],
  },
  {
    name: 'abbreviation',
    file: 'packages/sample/src/abbreviation.ts',
    code: 'export const run = (cb: () => number): number => cb();\n',
    expect: ['unicorn/name-replacements'],
  },
  // React and Next.js
  {
    name: 'dangerouslySetInnerHTML',
    file: 'projects/sample/web/src/components/raw.tsx',
    code: 'export function Raw({ html }: { readonly html: string }): React.JSX.Element {\n  return <div dangerouslySetInnerHTML={{ __html: html }} />;\n}\n',
    expect: ['react/no-danger'],
  },
  {
    name: 'img without alt',
    file: 'projects/sample/web/src/components/image.tsx',
    code: 'export function Image(): React.JSX.Element {\n  return <img src="/a.png" />;\n}\n',
    expect: ['jsx-a11y/alt-text'],
  },
  {
    name: 'hook called conditionally',
    file: 'projects/sample/web/src/components/hook.tsx',
    code: "import { useState } from 'react';\n\nexport function Counter({ isShown }: { readonly isShown: boolean }): number | null {\n  if (!isShown) {\n    return null;\n  }\n  const [count] = useState(0);\n  return count;\n}\n",
    expect: ['react-hooks/rules-of-hooks'],
  },
  // CDK
  {
    name: 'hard-coded account id',
    file: 'projects/sample/infra/src/stacks/account.ts',
    code: "export const ACCOUNT = '123456789012';\n",
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'RemovalPolicy.DESTROY',
    file: 'projects/sample/infra/src/stacks/destroy.ts',
    code: 'declare const RemovalPolicy: { readonly DESTROY: string };\n\nexport const POLICY = RemovalPolicy.DESTROY;\n',
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'RemovalPolicy.DESTROY in dev config',
    file: 'projects/sample/infra/src/config/dev.ts',
    code: 'declare const RemovalPolicy: { readonly DESTROY: string };\n\nexport const POLICY = RemovalPolicy.DESTROY;\n',
    expect: [],
  },
  {
    name: 'construct id not PascalCase',
    file: 'projects/sample/infra/src/stacks/ids.ts',
    code: "export class Thing {\n  public constructor(_scope: unknown, _id: string) {}\n}\n\nexport const make = (): Thing => new Thing(this, 'assets-bucket');\n",
    expect: ['no-restricted-syntax'],
  },
];
