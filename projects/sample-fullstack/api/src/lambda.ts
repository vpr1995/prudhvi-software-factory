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

const fastifyHandler = awsLambdaFastify(await buildServer({ config, logger }));

/**
 * The Lambda handler for API Gateway HTTP API (payload format 2.0).
 * It flushes the pending spans before it returns, because Lambda freezes the process after the
 * response and the batch span processor would not send them.
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
    await telemetry.forceFlush();
  }
}
