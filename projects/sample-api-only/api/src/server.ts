import helmet from '@fastify/helmet';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import fastify from 'fastify';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { Logger } from '@vprprudhvi/shared-logger';
import { formatTraceparent, getTraceContext } from '@vprprudhvi/shared-telemetry';

import { createInMemoryNotesStore } from './adapters/notes-store.js';
import type { NotesStore } from './adapters/notes-store.js';
import type { Config } from './config.js';
import { registerErrorHandlers } from './error-handler.js';
import { healthRoute } from './routes/health/health-route.js';
import { notesRoutes } from './routes/notes/notes-routes.js';

const TRACEPARENT_HEADER = 'traceparent';
// A JSON API serves no page, so it allows no content source and no framing at all.
const CONTENT_SECURITY_POLICY = {
  directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
};

/** What `buildServer` needs. */
export type BuildServerOptions = {
  readonly config: Config;
  readonly logger: Logger;
  /** Defaults to an in-memory store. Tests pass a fake. */
  readonly notesStore?: NotesStore;
};

/** The server type. */
export type Server = FastifyInstance;

/**
 * Builds the Fastify server with all plugins and routes. It does not listen and it does not call `ready`
 * (`@fastify/aws-lambda` must decorate the instance before `ready`).
 * `@fastify/helmet` sets the security headers (nosniff, HSTS, a CSP with `default-src 'none'`, and others).
 * `@fastify/otel` makes one span for each request and continues an incoming `traceparent`.
 * The `onSend` hook echoes the trace in the response header `traceparent`.
 *
 * @param options - The settings, the logger and an optional store.
 * @returns The Fastify instance.
 */
export async function buildServer(options: BuildServerOptions): Promise<Server> {
  const { config, logger, notesStore = createInMemoryNotesStore() } = options;
  const loggerInstance: FastifyBaseLogger = logger;
  const app = fastify({ loggerInstance }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: CONTENT_SECURITY_POLICY });

  const instrumentation = new FastifyOtelInstrumentation({ registerOnInitialization: false });
  await app.register(instrumentation.plugin());

  app.addHook('onSend', (_request, reply, payload) => {
    const traceContext = getTraceContext();
    if (traceContext !== undefined) {
      void reply.header(TRACEPARENT_HEADER, formatTraceparent(traceContext));
    }
    return Promise.resolve(payload);
  });

  registerErrorHandlers(app);
  await app.register(healthRoute, { config });
  await app.register(notesRoutes, { notesStore });
  return app;
}

/**
 * Builds the server and starts to listen.
 *
 * @param options - The same options as `buildServer`.
 * @returns The running server. Its `server.address()` has the port.
 */
export async function startServer(options: BuildServerOptions): Promise<Server> {
  const app = await buildServer(options);
  await app.listen({ host: options.config.host, port: options.config.port });
  return app;
}
