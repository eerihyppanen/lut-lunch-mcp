import { CachedLoader, MemoryCacheStore, type Loaded } from './cache.js';
import { daysBetween, helsinkiToday, isWeekend } from './calendar/dates.js';
import { finnishHoliday } from './calendar/holidays.js';
import { createRemoteHistoryStore } from './history/remote.js';
import type { History, HistoryStore } from './history/types.js';
import { SourceError, type HttpClient } from './http.js';
import { createAalefSource } from './sources/aalef.js';
import { createCompassSource } from './sources/compass.js';
import { createPowerestaSource } from './sources/poweresta.js';
import type { MenuSource, SourceResult } from './sources/source.js';
import {
  RESTAURANT_IDS,
  type DayStatus,
  type MenuService,
  type NoMenuReason,
  type RestaurantDay,
  type RestaurantId,
} from './types.js';

/** Dates further than this from today are answered without asking any source (spec §7.1). */
export const WINDOW_PAST_DAYS = 7;
export const WINDOW_FUTURE_DAYS = 14;

function noMenu(reason: NoMenuReason, holidayName?: string): DayStatus {
  return holidayName ? { kind: 'no_menu', reason, holidayName } : { kind: 'no_menu', reason };
}

/** Status of one date in a successfully loaded source unit (spec §7.2, steps 1 and 3–6). */
function resolveStatus(result: SourceResult, date: string, today: string): DayStatus {
  const courses = result.days[date] ?? [];
  if (courses.some((c) => c.dishes.length > 0)) return { kind: 'open', courses };

  // Outside what the source published: past dates are history, later dates aren't out yet.
  // A date between today and the start of coverage (Yolo's page can start after today) is
  // still explained by holiday / weekend / nothing listed below.
  const { coverage } = result;
  if (!coverage || date > coverage.through) {
    return noMenu(date < today ? 'history_not_available' : 'not_published_yet');
  }
  if (date < coverage.from && date < today) return noMenu('history_not_available');

  const holiday = finnishHoliday(date);
  if (holiday) return noMenu('public_holiday', holiday);
  if (isWeekend(date)) return noMenu('weekend');
  return noMenu('none_listed');
}

/** A past day as recorded: what was served, or why not (spec §6.3). Null when not recorded. */
function recordedDay(history: History, id: RestaurantId, date: string): RestaurantDay | null {
  const day = history.days.get(date);
  const entry = day?.restaurants.find((r) => r.id === id);
  if (!day || !entry) return null;
  // A failed collection can't be retried for a past day, so it reads as "no history"; a day
  // recorded as "not published yet" (e.g. during a long closure) had nothing listed.
  const status =
    entry.status.kind === 'error'
      ? noMenu('history_not_available')
      : entry.status.kind === 'no_menu' && entry.status.reason === 'not_published_yet'
        ? noMenu('none_listed')
        : entry.status;
  return { restaurantId: id, date, status, stale: false, fetchedAt: day.collectedAt };
}

export class LiveMenuService implements MenuService {
  private readonly sources: ReadonlyMap<RestaurantId, MenuSource>;
  private readonly loader: CachedLoader;
  private readonly now: () => Date;
  private readonly history: HistoryStore | undefined;

  constructor(opts: {
    sources: MenuSource[];
    loader: CachedLoader;
    now: () => Date;
    history?: HistoryStore;
  }) {
    this.sources = new Map(opts.sources.map((s) => [s.restaurantId, s]));
    this.loader = opts.loader;
    this.now = opts.now;
    this.history = opts.history;
  }

  today(): string {
    return helsinkiToday(this.now());
  }

  loadHistory(): Promise<History> {
    if (!this.history) {
      return Promise.reject(new SourceError('Menu history is not configured', false));
    }
    return this.history.load();
  }

  async getDays(dates: string[], restaurants: RestaurantId[]): Promise<RestaurantDay[]> {
    const today = this.today();
    const sortedDates = [...new Set(dates)].sort();
    const ordered = RESTAURANT_IDS.filter((id) => restaurants.includes(id));
    const history = await this.historyFor(sortedDates, today);
    const perRestaurant = await Promise.all(
      ordered.map((id) => this.daysFor(id, sortedDates, today, history)),
    );
    return sortedDates.flatMap((_, i) => perRestaurant.map((days) => days[i]!));
  }

