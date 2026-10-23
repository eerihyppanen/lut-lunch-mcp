import { describe, expect, it, vi } from 'vitest';
import { SourceError, type HttpClient } from '../../../src/core/http.js';
import { createCompassSource, parseCompassWeek } from '../../../src/core/sources/compass.js';
import { fixtureJson } from '../../helpers/fixtures.js';

const fi = fixtureJson('compass/week-2026-10-19-fi.json');
const en = fixtureJson('compass/week-2026-10-19-en.json');

describe('parseCompassWeek', () => {
  it('parses a week with English names paired by recipeId', () => {
    const r = parseCompassWeek(fi, en, '2026-10-19', '2026-10-23');
    expect(r.coverage).toEqual({ from: '2026-10-19', through: '2026-10-25' });
    expect(Object.keys(r.days)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
    const fri = r.days['2026-10-23']!;
    expect(fri).toHaveLength(5);
    expect(fri[0]!.name).toEqual({ fi: 'BISTRON VEGE', en: 'BISTRO VEGETARIAN LUNCH' });
    expect(fri[0]!.price).toBe('13,00/ STUDENT 3,10');
    expect(fri[0]!.dishes[1]!.name).toEqual({ fi: 'Tummaa riisiä', en: 'Rice' });
    expect(fri[0]!.dishes[1]!.tags).toEqual([
      'vegan',
      'vegetarian',
      'gluten_free',
      'milk_free',
      'lactose_free',
      'low_lactose',
    ]);
    expect(fri[0]!.dishes[0]!.codes).toEqual(['*', 'A', 'G', 'ILM', 'L', 'VS']);
    expect(fri[0]!.dishes[0]!.tags).toContain('vegetarian'); // course name "VEGE"
    expect(fri[0]!.dishes[0]!.allergens.coverage).toBe('none');
    expect(fri[4]!.name).toEqual({ fi: 'Menu', en: 'Menu' });
    expect(fri[4]!.dishes[0]!.name.en).toBe('Vegetables of the season');
  });

  it('trims trailing newlines from Finnish names too', () => {
    const thu = parseCompassWeek(fi, en, '2026-10-19', '2026-10-23').days['2026-10-22']!;
    expect(thu[1]!.dishes[0]!.name.fi).toBe('Kookoksella maustettua broileria ja nuudelia');
  });

  it('falls back to Finnish-only when English is missing', () => {
    const r = parseCompassWeek(fi, null, '2026-10-19', '2026-10-23');
    const course = r.days['2026-10-23']![0]!;
    expect(course.name).toEqual({ fi: 'BISTRON VEGE', en: null });
    expect(course.price).toBe('BUFFET 13,00STUDENT 3,10');
    expect(course.dishes[0]!.name).toEqual({
      fi: 'Kikherneitä ja kasviksia kormakastikkeessa',
      en: null,
    });
  });

  it('treats an empty future week as unpublished and an empty current week as published', () => {
    const empty = fixtureJson('compass/week-2026-12-21-fi.json');
    expect(parseCompassWeek(empty, null, '2026-12-21', '2026-10-23').coverage).toBeNull();
    expect(parseCompassWeek(empty, null, '2026-12-21', '2026-12-22').coverage).toEqual({
      from: '2026-12-21',
      through: '2026-12-27',
    });
  });

  it('rejects an unexpected shape', () => {
    expect(() => parseCompassWeek({ foo: 1 }, null, '2026-10-19', '2026-10-23')).toThrow(
      SourceError,
    );
  });
});

describe('createCompassSource', () => {
  it('keys units by ISO week', () => {
    const source = createCompassSource({ getJson: vi.fn(), getText: vi.fn() });
    expect(source.restaurantId).toBe('bistro-skinnarila');
    expect(source.unitKey('2026-10-25')).toBe('compass:2026-10-19');
    expect(source.freshMs).toBe(30 * 60_000);
  });

  it('fetches fi and en for the ISO week and tolerates en failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const urls: string[] = [];
    const http: HttpClient = {
      getText: vi.fn(),
      getJson: vi.fn((u: string) => {
        urls.push(u);
        if (u.includes('language=en')) return Promise.reject(new SourceError('x', true));
        return Promise.resolve(fi);
      }),
    };
    const r = await createCompassSource(http).fetchUnit('2026-10-22', '2026-10-23');
    expect(urls.sort()).toEqual([
      'https://www.compass-group.fi/menuapi/week-menus?costCenter=3363&date=2026-10-19&language=en',
      'https://www.compass-group.fi/menuapi/week-menus?costCenter=3363&date=2026-10-19&language=fi',
    ]);
    expect(r.days['2026-10-23']![0]!.name.en).toBeNull();
    expect(log.mock.calls.map((c) => c.join(' ')).join()).toMatch(/English.*x/);
    log.mockRestore();
  });

  it('fails when the Finnish menu cannot be fetched', async () => {
    const http: HttpClient = {
      getText: vi.fn(),
      getJson: vi.fn(() => Promise.reject(new SourceError('down', true))),
    };
    await expect(
      createCompassSource(http).fetchUnit('2026-10-22', '2026-10-23'),
    ).rejects.toMatchObject({ retryable: true });
  });
});
