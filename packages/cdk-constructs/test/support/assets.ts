import { fileURLToPath } from 'node:url';

import { App, Stack } from 'aws-cdk-lib';
import { AssetCode, Code } from 'aws-cdk-lib/aws-lambda';
import { expect, vi } from 'vitest';

/** A tiny folder that stands in for the bundled code. `Function` stages it when it binds the code. */
const PLACEHOLDER_ASSET = fileURLToPath(new URL('./asset-placeholder/', import.meta.url));

/** The arguments of one `Code.fromAsset` call. */
export type AssetCall = Parameters<typeof Code.fromAsset>;

/**
 * Creates something in a stack that bundles, and returns the arguments of the one call to
 * `Code.fromAsset`. The call itself does nothing: it returns a real `AssetCode` for a tiny placeholder
 * folder, with no bundling. So the test sees the bundling settings and runs no bundling tool.
 *
 * @param create - Creates the function in the stack.
 * @returns The folder and the options that the construct gave to `Code.fromAsset`.
 */
export function captureAssetCall(create: (stack: Stack) => void): AssetCall {
  const spy = vi
    .spyOn(Code, 'fromAsset')
    .mockImplementation(() => new AssetCode(PLACEHOLDER_ASSET));
  try {
    create(new Stack(new App(), 'BundlingStack'));
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0];
    if (call === undefined) {
      throw new Error('Code.fromAsset was not called.');
    }
    return call;
  } finally {
    spy.mockRestore();
  }
}
