import { describe, expect, it } from 'vitest';
import {
  buildStatsIndex,
  decodeStatsIndex,
  encodeStatsIndex,
} from '../../../src/core/history/stats-index.js';
import { dishSearchText, foldText } from '../../../src/core/normalize/text.js';
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
    // Folded once by the collector, so queries never fold text (phase 3 CPU budget).
    index.dishes.forEach((d, i) => {
      expect(d.search).toBe(dishSearchText(d));
      const first = index.dishes.findIndex((o) => foldText(o.fi) === foldText(d.fi));
      expect(d.group).toBe(first); // dishes with the same Finnish name share a group
      expect(first).toBeLessThanOrEqual(i);
    });

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

  it('is deterministic', async () => {
    const days = await fixtureHistoryDays();
    const a = buildStatsIndex(days, 'T');
    expect(JSON.stringify(buildStatsIndex([...days].reverse(), 'T'))).toBe(JSON.stringify(a));
    expect(buildStatsIndex([], 'T')).toMatchObject({
      firstDate: null,
      lastDate: null,
      dishes: [],
      days: [],
    });
  });
});

describe('stats.json encoding', () => {
  it('round-trips through a compact file', async () => {
    const index = buildStatsIndex(await fixtureHistoryDays(), 'T');
    const file = JSON.stringify(encodeStatsIndex(index));
    expect(decodeStatsIndex(JSON.parse(file))).toEqual(index);
    expect(file.length).toBeLessThan(JSON.stringify(index).length / 1.5);
    const empty = buildStatsIndex([], 'T');
    expect(decodeStatsIndex(JSON.parse(JSON.stringify(encodeStatsIndex(empty))))).toEqual(empty);
  });

  it('rejects malformed files', async () => {
    const good = encodeStatsIndex(buildStatsIndex(await fixtureHistoryDays(), 'T'));
    const variants: unknown[] = [
      'not an object',
      { ...good, days: 'nope' },
      { ...good, restaurants: ['nowhere'] },
      { ...good, tags: ['carnivore'] },
      { ...good, dishes: [['Keitto', null, 0, 'keitto', 5]] }, // group points ahead
      { ...good, days: [['2026-10-19', [['open', [999]]]]] }, // unknown dish
      { ...good, days: [['2026-10-19', [['closed']]]] }, // unknown status
    ];
    for (const json of variants) expect(decodeStatsIndex(json)).toBeNull();
  });
});
