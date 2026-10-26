import { dishSearchText, foldText } from '../core/normalize/text.js';
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

/**
 * The diet and text-query part of the filter on already folded text: `search` is
 * dishSearchText(name), `foldedQuery` is foldText(query). Statistics call it with values folded
 * once per dish and query.
 */
export function matchesSearch(
  search: string,
  tags: DietTag[],
  diet: DietTag[] | undefined,
  foldedQuery: string | undefined,
): boolean {
  if (diet?.some((tag) => !tags.includes(tag))) return false;
  return !foldedQuery || search.includes(foldedQuery);
}

export function matchesNameAndDiet(
  name: { fi: string; en: string | null },
  tags: DietTag[],
  filter: Pick<DishFilter, 'query' | 'diet'>,
): boolean {
  const query = filter.query ? foldText(filter.query) : undefined;
  return matchesSearch(dishSearchText(name), tags, filter.diet, query);
}

export function judgeDish(dish: Dish, filter: DishFilter): FilterVerdict {
  if (!matchesNameAndDiet(dish.name, dish.tags, filter)) return 'hidden';
  const verdicts = (filter.excludeAllergens ?? []).map((a) => allergenVerdict(dish, a));
  if (verdicts.includes('excluded')) return 'hidden';
  if (verdicts.includes('unverifiable')) return 'unverifiable';
  return 'keep';
}

/** True when diet or allergen filters are in use, which triggers the allergen notice. */
export function hasFilters(filter: DishFilter): boolean {
  return Boolean(filter.diet?.length || filter.excludeAllergens?.length);
}
