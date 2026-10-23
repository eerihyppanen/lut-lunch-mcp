import { describe, expect, it } from 'vitest';
import {
  aalefAllergens,
  compassAllergens,
  powerestaAllergens,
} from '../../../src/core/normalize/allergens.js';
import { ALLERGENS } from '../../../src/core/types.js';

describe('powerestaAllergens', () => {
  it('maps allergen names, may-contain entries and source typos', () => {
    const a = powerestaAllergens([
      'Cereals containing gluten',
      'Eggs',
      'Soybens',
      'Wheat',
      'May contain: Celery',
      'May contain: Crustaceans',
      'May contain: Milk',
      'Coriander',
    ]);
    expect(a.contains).toEqual(['gluten', 'egg', 'soy']);
    expect(a.mayContain).toEqual(['milk', 'crustaceans', 'celery']);
    expect(a.coverage).toBe('full');
    expect(a.assessed).toEqual([...ALLERGENS]);
  });

  it('lets contains win over may-contain', () => {
    const a = powerestaAllergens(['Oat', 'May contain: Barley', 'May contain: Soybens']);
    expect(a.contains).toEqual(['gluten']);
    expect(a.mayContain).toEqual(['soy']);
  });

  it('treats a missing list as no coverage', () => {
    expect(powerestaAllergens(undefined)).toEqual({
      coverage: 'none',
      contains: [],
      mayContain: [],
      assessed: [],
    });
  });

  it('treats an empty list as full coverage with nothing contained', () => {
    expect(powerestaAllergens([])).toMatchObject({ coverage: 'full', contains: [] });
  });
});

describe('aalefAllergens', () => {
  it('maps the five marked allergens with partial coverage', () => {
    expect(aalefAllergens(['L', 'SO', 'MU', 'SI'])).toEqual({
      coverage: 'partial',
      contains: ['egg', 'soy', 'mustard'],
      mayContain: [],
      assessed: ['egg', 'nuts', 'soy', 'celery', 'mustard'],
    });
    expect(aalefAllergens(['PÄ', 'SE']).contains).toEqual(['nuts', 'celery']);
  });
});

describe('compassAllergens', () => {
  it('has no allergen coverage', () => {
    expect(compassAllergens()).toEqual({
      coverage: 'none',
      contains: [],
      mayContain: [],
      assessed: [],
    });
  });
});
