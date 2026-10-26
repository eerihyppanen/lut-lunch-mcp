import { WEEKDAYS, daysBetween, monthsInRange, weekdayName } from '../core/calendar/dates.js';
import type { StatsIndex } from '../core/history/stats-index.js';
import { foldText } from '../core/normalize/text.js';
import { RESTAURANT_IDS, type DietTag, type RestaurantId } from '../core/types.js';
import { matchesSearch } from './filters.js';
import { localName } from './present.js';
import type { Language, MenuStatsOutput } from './schemas.js';

export type GroupBy = 'restaurant' | 'month' | 'weekday' | 'none';

export interface StatsQuery {
  query?: string;
  diet?: DietTag[];
  restaurants: RestaurantId[];
  from: string;
  to: string;
  groupBy: GroupBy;
  top: number;
  language: Language;
}

type Stats = Pick<MenuStatsOutput, 'history' | 'matches' | 'groups' | 'top_dishes'>;
type Seen = NonNullable<MenuStatsOutput['matches']['first_seen']>;

/** Coverage of the whole history, independent of the query (spec §7 `history`). */
function summarise(index: StatsIndex): Stats['history'] {
  const { firstDate, lastDate, days } = index;
  // Days are unique and sorted, so everything between first and last not listed is missing.
  const missing = firstDate && lastDate ? daysBetween(firstDate, lastDate) + 1 - days.length : 0;
  let unavailable = 0;
  for (const day of days) {
    unavailable += day.restaurants.filter((r) => r.status === 'error').length;
  }
  return {
    first_date: firstDate,
    last_date: lastDate,
    days_recorded: days.length,
    days_missing: missing,
    restaurant_days_unavailable: unavailable,
  };
}

/** Every group key in the period, in display order, so empty groups are listed too. */
function groupKeys(q: StatsQuery, index: StatsIndex): string[] {
  if (q.groupBy === 'restaurant') return RESTAURANT_IDS.filter((id) => q.restaurants.includes(id));
  if (q.groupBy === 'weekday') return [...WEEKDAYS];
  if (q.groupBy === 'none') return ['all'];
  // Months: only where history can have data, so a wide `from` doesn't list decades of zeros.
  const from = index.firstDate && index.firstDate > q.from ? index.firstDate : q.from;
  const to = index.lastDate && index.lastDate < q.to ? index.lastDate : q.to;
  return monthsInRange(from, to);
}

function groupKey(groupBy: GroupBy, date: string, id: RestaurantId): string {
  if (groupBy === 'restaurant') return id;
  if (groupBy === 'month') return date.slice(0, 7);
  if (groupBy === 'weekday') return weekdayName(date);
  return 'all';
}

interface TopEntry {
  name: string;
  times: number;
  restaurants: Set<RestaurantId>;
  lastSeen: string;
}

/** Statistics over recorded days in [from, to] for the selected restaurants (spec §7). */
export function computeStats(index: StatsIndex, q: StatsQuery): Stats {
  const query = q.query?.trim() ? foldText(q.query) : undefined;
  const groups = new Map(
    groupKeys(q, index).map((key) => [key, { key, open_days: 0, days_served: 0 }]),
  );
  // Judged once per distinct dish on text the collector already folded (phase 3 spec §4.2).
  const matches = index.dishes.map((dish) => matchesSearch(dish.search, dish.tags, q.diet, query));
  const names = index.dishes.map((dish) => localName(dish, q.language));
  const top = new Map<string, TopEntry>();
  let daysServed = 0;
  let dishesMatched = 0;
  let firstSeen: Seen | null = null;
  let lastSeen: Seen | null = null;

  for (const { date, restaurants } of index.days) {
    if (date < q.from || date > q.to) continue;
    for (const { id, status, dishes = [] } of restaurants) {
      if (!q.restaurants.includes(id) || status !== 'open') continue;
      const group = groups.get(groupKey(q.groupBy, date, id));
      if (group) group.open_days++;

      const servedHere = new Set<string>();
      for (const dish of dishes) {
        if (!matches[dish]) continue;
        dishesMatched++;
        const seen: Seen = { date, restaurant_id: id, dish: names[dish]! };
        firstSeen ??= seen;
        if (!lastSeen || date > lastSeen.date) lastSeen = seen;

        const key = index.dishes[dish]!.key;
        if (servedHere.has(key)) continue; // a dish counts once per restaurant-day
        servedHere.add(key);
        const entry = top.get(key);
        if (!entry) {
          top.set(key, { name: seen.dish, times: 1, restaurants: new Set([id]), lastSeen: date });
        } else {
          entry.times++;
          entry.restaurants.add(id);
          if (date > entry.lastSeen) Object.assign(entry, { lastSeen: date, name: seen.dish });
        }
      }
      if (servedHere.size > 0) {
        daysServed++;
        if (group) group.days_served++;
      }
    }
  }

  const topDishes = [...top.values()]
    .sort(
      (a, b) =>
        b.times - a.times ||
        (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )
    .slice(0, q.top)
    .map((t) => ({
      name: t.name,
      times: t.times,
      restaurants: RESTAURANT_IDS.filter((id) => t.restaurants.has(id)),
      last_seen: t.lastSeen,
    }));

  return {
    history: summarise(index),
    matches: {
      days_served: daysServed,
      dishes_matched: dishesMatched,
      first_seen: firstSeen,
      last_seen: lastSeen,
    },
    groups: [...groups.values()],
    top_dishes: topDishes,
  };
}
