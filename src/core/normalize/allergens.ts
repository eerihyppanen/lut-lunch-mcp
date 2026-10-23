import { ALLERGENS, type Allergen, type AllergenCoverage, type DishAllergens } from '../types.js';

// Poweresta's English allergen names, lowercased. "Soybens" is a typo in the source data.
// Names outside the EU-14 list (coriander, peas, pulses…) are ignored.
const POWERESTA_NAMES: Record<string, Allergen> = {
  'cereals containing gluten': 'gluten',
  wheat: 'gluten',
  rye: 'gluten',
  barley: 'gluten',
  oat: 'gluten',
  oats: 'gluten',
  spelt: 'gluten',
  milk: 'milk',
  eggs: 'egg',
  egg: 'egg',
  fish: 'fish',
  crustaceans: 'crustaceans',
  molluscs: 'molluscs',
  peanuts: 'peanuts',
  peanut: 'peanuts',
  nuts: 'nuts',
  'tree nuts': 'nuts',
  soybens: 'soy',
  soybeans: 'soy',
  soy: 'soy',
  soya: 'soy',
  celery: 'celery',
  mustard: 'mustard',
  sesame: 'sesame',
  'sesame seeds': 'sesame',
  'sulfur dioxide and sulfits': 'sulphites',
  'sulphur dioxide and sulphites': 'sulphites',
  sulphites: 'sulphites',
  lupin: 'lupin',
};

const MAY_CONTAIN = /^may contain:\s*/i;

// Yolo marks these five allergens when present; their absence means "not contained" per label.
const AALEF_MARKERS: Record<string, Allergen> = {
  MU: 'egg',
  SO: 'soy',
  SE: 'celery',
  SI: 'mustard',
  PÄ: 'nuts',
};

function inOrder(set: ReadonlySet<Allergen>): Allergen[] {
  return ALLERGENS.filter((a) => set.has(a));
}

function coverageOf(assessed: readonly Allergen[]): AllergenCoverage {
  if (assessed.length === ALLERGENS.length) return 'full';
  return assessed.length > 0 ? 'partial' : 'none';
}

function build(
  contains: ReadonlySet<Allergen>,
  mayContain: ReadonlySet<Allergen>,
  assessed: ReadonlySet<Allergen>,
): DishAllergens {
  const assessedList = inOrder(assessed);
  return {
    coverage: coverageOf(assessedList),
    contains: inOrder(contains),
    mayContain: inOrder(mayContain).filter((a) => !contains.has(a)),
    assessed: assessedList,
  };
}

/** From a Poweresta row's English allergen list; undefined means the row has no list. */
export function powerestaAllergens(englishList: string[] | undefined): DishAllergens {
  if (englishList === undefined) return build(new Set(), new Set(), new Set());
  const contains = new Set<Allergen>();
  const mayContain = new Set<Allergen>();
  for (const entry of englishList) {
    const isMay = MAY_CONTAIN.test(entry);
    const allergen = POWERESTA_NAMES[entry.replace(MAY_CONTAIN, '').trim().toLowerCase()];
    if (allergen) (isMay ? mayContain : contains).add(allergen);
  }
  return build(contains, mayContain, new Set(ALLERGENS));
}

/** From Yolo's notice codes: only the five marked allergens are known. */
export function aalefAllergens(codes: string[]): DishAllergens {
  const contains = new Set<Allergen>();
  for (const code of codes) {
    const allergen = AALEF_MARKERS[code];
    if (allergen) contains.add(allergen);
  }
  return build(contains, new Set(), new Set(Object.values(AALEF_MARKERS)));
}

/** Compass publishes no specific allergens ("A" only says "contains allergens"). */
export function compassAllergens(): DishAllergens {
  return build(new Set(), new Set(), new Set());
}
