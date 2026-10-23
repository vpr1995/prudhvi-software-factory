import { App, Stack } from 'aws-cdk-lib';
import { Code } from 'aws-cdk-lib/aws-lambda';
import { expect, vi } from 'vitest';

/** The arguments of one `Code.fromAsset` call. */
export type AssetCall = Parameters<typeof Code.fromAsset>;

/**
 * Creates something in a stack that bundles, and returns the arguments of the one call to
 * `Code.fromAsset`. The call itself does nothing: it returns placeholder code. So the test sees the
 * bundling settings and runs no bundling tool.
 *
 * @param create - Creates the function in the stack.
 * @returns The folder and the options that the construct gave to `Code.fromAsset`.
 */
export function captureAssetCall(create: (stack: Stack) => void): AssetCall {
  const spy = vi
    .spyOn(Code, 'fromAsset')
    .mockImplementation(
      () => Code.fromCfnParameters() as unknown as ReturnType<typeof Code.fromAsset>,
    );
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
