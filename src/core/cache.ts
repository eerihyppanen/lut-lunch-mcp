import { SourceError } from './http.js';

/** How long a successful value may be served after refreshes start failing. */
export const STALE_LIMIT_MS = 24 * 3600_000;
/** How long a failure suppresses further upstream attempts. */
export const NEGATIVE_TTL_MS = 60_000;

export type CacheEntry =
  | { ok: true; value: unknown; fetchedAt: number; failedAt?: number }
  | { ok: false; error: SourceError; fetchedAt: number };

/** Storage behind CachedLoader. In memory for stdio; Workers Cache/KV in phase 3. */
export interface CacheStore {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, entry: CacheEntry): void {
    this.entries.set(key, entry);
  }
}

export interface Loaded<T> {
  value: T;
  stale: boolean;
  fetchedAt: number;
}

function toSourceError(error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  return new SourceError(error instanceof Error ? error.message : String(error), false);
}

/**
 * Loads values through a cache: fresh hits skip upstream, concurrent loads of one key share a
 * request, and failures fall back to the last good value for up to a day (spec §7.3). After a
 * failure, upstream is left alone for NEGATIVE_TTL_MS, whether or not there is a stale value.
 */
export class CachedLoader {
  private readonly inFlight = new Map<string, Promise<Loaded<unknown>>>();

  constructor(
    private readonly store: CacheStore,
    private readonly now: () => number,
  ) {}

  load<T>(key: string, freshMs: number, fn: () => Promise<T>): Promise<Loaded<T>> {
    const t = this.now();
    const entry = this.store.get(key);

    if (entry?.ok && t - entry.fetchedAt < freshMs) {
      return Promise.resolve({ value: entry.value as T, stale: false, fetchedAt: entry.fetchedAt });
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<Loaded<T>>;

    if (entry?.ok) {
      const recentlyFailed = entry.failedAt !== undefined && t - entry.failedAt < NEGATIVE_TTL_MS;
      if (recentlyFailed && t - entry.fetchedAt < STALE_LIMIT_MS) {
        return Promise.resolve({
          value: entry.value as T,
          stale: true,
          fetchedAt: entry.fetchedAt,
        });
      }
    } else if (entry && t - entry.fetchedAt < NEGATIVE_TTL_MS) {
      return Promise.reject(entry.error);
    }

    const request = this.refresh(key, fn).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private async refresh<T>(key: string, fn: () => Promise<T>): Promise<Loaded<T>> {
    try {
      const value = await fn();
      const fetchedAt = this.now();
      this.store.set(key, { ok: true, value, fetchedAt });
      return { value, stale: false, fetchedAt };
    } catch (error) {
      const failure = toSourceError(error);
      const t = this.now();
      const previous = this.store.get(key);
      const canServeStale = previous?.ok === true && t - previous.fetchedAt < STALE_LIMIT_MS;
      // Logged once per real upstream attempt; negative caching keeps this quiet in outages.
      console.error(
        `lut-lunch-mcp: ${key} failed: ${failure.message}` +
          (canServeStale ? ' (serving cached copy)' : ''),
      );
      if (previous?.ok && canServeStale) {
        this.store.set(key, { ...previous, failedAt: t });
        return { value: previous.value as T, stale: true, fetchedAt: previous.fetchedAt };
      }
      this.store.set(key, { ok: false, error: failure, fetchedAt: t });
      throw failure;
    }
  }
}
