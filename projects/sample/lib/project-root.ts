import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The folder of this module: `lib` when the tests run, `dist/cdk/lib` when the compiled app runs.
const LIB_FOLDER = /(?:\/dist\/cdk)?\/lib$/;

/**
 * Finds the project folder from the folder of a module in `lib`. The CDK app runs from
 * `dist/cdk/lib` and the tests run from `lib`, so a fixed number of `..` would not work.
 *
 * @param moduleUrl - The `file:` URL of a module in `lib`. Defaults to this module.
 * @returns The absolute path of the project folder.
 * @throws When the module is not in a `lib` or `dist/cdk/lib` folder.
 */
export function findProjectRoot(moduleUrl: string | URL = import.meta.url): string {
  const folder = dirname(fileURLToPath(moduleUrl));
  if (!LIB_FOLDER.test(folder)) {
    throw new Error(`Expected a module in lib or dist/cdk/lib, got: ${folder}`);
  }
  return folder.replace(LIB_FOLDER, '');
}
