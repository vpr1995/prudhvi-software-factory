import { getTraceHeaders } from '@vprprudhvi/shared-telemetry';

import { createApiClient } from './api-client';
import type { ApiClient } from './api-client';

/**
 * Creates the API client for Server Components. Each request carries `traceparent` of the active span,
 * so the API continues the trace of the page render.
 *
 * @param baseUrl - The origin of the API.
 * @returns The client.
 */
export function createServerApiClient(baseUrl: string): ApiClient {
  return createApiClient({ baseUrl, getHeaders: getTraceHeaders });
}
