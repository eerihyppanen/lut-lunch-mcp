import type { CachedLoader } from '../cache.js';
import { SourceError, type HttpClient } from '../http.js';
import { HistoryDatasetSchema } from './schema.js';
import { indexHistory } from './snapshot.js';
import type { History, HistoryDataset, HistoryStore } from './types.js';

/** history.json on the data branch, written daily by .github/workflows/collect.yml. */
export const DEFAULT_HISTORY_URL =
  'https://raw.githubusercontent.com/eerihyppanen/lut-lunch-mcp/data/history.json';

const FRESH_MS = 6 * 3600_000;
const SUPPORTED_SCHEMA = 1;

function parseDataset(json: unknown): History {
  // Check the version first, so a newer collector's data asks for an update instead of
  // looking broken.
  const schema = (json as { schema?: unknown } | null)?.schema;
  if (typeof schema === 'number' && schema !== SUPPORTED_SCHEMA) {
    throw new SourceError(`History data uses schema ${schema}; update lut-lunch-mcp.`, false);
  }
  const parsed = HistoryDatasetSchema.safeParse(json);
  if (!parsed.success) throw new SourceError('History data is malformed', false);
  return indexHistory(parsed.data as HistoryDataset);
}

/** Downloads the shared history lazily, through the same cache as the menu sources. */
export function createRemoteHistoryStore(
  http: HttpClient,
  loader: CachedLoader,
  url: string,
): HistoryStore {
  return {
    async load() {
      const { value } = await loader.load('history', FRESH_MS, async () =>
        parseDataset(await http.getJson(url)),
      );
      return value;
    },
  };
}
