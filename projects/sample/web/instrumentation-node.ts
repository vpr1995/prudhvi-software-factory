import { initTelemetry } from '@vprprudhvi/shared-telemetry';

import { loadWebConfig, SERVICE_NAME } from './config';

/** Starts the OpenTelemetry Node SDK. It exports spans only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. */
export function registerNodeTelemetry(): void {
  const config = loadWebConfig();
  initTelemetry({
    serviceName: SERVICE_NAME,
    serviceVersion: config.serviceVersion,
    environment: config.environment,
  });
}
