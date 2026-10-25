import { describe, expect, it } from 'vitest';
import { parsePowerestaDates } from '../../src/core/sources/poweresta.js';
import type { RestaurantDay } from '../../src/core/types.js';
import { formatDays, formatMatches } from '../../src/mcp/format.js';
import { NOTICE, presentDish, presentRestaurantDay } from '../../src/mcp/present.js';
import { fixtureJson } from '../helpers/fixtures.js';

const fri = parsePowerestaDates(fixtureJson('poweresta/week-2026-10-19.json')).days['2026-10-23']!;
const day: RestaurantDay = {
  restaurantId: 'lut-buffet',
  date: '2026-10-23',
  status: { kind: 'open', courses: fri },
  stale: false,
  fetchedAt: '2026-10-23T09:00:00.000Z',
};

describe('presentDish', () => {
  it('uses English with a Finnish fallback, or Finnish on request', () => {
    expect(presentDish(fri[0]!.dishes[0]!, 'en')).toMatchObject({
      name: 'Itämaista linssikeittoa',
      untranslated: true,
    });
    expect(presentDish(fri[3]!.dishes[0]!, 'en')).toMatchObject({
      name: 'Lemon fish',
      untranslated: false,
      allergens: { coverage: 'full', contains: ['gluten', 'fish'], may_contain: [] },
    });
    expect(presentDish(fri[3]!.dishes[0]!, 'fi')).toMatchObject({
      name: 'Sitruunaisia kalaleikkeitä',
      untranslated: false,
    });
  });
});

describe('presentRestaurantDay', () => {
  it('presents restaurant days with counts and language fallback', () => {
    const out = presentRestaurantDay(day, 'en', { diet: ['vegan'] });
    expect(out.courses.flatMap((c) => c.dishes.map((d) => d.name))).toEqual([
      'Itämaista linssikeittoa',
      'Pulled oats and potato casserole',
    ]);
    expect(out.courses[0]!.dishes[0]!.untranslated).toBe(true);
    expect(out.hidden_by_filters).toBe(4);
    expect(out.unverifiable).toBe(0);
    expect(out.courses.every((c) => c.dishes.length > 0)).toBe(true); // empty courses are dropped
    expect(out).toMatchObject({
      id: 'lut-buffet',
      name: 'LUT Buffet',
      status: 'open',
      reason: null,
      source_url: 'https://www.kampusravintolat.fi/',
    });
  });

  it('counts dishes left out for missing allergen data', () => {
    const out = presentRestaurantDay(day, 'en', { excludeAllergens: ['egg'] });
    expect(out.unverifiable).toBe(2); // lentil soup and boiled potatoes have no allergen list
    expect(out.hidden_by_filters).toBe(2); // noodle soup and tartar sauce contain egg
  });

  it('separates permanent source errors from temporary outages', () => {
    const broken = presentRestaurantDay(
      { ...day, status: { kind: 'error', retryable: false } },
      'en',
      {},
    );
    expect(broken).toMatchObject({ status: 'error', reason: 'source_error' });
    const text = formatDays({
      timezone: 'Europe/Helsinki',
      today: '2026-10-23',
      notice: null,
      days: [{ date: '2026-10-23', weekday: 'Friday', restaurants: [broken] }],
    });
    expect(text).toMatch(/LUT Buffet — unavailable: .*could not be read/);
    expect(text).not.toMatch(/try again later/i);
  });

  it('maps errors and closed days to reasons', () => {
    const err = presentRestaurantDay(
      { ...day, status: { kind: 'error', retryable: true } },
      'en',
      {},
    );
    expect(err).toMatchObject({ status: 'error', reason: 'source_unavailable', courses: [] });
    const history = presentRestaurantDay(
      { ...day, status: { kind: 'error', retryable: true, origin: 'history' } },
      'en',
      {},
    );
    expect(history).toMatchObject({ status: 'error', reason: 'history_unavailable' }); // code review #4
    const holiday = presentRestaurantDay(
      {
        ...day,
        status: { kind: 'no_menu', reason: 'public_holiday', holidayName: "All Saints' Day" },
      },
      'en',
      {},
    );
    expect(holiday).toMatchObject({
      status: 'no_menu',
      reason: 'public_holiday',
      holiday_name: "All Saints' Day",
    });
  });
});

describe('text formatting', () => {
  it('formats text compactly with implied tags removed', () => {
    const restaurant = presentRestaurantDay(day, 'en', { diet: ['vegan'] });
    const sample = {
      timezone: 'Europe/Helsinki' as const,
      today: '2026-10-23',
      notice: NOTICE,
      days: [{ date: '2026-10-23', weekday: 'Friday' as const, restaurants: [restaurant] }],
    };
    const text = formatDays(sample);
    expect(text).toContain('Friday 2026-10-23 (today)');
    expect(text).toContain('Itämaista linssikeittoa [vegan, GF]');
    expect(text).toContain(NOTICE);
  });

  it('explains closed and unavailable restaurants', () => {
    const closed = presentRestaurantDay(
      { ...day, date: '2026-10-24', status: { kind: 'no_menu', reason: 'weekend' } },
      'en',
      {},
    );
    const down = presentRestaurantDay(
      { ...day, date: '2026-10-24', status: { kind: 'error', retryable: true } },
      'en',
      {},
    );
    const text = formatDays({
      timezone: 'Europe/Helsinki',
      today: '2026-10-23',
      notice: null,
      days: [{ date: '2026-10-24', weekday: 'Saturday', restaurants: [closed, down] }],
    });
    expect(text).toContain('Saturday 2026-10-24 (tomorrow)');
    expect(text).toMatch(/LUT Buffet — no menu: weekend/);
    expect(text).toMatch(/try again later/i);
  });

  it('formats search matches', () => {
    const text = formatMatches({
      timezone: 'Europe/Helsinki',
      today: '2026-10-23',
      searched: { from: '2026-10-23', to: '2026-10-29', restaurants: ['yolo'] },
      matches: [
        {
          date: '2026-10-23',
          weekday: 'Friday',
          restaurant_id: 'lut-buffet',
          restaurant: 'LUT Buffet',
          course: 'Lunch',
          dish: presentDish(fri[3]!.dishes[0]!, 'en'),
        },
      ],
      total_matches: 1,
      truncated: false,
      days_without_data: [
        {
          date: '2026-10-28',
          restaurant_id: 'yolo',
          status: 'no_menu',
          reason: 'not_published_yet',
          holiday_name: null,
        },
      ],
      unverifiable: 0,
      notice: null,
    });
    expect(text).toContain('1 match');
    expect(text).toContain('Friday 2026-10-23 · LUT Buffet · Lunch: Lemon fish');
    expect(text).toContain('Yolo on 2026-10-28: not published yet');
  });
});
