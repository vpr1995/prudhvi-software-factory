import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { HealthSchema } from '@vprprudhvi/sample-api-only-contracts';

import type { Config } from '../../config.js';
import { HttpStatus } from '../../http-status.js';

/** The route options. */
export type HealthRouteOptions = {
  readonly config: Config;
};

/**
 * `GET /v1/health`.
 *
 * @param app - The Fastify instance.
 * @param options - The settings.
 */
export const healthRoute: FastifyPluginAsyncZod<HealthRouteOptions> = async (app, options) => {
  const { serviceName, serviceVersion } = options.config;
  app.get(
    '/v1/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Check that the service is up.',
        response: { [HttpStatus.Ok]: HealthSchema },
      },
    },
    () => ({ status: 'ok' as const, service: serviceName, version: serviceVersion }),
  );
  await Promise.resolve();
};
