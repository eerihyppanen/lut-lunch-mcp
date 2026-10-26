// Daily menu history collector (spec §5). Run by .github/workflows/collect.yml:
//   tsx scripts/collect.ts [--data-dir data] [--date YYYY-MM-DD] [--fail-on-error]
// Fetches one day for every restaurant, merges it into days/YYYY/MM/YYYY-MM-DD.json and
// updates history.json and stats.json. Earlier days of the same week are fetched too, and any menu a missed
// run did not record is filled in. Files are only rewritten when their content changes, so a
// repeat run on a complete day leaves the data branch untouched.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addDays, datesInRange, helsinkiToday, isoWeekMonday } from '../src/core/calendar/dates.js';
import { HistoryDatasetSchema, HistoryDaySchema } from '../src/core/history/schema.js';
import {
  buildHistoryDataset,
  mergeHistoryDay,
  toHistoryDay,
} from '../src/core/history/snapshot.js';
import { buildStatsIndex } from '../src/core/history/stats-index.js';
import type { HistoryDataset, HistoryDay } from '../src/core/history/types.js';
import { USER_AGENT, createFetchHttpClient } from '../src/core/http.js';
import { createLiveMenuService } from '../src/core/menu-service.js';
import { RESTAURANT_IDS, type MenuService, type RestaurantDay } from '../src/core/types.js';
import { VERSION } from '../src/version.js';

export interface CollectOptions {
  dataDir: string;
  date: string;
  failOnError: boolean;
  service: Pick<MenuService, 'getDays'>;
  now: () => Date;
  log: (line: string) => void;
}

export interface CollectResult {
  exitCode: 0 | 1;
  wroteDay: boolean;
  wroteHistory: boolean;
  wroteStats: boolean;
  /** Earlier days of the week whose files a menu was added to. */
  backfilled: string[];
}

function dayPath(dataDir: string, date: string): string {
  return join(dataDir, 'days', date.slice(0, 4), date.slice(5, 7), `${date}.json`);
}

function readDay(path: string): HistoryDay {
  const parsed = HistoryDaySchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success || parsed.data.schema !== 1) {
    throw new Error(`${path} is not a valid schema 1 history day`);
  }
  return parsed.data as HistoryDay;
}

function allDays(dataDir: string): HistoryDay[] {
  const root = join(dataDir, 'days');
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.json'))
    .map((file) => readDay(join(root, file)));
}

/** The previous history.json, or null when it is missing or unreadable (then rebuild). */
function readHistory(path: string): HistoryDataset | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = HistoryDatasetSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success && parsed.data.schema === 1 ? (parsed.data as HistoryDataset) : null;
  } catch {
    return null;
  }
}

/** A JSON file's content, or null when it is missing or unreadable. */
function readJsonFile(path: string): object | null {
  if (!existsSync(path)) return null;
  try {
    const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

/** Merges a fetch into the day's file; the merged day when the file changed, else null. */
function mergeIntoFile(dataDir: string, incoming: HistoryDay): HistoryDay | null {
  const path = dayPath(dataDir, incoming.date);
  const { day, changed } = mergeHistoryDay(existsSync(path) ? readDay(path) : null, incoming);
  if (!changed) return null;
  writeFile(path, `${JSON.stringify(day, null, 2)}\n`);
  return day;
}

/**
 * A past day of this week as the live sources show it now. Only menus are trusted: anything
 * else is recorded as "not collected", which never replaces what a run on the day recorded.
 */
function backfillRow(row: RestaurantDay): RestaurantDay {
  return row.status.kind === 'open' ? row : { ...row, status: { kind: 'error', retryable: true } };
}

/** Writes `content` to `path`, creating folders as needed. Callers decide whether to write. */
function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export async function runCollect(opts: CollectOptions): Promise<CollectResult> {
  const { dataDir, date } = opts;
  const collectedAt = opts.now().toISOString();
  const earlier = datesInRange(isoWeekMonday(date), addDays(date, -1));
  const rows = await opts.service.getDays([...earlier, date], [...RESTAURANT_IDS]);
  const recordFor = (d: string, map: (row: RestaurantDay) => RestaurantDay = (row) => row) =>
    toHistoryDay(d, rows.filter((r) => r.date === d).map(map), collectedAt, VERSION);

  // history.json is updated from its previous content, or rebuilt from every day file when
  // that can't be read (delete it to force a rebuild). generatedAt alone is not a change.
  const historyPath = join(dataDir, 'history.json');
  const previous = readHistory(historyPath);
  const days = new Map((previous?.days ?? allDays(dataDir)).map((d) => [d.date, d]));
  const firstDate = [...days.keys()].sort()[0];

  // A backfilled day gets a file only when it recovers a menu, and never before the history
  // starts; otherwise a missed day stays missing.
  const changedDays: HistoryDay[] = [];
  for (const d of earlier) {
    const incoming = recordFor(d, backfillRow);
    const recovers = incoming.restaurants.some((r) => r.status.kind === 'open');
    if (!existsSync(dayPath(dataDir, d)) && (!recovers || !firstDate || d < firstDate)) continue;
    const day = mergeIntoFile(dataDir, incoming);
    if (day) changedDays.push(day);
  }
  const backfilled = changedDays.map((d) => d.date);
  const path = dayPath(dataDir, date);
  const merged = mergeIntoFile(dataDir, recordFor(date));
  if (merged) changedDays.push(merged);
  const day = merged ?? readDay(path);

  for (const d of changedDays) days.set(d.date, d);
  const dataset = buildHistoryDataset([...days.values()], collectedAt);
  const withoutTime = (value: object) => JSON.stringify({ ...value, generatedAt: '' });
  const wroteHistory = !previous || withoutTime(previous) !== withoutTime(dataset);
  if (wroteHistory) writeFile(historyPath, `${JSON.stringify(dataset)}\n`);

  // stats.json, which the server reads (phase 3 spec §4.4), comes from the same days.
  const statsPath = join(dataDir, 'stats.json');
  const stats = buildStatsIndex([...days.values()], collectedAt);
  const previousStats = readJsonFile(statsPath);
  const wroteStats = !previousStats || withoutTime(previousStats) !== withoutTime(stats);
  if (wroteStats) writeFile(statsPath, `${JSON.stringify(stats)}\n`);

  for (const d of backfilled) opts.log(`backfilled ${d}`);
  for (const { id, status } of day.restaurants) {
    opts.log(`${id}: ${status.kind}${status.kind === 'no_menu' ? ` ${status.reason}` : ''}`);
  }
  const failed = day.restaurants.some((r) => r.status.kind === 'error');
  return {
    exitCode: opts.failOnError && failed ? 1 : 0,
    wroteDay: merged !== null,
    wroteHistory,
    wroteStats,
    backfilled,
  };
}

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const result = await runCollect({
    dataDir: argValue(args, '--data-dir') ?? 'data',
    date: argValue(args, '--date') ?? helsinkiToday(new Date()),
    failOnError: args.includes('--fail-on-error'),
    service: createLiveMenuService(createFetchHttpClient({ userAgent: USER_AGENT })),
    now: () => new Date(),
    log: (line) => console.error(line),
  });
  console.error(
    `day file ${result.wroteDay ? 'written' : 'unchanged'}, ` +
      `history.json ${result.wroteHistory ? 'written' : 'unchanged'}, ` +
      `stats.json ${result.wroteStats ? 'written' : 'unchanged'}, ` +
      `${result.backfilled.length} earlier day(s) backfilled`,
  );
  process.exit(result.exitCode);
}
