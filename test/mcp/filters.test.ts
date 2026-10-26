import { describe, expect, it } from 'vitest';
import { parsePowerestaDates } from '../../src/core/sources/poweresta.js';
import {
  allergenVerdict,
  hasFilters,
  judgeDish,
  matchesNameAndDiet,
} from '../../src/mcp/filters.js';
import { presentDish } from '../../src/mcp/present.js';
import { fixtureJson } from '../helpers/fixtures.js';

const fri = parsePowerestaDates(fixtureJson('poweresta/week-2026-10-19.json')).days['2026-10-23']!;
const casserole = fri[1]!.dishes[0]!; // tagged G, allergen list says gluten (oats)
const fish = fri[3]!.dishes[0]!;
const soup = fri[0]!.dishes[0]!; // no allergen list

describe('matchesNameAndDiet', () => {
  it('matches name and diet the same way judgeDish does', () => {
    const name = { fi: 'Itämaista linssikeittoa', en: 'Oriental lentil soup' };
    expect(matchesNameAndDiet(name, ['vegan'], { query: 'itamaista', diet: ['vegan'] })).toBe(true);
    expect(matchesNameAndDiet(name, ['vegan'], { query: 'lohi' })).toBe(false);
    expect(matchesNameAndDiet(name, [], { diet: ['vegan'] })).toBe(false);
  });
});

describe('allergen filtering', () => {
  it('lets the label win for gluten (review focus 2)', () => {
    expect(allergenVerdict(casserole, 'gluten')).toBe('ok');
    expect(judgeDish(casserole, { excludeAllergens: ['gluten'] })).toBe('keep');
    expect(presentDish(casserole, 'en').allergens.contains).toEqual(['gluten']);
  });

  it('excludes, keeps or marks unverifiable', () => {
    expect(judgeDish(fish, { excludeAllergens: ['fish'] })).toBe('hidden');
    expect(judgeDish(fish, { excludeAllergens: ['egg'] })).toBe('keep');
    expect(judgeDish(soup, { excludeAllergens: ['egg'] })).toBe('unverifiable');
    // gluten is ok via the G label, but fish is unknown
    expect(judgeDish(soup, { excludeAllergens: ['fish', 'gluten'] })).toBe('unverifiable');
  });

  it('decides milk by the milk-free label', () => {
    expect(allergenVerdict(soup, 'milk')).toBe('ok'); // M
    expect(allergenVerdict(casserole, 'milk')).toBe('ok'); // M
    expect(allergenVerdict(fri[3]!.dishes[1]!, 'milk')).toBe('excluded'); // tartar sauce: G, L
  });

  it('treats may-contain as excluded', () => {
    expect(allergenVerdict(casserole, 'soy')).toBe('excluded');
  });
});

describe('diet and query filters', () => {
  it('requires every diet tag', () => {
    expect(judgeDish(soup, { diet: ['vegan'] })).toBe('keep');
    expect(judgeDish(fish, { diet: ['vegan'] })).toBe('hidden');
    expect(judgeDish(soup, { diet: ['vegan', 'gluten_free'] })).toBe('keep');
  });

  it('matches the query against both languages, case-insensitively', () => {
    expect(judgeDish(fish, { query: 'LEMON' })).toBe('keep');
    expect(judgeDish(fish, { query: 'kalaleikk' })).toBe('keep');
    expect(judgeDish(fish, { query: 'salmon' })).toBe('hidden');
  });

  it('counts only diet and allergen filters as filters', () => {
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ query: 'x' })).toBe(false);
    expect(hasFilters({ diet: [] })).toBe(false);
    expect(hasFilters({ diet: ['vegan'] })).toBe(true);
    expect(hasFilters({ excludeAllergens: ['egg'] })).toBe(true);
  });
});
