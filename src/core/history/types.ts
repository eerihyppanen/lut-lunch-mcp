import type { DayStatus, RestaurantId } from '../types.js';
import type { StatsIndex } from './stats-index.js';

/** One restaurant's recorded outcome for a day. */
export interface HistoryRestaurant {
  id: RestaurantId;
  status: DayStatus;
}

/** One day file (`days/YYYY/MM/YYYY-MM-DD.json`), spec §4.1. */
export interface HistoryDay {
  schema: 1;
  date: string;
  collectedAt: string;
  collectorVersion: string;
  /** Registry order. */
  restaurants: HistoryRestaurant[];
}

export interface HistorySource {
  id: RestaurantId;
  name: string;
  operator: string;
  menuUrl: string;
}

/** The combined `history.json`, spec §4.2. */
export interface HistoryDataset {
  schema: 1;
  generatedAt: string;
  firstDate: string | null;
  lastDate: string | null;
  attribution: string;
  sources: HistorySource[];
  /** Sorted by date. */
  days: HistoryDay[];
}

/**
 * Recorded history (phase 3 spec §4.3). Both lookups reject with SourceError when the history is
 * unavailable or uses an unsupported schema.
 */
export interface HistoryStore {
  /** The parsed stats.json; also the list of recorded dates. */
  statsIndex(): Promise<StatsIndex>;
  /** Recorded days among `dates`; dates without a day file are absent from the map. */
  days(dates: string[]): Promise<Map<string, HistoryDay>>;
}
