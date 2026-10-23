import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The folder of this module: `src` when the tests run, `dist` when a CDK app imports the package.
const PACKAGE_FOLDER = /\/packages\/cdk-constructs\/(?:src|dist)$/;

/**
 * Finds the root folder of the Rush repo from the folder of a module in this package. It assumes
 * that the package is at `packages/cdk-constructs` in the repo. Node resolves the workspace link in
 * `node_modules` to the real path, so the module is in the repo also when a project imports it.
 *
 * @param moduleUrl - The `file:` URL of a module in `src` or `dist`. Defaults to this module.
 * @returns The absolute path of the repo root folder.
 * @throws When the module is not in `packages/cdk-constructs/src` or `packages/cdk-constructs/dist`.
 */
export function findRepositoryRoot(moduleUrl: string | URL = import.meta.url): string {
  const folder = dirname(fileURLToPath(moduleUrl));
  if (!PACKAGE_FOLDER.test(folder)) {
    throw new Error(
      `Expected a module in packages/cdk-constructs/src or packages/cdk-constructs/dist, got: ` +
        `${folder}. Set projectRoot and depsLockFilePath.`,
    );
  }
  return folder.replace(PACKAGE_FOLDER, '');
}
