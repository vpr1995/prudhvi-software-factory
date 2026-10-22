import { describe, expect, it } from 'vitest';

import { run } from './run.js';

describe('run', () => {
  it('starts the server, and stop closes it and removes the signal handlers', async () => {
    const before = process.listenerCount('SIGTERM');
    const api = await run({
      SAMPLE_API_ONLY_API_PORT: '0',
      SAMPLE_API_ONLY_API_LOG_LEVEL: 'silent',
    });
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    const address = api.app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/health`);
    expect(response.status).toBe(200);

    await api.stop();
    expect(process.listenerCount('SIGTERM')).toBe(before);
    await expect(fetch(`http://127.0.0.1:${String(port)}/v1/health`)).rejects.toThrow();
  });

  it('stops on SIGTERM', async () => {
    const before = process.listenerCount('SIGTERM');
    await run({ SAMPLE_API_ONLY_API_PORT: '0', SAMPLE_API_ONLY_API_LOG_LEVEL: 'silent' });
    process.emit('SIGTERM');
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });
});
