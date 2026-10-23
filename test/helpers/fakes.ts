import type { MenuService, RestaurantDay } from '../../src/core/types.js';

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
