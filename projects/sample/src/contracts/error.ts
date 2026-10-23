import { z } from 'zod';

import { SchemaRegistry } from './registry.ts';

/** The body of every API error: `{ error: { code, message, requestId } }`. `requestId` is the trace id. */
export const ErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      message: z.string(),
      requestId: z.string(),
    }),
  })
  .register(SchemaRegistry, { id: 'ErrorEnvelope' });

/** The body of every API error. */
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
