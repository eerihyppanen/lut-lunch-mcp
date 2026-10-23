import { describe, expect, it, vi } from 'vitest';
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

  it('maps EU tree-nut species to nuts', () => {
    const a = powerestaAllergens(['Almond', 'May contain: Hazelnut', 'Cashew nuts']);
    expect(a.contains).toEqual(['nuts']);
    expect(a.coverage).toBe('full');
  });

  it('downgrades a list with an unrecognised allergen name and warns', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = powerestaAllergens(['Milk', 'Mystery thickener']);
    expect(a).toEqual({ coverage: 'partial', contains: ['milk'], mayContain: [], assessed: [] });
    expect(log.mock.calls[0]?.[0]).toContain('Mystery thickener');
    log.mockRestore();
  });

  it('ignores known non-EU-14 names without losing coverage', () => {
    expect(powerestaAllergens(['Coriander', 'Peas', 'Pulses']).coverage).toBe('full');
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
  it('treats markers as evidence of presence only', () => {
    // Yolo doesn't mark every row ("Tuna and eggs" carries only "+"), so a missing marker
    // proves nothing: nothing counts as assessed.
    expect(aalefAllergens(['L', 'SO', 'MU', 'SI'])).toEqual({
      coverage: 'partial',
      contains: ['egg', 'soy', 'mustard'],
      mayContain: [],
      assessed: [],
    });
    expect(aalefAllergens(['PÄ', 'SE']).contains).toEqual(['nuts', 'celery']);
  });

  it('reports no coverage for a row without markers', () => {
    expect(aalefAllergens(['+'])).toEqual({
      coverage: 'none',
      contains: [],
      mayContain: [],
      assessed: [],
    });
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
