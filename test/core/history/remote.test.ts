import { describe, expect, it, vi } from 'vitest';
import { CachedLoader, MemoryCacheStore } from '../../../src/core/cache.js';
import { DEFAULT_HISTORY_URL, createRemoteHistoryStore } from '../../../src/core/history/remote.js';
import { buildHistoryDataset } from '../../../src/core/history/snapshot.js';
import { fixtureHistoryDays } from '../../helpers/history-fixture.js';

const loader = () => new CachedLoader(new MemoryCacheStore(), () => 0);

describe('createRemoteHistoryStore', () => {
  it('loads, validates and indexes the dataset once per fresh period', async () => {
    const dataset = buildHistoryDataset(await fixtureHistoryDays(), '2026-10-25T07:00:00.000Z');
    const getJson = vi.fn(() => Promise.resolve(JSON.parse(JSON.stringify(dataset)) as unknown));
    const store = createRemoteHistoryStore(
      { getJson, getText: vi.fn() },
      loader(),
      'https://h/history.json',
    );
    const [a, b] = await Promise.all([store.load(), store.load()]);
    expect(a.firstDate).toBe('2026-10-19');
    expect(a.lastDate).toBe('2026-10-25');
    expect(a.days.size).toBe(6);
    expect(b).toBe(a);
    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getJson).toHaveBeenCalledWith('https://h/history.json');
  });

  it.each([
    [{ schema: 2, days: [] }, 'History data uses schema 2; update lut-lunch-mcp.'],
    [{ schema: 1, days: 'nope' }, 'History data is malformed'],
    ['not an object', 'History data is malformed'],
  ])('rejects %j (review focus 3)', async (body, message) => {
    const store = createRemoteHistoryStore(
      { getJson: () => Promise.resolve(body), getText: vi.fn() },
      loader(),
      'u',
    );
    await expect(store.load()).rejects.toMatchObject({ message, retryable: false });
  });

  it('points at the data branch by default', () => {
    expect(DEFAULT_HISTORY_URL).toBe(
      'https://raw.githubusercontent.com/eerihyppanen/lut-lunch-mcp/data/history.json',
    );
  });
});
