import { isoWeekMonday } from '../../src/core/calendar/dates.js';
import type { History } from '../../src/core/history/types.js';
import { SourceError } from '../../src/core/http.js';
import type { MenuSource, SourceResult } from '../../src/core/sources/source.js';
import type { MenuService, RestaurantDay, RestaurantId } from '../../src/core/types.js';

/**
 * A MenuService that serves a fixed set of days, and optionally a fixed history. Without a
 * history, loadHistory rejects as temporarily unavailable.
 */
export function fakeService(
  days: RestaurantDay[] = [],
  today = '2026-10-23',
  history?: History,
): MenuService {
  return {
    today: () => today,
    getDays: (dates, restaurants) =>
      Promise.resolve(
        days.filter((d) => dates.includes(d.date) && restaurants.includes(d.restaurantId)),
      ),
    loadHistory: () =>
      history
        ? Promise.resolve(history)
        : Promise.reject(new SourceError('Menu history is temporarily unavailable', true)),
  };
}

/** A MenuSource returning a fixed result, failing with an error, or computing a result per date. */
export function fakeSource(
  id: RestaurantId,
  result: SourceResult | Error | ((date: string) => SourceResult),
): MenuSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    restaurantId: id,
    freshMs: 30 * 60_000,
    calls,
    unitKey: (date) => `${id}:${isoWeekMonday(date)}`,
    fetchUnit(date) {
      calls.push(date);
      try {
        if (result instanceof Error) throw result;
        return Promise.resolve(typeof result === 'function' ? result(date) : result);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}
