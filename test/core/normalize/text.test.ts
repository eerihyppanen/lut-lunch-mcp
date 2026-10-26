import { describe, expect, it } from 'vitest';
import { dishSearchText, foldText } from '../../../src/core/normalize/text.js';

describe('dishSearchText', () => {
  it('folds the Finnish and English names into one searchable text', () => {
    expect(dishSearchText({ fi: 'Lohikeitto', en: 'Salmon  Soup' })).toBe('lohikeitto salmon soup');
    expect(dishSearchText({ fi: 'Jälkiruoka', en: null })).toBe('jalkiruoka');
  });
});

describe('foldText', () => {
  it('lowercases, strips diacritics and collapses whitespace', () => {
    expect(foldText('  Jälkiruoka  Ä ')).toBe('jalkiruoka a');
    expect(foldText('Itämaista\nLINSSIKEITTOA')).toBe('itamaista linssikeittoa');
  });
});
