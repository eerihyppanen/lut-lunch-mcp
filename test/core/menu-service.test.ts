import { describe, expect, it } from 'vitest';
import { CachedLoader, MemoryCacheStore } from '../../src/core/cache.js';
import { SourceError } from '../../src/core/http.js';
import { LiveMenuService } from '../../src/core/menu-service.js';
import type { MenuSource, SourceResult } from '../../src/core/sources/source.js';
import type { Course, RestaurantDay } from '../../src/core/types.js';
import { fakeSource } from '../helpers/fakes.js';

const NOW = new Date('2026-10-23T09:00:00Z');

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

const open = (d: string): SourceResult => ({
  days: { [d]: [course] },
  coverage: { from: '2026-10-19', through: '2026-10-25' },
});

function service(sources: MenuSource[], now: () => Date = () => NOW): LiveMenuService {
  const loader = new CachedLoader(new MemoryCacheStore(), () => now().getTime());
  return new LiveMenuService({ sources, loader, now });
}

function statusOf(d: RestaurantDay): string {
  return d.status.kind === 'no_menu' ? `no_menu:${d.status.reason}` : d.status.kind;
}

describe('LiveMenuService', () => {
  it('resolves statuses in spec order', async () => {
    const yolo = fakeSource('yolo', {
      days: { '2026-10-24': [course] },
      coverage: { from: '2026-10-23', through: '2026-10-27' },
    });
    const lut = fakeSource('lut-buffet', {
      days: {},
      coverage: { from: '2026-10-19', through: '2026-10-25' },
    });
    const days = await service([yolo, lut]).getDays(
      ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-28'],
      ['yolo'],
    );
    expect(days.map((d) => [d.date, statusOf(d)])).toEqual([
      ['2026-10-22', 'no_menu:history_not_available'], // before Yolo's coverage, in the past
      ['2026-10-23', 'no_menu:none_listed'],
      ['2026-10-24', 'open'], // Saturday but has dishes
      ['2026-10-25', 'no_menu:weekend'],
      ['2026-10-28', 'no_menu:not_published_yet'],
    ]);
  });

  it('reports public holidays with a name', async () => {
    const src = fakeSource('lut-buffet', {
      days: {},
      coverage: { from: '2026-10-26', through: '2026-11-01' },
    });
    const [d] = await service([src]).getDays(['2026-10-31'], ['lut-buffet']);
    expect(d!.status).toEqual({
      kind: 'no_menu',
      reason: 'public_holiday',
      holidayName: "All Saints' Day",
    });
  });

  it('isolates a failing source (review focus 4)', async () => {
    const svc = service([
      fakeSource('yolo', new SourceError('down', true)),
      fakeSource('lut-buffet', open('2026-10-23')),
    ]);
    const days = await svc.getDays(['2026-10-23'], ['lut-buffet', 'yolo']);
    expect(days.map((d) => [d.restaurantId, d.status.kind])).toEqual([
      ['lut-buffet', 'open'],
      ['yolo', 'error'],
    ]);
    expect(days[1]!.status).toEqual({ kind: 'error', retryable: true });
  });

  it('skips upstream for dates outside the window', async () => {
    const src = fakeSource('lut-buffet', open('2026-10-23'));
    const days = await service([src]).getDays(['2026-10-15', '2026-11-07'], ['lut-buffet']);
    expect(src.calls).toEqual([]);
    expect(days.map(statusOf)).toEqual([
      'no_menu:history_not_available',
      'no_menu:not_published_yet',
    ]);
  });

  it('loads each unit once per call', async () => {
    const src = fakeSource('lut-buffet', open('2026-10-23'));
    await service([src]).getDays(['2026-10-19', '2026-10-20', '2026-10-21'], ['lut-buffet']);
    expect(src.calls).toHaveLength(1);
  });

  it('sorts by date, then registry order', async () => {
    const svc = service([
      fakeSource('yolo', open('2026-10-23')),
      fakeSource('bistro-skinnarila', open('2026-10-23')),
      fakeSource('lut-buffet', open('2026-10-23')),
    ]);
    const days = await svc.getDays(['2026-10-24', '2026-10-23'], ['yolo', 'lut-buffet']);
    expect(days.map((d) => `${d.date}/${d.restaurantId}`)).toEqual([
      '2026-10-23/lut-buffet',
      '2026-10-23/yolo',
      '2026-10-24/lut-buffet',
      '2026-10-24/yolo',
    ]);
  });

  it('marks data served after a failed refresh as stale', async () => {
    let now = NOW;
    let fail = false;
    const src = fakeSource('lut-buffet', () => {
      if (fail) throw new SourceError('down', true);
      return open('2026-10-23');
    });
    const svc = service([src], () => now);
    const [first] = await svc.getDays(['2026-10-23'], ['lut-buffet']);
    expect(first).toMatchObject({ stale: false, fetchedAt: '2026-10-23T09:00:00.000Z' });
    now = new Date(NOW.getTime() + 31 * 60_000);
    fail = true;
    const [second] = await svc.getDays(['2026-10-23'], ['lut-buffet']);
    expect(second).toMatchObject({
      status: { kind: 'open' },
      stale: true,
      fetchedAt: '2026-10-23T09:00:00.000Z',
    });
  });

  it('does not call days before a source’s coverage "not published yet"', async () => {
    // Yolo's page can start after today (on a Sunday it lists Monday onwards).
    const yolo = fakeSource('yolo', {
      days: { '2026-10-26': [course] },
      coverage: { from: '2026-10-26', through: '2026-10-27' },
    });
    const days = await service([yolo]).getDays(
      ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-28'],
      ['yolo'],
    );
    expect(days.map((d) => [d.date, statusOf(d)])).toEqual([
      ['2026-10-23', 'no_menu:none_listed'],
      ['2026-10-24', 'no_menu:weekend'],
      ['2026-10-25', 'no_menu:weekend'],
      ['2026-10-26', 'open'],
      ['2026-10-28', 'no_menu:not_published_yet'],
    ]);
    const holiday = fakeSource('yolo', {
      days: {},
      coverage: { from: '2026-11-02', through: '2026-11-03' },
    });
    const [allSaints] = await service([holiday]).getDays(['2026-10-31'], ['yolo']);
    expect(allSaints!.status).toMatchObject({ reason: 'public_holiday' });
  });

  it("uses Finland's date for today", () => {
    expect(service([], () => new Date('2026-10-23T21:30:00Z')).today()).toBe('2026-10-24');
  });
});
