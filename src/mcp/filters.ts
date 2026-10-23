import { foldText } from '../core/normalize/text.js';
import type { Allergen, DietTag, Dish } from '../core/types.js';

export interface DishFilter {
  diet?: DietTag[];
  excludeAllergens?: Allergen[];
  query?: string;
}

/** keep: matches; hidden: filtered out; unverifiable: left out because allergen data is missing. */
export type FilterVerdict = 'keep' | 'hidden' | 'unverifiable';

/**
 * Whether a dish is safe from one allergen *according to its labels* (spec §6.2).
 * Gluten and milk are decided by the gluten-free / milk-free labels every source has, so a
 * gluten-free oat dish passes even when its allergen list mentions oats. Anything else needs
 * the source to have assessed that allergen; unknown is never treated as safe.
 */
export function allergenVerdict(
  dish: Dish,
  allergen: Allergen,
): 'ok' | 'excluded' | 'unverifiable' {
  if (allergen === 'gluten') return dish.tags.includes('gluten_free') ? 'ok' : 'excluded';
  if (allergen === 'milk') return dish.tags.includes('milk_free') ? 'ok' : 'excluded';
  const { contains, mayContain, assessed } = dish.allergens;
  if (contains.includes(allergen) || mayContain.includes(allergen)) return 'excluded';
  return assessed.includes(allergen) ? 'ok' : 'unverifiable';
}

export function judgeDish(dish: Dish, filter: DishFilter): FilterVerdict {
  if (filter.diet?.some((tag) => !dish.tags.includes(tag))) return 'hidden';
  if (filter.query) {
    const haystack = foldText(`${dish.name.fi} ${dish.name.en ?? ''}`);
    if (!haystack.includes(foldText(filter.query))) return 'hidden';
  }
  const verdicts = (filter.excludeAllergens ?? []).map((a) => allergenVerdict(dish, a));
  if (verdicts.includes('excluded')) return 'hidden';
  if (verdicts.includes('unverifiable')) return 'unverifiable';
  return 'keep';
}

/** True when diet or allergen filters are in use, which triggers the allergen notice. */
export function hasFilters(filter: DishFilter): boolean {
  return Boolean(filter.diet?.length || filter.excludeAllergens?.length);
}
