import { addDays } from './dates.js';

// Finnish public holidays that close campus restaurants (spec §7.2). Midsummer Eve and
// Christmas Eve are de facto holidays rather than official ones, but restaurants close.

const FIXED: Record<string, string> = {
  '01-01': "New Year's Day",
  '01-06': 'Epiphany',
  '05-01': 'May Day',
  '12-06': 'Independence Day',
  '12-24': 'Christmas Eve',
  '12-25': 'Christmas Day',
  '12-26': "St. Stephen's Day",
};

/** Easter Sunday for a Gregorian year (anonymous Gregorian / Meeus–Jones–Butcher algorithm). */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The first Saturday on or after `${year}-${monthDay}`. */
function saturdayFrom(year: number, monthDay: string): string {
  const start = `${year}-${monthDay}`;
  const daysToSaturday = (6 - new Date(`${start}T00:00:00Z`).getUTCDay() + 7) % 7;
  return addDays(start, daysToSaturday);
}

function movableHolidays(year: number): Record<string, string> {
  const easter = easterSunday(year);
  const midsummerDay = saturdayFrom(year, '06-20');
  return {
    [addDays(easter, -2)]: 'Good Friday',
    [addDays(easter, 1)]: 'Easter Monday',
    [addDays(easter, 39)]: 'Ascension Day',
    [addDays(midsummerDay, -1)]: 'Midsummer Eve',
    [midsummerDay]: 'Midsummer Day',
    [saturdayFrom(year, '10-31')]: "All Saints' Day",
  };
}

/** English name of the Finnish public holiday on `date` (YYYY-MM-DD), or null. */
export function finnishHoliday(date: string): string | null {
  const fixed = FIXED[date.slice(5)];
  if (fixed) return fixed;
  return movableHolidays(Number(date.slice(0, 4)))[date] ?? null;
}
