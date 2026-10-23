import { base, boundaries, cdk, node, test } from '@vprprudhvi/tooling-eslint-config';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

export default [...base, ...node, ...cdk, ...test, ...boundaries({ rootPath: REPO_ROOT })];
