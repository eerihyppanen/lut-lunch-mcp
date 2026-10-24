import type { DayStatus, RestaurantId } from '../types.js';

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

/** The history indexed for lookups. */
export interface History {
  /** Null when no day is recorded yet. */
  firstDate: string | null;
  lastDate: string | null;
  days: ReadonlyMap<string, HistoryDay>;
}

export interface HistoryStore {
  /** Throws SourceError when the history is unavailable or uses an unsupported schema. */
  load(): Promise<History>;
}
