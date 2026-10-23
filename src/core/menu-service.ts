import { CachedLoader, MemoryCacheStore, type Loaded } from './cache.js';
import { daysBetween, helsinkiToday, isWeekend } from './calendar/dates.js';
import { finnishHoliday } from './calendar/holidays.js';
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

  const covered =
    result.coverage && date >= result.coverage.from && date <= result.coverage.through;
  if (!covered) return noMenu(date < today ? 'history_not_available' : 'not_published_yet');

  const holiday = finnishHoliday(date);
  if (holiday) return noMenu('public_holiday', holiday);
  if (isWeekend(date)) return noMenu('weekend');
  return noMenu('none_listed');
}

export class LiveMenuService implements MenuService {
  private readonly sources: ReadonlyMap<RestaurantId, MenuSource>;
  private readonly loader: CachedLoader;
  private readonly now: () => Date;

  constructor(opts: { sources: MenuSource[]; loader: CachedLoader; now: () => Date }) {
    this.sources = new Map(opts.sources.map((s) => [s.restaurantId, s]));
    this.loader = opts.loader;
    this.now = opts.now;
  }

  today(): string {
    return helsinkiToday(this.now());
  }

  async getDays(dates: string[], restaurants: RestaurantId[]): Promise<RestaurantDay[]> {
    const today = this.today();
    const sortedDates = [...new Set(dates)].sort();
    const ordered = RESTAURANT_IDS.filter((id) => restaurants.includes(id));
    const perRestaurant = await Promise.all(
      ordered.map((id) => this.daysFor(id, sortedDates, today)),
    );
    return sortedDates.flatMap((_, i) => perRestaurant.map((days) => days[i]!));
  }

  /** One RestaurantDay per date (same order), loading each source unit at most once. */
  private async daysFor(
    id: RestaurantId,
    dates: string[],
    today: string,
  ): Promise<RestaurantDay[]> {
    const source = this.sources.get(id);
    if (!source) throw new Error(`No menu source configured for ${id}`);
    const nowIso = this.now().toISOString();
    const inWindow = (date: string) => {
      const offset = daysBetween(today, date);
      return offset >= -WINDOW_PAST_DAYS && offset <= WINDOW_FUTURE_DAYS;
    };

    const firstDateOfUnit = new Map<string, string>();
    for (const date of dates.filter(inWindow)) {
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

/** The production service: all three restaurants, one shared in-memory cache. */
export function createLiveMenuService(http: HttpClient): LiveMenuService {
  const loader = new CachedLoader(new MemoryCacheStore(), Date.now);
  return new LiveMenuService({
    sources: [
      createPowerestaSource(http, loader),
      createCompassSource(http),
      createAalefSource(http),
    ],
    loader,
    now: () => new Date(),
  });
}
