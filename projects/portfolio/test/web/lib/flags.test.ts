import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFlags, flagRegistry, isChatEnabled } from '../../../web/lib/flags';

describe('the portfolioChat flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off by default, with an empty environment', () => {
    expect(flagRegistry.portfolioChat.defaultValue).toBe(false);
    expect(isChatEnabled({})).toBe(false);
  });

  it('is on when FLAG_PORTFOLIO_CHAT is true', () => {
    expect(isChatEnabled({ FLAG_PORTFOLIO_CHAT: 'true' })).toBe(true);
    expect(isChatEnabled({ FLAG_PORTFOLIO_CHAT: ' TRUE ' })).toBe(true);
    expect(createFlags({ FLAG_PORTFOLIO_CHAT: '1' }).isEnabled('portfolioChat')).toBe(true);
  });

  it('stays off when FLAG_PORTFOLIO_CHAT is false', () => {
    expect(isChatEnabled({ FLAG_PORTFOLIO_CHAT: 'false' })).toBe(false);
    expect(createFlags({ FLAG_PORTFOLIO_CHAT: 'off' }).isEnabled('portfolioChat')).toBe(false);
  });

  it('stays off when FLAG_PORTFOLIO_CHAT holds a value the provider does not accept', () => {
    // The env provider ignores a value that is neither a true nor a false word. The flag keeps its default.
    expect(isChatEnabled({ FLAG_PORTFOLIO_CHAT: 'maybe' })).toBe(false);
    expect(isChatEnabled({ FLAG_PORTFOLIO_CHAT: '' })).toBe(false);
  });

  it('reads the process environment when no record is passed', () => {
    vi.stubEnv('FLAG_PORTFOLIO_CHAT', 'true');
    expect(isChatEnabled()).toBe(true);
  });
});
