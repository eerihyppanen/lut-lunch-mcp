import { describe, expect, it, vi } from 'vitest';
import { CachedLoader, MemoryCacheStore } from '../../../src/core/cache.js';
import {
  DEFAULT_HISTORY_BASE_URL,
  createRemoteHistoryStore,
  historyBaseUrl,
} from '../../../src/core/history/remote.js';
import { buildStatsIndex } from '../../../src/core/history/stats-index.js';
import type { HistoryDay } from '../../../src/core/history/types.js';
import { SourceError, type HttpClient } from '../../../src/core/http.js';
import { fixtureHistoryDays } from '../../helpers/history-fixture.js';

const loader = () => new CachedLoader(new MemoryCacheStore(), () => 0);
const BASE = 'https://h/';
const dayUrl = (date: string) => `${BASE}days/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.json`;

/** An HttpClient serving the fixture history as day files and stats.json; overrides win. */
async function dataBranch(overrides: Record<string, () => Promise<unknown>> = {}) {
  const days = await fixtureHistoryDays();
  const files: Record<string, () => Promise<unknown>> = {
    [`${BASE}stats.json`]: () => Promise.resolve(buildStatsIndex(days, 'T')),
    ...Object.fromEntries(days.map((d) => [dayUrl(d.date), () => Promise.resolve(copy(d))])),
    ...overrides,
  };
  const getJson = vi.fn((url: string) =>
    files[url]
      ? files[url]()
      : Promise.reject(new SourceError(`Request to ${url} failed with HTTP 404`, false, 404)),
  );
  const http: HttpClient = { getJson, getText: vi.fn() };
  return { http, getJson, days };
}

const copy = (day: HistoryDay): unknown => JSON.parse(JSON.stringify(day));

describe('createRemoteHistoryStore', () => {
  it('loads stats.json once per fresh period', async () => {
    const { http, getJson } = await dataBranch();
    const store = createRemoteHistoryStore(http, loader(), BASE);
    const [a, b] = await Promise.all([store.statsIndex(), store.statsIndex()]);
    expect(a).toMatchObject({ firstDate: '2026-10-19', lastDate: '2026-10-25' });
    expect(b).toBe(a);
    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getJson).toHaveBeenCalledWith(`${BASE}stats.json`);
  });

  it('fetches only the day files the index lists', async () => {
    const { http, getJson } = await dataBranch();
    const store = createRemoteHistoryStore(http, loader(), BASE);
    const days = await store.days(['2026-10-20', '2026-10-21']); // the 21st is not recorded
    expect([...days.keys()]).toEqual(['2026-10-20']);
    expect(days.get('2026-10-20')!.restaurants.map((r) => r.id)).toEqual([
      'lut-buffet',
      'bistro-skinnarila',
      'yolo',
    ]);
    expect(getJson.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}stats.json`,
      dayUrl('2026-10-20'),
    ]);
  });

  it('treats a listed day whose file is not there yet as not recorded (review focus)', async () => {
    // raw.githubusercontent.com caches for minutes, so stats.json can be ahead of a day file.
    const { http } = await dataBranch({
      [dayUrl('2026-10-20')]: () =>
        Promise.reject(new SourceError('Request failed with HTTP 404', false, 404)),
    });
    const store = createRemoteHistoryStore(http, loader(), BASE);
    const days = await store.days(['2026-10-19', '2026-10-20']);
    expect([...days.keys()]).toEqual(['2026-10-19']);
  });

  it('rejects when a day file fails for another reason', async () => {
    const down = new SourceError('Request failed with HTTP 500', true, 500);
    const { http } = await dataBranch({ [dayUrl('2026-10-20')]: () => Promise.reject(down) });
    const store = createRemoteHistoryStore(http, loader(), BASE);
    await expect(store.days(['2026-10-20'])).rejects.toBe(down);
  });

  it.each([
    [{ schema: 2, days: [] }, 'History data uses schema 2; update lut-lunch-mcp.'],
    [{ schema: 1, days: 'nope' }, 'History data is malformed'],
    ['not an object', 'History data is malformed'],
  ])('rejects stats.json %j (review focus 3)', async (body, message) => {
    const { http } = await dataBranch({ [`${BASE}stats.json`]: () => Promise.resolve(body) });
    const store = createRemoteHistoryStore(http, loader(), BASE);
    await expect(store.statsIndex()).rejects.toMatchObject({ message, retryable: false });
    await expect(store.days(['2026-10-20'])).rejects.toMatchObject({ message });
  });

  it('rejects a malformed day file', async () => {
    const { http } = await dataBranch({ [dayUrl('2026-10-20')]: () => Promise.resolve({ x: 1 }) });
    const store = createRemoteHistoryStore(http, loader(), BASE);
    await expect(store.days(['2026-10-20'])).rejects.toMatchObject({
      message: 'History data is malformed',
      retryable: false,
    });
  });

  it('points at the data branch by default and accepts a history.json URL', () => {
    expect(DEFAULT_HISTORY_BASE_URL).toBe(
      'https://raw.githubusercontent.com/eerihyppanen/lut-lunch-mcp/data/',
    );
    expect(historyBaseUrl('https://x/data/history.json')).toBe('https://x/data/');
    expect(historyBaseUrl('https://x/data')).toBe('https://x/data/');
    expect(historyBaseUrl('https://x/data/')).toBe('https://x/data/');
  });
});
