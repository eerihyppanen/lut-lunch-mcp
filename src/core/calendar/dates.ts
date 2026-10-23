// Dates are plain YYYY-MM-DD strings in Europe/Helsinki. Arithmetic runs on UTC midnights,
// so daylight saving changes can never shift a date. Only helsinkiToday looks at a clock.

export type Weekday =
  'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

const WEEKDAYS: readonly Weekday[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const HELSINKI_DATE = new Intl.DateTimeFormat('en-CA', {
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
  return HELSINKI_DATE.format(now);
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
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

export function weekdayName(date: string): Weekday {
  return WEEKDAYS[toUtc(date).getUTCDay()]!;
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
  if (input === 'today') return today;
  if (input === 'tomorrow') return addDays(today, 1);
  if (isValidIsoDate(input)) return input;
  throw new InvalidDateError(input);
}
