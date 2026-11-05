import { base, boundaries, cdk, next, node, scope, test } from '@vprprudhvi/tooling-eslint-config';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

// One config for the whole project. Each part folder gets the shared config of its kind:
// web/** and test/web/** get `next`, bin/** and lib/** get `cdk`, everything gets `node`.
// A scope with no files does nothing, so `rush add-part` does not change this file.
export default [
  ...base,
  ...node,
  ...scope(['web/**', 'test/web/**'], next),
  ...scope(['bin/**', 'lib/**'], cdk),
  ...test,
  ...boundaries({ rootPath: REPO_ROOT }),
];
