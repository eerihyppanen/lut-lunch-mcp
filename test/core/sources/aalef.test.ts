import { describe, expect, it, vi } from 'vitest';
import { SourceError, type HttpClient } from '../../../src/core/http.js';
import { CachedLoader, MemoryCacheStore } from '../../../src/core/cache.js';
import { toHistoryDay } from '../../../src/core/history/snapshot.js';
import { LiveMenuService } from '../../../src/core/menu-service.js';
import { createAalefSource, inferYear, parseAalefPage } from '../../../src/core/sources/aalef.js';
import { fixtureText } from '../../helpers/fixtures.js';

const html = fixtureText('aalef/2026-10-23.html');

// What a closed Yolo might serve: the menu section is there, but no dated day headings.
const CLOSED =
  '<html><body><div class="pricing__section pricing__section--type-menu"><div class="pricing__rows">' +
  '<div class="pricing__row pricing__row--type-subtitle"><h3>Suljettu joulun ajan</h3></div>' +
  '</div></div></body></html>';

describe('parseAalefPage', () => {
  it('parses listed days including Saturday', () => {
    const r = parseAalefPage(html, '2026-10-23');
    expect(Object.keys(r.days)).toEqual(['2026-10-23', '2026-10-24', '2026-10-26', '2026-10-27']);
    expect(r.coverage).toEqual({ from: '2026-10-23', through: '2026-10-27' });
    expect(r.days['2026-10-24']!.map((c) => c.name.en)).toEqual(['Vegetarian', 'Home made']);
    expect(r.days['2026-10-26']!.map((c) => c.name.fi)).toEqual([
      'Kasvisruoka',
      'Kotoisia makuja',
      'Kokin suositus',
      'Salaattibuffet',
      'Puuro',
      'Jälkiruoka',
    ]);
  });

  it('parses dishes, codes, tags and partial allergens', () => {
    const fri = parseAalefPage(html, '2026-10-23').days['2026-10-23']!;
    const soup = fri.find((c) => c.name.en === 'Soup')!.dishes[0]!;
    expect(soup.name).toEqual({ fi: 'Lohikeitto', en: 'Salmon soup' });
    expect(soup.codes).toEqual(['L', 'G', '+']);
    expect(soup.tags).toEqual(['gluten_free', 'lactose_free', 'low_lactose']);
    const veg = fri[0]!.dishes[0]!;
    expect(veg.tags).toEqual(['vegan', 'vegetarian', 'milk_free', 'lactose_free', 'low_lactose']);
    const homemade = fri[1]!.dishes[0]!;
    expect(homemade.allergens).toMatchObject({ coverage: 'partial', contains: ['egg'] });
    const salad = fri.find((c) => c.name.en === 'Salad buffet')!.dishes[0]!;
    expect(salad.name).toEqual({
      fi: 'Talon salaatti (sis. kevytkeitto)',
      en: 'Salad buffet (Inc. light soup)',
    });
  });

  it('reads allergen codes written inside a dish name', () => {
    // Row codes are "L,G"; the name adds "(L,MU)" for the chocolate cake (egg).
    const fri = parseAalefPage(html, '2026-10-23').days['2026-10-23']!;
    const dessert = fri.find((c) => c.name.en === 'Dessert')!.dishes[0]!;
    expect(dessert.name.en).toBe('Chocolate mousse/chocolate cake (L,MU)');
    expect(dessert.allergens.contains).toEqual(['egg']);
    expect(dessert.tags).toEqual(['gluten_free', 'lactose_free', 'low_lactose']); // from row codes only
  });

  it('reads a menu section without dated headings as nothing published', () => {
    expect(parseAalefPage(CLOSED, '2026-12-23')).toEqual({ days: {}, coverage: null });
  });

  it('reports day headings it cannot read as a source error, not as closed (final review)', () => {
    // The real page always has a second menu section ("Päivittäin tarjolla…"), so a changed
    // date format must not pass for a closed restaurant.
    const changed = html.replace(
      /<h3>(Maanantai|Tiistai|Keskiviikko|Torstai|Perjantai|Lauantai|Sunnuntai) (\d{1,2})\.(\d{1,2})<\/h3>/g,
      '<h3>$1 $2/$3</h3>',
    );
    expect(changed).not.toBe(html);
    expect(() => parseAalefPage(changed, '2026-10-23')).toThrow(SourceError);
  });

  it('throws when no day headings exist', () => {
    expect(() => parseAalefPage('<html><body><h3>Hello</h3></body></html>', '2026-10-23')).toThrow(
      SourceError,
    );
  });
});

describe('inferYear', () => {
  it('infers the year across New Year', () => {
    expect(inferYear(2, 1, '2026-12-30')).toBe('2027-01-02');
    expect(inferYear(30, 12, '2027-01-02')).toBe('2026-12-30');
    expect(inferYear(23, 10, '2026-10-23')).toBe('2026-10-23');
  });
});

describe('a closed Yolo (review focus)', () => {
  it('reports it as not published yet, recorded as nothing listed', async () => {
    const at = new Date('2026-12-23T09:00:00Z');
    const service = new LiveMenuService({
      sources: [createAalefSource({ getText: () => Promise.resolve(CLOSED), getJson: vi.fn() })],
      loader: new CachedLoader(new MemoryCacheStore(), () => at.getTime()),
      now: () => at,
    });
    const rows = await service.getDays(['2026-12-23'], ['yolo']);
    expect(rows[0]!.status).toEqual({ kind: 'no_menu', reason: 'not_published_yet' });
    expect(toHistoryDay('2026-12-23', rows, 'T', 'x').restaurants[0]!.status).toEqual({
      kind: 'no_menu',
      reason: 'none_listed',
    });
  });
});

describe('createAalefSource', () => {
  it('fetches the front page as a single unit', async () => {
    const getText = vi.fn(() => Promise.resolve(html));
    const http: HttpClient = { getJson: vi.fn(), getText };
    const source = createAalefSource(http);
    expect(source.restaurantId).toBe('yolo');
    expect(source.unitKey('2026-10-19')).toBe('aalef:page');
    expect(source.unitKey('2026-11-02')).toBe('aalef:page');
    const r = await source.fetchUnit('2026-10-23', '2026-10-23');
    expect(getText).toHaveBeenCalledWith('https://www.aalef.fi/');
    expect(r.coverage).toEqual({ from: '2026-10-23', through: '2026-10-27' });
  });
});
