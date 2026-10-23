import { base, boundaries, next, node, scope, test } from '@vprprudhvi/tooling-eslint-config';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

// One config for the whole package. web/** and test/web/** get `next`. Everything gets `node`.
export default [
  // The static exports of `next build`: web/out (the site) and web/out-e2e (the e2e build).
  { name: 'project/ignore-build-output', ignores: ['web/out/**', 'web/out-e2e/**'] },
  ...base,
  ...node,
  ...scope(['web/**', 'test/web/**'], next),
  ...test,
  ...boundaries({ rootPath: REPO_ROOT }),
];