  /** The history, or its load error; only loaded when a past date is asked for. */
  private async historyFor(
    dates: string[],
    today: string,
  ): Promise<History | SourceError | undefined> {
    if (!this.history || !dates.some((date) => date < today)) return undefined;
    try {
      return await this.history.load();
    } catch (error) {
      return error instanceof SourceError ? error : new SourceError(String(error), false);
    }
  }

  /** One RestaurantDay per date (same order), loading each source unit at most once. */
  private async daysFor(
    id: RestaurantId,
    dates: string[],
    today: string,
    history: History | SourceError | undefined,
  ): Promise<RestaurantDay[]> {
    const source = this.sources.get(id);
    if (!source) throw new Error(`No menu source configured for ${id}`);
    const nowIso = this.now().toISOString();
    const inWindow = (date: string) => {
      const offset = daysBetween(today, date);
      return offset >= -WINDOW_PAST_DAYS && offset <= WINDOW_FUTURE_DAYS;
    };

    // Past dates come from the recorded history when it has them (spec §6.3). If the history
    // could not be loaded, dates older than the live window can only report that error.
    const fromHistory = new Map<string, RestaurantDay>();
    for (const date of dates) {
      if (history === undefined || date >= today) continue;
      if (history instanceof SourceError) {
        if (inWindow(date)) continue;
        const status: DayStatus = { kind: 'error', retryable: history.retryable };
        fromHistory.set(date, { restaurantId: id, date, status, stale: false, fetchedAt: nowIso });
        continue;
      }
      const recorded = recordedDay(history, id, date);
      if (recorded) fromHistory.set(date, recorded);
    }

    const firstDateOfUnit = new Map<string, string>();
    for (const date of dates.filter((d) => inWindow(d) && !fromHistory.has(d))) {
      const key = source.unitKey(date);
      if (!firstDateOfUnit.has(key)) firstDateOfUnit.set(key, date);
    }

    const units = new Map<string, Loaded<SourceResult> | SourceError>();
    await Promise.all(
      [...firstDateOfUnit].map(async ([key, date]) => {
        try {
          units.set(
            key,
            await this.loader.load(key, source.freshMs, () => source.fetchUnit(date, today)),
          );
        } catch (error) {
          units.set(
            key,
            error instanceof SourceError ? error : new SourceError(String(error), false),
          );
        }
      }),
    );

    return dates.map((date): RestaurantDay => {
      const recorded = fromHistory.get(date);
      if (recorded) return recorded;
      const base = { restaurantId: id, date };
      if (!inWindow(date)) {
        const reason = date < today ? 'history_not_available' : 'not_published_yet';
        return { ...base, status: noMenu(reason), stale: false, fetchedAt: nowIso };
      }
      const unit = units.get(source.unitKey(date))!;
      if (unit instanceof SourceError) {
        return {
          ...base,
          status: { kind: 'error', retryable: unit.retryable },
          stale: false,
          fetchedAt: nowIso,
        };
      }
      return {
        ...base,
        status: resolveStatus(unit.value, date, today),
        stale: unit.stale,
        fetchedAt: new Date(unit.fetchedAt).toISOString(),
      };
    });
  }
}

/**
 * The production service: all three restaurants, one shared in-memory cache. With `historyUrl`
 * past days and statistics come from the recorded history; without it (the collector) only
 * live sources are used.
 */
export function createLiveMenuService(
  http: HttpClient,
  opts: { historyUrl?: string } = {},
): LiveMenuService {
  const loader = new CachedLoader(new MemoryCacheStore(), Date.now);
  return new LiveMenuService({
    sources: [
      createPowerestaSource(http, loader),
      createCompassSource(http),
      createAalefSource(http),
    ],
    loader,
    history: opts.historyUrl ? createRemoteHistoryStore(http, loader, opts.historyUrl) : undefined,
    now: () => new Date(),
  });
}
