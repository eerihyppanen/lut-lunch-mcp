import type { Env } from './env.js';

// Per-client limit for /mcp (phase 3 spec §5.2): stops runaway clients from using up the free
// plan's 100,000 requests a day. Claude and ChatGPT connectors call from their vendors' shared
// servers, so one IP carries many users (a conversation turn is typically 2–5 requests); the
// limit is set for that crowd, and the daily cap is the real backstop.

export const RATE_LIMIT = 600;
export const RATE_WINDOW_MS = 60_000;

export interface RateLimiter {
  /** True when `key` may make another request now. */
  allow(key: string, env: Env): Promise<boolean>;
}

/**
 * Counts per Worker instance in fixed one-minute windows, and also asks the Workers Rate
 * Limiting binding when the account has it. Both are approximate (the binding counts per
 * Cloudflare location and is eventually consistent), so a request is denied when either says
 * no. The instance count can never be stricter than a perfect limit across all instances.
 */
export function createRateLimiter(now: () => number): RateLimiter {
  let window = -1;
  const counts = new Map<string, number>();

  return {
    async allow(key, env) {
      if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key })).success) return false;
      const current = Math.floor(now() / RATE_WINDOW_MS);
      if (current !== window) {
        // A new window: earlier counts no longer matter, so memory stays bounded.
        window = current;
        counts.clear();
      }
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count <= RATE_LIMIT;
    },
  };
}
