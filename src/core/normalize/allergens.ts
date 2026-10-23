import { ALLERGENS, type Allergen, type AllergenCoverage, type DishAllergens } from '../types.js';
import { warnOnce } from './warn.js';

// Poweresta's English allergen names, lowercased. "Soybens" is a typo in the source data.
// Cereals and tree nuts are listed by species, so each species maps to its EU-14 group.
const POWERESTA_NAMES: Record<string, Allergen> = {
  'cereals containing gluten': 'gluten',
  wheat: 'gluten',
  rye: 'gluten',
  barley: 'gluten',
  oat: 'gluten',
  oats: 'gluten',
  spelt: 'gluten',
  kamut: 'gluten',
  milk: 'milk',
  eggs: 'egg',
  egg: 'egg',
  fish: 'fish',
  'alaska pollock': 'fish', // fish can be listed by species (seen in live data)
  crustaceans: 'crustaceans',
  molluscs: 'molluscs',
  peanuts: 'peanuts',
  peanut: 'peanuts',
  nuts: 'nuts',
  'tree nuts': 'nuts',
  almond: 'nuts',
  almonds: 'nuts',
  hazelnut: 'nuts',
  hazelnuts: 'nuts',
  walnut: 'nuts',
  walnuts: 'nuts',
  cashew: 'nuts',
  'cashew nuts': 'nuts',
  pecan: 'nuts',
  'pecan nuts': 'nuts',
  pistachio: 'nuts',
  'pistachio nuts': 'nuts',
  'brazil nut': 'nuts',
  'brazil nuts': 'nuts',
  macadamia: 'nuts',
  'macadamia nuts': 'nuts',
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

// Names Poweresta lists that are not among the EU-14; they don't affect coverage.
const POWERESTA_IGNORED = new Set(['coriander', 'peas', 'pulses']);

const MAY_CONTAIN = /^may contain:\s*/i;

// Yolo marks these five allergens on some rows. Not every row is marked ("Tuna and eggs"
// carries only "+"), so a marker proves presence but its absence proves nothing.
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

/** full: every allergen assessed; partial: some known facts; none: nothing known. */
function coverageOf(assessed: number, known: number): AllergenCoverage {
  if (assessed === ALLERGENS.length) return 'full';
  return assessed > 0 || known > 0 ? 'partial' : 'none';
}

function build(
  contains: ReadonlySet<Allergen>,
  mayContain: ReadonlySet<Allergen>,
  assessed: ReadonlySet<Allergen>,
): DishAllergens {
  const containsList = inOrder(contains);
  const mayContainList = inOrder(mayContain).filter((a) => !contains.has(a));
  const assessedList = inOrder(assessed);
  return {
    coverage: coverageOf(assessedList.length, containsList.length + mayContainList.length),
    contains: containsList,
    mayContain: mayContainList,
    assessed: assessedList,
  };
}

/**
 * From a Poweresta row's English allergen list; undefined means the row has no list.
 * A name we can't map makes the whole list untrustworthy for "absent" answers, so the dish
 * keeps what it is known to contain but nothing counts as assessed.
 */
export function powerestaAllergens(englishList: string[] | undefined): DishAllergens {
  if (englishList === undefined) return build(new Set(), new Set(), new Set());
  const contains = new Set<Allergen>();
  const mayContain = new Set<Allergen>();
  let complete = true;
  for (const entry of englishList) {
    const isMay = MAY_CONTAIN.test(entry);
    const name = entry.replace(MAY_CONTAIN, '').trim().toLowerCase();
    const allergen = POWERESTA_NAMES[name];
    if (allergen) (isMay ? mayContain : contains).add(allergen);
    else if (!POWERESTA_IGNORED.has(name)) {
      complete = false;
      warnOnce(
        `poweresta-allergen:${name}`,
        `lut-lunch-mcp: unknown Poweresta allergen "${entry}"`,
      );
    }
  }
  return build(contains, mayContain, complete ? new Set(ALLERGENS) : new Set());
}

/** From Yolo's notice codes: markers show presence; absence is unknown. */
export function aalefAllergens(codes: string[]): DishAllergens {
  const contains = new Set<Allergen>();
  for (const code of codes) {
    const allergen = AALEF_MARKERS[code];
    if (allergen) contains.add(allergen);
  }
  return build(contains, new Set(), new Set());
}

/** Compass publishes no specific allergens ("A" only says "contains allergens"). */
export function compassAllergens(): DishAllergens {
  return build(new Set(), new Set(), new Set());
}
