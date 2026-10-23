import { DIET_TAGS, type DietTag, type LocalizedName } from '../types.js';
import { KNOWN_CODES, type SourceId } from './codes.js';
import { warnOnce } from './warn.js';

// Codes that carry a diet meaning; the rest of KNOWN_CODES (allergen markers, "*", "+",
// "A", "ILM", "VS") stay in Dish.codes only (spec §6.1).
const DIET_CODES: Record<SourceId, Record<string, DietTag>> = {
  poweresta: {
    G: 'gluten_free',
    L: 'lactose_free',
    M: 'milk_free',
    VL: 'low_lactose',
    VE: 'vegan',
    VG: 'vegan',
  },
  compass: {
    G: 'gluten_free',
    L: 'lactose_free',
    M: 'milk_free',
    VL: 'low_lactose',
    Veg: 'vegan',
  },
  aalef: { G: 'gluten_free', L: 'lactose_free', M: 'milk_free', VL: 'low_lactose', V: 'vegan' },
};

// No source has a vegetarian code, so it is inferred from the course name (documented heuristic).
const VEGETARIAN_COURSE = /kasvis|vege|vegetarian/i;

/** Canonical diet tags for a dish, in DIET_TAGS order. */
export function dietTags(source: SourceId, codes: string[], courseName: LocalizedName): DietTag[] {
  const tags = new Set<DietTag>();
  for (const code of codes) {
    const tag = DIET_CODES[source][code];
    if (tag) tags.add(tag);
    else if (!KNOWN_CODES[source].has(code)) {
      warnOnce(`${source}:${code}`, `lut-lunch-mcp: unknown ${source} diet code "${code}"`);
    }
  }
  if (VEGETARIAN_COURSE.test(courseName.fi) || VEGETARIAN_COURSE.test(courseName.en ?? '')) {
    tags.add('vegetarian');
  }
  // Implications, applied in order so they chain: vegan ⇒ milk-free ⇒ lactose-free ⇒ low lactose.
  if (tags.has('vegan')) tags.add('vegetarian').add('milk_free');
  if (tags.has('milk_free')) tags.add('lactose_free');
  if (tags.has('lactose_free')) tags.add('low_lactose');
  return DIET_TAGS.filter((tag) => tags.has(tag));
}
