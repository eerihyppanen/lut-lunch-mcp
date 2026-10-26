import { RESTAURANTS } from '../restaurants.js';
import { RESTAURANT_IDS, type DayStatus, type RestaurantDay } from '../types.js';
import type { HistoryDataset, HistoryDay, HistoryRestaurant } from './types.js';

export const ATTRIBUTION =
  'Menus by Kampusravintolat, Compass Group (Food & Co) and Aalef; collected by lut-lunch-mcp. ' +
  'Diet and allergen labels come from the restaurants and can change.';

// A later run can only improve a day: a recorded menu beats "no menu", which beats a failure.
const RANK: Record<DayStatus['kind'], number> = { open: 3, no_menu: 2, error: 1 };

/**
 * A status as worth recording. "Not published yet" on the day being recorded means nothing was
 * listed; "history not available" (a date the live source no longer covers, e.g. an old
 * `--date`) means it was not collected.
 */
function recordedStatus(status: DayStatus): DayStatus {
  if (status.kind !== 'no_menu') return status;
  if (status.reason === 'not_published_yet') return { kind: 'no_menu', reason: 'none_listed' };
  if (status.reason === 'history_not_available') return { kind: 'error', retryable: true };
  return status;
}

/** A day file from one fetch of that date; runtime fields (stale, fetchedAt) are dropped. */
export function toHistoryDay(
  date: string,
  rows: RestaurantDay[],
  collectedAt: string,
  collectorVersion: string,
): HistoryDay {
  const restaurants = RESTAURANT_IDS.flatMap((id): HistoryRestaurant[] => {
    const row = rows.find((r) => r.restaurantId === id);
    return row ? [{ id, status: recordedStatus(row.status) }] : [];
  });
  return { schema: 1, date, collectedAt, collectorVersion, restaurants };
}

/** Merges a new fetch of a day into the recorded one, per restaurant by rank (spec §5.2). */
export function mergeHistoryDay(
  existing: HistoryDay | null,
  incoming: HistoryDay,
): { day: HistoryDay; changed: boolean } {
  if (!existing) return { day: incoming, changed: true };
  const restaurants = RESTAURANT_IDS.flatMap((id): HistoryRestaurant[] => {
    const before = existing.restaurants.find((r) => r.id === id);
    const after = incoming.restaurants.find((r) => r.id === id);
    if (!before || !after) return before ? [before] : after ? [after] : [];
    return [RANK[after.status.kind] > RANK[before.status.kind] ? after : before];
  });
  const changed = JSON.stringify(restaurants) !== JSON.stringify(existing.restaurants);
  return changed ? { day: { ...incoming, restaurants }, changed } : { day: existing, changed };
}

/** The combined history.json content, days sorted by date. */
export function buildHistoryDataset(days: HistoryDay[], generatedAt: string): HistoryDataset {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    schema: 1,
    generatedAt,
    firstDate: sorted[0]?.date ?? null,
    lastDate: sorted.at(-1)?.date ?? null,
    attribution: ATTRIBUTION,
    sources: RESTAURANTS.map(({ id, name, operator, menuUrl }) => ({
      id,
      name,
      operator,
      menuUrl,
    })),
    days: sorted,
  };
}
