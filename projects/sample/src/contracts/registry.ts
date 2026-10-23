import { z } from 'zod';

/** Registry of the named schemas. The OpenAPI build turns each entry into `components.schemas.<id>`. */
export const SchemaRegistry = z.registry<{ readonly id: string }>();
