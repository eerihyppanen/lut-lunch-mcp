import { describe, expect, it, vi } from 'vitest';
import type { RestaurantDay } from '../../src/core/types.js';
import type { History } from '../../src/core/history/types.js';
import { HistorySchemaError } from '../../src/core/history/remote.js';
import type { FindDishesOutput } from '../../src/mcp/schemas.js';
import { call, connectClient } from '../helpers/connect.js';
import { fixtureHistory, historyService } from '../helpers/history-fixture.js';

function statusOf(d: RestaurantDay): string {
  return d.status.kind === 'no_menu' ? `no_menu:${d.status.reason}` : d.status.kind;
}

// historyService(): fixture history (19–25 Oct, 21st missing, Yolo failed on the 22nd),
// today 2026-10-30, live sources serving the captured week of 19 Oct.
describe('LiveMenuService with history', () => {
  it('serves recorded past days from history', async () => {
    const days = await historyService().getDays(
      ['2026-10-20', '2026-10-22'],
      ['lut-buffet', 'yolo'],
    );
    expect(days.map((d) => [d.date, d.restaurantId, statusOf(d)])).toEqual([
      ['2026-10-20', 'lut-buffet', 'open'],
      ['2026-10-20', 'yolo', 'no_menu:none_listed'],
      ['2026-10-22', 'lut-buffet', 'open'],
      ['2026-10-22', 'yolo', 'no_menu:history_not_available'], // collection failed that day
    ]);
    expect(days[0]).toMatchObject({ stale: false, fetchedAt: '2026-10-20T06:30:00.000Z' });
  });

  it('answers days before or between recorded history (review focus 1)', async () => {
    const days = await historyService().getDays(['2025-05-05', '2026-10-21'], ['lut-buffet']);
    expect(days.map(statusOf)).toEqual([
      'no_menu:history_not_available',
      'no_menu:history_not_available',
    ]);
  });

  it('falls back to live sources inside the window when a day is not recorded', async () => {
    const days = await historyService({ now: new Date('2026-10-24T09:00:00Z') }).getDays(
      ['2026-10-21'],
      ['bistro-skinnarila'],
    );
    expect(statusOf(days[0]!)).toBe('open'); // live fixture week, 3 days back
  });

  it('reports history outages only where waiting can help', async () => {
    const days = await historyService({ history: 'failing' }).getDays(
      ['2026-10-20', '2026-10-29'],
      ['lut-buffet'],
    );
    expect(days.map((d) => d.status)).toEqual([
      { kind: 'error', retryable: true }, // outside window: history needed
      { kind: 'no_menu', reason: 'history_not_available' }, // inside window: live (unpublished week)
    ]);
  });

  it('does not load history for today and future dates', async () => {
    const load = vi.fn();
    await historyService({ history: { load } }).getDays(['2026-10-30', '2026-10-31'], ['yolo']);
    expect(load).not.toHaveBeenCalled();
  });

  it('exposes loadHistory', async () => {
    expect((await historyService().loadHistory()).firstDate).toBe('2026-10-19');
  });

  it('describes past dates in the tool descriptions', async () => {
    const { tools } = await (await connectClient(historyService())).listTools();
    const description = (name: string) => tools.find((t) => t.name === name)!.description;
    expect(description('get_menu')).toContain('including past days from the recorded history');
    expect(description('find_dishes')).toContain(
      'Past dates are searched in the recorded history, up to 14 days per search',
    );
  });

  it('keeps today working when the history is broken (review focus 3)', async () => {
    const svc = historyService({
      history: {
        load: () => Promise.reject(new HistorySchemaError(2)),
      },
    });
    const [today] = await svc.getDays(['2026-10-30'], ['lut-buffet']);
    expect(today!.status.kind).not.toBe('error');
    const [old] = await svc.getDays(['2026-10-20'], ['lut-buffet']);
    expect(old!.status).toEqual({ kind: 'error', retryable: false });
  });

  it('reads a recorded "not published yet" as nothing listed for a past day (review finding 3)', async () => {
    const h = await fixtureHistory();
    const day = h.days.get('2026-10-20')!;
    const closed = {
      ...day,
      restaurants: day.restaurants.map((r) =>
        r.id === 'lut-buffet'
          ? { ...r, status: { kind: 'no_menu' as const, reason: 'not_published_yet' as const } }
          : r,
      ),
    };
    const history: History = { ...h, days: new Map([...h.days, ['2026-10-20', closed]]) };
    const [d] = await historyService({ history: { load: () => Promise.resolve(history) } }).getDays(
      ['2026-10-20'],
      ['lut-buffet'],
    );
    expect(statusOf(d!)).toBe('no_menu:none_listed');
  });

  it('finds dishes over a past range end to end (spec §9)', async () => {
    const out = await call<FindDishesOutput>(await connectClient(historyService()), 'find_dishes', {
      query: 'lohi',
      from: '2026-10-19',
      to: '2026-10-25',
    });
    expect(out.matches.map((m) => [m.date, m.restaurant_id, m.dish.name])).toEqual([
      ['2026-10-23', 'yolo', 'Salmon soup'],
    ]);
  });
});
