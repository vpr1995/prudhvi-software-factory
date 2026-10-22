import { createLogger } from '@vprprudhvi/shared-logger';
import { initTelemetry } from '@vprprudhvi/shared-telemetry';

import { loadConfig } from './config.js';
import { startServer } from './server.js';
import type { Server } from './server.js';

/** A running API. */
export type RunningApi = {
  readonly app: Server;
  /** Closes the server, flushes spans and removes the signal handlers. */
  readonly stop: () => Promise<void>;
};

/**
 * Starts telemetry, the logger and the server. `SIGINT` and `SIGTERM` call `stop`.
 *
 * @param source - The environment variables. Defaults to the process environment.
 * @returns The running API.
 */
export async function run(
  source?: Readonly<Record<string, string | undefined>>,
): Promise<RunningApi> {
  const config = loadConfig(source);
  const telemetry = initTelemetry({
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
    environment: config.environment,
  });
  const logger = createLogger({ serviceName: config.serviceName, level: config.logLevel });
  const app = await startServer({ config, logger });

  const handlers = {
    SIGINT: (): void => void stop(),
    SIGTERM: (): void => void stop(),
  };
  async function stop(): Promise<void> {
    process.off('SIGINT', handlers.SIGINT);
    process.off('SIGTERM', handlers.SIGTERM);
    await app.close();
    await telemetry.shutdown();
  }
  process.once('SIGINT', handlers.SIGINT);
  process.once('SIGTERM', handlers.SIGTERM);
  return { app, stop };
}
