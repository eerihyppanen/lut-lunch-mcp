import { describe, expect, it, vi } from 'vitest';
import { CachedLoader, MemoryCacheStore } from '../../../src/core/cache.js';
import { SourceError, type HttpClient } from '../../../src/core/http.js';
import {
  createPowerestaSource,
  parsePowerestaDates,
  pickSlugs,
} from '../../../src/core/sources/poweresta.js';
import { fixtureJson } from '../../helpers/fixtures.js';

const week = fixtureJson('poweresta/week-2026-10-19.json');
const menus = fixtureJson('poweresta/menus.json');
const DATES_URL =
  'https://api.fi.poweresta.com/publicmenu/dates/kampusravintolat/lut/?menu=syksy&dates=2026-10-19,2026-10-20,2026-10-21,2026-10-22,2026-10-23,2026-10-24,2026-10-25';

const loader = () => new CachedLoader(new MemoryCacheStore(), () => 0);

describe('parsePowerestaDates', () => {
  it('parses a week including empty weekend days', () => {
    const r = parsePowerestaDates(week);
    expect(r.coverage).toEqual({ from: '2026-10-19', through: '2026-10-25' });
    expect(r.days['2026-10-24']).toEqual([]);
    const fri = r.days['2026-10-23']!;
    expect(fri.map((c) => c.name.fi)).toEqual(['Kasviskeitto', 'Kasvislounas', 'Lounas', 'Lounas']);
    expect(fri.map((c) => c.name.en)).toEqual([
      'Vegetarian soup',
      'Vegetarian lunch',
      'Lunch',
      'Lunch',
    ]);
    expect(fri[1]!.price).toBe('3,10 / 5,90 / 9,00 / 12,00');
    expect(fri[0]!.price).toBe('2,30 / 5,10 / 8,20 / 9,50');
  });

  it('extracts names, codes, tags and allergens per dish', () => {
    const fri = parsePowerestaDates(week).days['2026-10-23']!;
    const soup = fri[0]!.dishes[0]!;
    expect(soup.name).toEqual({ fi: 'Itämaista linssikeittoa', en: null });
    expect(soup.codes).toEqual(['G', 'L', 'M', 'VE', '*']);
    expect(soup.tags).toContain('vegan');
    expect(soup.allergens.coverage).toBe('none'); // no allergen list upstream
    const casserole = fri[1]!.dishes[0]!;
    expect(casserole.name).toEqual({
      fi: 'Nyhtökaura-perunavuoka',
      en: 'Pulled oats and potato casserole',
    });
    expect(casserole.tags).toContain('gluten_free');
    expect(casserole.allergens.contains).toEqual(['gluten']);
    expect(casserole.allergens.mayContain).toEqual(['soy']);
    const fish = fri[3]!.dishes[0]!;
    expect(fish.name.en).toBe('Lemon fish');
    expect(fish.allergens).toMatchObject({ coverage: 'full', contains: ['gluten', 'fish'] });
  });

  it('returns no coverage for an empty response', () => {
    expect(parsePowerestaDates([])).toEqual({ days: {}, coverage: null });
  });

  it('rejects an unexpected shape', () => {
    expect(() => parsePowerestaDates({ nope: true })).toThrow(SourceError);
  });
});

describe('pickSlugs', () => {
  it('reads published menu slugs', () => {
    expect(pickSlugs(menus)).toEqual(['syksy']);
    expect(pickSlugs([{ publishUrl: '' }, {}])).toEqual([]);
  });
});

describe('createPowerestaSource', () => {
  it('requests the whole ISO week in one call', async () => {
    const urls: string[] = [];
    const http: HttpClient = {
      getText: vi.fn(),
      getJson: vi.fn((u: string) => {
        urls.push(u);
        return Promise.resolve(u.includes('/menus/') ? menus : week);
      }),
    };
    const source = createPowerestaSource(http, loader());
    expect(source.unitKey('2026-10-23')).toBe('poweresta:2026-10-19');
    await source.fetchUnit('2026-10-23', '2026-10-23');
    expect(urls).toEqual([
      'https://api.fi.poweresta.com/publicmenu/menus/kampusravintolat/lut/',
      DATES_URL,
    ]);
  });

  it('uses, per date, the first slug that has a menu', async () => {
    const twoSlugs = [{ publishUrl: 'kesa' }, { publishUrl: 'syksy' }];
    const emptyWeek = (week as { date: string }[]).map((d) => ({
      ...d,
      data: { mealOptions: [] },
    }));
    const http: HttpClient = {
      getText: vi.fn(),
      getJson: vi.fn((u: string) => {
        if (u.includes('/menus/')) return Promise.resolve(twoSlugs);
        return Promise.resolve(u.includes('menu=kesa') ? emptyWeek : week);
      }),
    };
    const r = await createPowerestaSource(http, loader()).fetchUnit('2026-10-23', '2026-10-23');
    expect(r.days['2026-10-23']).toHaveLength(4);
  });

  it('treats HTTP 400 for a week with no published dates as unpublished', async () => {
    // Poweresta answers 400 (empty body) when none of the requested dates is published yet.
    const http: HttpClient = {
      getText: vi.fn(),
      getJson: vi.fn((u: string) =>
        u.includes('/menus/')
          ? Promise.resolve(menus)
          : Promise.reject(new SourceError('HTTP 400', false, 400)),
      ),
    };
    const r = await createPowerestaSource(http, loader()).fetchUnit('2026-11-02', '2026-10-23');
    expect(r).toEqual({ days: {}, coverage: null });
  });

  it('still fails on other HTTP errors from the dates endpoint', async () => {
    const http: HttpClient = {
      getText: vi.fn(),
      getJson: vi.fn((u: string) =>
        u.includes('/menus/')
          ? Promise.resolve(menus)
          : Promise.reject(new SourceError('HTTP 503', true, 503)),
      ),
    };
    await expect(
      createPowerestaSource(http, loader()).fetchUnit('2026-11-02', '2026-10-23'),
    ).rejects.toMatchObject({ status: 503, retryable: true });
  });

  it('fails retryably when no menu is published', async () => {
    const http: HttpClient = { getText: vi.fn(), getJson: vi.fn(() => Promise.resolve([])) };
    await expect(
      createPowerestaSource(http, loader()).fetchUnit('2026-10-23', '2026-10-23'),
    ).rejects.toMatchObject({ message: 'Poweresta: no published menu', retryable: true });
  });
});
