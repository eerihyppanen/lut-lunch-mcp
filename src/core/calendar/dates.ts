// Dates are plain YYYY-MM-DD strings in Europe/Helsinki. Arithmetic runs on UTC midnights,
// so daylight saving changes can never shift a date. Only helsinkiToday looks at a clock.

/** Monday-first, as in the ISO week used throughout. */
export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Menus only exist for current dates; the bounds keep Date arithmetic in plain YYYY form.
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

// Read the parts rather than relying on one locale's formatting (e.g. en-CA's YYYY-MM-DD).
const HELSINKI_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Helsinki',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export class InvalidDateError extends Error {
  constructor(input: string) {
    super(`Invalid date "${input}". Use "today", "tomorrow" or YYYY-MM-DD.`);
    this.name = 'InvalidDateError';
  }
}

/** The calendar date in Finland at the given instant. */
export function helsinkiToday(now: Date): string {
  const parts = HELSINKI_PARTS.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isValidIsoDate(s: string): boolean {
  const match = ISO_DATE.exec(s);
  if (!match) return false;
  const year = Number(match[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  const d = toUtc(s);
  return !Number.isNaN(d.getTime()) && fromUtc(d) === s;
}

export function addDays(date: string, n: number): string {
  return fromUtc(new Date(toUtc(date).getTime() + n * DAY_MS));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
}

/** Every date from `from` to `to`, inclusive. Empty when `to` is before `from`. */
export function datesInRange(from: string, to: string): string[] {
  const count = daysBetween(from, to);
  return Array.from({ length: Math.max(0, count + 1) }, (_, i) => addDays(from, i));
}

/** Every month (YYYY-MM) the range touches, in order. Empty when `to` is before `from`. */
export function monthsInRange(from: string, to: string): string[] {
  if (to < from) return [];
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key >= last) return months;
    month = month === 12 ? 1 : month + 1;
    if (month === 1) year++;
  }
}

export function weekdayName(date: string): Weekday {
  return WEEKDAYS[(toUtc(date).getUTCDay() + 6) % 7]!;
}

export function isWeekend(date: string): boolean {
  const day = toUtc(date).getUTCDay();
  return day === 0 || day === 6;
}

/** The Monday of the ISO week (Monday–Sunday) containing `date`. */
export function isoWeekMonday(date: string): string {
  const daysSinceMonday = (toUtc(date).getUTCDay() + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

/** Resolves a tool's date argument against today's Helsinki date. */
export function resolveDateInput(input: string, today: string): string {
  const value = input.trim().toLowerCase();
  if (value === 'today') return today;
  if (value === 'tomorrow') return addDays(today, 1);
  if (isValidIsoDate(value)) return value;
  throw new InvalidDateError(input);
}
