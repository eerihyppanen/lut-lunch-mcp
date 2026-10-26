import { describe, expect, it, vi } from 'vitest';
import { RATE_LIMIT, RATE_WINDOW_MS, createRateLimiter } from '../../src/worker/rate-limit.js';

async function allowedCount(allow: () => Promise<boolean>, times: number): Promise<number> {
  let allowed = 0;
  for (let i = 0; i < times; i++) if (await allow()) allowed++;
  return allowed;
}

describe('createRateLimiter', () => {
  it('allows 60 requests per minute per key, then denies until the window passes', async () => {
    expect([RATE_LIMIT, RATE_WINDOW_MS]).toEqual([60, 60_000]);
    let t = 0;
    const limiter = createRateLimiter(() => t);
    expect(await allowedCount(() => limiter.allow('a', {}), 61)).toBe(60);
    expect(await limiter.allow('b', {})).toBe(true); // other clients are unaffected
    t += RATE_WINDOW_MS;
    expect(await limiter.allow('a', {})).toBe(true);
  });

  it('denies when the Workers binding denies', async () => {
    const limit = vi.fn(() => Promise.resolve({ success: false }));
    const limiter = createRateLimiter(() => 0);
    expect(await limiter.allow('a', { RATE_LIMITER: { limit } })).toBe(false);
    expect(limit).toHaveBeenCalledWith({ key: 'a' });
  });

  it('still counts per instance when the binding allows (it is approximate)', async () => {
    const limit = vi.fn(() => Promise.resolve({ success: true }));
    const limiter = createRateLimiter(() => 0);
    const env = { RATE_LIMITER: { limit } };
    expect(await allowedCount(() => limiter.allow('a', env), 61)).toBe(60);
  });
});
