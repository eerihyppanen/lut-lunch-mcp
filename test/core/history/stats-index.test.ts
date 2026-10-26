import { describe, expect, it } from 'vitest';
import { StatsIndexSchema } from '../../../src/core/history/schema.js';
import { buildStatsIndex } from '../../../src/core/history/stats-index.js';
import { fixtureHistoryDays } from '../../helpers/history-fixture.js';

describe('buildStatsIndex', () => {
  it('stores each dish once and refers to it by index', async () => {
    const days = await fixtureHistoryDays();
    const index = buildStatsIndex(days, 'T');
    const served = days
      .flatMap((d) => d.restaurants)
      .flatMap((r) => (r.status.kind === 'open' ? r.status.courses.flatMap((c) => c.dishes) : []));
    const keys = new Set(index.dishes.map((d) => JSON.stringify([d.fi, d.en, d.tags])));
    expect(keys.size).toBe(index.dishes.length);
    expect(index.dishes.length).toBeLessThan(served.length);

    const first = index.days[0]!.restaurants[0]!; // 2026-10-19, lut-buffet
    const recorded = days[0]!.restaurants[0]!.status;
    expect(first.status).toBe('open');
    expect(first.dishes!.map((i) => index.dishes[i]!.fi)).toEqual(
      recorded.kind === 'open'
        ? recorded.courses.flatMap((c) => c.dishes.map((d) => d.name.fi))
        : [],
    );
  });

  it('keeps statuses, dates and order, without dishes for closed days', async () => {
    const index = buildStatsIndex(await fixtureHistoryDays(), 'T');
    expect(index).toMatchObject({ schema: 1, firstDate: '2026-10-19', lastDate: '2026-10-25' });
    expect(index.days.map((d) => d.date)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    const yolo22 = index.days[2]!.restaurants.find((r) => r.id === 'yolo')!;
    expect(yolo22).toEqual({ id: 'yolo', status: 'error' });
  });

  it('is deterministic and validates against its schema', async () => {
    const days = await fixtureHistoryDays();
    const a = buildStatsIndex(days, 'T');
    expect(JSON.stringify(buildStatsIndex([...days].reverse(), 'T'))).toBe(JSON.stringify(a));
    expect(StatsIndexSchema.parse(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(buildStatsIndex([], 'T')).toMatchObject({
      firstDate: null,
      lastDate: null,
      dishes: [],
      days: [],
    });
  });
});
