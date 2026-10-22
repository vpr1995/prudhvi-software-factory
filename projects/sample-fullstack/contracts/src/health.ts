import { z } from 'zod';

import { SchemaRegistry } from './registry.js';

/** Response of `GET /v1/health`. */
export const HealthSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string().min(1),
    version: z.string().min(1),
  })
  .register(SchemaRegistry, { id: 'Health' });

/** Response of `GET /v1/health`. */
export type Health = z.infer<typeof HealthSchema>;
