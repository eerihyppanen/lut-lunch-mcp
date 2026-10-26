import type { StatsIndex } from './history/stats-index.js';

export const RESTAURANT_IDS = ['lut-buffet', 'bistro-skinnarila', 'yolo'] as const;
export type RestaurantId = (typeof RESTAURANT_IDS)[number];

export const DIET_TAGS = [
  'vegan',
  'vegetarian',
  'gluten_free',
  'milk_free',
  'lactose_free',
  'low_lactose',
] as const;
export type DietTag = (typeof DIET_TAGS)[number];

/** The EU's 14 mandatory allergens, in the order used throughout the project. */
export const ALLERGENS = [
  'gluten',
  'milk',
  'egg',
  'fish',
  'crustaceans',
  'molluscs',
  'peanuts',
  'nuts',
  'soy',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export type AllergenCoverage = 'full' | 'partial' | 'none';

export interface DishAllergens {
  /** How complete `contains` is, derived from `assessed`. */
  coverage: AllergenCoverage;
  contains: Allergen[];
  mayContain: Allergen[];
  /** Allergens the source makes a statement about, present or absent. */
  assessed: Allergen[];
}

export interface LocalizedName {
  fi: string;
  /** Null when the source has no real English translation. */
  en: string | null;
}

export interface Dish {
  name: LocalizedName;
  /** Canonical diet tags, after implication rules. */
  tags: DietTag[];
  /** Raw source codes, e.g. ["G", "L", "VS"]. */
  codes: string[];
  allergens: DishAllergens;
}

export interface Course {
  name: LocalizedName;
  price: string | null;
  dishes: Dish[];
}

export type NoMenuReason =
  'weekend' | 'public_holiday' | 'none_listed' | 'not_published_yet' | 'history_not_available';

export type DayStatus =
  | { kind: 'open'; courses: Course[] }
  | { kind: 'no_menu'; reason: NoMenuReason; holidayName?: string }
  /** `origin: 'history'`: the recorded history could not be loaded, not the restaurant's source. */
  | { kind: 'error'; retryable: boolean; origin?: 'history' };

export interface RestaurantDay {
  restaurantId: RestaurantId;
  /** YYYY-MM-DD in Europe/Helsinki. */
  date: string;
  status: DayStatus;
  /** Served from cache after a failed refresh. */
  stale: boolean;
  /** ISO timestamp of the upstream fetch. */
  fetchedAt: string;
}

export interface MenuService {
  getDays(dates: string[], restaurants: RestaurantId[]): Promise<RestaurantDay[]>;
  /** Today's date in Europe/Helsinki. */
  today(): string;
  /** The recorded history's stats.json; rejects with SourceError when it is unavailable. */
  loadStatsIndex(): Promise<StatsIndex>;
}
