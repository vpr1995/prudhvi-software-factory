import { describe, expect, it, vi } from 'vitest';

describe('main', () => {
  it('starts the API from the process environment', async () => {
    vi.stubEnv('SAMPLE_API_PORT', '0');
    vi.stubEnv('SAMPLE_API_LOG_LEVEL', 'silent');
    const before = process.listenerCount('SIGINT');
    await import('./main.js');
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    process.emit('SIGINT');
    expect(process.listenerCount('SIGINT')).toBe(before);
  });
});
