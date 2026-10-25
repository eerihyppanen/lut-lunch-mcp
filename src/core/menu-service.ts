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
  // Yolo's page can start after today (on Sundays, and in the evening once it has moved on):
  // today is then no longer known, while later days before coverage are still explained by
  // holiday / weekend / nothing listed below.
  const { coverage } = result;
  if (!coverage || date > coverage.through) {
    return noMenu(date < today ? 'history_not_available' : 'not_published_yet');
  }
  if (date < coverage.from && date <= today) return noMenu('history_not_available');

  const holiday = finnishHoliday(date);
  if (holiday) return noMenu('public_holiday', holiday);
  if (isWeekend(date)) return noMenu('weekend');
  return noMenu('none_listed');
}

/**
 * A day as recorded: what was served, or why not (spec §6.3). Null when not recorded, or when
 * its collection failed and the live source can still be asked (`live`).
 */
function recordedDay(
  history: History,
  id: RestaurantId,
  date: string,
  live: boolean,
): RestaurantDay | null {
  const day = history.days.get(date);
  const entry = day?.restaurants.find((r) => r.id === id);
  if (!day || !entry || (entry.status.kind === 'error' && live)) return null;
  // A failed collection can't be retried once the source has moved on: "no history".
  const status = entry.status.kind === 'error' ? noMenu('history_not_available') : entry.status;
  return { restaurantId: id, date, status, stale: false, fetchedAt: day.collectedAt };
}

const isUnknown = (status: DayStatus): boolean =>
  status.kind === 'no_menu' && status.reason === 'history_not_available';

const toSourceError = (error: unknown): SourceError =>
  error instanceof SourceError ? error : new SourceError(String(error), false);

/** The history or its load error, loaded at most once per request; undefined without a store. */
type HistoryGetter = () => Promise<History | SourceError | undefined>;

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
    const store = this.history;
    let pending: Promise<History | SourceError> | undefined;
    const history: HistoryGetter = () =>
      store ? (pending ??= store.load().catch(toSourceError)) : Promise.resolve(undefined);
    // Start the download now; the live sources are asked meanwhile.
    if (sortedDates.some((date) => date < today)) void history();
    const perRestaurant = await Promise.all(
      ordered.map((id) => this.daysFor(id, sortedDates, today, history)),
    );
    return sortedDates.flatMap((_, i) => perRestaurant.map((days) => days[i]!));
  }

  /** One RestaurantDay per date (same order), loading each source unit at most once. */
  private async daysFor(
    id: RestaurantId,
    dates: string[],
    today: string,
    history: HistoryGetter,
  ): Promise<RestaurantDay[]> {
    const source = this.sources.get(id);
    if (!source) throw new Error(`No menu source configured for ${id}`);
    const nowIso = this.now().toISOString();
    const inWindow = (date: string) => {
      const offset = daysBetween(today, date);
      return offset >= -WINDOW_PAST_DAYS && offset <= WINDOW_FUTURE_DAYS;
    };

    const units = new Map<string, Promise<Loaded<SourceResult> | SourceError>>();
    const loadUnit = (date: string) => {
      const key = source.unitKey(date);
      if (units.has(key)) return;
      const load = this.loader.load(key, source.freshMs, () => source.fetchUnit(date, today));
      units.set(key, load.catch(toSourceError));
    };
    // Today and later never come from the history: ask the sources before waiting for it.
    for (const date of dates) if (date >= today && inWindow(date)) loadUnit(date);

    // Past dates come from the recorded history when it has them (spec §6.3). If the history
    // could not be loaded, dates older than the live window can only report that error.
    const fromHistory = new Map<string, RestaurantDay>();
    const past = dates.filter((date) => date < today);
    const loaded = past.length ? await history() : undefined;
    for (const date of past) {
      if (loaded instanceof SourceError) {
        if (inWindow(date)) continue;
        const status: DayStatus = { kind: 'error', retryable: loaded.retryable };
        fromHistory.set(date, { restaurantId: id, date, status, stale: false, fetchedAt: nowIso });
        continue;
      }
      const recorded = loaded && recordedDay(loaded, id, date, inWindow(date));
      if (recorded) fromHistory.set(date, recorded);
    }
    for (const date of past) if (inWindow(date) && !fromHistory.has(date)) loadUnit(date);

    const results = new Map<string, Loaded<SourceResult> | SourceError>();
    await Promise.all([...units].map(async ([key, unit]) => results.set(key, await unit)));

    const rows = dates.map((date): RestaurantDay => {
      const recorded = fromHistory.get(date);
      if (recorded) return recorded;
      const base = { restaurantId: id, date };
      if (!inWindow(date)) {
        const reason = date < today ? 'history_not_available' : 'not_published_yet';
        return { ...base, status: noMenu(reason), stale: false, fetchedAt: nowIso };
      }
      const unit = results.get(source.unitKey(date))!;
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
    return this.withRecordedToday(rows, id, today, history);
  }

  /** Today, once the source has moved on (Yolo in the evening), as the morning recorded it. */
  private async withRecordedToday(
    rows: RestaurantDay[],
    id: RestaurantId,
    today: string,
    history: HistoryGetter,
  ): Promise<RestaurantDay[]> {
    const i = rows.findIndex((r) => r.date === today && isUnknown(r.status));
    if (i < 0) return rows;
    const loaded = await history();
    if (!loaded || loaded instanceof SourceError) return rows;
    const recorded = recordedDay(loaded, id, today, false);
    if (!recorded || isUnknown(recorded.status)) return rows;
    return rows.map((row, j) => (j === i ? recorded : row));
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
