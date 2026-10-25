import { getRestaurant } from '../core/restaurants.js';
import type { DayStatus, Dish, LocalizedName, RestaurantDay } from '../core/types.js';
import { judgeDish, type DishFilter } from './filters.js';
import type { DishOut, Language, RestaurantDayOut } from './schemas.js';

/** Shown whenever diet or allergen filters are used (spec §6.4). */
export const NOTICE =
  'Diet and allergen labels come from the restaurants and can change. People with allergies ' +
  'should confirm at the restaurant.';

export function localName(name: LocalizedName, lang: Language): string {
  return lang === 'en' ? (name.en ?? name.fi) : name.fi;
}

export function presentDish(dish: Dish, lang: Language): DishOut {
  return {
    name: localName(dish.name, lang),
    untranslated: lang === 'en' && dish.name.en === null,
    tags: dish.tags,
    codes: dish.codes,
    allergens: {
      coverage: dish.allergens.coverage,
      contains: dish.allergens.contains,
      may_contain: dish.allergens.mayContain,
    },
  };
}

/** Why a restaurant has no menu: its no-menu reason, or what kind of source failure it was. */
export function explainNoMenu(status: Exclude<DayStatus, { kind: 'open' }>): {
  reason: NonNullable<RestaurantDayOut['reason']>;
  holiday_name: string | null;
} {
  if (status.kind === 'error') {
    const reason =
      status.origin === 'history'
        ? 'history_unavailable'
        : status.retryable
          ? 'source_unavailable'
          : 'source_error';
    return { reason, holiday_name: null };
  }
  return { reason: status.reason, holiday_name: status.holidayName ?? null };
}

export function presentRestaurantDay(
  day: RestaurantDay,
  lang: Language,
  filter: DishFilter,
): RestaurantDayOut {
  const restaurant = getRestaurant(day.restaurantId);
  const out: RestaurantDayOut = {
    id: restaurant.id,
    name: restaurant.name,
    status: day.status.kind,
    reason: null,
    holiday_name: null,
    stale: day.stale,
    source_url: restaurant.menuUrl,
    courses: [],
    hidden_by_filters: 0,
    unverifiable: 0,
  };

  if (day.status.kind !== 'open') return { ...out, ...explainNoMenu(day.status) };

  for (const course of day.status.courses) {
    const dishes: DishOut[] = [];
    for (const dish of course.dishes) {
      const verdict = judgeDish(dish, filter);
      if (verdict === 'keep') dishes.push(presentDish(dish, lang));
      else if (verdict === 'hidden') out.hidden_by_filters++;
      else out.unverifiable++;
    }
    if (dishes.length) {
      out.courses.push({ name: localName(course.name, lang), price: course.price, dishes });
    }
  }
  return out;
}
