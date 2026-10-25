import { describe, expect, it } from 'vitest';
import { HistoryDatasetSchema } from '../../../src/core/history/schema.js';
import {
  buildHistoryDataset,
  indexHistory,
  mergeHistoryDay,
  toHistoryDay,
} from '../../../src/core/history/snapshot.js';
import type { Course, RestaurantDay, RestaurantId } from '../../../src/core/types.js';
import { fixtureHistoryDays } from '../../helpers/history-fixture.js';

const course: Course = {
  name: { fi: 'Lounas', en: 'Lunch' },
  price: null,
  dishes: [
    {
      name: { fi: 'Keitto', en: 'Soup' },
      tags: [],
      codes: [],
      allergens: { coverage: 'none', contains: [], mayContain: [], assessed: [] },
    },
  ],
};

const open = (id: RestaurantId): RestaurantDay => ({
  restaurantId: id,
  date: '2026-10-26',
  status: { kind: 'open', courses: [course] },
  stale: true,
  fetchedAt: 'x',
});
const err = (id: RestaurantId): RestaurantDay => ({
  ...open(id),
  status: { kind: 'error', retryable: true },
});
const closed = (id: RestaurantId): RestaurantDay => ({
  ...open(id),
  status: { kind: 'no_menu', reason: 'weekend' },
});

describe('history snapshots', () => {
  it('builds a day in registry order without runtime fields', () => {
    const day = toHistoryDay(
      '2026-10-26',
      [open('yolo'), err('lut-buffet'), closed('bistro-skinnarila')],
      '2026-10-26T06:30:00.000Z',
      '0.2.0',
    );
    expect(day.restaurants.map((r) => r.id)).toEqual(['lut-buffet', 'bistro-skinnarila', 'yolo']);
    expect(day).toMatchObject({
      schema: 1,
      date: '2026-10-26',
      collectedAt: '2026-10-26T06:30:00.000Z',
      collectorVersion: '0.2.0',
    });
    expect(JSON.stringify(day)).not.toMatch(/stale|fetchedAt/);
  });

  it('records only what the source said about the day (code review #7, #1)', () => {
    const notPublished: RestaurantDay = {
      ...open('lut-buffet'),
      status: { kind: 'no_menu', reason: 'not_published_yet' },
    };
    const noLonger: RestaurantDay = {
      ...open('yolo'),
      status: { kind: 'no_menu', reason: 'history_not_available' },
    };
    const day = toHistoryDay(
      '2026-10-26',
      [notPublished, open('bistro-skinnarila'), noLonger],
      'T',
      '0.2.1',
    );
    expect(day.restaurants.map((r) => r.status)).toEqual([
      { kind: 'no_menu', reason: 'none_listed' }, // nothing published for a day being recorded
      { kind: 'open', courses: [course] },
      { kind: 'error', retryable: true }, // the source no longer lists the day: not collected
    ]);
  });

  it('merges by rank and never replaces a recorded menu', () => {
    const first = toHistoryDay(
      '2026-10-26',
      [open('lut-buffet'), err('bistro-skinnarila'), closed('yolo')],
      'T1',
      '0.2.0',
    );
    const retry = toHistoryDay(
      '2026-10-26',
      [err('lut-buffet'), open('bistro-skinnarila'), err('yolo')],
      'T2',
      '0.2.0',
    );
    const { day, changed } = mergeHistoryDay(first, retry);
    expect(changed).toBe(true);
    expect(day.restaurants.map((r) => r.status.kind)).toEqual(['open', 'open', 'no_menu']);
    expect(day.collectedAt).toBe('T2');
  });

  it('reports no change for an identical or worse run (review focus 4)', () => {
    const first = toHistoryDay(
      '2026-10-26',
      [open('lut-buffet'), open('bistro-skinnarila'), closed('yolo')],
      'T1',
      '0.2.0',
    );
    const again = toHistoryDay(
      '2026-10-26',
      [open('lut-buffet'), err('bistro-skinnarila'), closed('yolo')],
      'T2',
      '0.2.0',
    );
    expect(mergeHistoryDay(first, again)).toEqual({ day: first, changed: false });
    expect(mergeHistoryDay(null, first)).toEqual({ day: first, changed: true });
  });

  it('builds and indexes a dataset', async () => {
    const days = await fixtureHistoryDays();
    const dataset = buildHistoryDataset([...days].reverse(), '2026-10-25T07:00:00.000Z');
    expect(dataset.days.map((d) => d.date)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(dataset).toMatchObject({ schema: 1, firstDate: '2026-10-19', lastDate: '2026-10-25' });
    expect(dataset.sources.map((s) => s.id)).toEqual(['lut-buffet', 'bistro-skinnarila', 'yolo']);
    expect(HistoryDatasetSchema.safeParse(JSON.parse(JSON.stringify(dataset))).success).toBe(true);
    const history = indexHistory(dataset);
    expect(history.days.get('2026-10-22')!.restaurants[2]!.status).toEqual({
      kind: 'error',
      retryable: true,
    });
    expect(indexHistory(buildHistoryDataset([], 'T'))).toMatchObject({
      firstDate: null,
      lastDate: null,
    });
  });
});
