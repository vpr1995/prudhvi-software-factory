// Gate fixtures for the boundaries rules. Relative imports keep the cases independent of node_modules.

/**
 * Files that exist only so relative imports resolve in the boundary cases.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SUPPORT_FILES = {
  'projects/sample/contracts/src/order.ts': 'export const ORDER = 1;\n',
  'projects/sample/contracts/src/types.ts': 'export type Order = { readonly id: string };\n',
  'projects/other/contracts/src/order.ts': 'export const ORDER = 1;\n',
  'projects/sample/api/src/domain/rules.ts': 'export const RULE = 1;\n',
  'projects/sample/api/src/adapters/db.ts': 'export const DB = 1;\n',
  'projects/sample/api/src/server.ts': 'export const SERVER = 1;\n',
  'projects/sample/web/src/page-data.ts': 'export const PAGE = 1;\n',
  'packages/sample/src/shared.ts': 'export const SHARED = 1;\n',
  'packages/cdk-constructs/src/construct.ts': 'export const CONSTRUCT = 1;\n',
  'platform/infra/src/pool.ts': 'export const POOL = 1;\n',
};

/**
 * Boundary cases. `from` is the importing file, `to` the relative import path.
 *
 * @type {readonly { name: string, file: string, code: string, expect: readonly string[] }[]}
 */
export const BOUNDARY_CASES = [
  {
    name: 'web imports its own contracts',
    file: 'projects/sample/web/src/a.ts',
    to: '../../contracts/src/order.js',
    symbol: 'ORDER',
    expect: [],
  },
  {
    name: 'web imports api',
    file: 'projects/sample/web/src/b.ts',
    to: '../../api/src/server.js',
    symbol: 'SERVER',
    expect: ['boundaries/dependencies'],
  },
  {
    name: 'api imports web',
    file: 'projects/sample/api/src/c.ts',
    to: '../../web/src/page-data.js',
    symbol: 'PAGE',
    expect: ['boundaries/dependencies'],
  },
  {
    name: 'web imports another project',
    file: 'projects/sample/web/src/d.ts',
    to: '../../../other/contracts/src/order.js',
    symbol: 'ORDER',
    expect: ['boundaries/dependencies'],
  },
  {
    name: 'api imports own contracts and domain',
    file: 'projects/sample/api/src/e.ts',
    to: '../../contracts/src/order.js',
    symbol: 'ORDER',
    expect: [],
  },
  {
    name: 'api domain imports adapters',
    file: 'projects/sample/api/src/domain/f.ts',
    to: '../adapters/db.js',
    symbol: 'DB',
    expect: ['boundaries/dependencies'],
  },
  {
    name: 'api adapters import domain',
    file: 'projects/sample/api/src/adapters/g.ts',
    to: '../domain/rules.js',
    symbol: 'RULE',
    expect: [],
  },
  {
    name: 'contracts import api',
    file: 'projects/sample/contracts/src/h.ts',
    to: '../../api/src/server.js',
    symbol: 'SERVER',
    expect: ['boundaries/dependencies'],
  },
  {
    name: 'packages import a project',
    file: 'packages/sample/src/i.ts',
    to: '../../../projects/sample/contracts/src/order.js',
    symbol: 'ORDER',
    expect: ['boundaries/dependencies'],
  },
  {
    name: 'infra imports contracts as a value',
    file: 'projects/sample/infra/src/j.ts',
    to: '../../contracts/src/order.js',
    symbol: 'ORDER',
    expect: ['boundaries/dependencies'],
  },
  {
    name: 'infra imports contracts as a type',
    file: 'projects/sample/infra/src/k.ts',
    to: '../../contracts/src/types.js',
    symbol: 'Order',
    typeOnly: true,
    expect: [],
  },
  {
    name: 'infra imports cdk-constructs',
    file: 'projects/sample/infra/src/l.ts',
    to: '../../../../packages/cdk-constructs/src/construct.js',
    symbol: 'CONSTRUCT',
    expect: [],
  },
  {
    name: 'infra imports platform/infra',
    file: 'projects/sample/infra/src/m.ts',
    to: '../../../../platform/infra/src/pool.js',
    symbol: 'POOL',
    expect: ['boundaries/dependencies'],
  },
  {
    name: 'platform/infra imports a project',
    file: 'platform/infra/src/n.ts',
    to: '../../../projects/sample/contracts/src/order.js',
    symbol: 'ORDER',
    expect: ['boundaries/dependencies'],
  },
  {
    name: 'platform/infra imports cdk-constructs',
    file: 'platform/infra/src/o.ts',
    to: '../../../packages/cdk-constructs/src/construct.js',
    symbol: 'CONSTRUCT',
    expect: [],
  },
  {
    name: 'web imports shared packages',
    file: 'projects/sample/web/src/p.ts',
    to: '../../../../packages/sample/src/shared.js',
    symbol: 'SHARED',
    expect: [],
  },
].map(({ to, symbol, typeOnly, ...rest }) => ({
  ...rest,
  code: typeOnly
    ? `import type { ${symbol} } from '${to}';\n\n/** Used. */\nexport type Used = ${symbol};\n`
    : `import { ${symbol} } from '${to}';\n\nexport const USED = ${symbol};\n`,
}));
