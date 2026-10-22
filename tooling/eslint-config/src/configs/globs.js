export const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];
export const JS_FILES = ['**/*.{js,jsx,mjs,cjs}'];
export const ALL_CODE_FILES = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];
export const REACT_FILES = ['**/*.{tsx,jsx}'];

export const E2E_FILES = ['**/e2e/**/*.spec.{ts,tsx}'];

export const TEST_FILES = [
  '**/*.test.{ts,tsx,js,jsx}',
  '**/e2e/**/*.spec.{ts,tsx}',
  '**/test/**/*.{ts,tsx,js}',
  '**/tests/**/*.{ts,tsx,js}',
];

/** Files where a default export is required by Next.js or by the tool that loads them. */
export const DEFAULT_EXPORT_FILES = [
  '**/app/**/{page,layout,route,loading,error,global-error,not-found,template,default}.{ts,tsx}',
  '**/*.config.*',
];

export const IGNORED_PATHS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.next/**',
  '**/bruno/**',
  '**/cdk.out/**',
  '**/.rush/**',
  '**/temp/**',
  'common/temp/**',
  '**/*.d.ts',
];
