import { dishSearchText, foldText } from '../normalize/text.js';
import type { DayStatus, DietTag, RestaurantId } from '../types.js';
import { ATTRIBUTION } from './snapshot.js';
import type { HistoryDay } from './types.js';

// stats.json (phase 3 spec §4.1): the history reduced to what menu_stats needs, small enough to
// parse and query within a Worker's CPU budget. Dishes repeat a lot, so each is stored once.

export interface IndexedDish {
  fi: string;
  en: string | null;
  tags: DietTag[];
  /** foldText(fi): how dishes are told apart in "most common". */
  key: string;
  /** dishSearchText({ fi, en }): what a text query is matched against. */
  search: string;
}

export interface IndexedRestaurantDay {
  id: RestaurantId;
  status: DayStatus['kind'];
  /** Indexes into StatsIndex.dishes, in menu order; only for `open`. */
  dishes?: number[];
}

export interface IndexedDay {
  date: string;
  restaurants: IndexedRestaurantDay[];
}

export interface StatsIndex {
  schema: 1;
  generatedAt: string;
  firstDate: string | null;
  lastDate: string | null;
  attribution: string;
  dishes: IndexedDish[];
  /** Sorted by date; restaurants in registry order. */
  days: IndexedDay[];
}

/** The index for a set of recorded days; deterministic apart from `generatedAt`. */
export function buildStatsIndex(days: HistoryDay[], generatedAt: string): StatsIndex {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dishes: IndexedDish[] = [];
  const ids = new Map<string, number>();
  const idOf = (name: { fi: string; en: string | null }, tags: DietTag[]): number => {
    const identity = JSON.stringify([name.fi, name.en, tags]);
    let id = ids.get(identity);
    if (id === undefined) {
      // Folded here, once per distinct dish, so queries never fold text (phase 3 spec §4.2).
      const dish = { ...name, tags, key: foldText(name.fi), search: dishSearchText(name) };
      id = dishes.push(dish) - 1;
      ids.set(identity, id);
    }
    return id;
  };

  const indexed = sorted.map((day): IndexedDay => ({
    date: day.date,
    restaurants: day.restaurants.map(({ id, status }): IndexedRestaurantDay => {
      if (status.kind !== 'open') return { id, status: status.kind };
      const served = status.courses.flatMap((course) =>
        course.dishes.map((d) => idOf({ fi: d.name.fi, en: d.name.en }, d.tags)),
      );
      return { id, status: 'open', dishes: served };
    }),
  }));

  return {
    schema: 1,
    generatedAt,
    firstDate: sorted[0]?.date ?? null,
    lastDate: sorted.at(-1)?.date ?? null,
    attribution: ATTRIBUTION,
    dishes,
    days: indexed,
  };
}
