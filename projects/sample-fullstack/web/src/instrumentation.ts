import { isNodeRuntime } from './config';

/** Next.js calls this once when the server starts. It starts OpenTelemetry for the Node.js runtime. */
export async function register(): Promise<void> {
  if (isNodeRuntime) {
    const { registerNodeTelemetry } = await import('./instrumentation-node');
    registerNodeTelemetry();
  }
}
