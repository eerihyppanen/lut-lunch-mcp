import {
  buildHistoryDataset,
  indexHistory,
  toHistoryDay,
} from '../../src/core/history/snapshot.js';
import type { History, HistoryDay } from '../../src/core/history/types.js';
import { RESTAURANT_IDS, type RestaurantDay } from '../../src/core/types.js';
import { fixtureService } from './fixture-service.js';

/** Recorded days built from the captured week; 2026-10-21 is deliberately missing. */
const RECORDED_DATES = [
  '2026-10-19',
  '2026-10-20',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
];

/** History days from the phase 1 fixtures, as a collector would have recorded them. */
export async function fixtureHistoryDays(): Promise<HistoryDay[]> {
  const rows = await fixtureService().getDays(RECORDED_DATES, [...RESTAURANT_IDS]);
  const recorded = rows.map((row): RestaurantDay => {
    if (row.restaurantId !== 'yolo') return row;
    // Yolo's page starts on the 23rd: it listed nothing for the 19th/20th, and the 22nd stands
    // for a day whose collection failed.
    if (row.date === '2026-10-22') return { ...row, status: { kind: 'error', retryable: true } };
    if (row.date < '2026-10-23')
      return { ...row, status: { kind: 'no_menu', reason: 'none_listed' } };
    return row;
  });
  return RECORDED_DATES.map((date) =>
    toHistoryDay(
      date,
      recorded.filter((r) => r.date === date),
      `${date}T06:30:00.000Z`,
      '0.2.0',
    ),
  );
}

/** The fixture days as an indexed history. */
export async function fixtureHistory(): Promise<History> {
  return indexHistory(buildHistoryDataset(await fixtureHistoryDays(), '2026-10-25T07:00:00.000Z'));
}
