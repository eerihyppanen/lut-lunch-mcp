import { describe, expect, it } from 'vitest';
import {
  InvalidDateError,
  addDays,
  datesInRange,
  daysBetween,
  helsinkiToday,
  isValidIsoDate,
  isWeekend,
  isoWeekMonday,
  monthsInRange,
  resolveDateInput,
  weekdayName,
} from '../../../src/core/calendar/dates.js';

describe('helsinkiToday', () => {
  it.each([
    ['2026-10-23T20:59:00Z', '2026-10-23'],
    ['2026-10-23T21:30:00Z', '2026-10-24'], // after midnight Helsinki (UTC+3)
    ['2026-10-25T21:59:00Z', '2026-10-25'], // after DST ends (UTC+2)
    ['2026-10-25T22:30:00Z', '2026-10-26'],
  ])('helsinkiToday(%s) = %s', (iso, expected) => {
    expect(helsinkiToday(new Date(iso))).toBe(expected);
  });
});

describe('date arithmetic', () => {
  it('lists the months a range touches, across year ends', () => {
    expect(monthsInRange('2026-11-30', '2027-02-01')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(monthsInRange('2026-10-24', '2026-10-26')).toEqual(['2026-10']);
    expect(monthsInRange('2026-10-26', '2026-10-24')).toEqual([]);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-10-23', '2026-11-06')).toBe(14);
    expect(daysBetween('2026-10-23', '2026-10-16')).toBe(-7);
  });

  it('lists an inclusive range', () => {
    expect(datesInRange('2026-10-23', '2026-10-25')).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(datesInRange('2026-10-25', '2026-10-23')).toEqual([]);
  });

  it('finds the ISO week Monday', () => {
    expect(isoWeekMonday('2026-10-25')).toBe('2026-10-19');
    expect(isoWeekMonday('2026-10-19')).toBe('2026-10-19');
    expect(isoWeekMonday('2027-01-01')).toBe('2026-12-28');
  });

  it('names weekdays and detects weekends', () => {
    expect(weekdayName('2026-10-24')).toBe('Saturday');
    expect(weekdayName('2026-10-19')).toBe('Monday');
    expect(isWeekend('2026-10-24')).toBe(true);
    expect(isWeekend('2026-10-25')).toBe(true);
    expect(isWeekend('2026-10-23')).toBe(false);
  });
});

describe('date validation and input resolution', () => {
  it('validates ISO dates strictly', () => {
    expect(isValidIsoDate('2026-10-23')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-02-31')).toBe(false);
    expect(isValidIsoDate('2026-1-5')).toBe(false);
  });

  it('accepts today/tomorrow in any case and with surrounding spaces', () => {
    expect(resolveDateInput('Today', '2026-10-23')).toBe('2026-10-23');
    expect(resolveDateInput(' TOMORROW ', '2026-10-23')).toBe('2026-10-24');
    expect(resolveDateInput(' 2026-10-26 ', '2026-10-23')).toBe('2026-10-26');
  });

  it('only accepts years 2000–2100', () => {
    expect(isValidIsoDate('2000-01-01')).toBe(true);
    expect(isValidIsoDate('2100-12-31')).toBe(true);
    expect(isValidIsoDate('1999-12-31')).toBe(false);
    expect(isValidIsoDate('2101-01-01')).toBe(false);
    expect(() => resolveDateInput('9999-12-30', '2026-10-23')).toThrow(InvalidDateError);
  });

  it('resolves today, tomorrow and ISO dates', () => {
    expect(resolveDateInput('today', '2026-10-23')).toBe('2026-10-23');
    expect(resolveDateInput('tomorrow', '2026-10-23')).toBe('2026-10-24');
    expect(resolveDateInput('2026-10-26', '2026-10-23')).toBe('2026-10-26');
  });

  it.each(['2026-02-31', 'Friday', '2026-10-23T10:00', '23.10.2026', ''])(
    'rejects %j with guidance',
    (bad) => {
      expect(() => resolveDateInput(bad, '2026-10-23')).toThrow(InvalidDateError);
      expect(() => resolveDateInput(bad, '2026-10-23')).toThrow(
        `Invalid date "${bad}". Use "today", "tomorrow" or YYYY-MM-DD.`,
      );
    },
  );
});
