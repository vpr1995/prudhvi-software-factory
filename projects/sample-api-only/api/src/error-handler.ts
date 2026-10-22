import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

import type { AppError } from '@vprprudhvi/shared-result';
import { getTraceContext, recordSpanError } from '@vprprudhvi/shared-telemetry';

import type { ErrorEnvelope } from '@vprprudhvi/sample-api-only-contracts';

import { HttpStatus } from './http-status.js';

const CLIENT_ERROR_FLOOR = 400;
const SERVER_ERROR_FLOOR = 500;

/** The error statuses a route can return. */
export type ErrorStatus = typeof HttpStatus.BadRequest | typeof HttpStatus.Conflict;

const STATUS_BY_CODE: Readonly<Record<string, ErrorStatus>> = {
  NOTE_TITLE_TAKEN: HttpStatus.Conflict,
  NOTE_LIMIT_REACHED: HttpStatus.Conflict,
};

/**
 * Builds the error envelope. `requestId` is the trace id, so support can find the trace from a user report.
 *
 * @param request - The request that failed.
 * @param code - The error code in UPPER_SNAKE_CASE.
 * @param message - A short message with no secrets or personal data.
 * @returns The envelope.
 */
export function buildErrorEnvelope(
  request: FastifyRequest,
  code: string,
  message: string,
): ErrorEnvelope {
  const requestId = getTraceContext()?.traceId ?? request.id;
  return { error: { code, message, requestId } };
}

/**
 * Maps an expected error to an HTTP status.
 *
 * @param error - The error from the domain.
 * @returns The status code. Unknown codes map to 400.
 */
export function statusForAppError(error: AppError): ErrorStatus {
  return STATUS_BY_CODE[error.code] ?? HttpStatus.BadRequest;
}

function handleError(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (hasZodFastifySchemaValidationErrors(error)) {
    void reply
      .code(HttpStatus.BadRequest)
      .send(buildErrorEnvelope(request, 'VALIDATION_ERROR', 'The request is not valid.'));
    return;
  }
  const status = error.statusCode ?? HttpStatus.InternalServerError;
  if (status >= CLIENT_ERROR_FLOOR && status < SERVER_ERROR_FLOOR) {
    void reply
      .code(status)
      .send(buildErrorEnvelope(request, 'BAD_REQUEST', 'The request is not valid.'));
    return;
  }
  request.log.error({ err: error }, 'request failed');
  const span = request.opentelemetry().span;
  if (span !== null) {
    recordSpanError(span, error);
  }
  void reply
    .code(HttpStatus.InternalServerError)
    .send(buildErrorEnvelope(request, 'INTERNAL_ERROR', 'The service failed. Try again later.'));
}

/**
 * Registers the error handlers. Every error and every unknown route returns the error envelope.
 *
 * @param app - The Fastify instance.
 */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler(handleError);
  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(HttpStatus.NotFound)
      .send(buildErrorEnvelope(request, 'NOT_FOUND', 'The route does not exist.'));
  });
}
