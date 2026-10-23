import { describe, expect, it } from 'vitest';
import { finnishHoliday } from '../../../src/core/calendar/holidays.js';

describe('finnishHoliday', () => {
  it.each([
    ['2026-01-01', "New Year's Day"],
    ['2026-01-06', 'Epiphany'],
    ['2026-04-03', 'Good Friday'],
    ['2026-04-06', 'Easter Monday'],
    ['2026-05-01', 'May Day'],
    ['2026-05-14', 'Ascension Day'],
    ['2026-06-19', 'Midsummer Eve'],
    ['2026-06-20', 'Midsummer Day'],
    ['2026-10-31', "All Saints' Day"],
    ['2026-12-06', 'Independence Day'],
    ['2026-12-24', 'Christmas Eve'],
    ['2026-12-25', 'Christmas Day'],
    ['2026-12-26', "St. Stephen's Day"],
    ['2027-03-26', 'Good Friday'],
    ['2027-05-06', 'Ascension Day'],
    ['2027-06-25', 'Midsummer Eve'],
    ['2027-11-06', "All Saints' Day"],
    ['2028-04-17', 'Easter Monday'],
    ['2028-06-24', 'Midsummer Day'],
  ])('finnishHoliday(%s) = %s', (date, name) => {
    expect(finnishHoliday(date)).toBe(name);
  });

  it.each(['2026-10-23', '2026-04-05', '2026-11-01', '2027-06-19'])(
    'returns null for ordinary day %s',
    (date) => {
      expect(finnishHoliday(date)).toBeNull();
    },
  );
});
