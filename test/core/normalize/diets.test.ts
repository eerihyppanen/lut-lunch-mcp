import { afterEach, describe, expect, it, vi } from 'vitest';
import { dietTags } from '../../../src/core/normalize/diets.js';

const plain = { fi: 'Lounas', en: 'Lunch' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dietTags', () => {
  it('maps Compass codes and applies implications', () => {
    expect(dietTags('compass', ['*', 'G', 'L', 'M', 'Veg'], plain)).toEqual([
      'vegan',
      'vegetarian',
      'gluten_free',
      'milk_free',
      'lactose_free',
      'low_lactose',
    ]);
    expect(dietTags('compass', ['A', 'G', 'L'], plain)).toEqual([
      'gluten_free',
      'lactose_free',
      'low_lactose',
    ]);
  });

  it('maps Aalef and Poweresta vegan codes', () => {
    expect(dietTags('aalef', ['M', 'V'], plain)).toEqual([
      'vegan',
      'vegetarian',
      'milk_free',
      'lactose_free',
      'low_lactose',
    ]);
    expect(dietTags('poweresta', ['VG'], plain)).toContain('vegan');
    expect(dietTags('poweresta', ['VE'], plain)).toContain('vegan');
  });

  it('treats V as vegan only for Aalef', () => {
    expect(dietTags('aalef', ['V'], plain)).toContain('vegan');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(dietTags('compass', ['V'], plain)).toEqual([]);
  });

  it('infers vegetarian from the course name', () => {
    expect(
      dietTags('aalef', ['L', 'G', 'SO', '+'], { fi: 'Kasvisruoka', en: 'Vegetarian' }),
    ).toEqual(['vegetarian', 'gluten_free', 'lactose_free', 'low_lactose']);
    expect(dietTags('compass', ['A'], { fi: 'BISTRON VEGE', en: null })).toEqual(['vegetarian']);
  });

  it('warns once per unknown code', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dietTags('compass', ['XYZ'], { fi: '', en: null });
    dietTags('compass', ['XYZ'], { fi: '', en: null });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain('XYZ');
  });
});
