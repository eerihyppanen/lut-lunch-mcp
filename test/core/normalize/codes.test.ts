import { describe, expect, it } from 'vitest';
import { parseCodes, splitTrailingCodes } from '../../../src/core/normalize/codes.js';

describe('parseCodes', () => {
  it.each([
    ['L, M,G VE', ['L', 'M', 'G', 'VE']],
    ['VE *', ['VE', '*']],
    ['L,G+', ['L', 'G', '+']],
    ['M,V,G,SE,+', ['M', 'V', 'G', 'SE', '+']],
    ['L, L, M', ['L', 'M']],
    ['', []],
  ])('parseCodes(%j)', (raw, codes) => {
    expect(parseCodes(raw)).toEqual(codes);
  });
});

describe('splitTrailingCodes', () => {
  it('strips Poweresta codes from the end of a name', () => {
    expect(splitTrailingCodes('Itämaista linssikeittoa G, L, M, VE *')).toEqual({
      name: 'Itämaista linssikeittoa',
      codes: ['G', 'L', 'M', 'VE', '*'],
    });
    expect(splitTrailingCodes('Pulled oats and potato casserole L, M,G VE')).toEqual({
      name: 'Pulled oats and potato casserole',
      codes: ['L', 'M', 'G', 'VE'],
    });
    expect(splitTrailingCodes('Honey noodle chicken soup L, M,*')).toEqual({
      name: 'Honey noodle chicken soup',
      codes: ['L', 'M', '*'],
    });
  });

  it('leaves names without known trailing codes unchanged', () => {
    expect(splitTrailingCodes('BBQ hot dogs')).toEqual({ name: 'BBQ hot dogs', codes: [] });
    expect(splitTrailingCodes('Kana BBQ')).toEqual({ name: 'Kana BBQ', codes: [] });
  });
});
