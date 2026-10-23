import { isoWeekMonday } from '../../src/core/calendar/dates.js';
import type { MenuSource, SourceResult } from '../../src/core/sources/source.js';
import type { MenuService, RestaurantDay, RestaurantId } from '../../src/core/types.js';

/** A MenuService that serves a fixed set of days. */
export function fakeService(days: RestaurantDay[] = [], today = '2026-10-23'): MenuService {
  return {
    today: () => today,
    getDays: (dates, restaurants) =>
      Promise.resolve(
        days.filter((d) => dates.includes(d.date) && restaurants.includes(d.restaurantId)),
      ),
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
