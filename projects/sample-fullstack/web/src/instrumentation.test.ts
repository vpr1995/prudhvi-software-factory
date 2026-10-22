import { afterEach, describe, expect, it, vi } from 'vitest';

const initTelemetry = vi.fn();

vi.mock('@vprprudhvi/shared-telemetry', () => ({ initTelemetry }));

afterEach(() => {
  vi.resetModules();
});

describe('register', () => {
  it('starts telemetry in the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const { register } = await import('./instrumentation');
    await register();
    expect(initTelemetry).toHaveBeenCalledWith({
      serviceName: 'sample-fullstack-web',
      serviceVersion: '0.0.0',
      environment: 'local',
    });
  });

  it('starts nothing in the Edge runtime', async () => {
    initTelemetry.mockClear();
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    const { register } = await import('./instrumentation');
    await register();
    expect(initTelemetry).not.toHaveBeenCalled();
  });
});
