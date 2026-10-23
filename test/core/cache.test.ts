import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CachedLoader,
  MemoryCacheStore,
  NEGATIVE_TTL_MS,
  STALE_LIMIT_MS,
} from '../../src/core/cache.js';
import { SourceError } from '../../src/core/http.js';

let t = 0;
const now = () => t;
const down = () => Promise.reject(new SourceError('down', true));

beforeEach(() => {
  t = 0;
});

describe('CachedLoader', () => {
  it('returns fresh values without refetching', async () => {
    const fn = vi.fn().mockResolvedValue(1);
    const l = new CachedLoader(new MemoryCacheStore(), now);
    await l.load('k', 1000, fn);
    t = 999;
    const r = await l.load('k', 1000, fn);
    expect(r).toEqual({ value: 1, stale: false, fetchedAt: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('refetches once the fresh window has passed', async () => {
    const fn = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const l = new CachedLoader(new MemoryCacheStore(), now);
    await l.load('k', 1000, fn);
    t = 1000;
    expect(await l.load('k', 1000, fn)).toEqual({ value: 2, stale: false, fetchedAt: 1000 });
  });

  it('coalesces concurrent loads', async () => {
    const fn = vi.fn(() => new Promise<number>((resolve) => setTimeout(() => resolve(1), 5)));
    const l = new CachedLoader(new MemoryCacheStore(), now);
    const [a, b] = await Promise.all([l.load('k', 1000, fn), l.load('k', 1000, fn)]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('serves stale on error within 24h', async () => {
    const l = new CachedLoader(new MemoryCacheStore(), now);
    await l.load('k', 1000, () => Promise.resolve(1));
    t = 5000;
    expect(await l.load('k', 1000, down)).toEqual({ value: 1, stale: true, fetchedAt: 0 });
  });

  it('does not retry a down source for 60s while serving stale', async () => {
    const l = new CachedLoader(new MemoryCacheStore(), now);
    await l.load('k', 1000, () => Promise.resolve(1));
    t = 5000;
    const failing = vi.fn(down);
    await l.load('k', 1000, failing);
    t += NEGATIVE_TTL_MS - 1;
    expect(await l.load('k', 1000, failing)).toEqual({ value: 1, stale: true, fetchedAt: 0 });
    expect(failing).toHaveBeenCalledTimes(1);
    t += 2;
    await l.load('k', 1000, failing);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('recovers when the source comes back', async () => {
    const l = new CachedLoader(new MemoryCacheStore(), now);
    await l.load('k', 1000, () => Promise.resolve(1));
    t = 5000;
    await l.load('k', 1000, down);
    t += NEGATIVE_TTL_MS;
    expect(await l.load('k', 1000, () => Promise.resolve(2))).toEqual({
      value: 2,
      stale: false,
      fetchedAt: t,
    });
  });

  it('throws after 24h and negative-caches for 60s', async () => {
    const l = new CachedLoader(new MemoryCacheStore(), now);
    await l.load('k', 1000, () => Promise.resolve(1));
    t = STALE_LIMIT_MS + 1;
    const failing = vi.fn(down);
    await expect(l.load('k', 1000, failing)).rejects.toThrow('down');
    t += 59_000;
    await expect(l.load('k', 1000, failing)).rejects.toThrow('down');
    expect(failing).toHaveBeenCalledTimes(1);
    t += 2_000;
    await expect(l.load('k', 1000, failing)).rejects.toThrow('down');
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('logs each failed upstream refresh once to stderr, with its key', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const l = new CachedLoader(new MemoryCacheStore(), now);
    await expect(l.load('compass:2026-10-19', 1000, down)).rejects.toThrow('down');
    await expect(l.load('compass:2026-10-19', 1000, down)).rejects.toThrow('down'); // negative cache
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.join(' ')).toMatch(/compass:2026-10-19.*down/);
    log.mockRestore();
  });

  it('wraps unexpected errors as non-retryable SourceErrors', async () => {
    const l = new CachedLoader(new MemoryCacheStore(), now);
    const err = await l
      .load('k', 1000, () => Promise.reject(new TypeError('boom')))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ message: 'boom', retryable: false });
  });
});
