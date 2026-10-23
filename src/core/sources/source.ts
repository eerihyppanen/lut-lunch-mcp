import type { Course, RestaurantId } from '../types.js';

/**
 * One fetched unit of a source (a week, or Yolo's whole page).
 * Dates inside `coverage` count as published: a covered date with no dishes means the
 * restaurant listed nothing that day. Dates outside it are unknown to the source.
 */
export interface SourceResult {
  days: Record<string, Course[]>;
  coverage: { from: string; through: string } | null;
}

/** Adapter between one upstream menu source and the menu service. */
export interface MenuSource {
  restaurantId: RestaurantId;
  /** How long a fetched unit stays fresh in the cache. */
  freshMs: number;
  /** Cache key of the unit that contains `date`. */
  unitKey(date: string): string;
  /** Fetches and parses the unit that contains `date`. */
  fetchUnit(date: string, today: string): Promise<SourceResult>;
}
