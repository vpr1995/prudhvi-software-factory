import awsLambdaFastify from '@fastify/aws-lambda';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

import { createLogger } from '@vprprudhvi/shared-logger';
import { initTelemetry } from '@vprprudhvi/shared-telemetry';

import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const config = loadConfig();
const telemetry = initTelemetry({
  serviceName: config.serviceName,
  serviceVersion: config.serviceVersion,
  environment: config.environment,
});
const logger = createLogger({ serviceName: config.serviceName, level: config.logLevel });

/** The longest the handler waits for the span flush, in milliseconds. */
export const FLUSH_TIMEOUT_MS = 2000;

const fastifyHandler = awsLambdaFastify(await buildServer({ config, logger }));

/**
 * Flushes the pending spans. It never throws and never waits longer than `FLUSH_TIMEOUT_MS`: a
 * collector that fails or hangs must not replace or delay the response. A failure is logged as a
 * warning.
 */
async function flushSpans(): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`span flush timed out after ${String(FLUSH_TIMEOUT_MS)} ms`));
    }, FLUSH_TIMEOUT_MS);
  });
  try {
    await Promise.race([telemetry.forceFlush(), timeout]);
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'flush spans failed',
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The Lambda handler for API Gateway HTTP API (payload format 2.0).
 * It flushes the pending spans before it returns, because Lambda freezes the process after the
 * response and the batch span processor would not send them. The flush is bounded and its failure
 * is only logged.
 *
 * @param event - The API Gateway event.
 * @param context - The Lambda context.
 * @returns The HTTP response.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<awsLambdaFastify.LambdaResponse> {
  try {
    return await fastifyHandler(event, context);
  } finally {
    await flushSpans();
  }
}
