import { initBrowserTelemetry } from '@vprprudhvi/shared-telemetry/browser';

import { BROWSER_SERVICE_NAME } from '../config';

import { createApiClient } from './api-client';
import type { ApiClient } from './api-client';

/** What the browser needs to call the API. The server passes it to the client component. */
export type BrowserApiSettings = {
  readonly apiBaseUrl: string;
  readonly serviceVersion: string;
  readonly environment: string;
  /** Where the browser sends its spans (OTLP/HTTP). Unset: spans are created but not exported. */
  readonly tracesUrl?: string | undefined;
};

/**
 * Creates the API client for the browser. It starts browser tracing on the first call. Its `fetch`
 * makes a span and adds `traceparent` to each request to the API origin.
 *
 * @param settings - The API origin and the service identity.
 * @returns The client.
 */
export function createBrowserApiClient(settings: BrowserApiSettings): ApiClient {
  const telemetry = initBrowserTelemetry({
    serviceName: BROWSER_SERVICE_NAME,
    serviceVersion: settings.serviceVersion,
    environment: settings.environment,
    propagateTraceHeaderOrigins: [settings.apiBaseUrl],
    ...(settings.tracesUrl === undefined ? {} : { tracesUrl: settings.tracesUrl }),
  });
  return createApiClient({ baseUrl: settings.apiBaseUrl, fetch: telemetry.fetch });
}
