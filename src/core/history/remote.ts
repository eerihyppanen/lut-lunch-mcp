import type { CachedLoader } from '../cache.js';
import { SourceError, type HttpClient } from '../http.js';
import { HistoryDaySchema, StatsIndexSchema } from './schema.js';
import type { StatsIndex } from './stats-index.js';
import type { HistoryDay, HistoryStore } from './types.js';

/** The data branch root, written daily by .github/workflows/collect.yml. */
export const DEFAULT_HISTORY_BASE_URL =
  'https://raw.githubusercontent.com/eerihyppanen/lut-lunch-mcp/data/';

const FRESH_MS = 6 * 3600_000;
const HISTORY_JSON = 'history.json';

/** The history uses a schema this version can't read; the fix is updating the package. */
export class HistorySchemaError extends SourceError {
  constructor(schema: number) {
    super(`History data uses schema ${schema}; update lut-lunch-mcp.`, false);
    this.name = 'HistorySchemaError';
  }
}

const SUPPORTED_SCHEMA = 1;

/**
 * The data branch base URL from LUT_LUNCH_HISTORY_URL. Before 0.2.2 that named history.json,
 * so a value ending in history.json still works: its directory is used.
 */
export function historyBaseUrl(value: string): string {
  const base = value.endsWith(HISTORY_JSON) ? value.slice(0, -HISTORY_JSON.length) : value;
  return base.endsWith('/') ? base : `${base}/`;
}

function parse<T>(
  json: unknown,
  schema: { safeParse(v: unknown): { success: boolean; data?: unknown } },
): T {
  // Check the version first, so a newer collector's data asks for an update instead of
  // looking broken.
  const version = (json as { schema?: unknown } | null)?.schema;
  if (typeof version === 'number' && version !== SUPPORTED_SCHEMA) {
    throw new HistorySchemaError(version);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new SourceError('History data is malformed', false);
  return parsed.data as T;
}

/** Reads stats.json and day files from the data branch lazily, through the shared cache. */
export function createRemoteHistoryStore(
  http: HttpClient,
  loader: CachedLoader,
  baseUrl: string,
): HistoryStore {
  async function statsIndex(): Promise<StatsIndex> {
    const { value } = await loader.load('stats', FRESH_MS, async () =>
      parse<StatsIndex>(await http.getJson(`${baseUrl}stats.json`), StatsIndexSchema),
    );
    return value;
  }

  async function day(date: string): Promise<HistoryDay | null> {
    const url = `${baseUrl}days/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.json`;
    try {
      const { value } = await loader.load(`day:${date}`, FRESH_MS, async () =>
        parse<HistoryDay>(await http.getJson(url), HistoryDaySchema),
      );
      return value;
    } catch (error) {
      // raw.githubusercontent.com caches for minutes, so stats.json can list a day whose file
      // isn't served yet: that day counts as not recorded.
      if (error instanceof SourceError && error.status === 404) return null;
      throw error;
    }
  }

  return {
    statsIndex,
    async days(dates) {
      const recorded = new Set((await statsIndex()).days.map((d) => d.date));
      const found = await Promise.all(dates.filter((d) => recorded.has(d)).map(day));
      return new Map(found.flatMap((d) => (d ? [[d.date, d] as const] : [])));
    },
  };
}
