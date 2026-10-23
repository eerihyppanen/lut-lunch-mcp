import { describe, expect, it } from 'vitest';
import { foldText } from '../../../src/core/normalize/text.js';

describe('foldText', () => {
  it('lowercases, strips diacritics and collapses whitespace', () => {
    expect(foldText('  Jälkiruoka  Ä ')).toBe('jalkiruoka a');
    expect(foldText('Itämaista\nLINSSIKEITTOA')).toBe('itamaista linssikeittoa');
  });
});
