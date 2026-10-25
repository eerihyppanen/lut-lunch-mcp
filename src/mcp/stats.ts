import { WEEKDAYS, datesInRange, weekdayName } from '../core/calendar/dates.js';
import type { History } from '../core/history/types.js';
import { foldText } from '../core/normalize/text.js';
import { RESTAURANT_IDS, type DietTag, type RestaurantId } from '../core/types.js';
import { judgeDish } from './filters.js';
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
function summarise(history: History): Stats['history'] {
  const { firstDate, lastDate, days } = history;
  const missing =
    firstDate && lastDate
      ? datesInRange(firstDate, lastDate).filter((d) => !days.has(d)).length
      : 0;
  let unavailable = 0;
  for (const day of days.values()) {
    unavailable += day.restaurants.filter((r) => r.status.kind === 'error').length;
  }
  return {
    first_date: firstDate,
    last_date: lastDate,
    days_recorded: days.size,
    days_missing: missing,
    restaurant_days_unavailable: unavailable,
  };
}

/** Every group key in the period, in display order, so empty groups are listed too. */
function groupKeys(q: StatsQuery, history: History): string[] {
  if (q.groupBy === 'restaurant') return RESTAURANT_IDS.filter((id) => q.restaurants.includes(id));
  if (q.groupBy === 'weekday') return [...WEEKDAYS];
  if (q.groupBy === 'none') return ['all'];
  // Months: only where history can have data, so a wide `from` doesn't list decades of zeros.
  const from = history.firstDate && history.firstDate > q.from ? history.firstDate : q.from;
  const to = history.lastDate && history.lastDate < q.to ? history.lastDate : q.to;
  return from > to ? [] : [...new Set(datesInRange(from, to).map((d) => d.slice(0, 7)))];
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
export function computeStats(history: History, q: StatsQuery): Stats {
  const filter = { query: q.query?.trim() || undefined, diet: q.diet };
  const groups = new Map(
    groupKeys(q, history).map((key) => [key, { key, open_days: 0, days_served: 0 }]),
  );
  const top = new Map<string, TopEntry>();
  let daysServed = 0;
  let dishesMatched = 0;
  let firstSeen: Seen | null = null;
  let lastSeen: Seen | null = null;

  const dates = [...history.days.keys()].filter((d) => d >= q.from && d <= q.to).sort();
  for (const date of dates) {
    const day = history.days.get(date)!;
    for (const { id, status } of day.restaurants) {
      if (!q.restaurants.includes(id) || status.kind !== 'open') continue;
      const group = groups.get(groupKey(q.groupBy, date, id));
      if (group) group.open_days++;

      const servedHere = new Set<string>();
      for (const course of status.courses) {
        for (const dish of course.dishes) {
          if (judgeDish(dish, filter) !== 'keep') continue;
          dishesMatched++;
          const seen: Seen = { date, restaurant_id: id, dish: localName(dish.name, q.language) };
          firstSeen ??= seen;
          if (!lastSeen || date > lastSeen.date) lastSeen = seen;

          const key = foldText(dish.name.fi);
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
    history: summarise(history),
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
