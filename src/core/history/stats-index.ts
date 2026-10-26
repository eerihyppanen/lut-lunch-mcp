import { dishSearchText, foldText } from '../normalize/text.js';
import {
  DIET_TAGS,
  RESTAURANT_IDS,
  type DayStatus,
  type DietTag,
  type RestaurantId,
} from '../types.js';
import { ATTRIBUTION } from './snapshot.js';
import type { HistoryDay } from './types.js';

// stats.json (phase 3 spec §4.1): the history reduced to what menu_stats needs, small enough to
// parse and query within a Worker's CPU budget. Dishes repeat a lot, so each is stored once.

export interface IndexedDish {
  fi: string;
  en: string | null;
  tags: DietTag[];
  /** Index of the first dish with the same folded Finnish name: "most common" counts it as one. */
  group: number;
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
  const groups = new Map<string, number>();
  const idOf = (name: { fi: string; en: string | null }, tags: DietTag[]): number => {
    const identity = JSON.stringify([name.fi, name.en, tags]);
    let id = ids.get(identity);
    if (id === undefined) {
      // Folded here, once per distinct dish, so queries never fold text (phase 3 spec §4.2).
      const key = foldText(name.fi);
      const group = groups.get(key) ?? dishes.length;
      groups.set(key, group);
      id = dishes.push({ ...name, tags, group, search: dishSearchText(name) }) - 1;
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

// The file is compact because parsing is most of a cold request's CPU (phase 3 spec §4.1): diet
// tags are a bitmask over `tags`, and each day lists its restaurants by position in
// `restaurants` (null when not recorded). The file names both orders, so it explains itself.

type StatusKind = DayStatus['kind'];
type FileDish = [fi: string, en: string | null, tags: number, search: string, group: number];
type FileRestaurantDay = [status: StatusKind, dishes?: number[]] | null;
type FileDay = [date: string, restaurants: FileRestaurantDay[]];

export interface StatsFile {
  schema: 1;
  generatedAt: string;
  firstDate: string | null;
  lastDate: string | null;
  attribution: string;
  restaurants: RestaurantId[];
  tags: DietTag[];
  dishes: FileDish[];
  days: FileDay[];
}

const STATUSES: readonly StatusKind[] = ['open', 'no_menu', 'error'];

export function encodeStatsIndex(index: StatsIndex): StatsFile {
  const { schema, generatedAt, firstDate, lastDate, attribution } = index;
  return {
    schema,
    generatedAt,
    firstDate,
    lastDate,
    attribution,
    restaurants: [...RESTAURANT_IDS],
    tags: [...DIET_TAGS],
    dishes: index.dishes.map((d) => [
      d.fi,
      d.en,
      d.tags.reduce((bits, tag) => bits | (1 << DIET_TAGS.indexOf(tag)), 0),
      d.search,
      d.group,
    ]),
    days: index.days.map((day) => [
      day.date,
      RESTAURANT_IDS.map((id): FileRestaurantDay => {
        const r = day.restaurants.find((x) => x.id === id);
        if (!r) return null;
        return r.dishes ? [r.status, r.dishes] : [r.status];
      }),
    ]),
  };
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isIndex = (v: unknown, below: number): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < below;

/** Validates and decodes stats.json in one pass; null when it is malformed. */
export function decodeStatsIndex(json: unknown): StatsIndex | null {
  if (typeof json !== 'object' || json === null) return null;
  const f = json as Partial<Record<keyof StatsFile, unknown>>;
  if (f.schema !== 1 || !isString(f.generatedAt) || !isString(f.attribution)) return null;
  if (!(f.firstDate === null || isString(f.firstDate))) return null;
  if (!(f.lastDate === null || isString(f.lastDate))) return null;
  const { restaurants, tags, dishes, days } = f;
  if (!Array.isArray(restaurants) || !Array.isArray(tags)) return null;
  if (!Array.isArray(dishes) || !Array.isArray(days)) return null;
  const ids = restaurants as unknown[];
  if (!ids.every((id) => (RESTAURANT_IDS as readonly unknown[]).includes(id))) return null;
  if (!(tags as unknown[]).every((t) => (DIET_TAGS as readonly unknown[]).includes(t))) return null;

  const decodedDishes: IndexedDish[] = [];
  for (const [i, d] of (dishes as unknown[]).entries()) {
    if (!Array.isArray(d) || d.length !== 5) return null;
    const [fi, en, bits, search, group] = d as unknown[];
    if (!isString(fi) || !(en === null || isString(en)) || !isString(search)) return null;
    if (!Number.isInteger(bits) || !isIndex(group, i + 1)) return null;
    const dishTags = (tags as DietTag[]).filter((_, bit) => ((bits as number) & (1 << bit)) !== 0);
    decodedDishes.push({ fi, en, tags: dishTags, group, search });
  }

  const decodedDays: IndexedDay[] = [];
  for (const day of days as unknown[]) {
    if (!Array.isArray(day) || day.length !== 2) return null;
    const [date, entries] = day as unknown[];
    if (!isString(date) || !Array.isArray(entries) || entries.length > ids.length) return null;
    const restaurantDays: IndexedRestaurantDay[] = [];
    for (const [pos, entry] of (entries as unknown[]).entries()) {
      if (entry === null) continue;
      if (!Array.isArray(entry)) return null;
      const [status, served] = entry as unknown[];
      if (!STATUSES.includes(status as StatusKind)) return null;
      const id = ids[pos] as RestaurantId;
      if (served === undefined) {
        restaurantDays.push({ id, status: status as StatusKind });
        continue;
      }
      if (!Array.isArray(served)) return null;
      if (!served.every((n) => isIndex(n, decodedDishes.length))) return null;
      restaurantDays.push({ id, status: status as StatusKind, dishes: served });
    }
    decodedDays.push({ date, restaurants: restaurantDays });
  }

  return {
    schema: 1,
    generatedAt: f.generatedAt,
    firstDate: f.firstDate,
    lastDate: f.lastDate,
    attribution: f.attribution,
    dishes: decodedDishes,
    days: decodedDays,
  };
}
