import { beforeAll, describe, expect, it } from 'vitest';
import { buildHistoryDataset, indexHistory } from '../../src/core/history/snapshot.js';
import type { History } from '../../src/core/history/types.js';
import { computeStats, type StatsQuery } from '../../src/mcp/stats.js';
import { fixtureHistory } from '../helpers/history-fixture.js';

// Fixture history: 19–25 Oct 2026 from the captured menus, the 21st missing, Yolo's collection
// failed on the 22nd. Expected values were computed from that data when the plan was written.
let h: History;
const base: StatsQuery = {
  restaurants: ['lut-buffet', 'bistro-skinnarila', 'yolo'],
  from: '2026-10-19',
  to: '2026-10-30',
  groupBy: 'restaurant',
  top: 10,
  language: 'en',
};

beforeAll(async () => {
  h = await fixtureHistory();
});

describe('computeStats', () => {
  it('summarises history coverage', () => {
    expect(computeStats(h, { ...base, query: 'lohi' }).history).toEqual({
      first_date: '2026-10-19',
      last_date: '2026-10-25',
      days_recorded: 6,
      days_missing: 1,
      restaurant_days_unavailable: 1,
    });
  });

  it('counts how often and when (salmon)', () => {
    const s = computeStats(h, { ...base, query: 'lohi' });
    expect(s.matches).toEqual({
      days_served: 1,
      dishes_matched: 1,
      first_seen: { date: '2026-10-23', restaurant_id: 'yolo', dish: 'Salmon soup' },
      last_seen: { date: '2026-10-23', restaurant_id: 'yolo', dish: 'Salmon soup' },
    });
    expect(s.groups).toEqual([
      { key: 'lut-buffet', open_days: 4, days_served: 0 },
      { key: 'bistro-skinnarila', open_days: 4, days_served: 0 },
      { key: 'yolo', open_days: 2, days_served: 1 },
    ]);
    expect(s.top_dishes).toEqual([
      { name: 'Salmon soup', times: 1, restaurants: ['yolo'], last_seen: '2026-10-23' },
    ]);
  });

  it.each(['LOHI', 'Lohi', 'salmon'])('matches %s like "lohi" (review focus 5)', (query) => {
    expect(computeStats(h, { ...base, query }).matches.days_served).toBe(1);
  });

  it('orders first/last seen and top dishes (soups)', () => {
    const s = computeStats(h, { ...base, query: 'keitto', top: 5 });
    expect(s.matches).toMatchObject({
      days_served: 5,
      dishes_matched: 8,
      first_seen: {
        date: '2026-10-19',
        restaurant_id: 'lut-buffet',
        dish: 'Italian style broccoli soup',
      },
      last_seen: {
        date: '2026-10-23',
        restaurant_id: 'lut-buffet',
        dish: 'Itämaista linssikeittoa',
      },
    });
    expect(s.top_dishes.map((t) => t.name)).toEqual([
      'Honey noodle chicken soup',
      'Itämaista linssikeittoa',
      'Salad buffet (Inc. light soup)',
      'Salmon soup',
      'Metsäsienikeittoa',
    ]);
  });

  it('lists most common dishes overall', () => {
    const s = computeStats(h, { ...base, top: 5 });
    expect(s.top_dishes.map((t) => [t.name, t.times])).toEqual([
      ['Vegetables of the season', 4],
      ['Boiled potatoes', 2],
      ['Vanilla custard', 2],
      ['Whole grain rice', 2],
      ['Pulled pork casserole', 1],
    ]);
  });

  it('groups vegan dishes by weekday and month', () => {
    const w = computeStats(h, { ...base, diet: ['vegan'], groupBy: 'weekday' });
    expect(w.matches).toMatchObject({ days_served: 10, dishes_matched: 24 });
    expect(w.groups.map((g) => [g.key, g.open_days, g.days_served])).toEqual([
      ['Monday', 2, 2],
      ['Tuesday', 2, 2],
      ['Wednesday', 0, 0],
      ['Thursday', 2, 2],
      ['Friday', 3, 3],
      ['Saturday', 1, 1],
      ['Sunday', 0, 0],
    ]);
    expect(computeStats(h, { ...base, diet: ['vegan'], groupBy: 'month' }).groups).toEqual([
      { key: '2026-10', open_days: 10, days_served: 10 },
    ]);
    expect(computeStats(h, { ...base, groupBy: 'none' }).groups).toEqual([
      { key: 'all', open_days: 10, days_served: 10 },
    ]);
  });

  it('respects restaurants, period and language', () => {
    expect(
      computeStats(h, { ...base, query: 'keitto', restaurants: ['yolo'] }).matches.days_served,
    ).toBe(1);
    expect(
      computeStats(h, { ...base, query: 'keitto', from: '2026-10-22', to: '2026-10-22' }).matches
        .days_served,
    ).toBe(1);
    expect(computeStats(h, { ...base, query: 'lohi', language: 'fi' }).top_dishes[0]!.name).toBe(
      'Lohikeitto',
    );
  });

  it('handles an empty history', () => {
    const empty = indexHistory(buildHistoryDataset([], 'T'));
    const s = computeStats(empty, { ...base, query: 'lohi' });
    expect(s.history).toEqual({
      first_date: null,
      last_date: null,
      days_recorded: 0,
      days_missing: 0,
      restaurant_days_unavailable: 0,
    });
    expect(s.matches).toEqual({
      days_served: 0,
      dishes_matched: 0,
      first_seen: null,
      last_seen: null,
    });
  });
});
