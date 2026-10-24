// Daily menu history collector (spec §5). Run by .github/workflows/collect.yml:
//   tsx scripts/collect.ts [--data-dir data] [--date YYYY-MM-DD] [--fail-on-error]
// Fetches one day for every restaurant, merges it into days/YYYY/MM/YYYY-MM-DD.json and
// rebuilds history.json. Files are only rewritten when their content changes, so a repeat
// run on a complete day leaves the data branch untouched.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { helsinkiToday } from '../src/core/calendar/dates.js';
import { HistoryDaySchema } from '../src/core/history/schema.js';
import {
  buildHistoryDataset,
  mergeHistoryDay,
  toHistoryDay,
} from '../src/core/history/snapshot.js';
import type { HistoryDay } from '../src/core/history/types.js';
import { USER_AGENT, createFetchHttpClient } from '../src/core/http.js';
import { createLiveMenuService } from '../src/core/menu-service.js';
import { RESTAURANT_IDS, type MenuService } from '../src/core/types.js';
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

/** Writes `content` to `path`, creating folders as needed. Callers decide whether to write. */
function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export async function runCollect(opts: CollectOptions): Promise<CollectResult> {
  const { dataDir, date } = opts;
  const rows = await opts.service.getDays([date], [...RESTAURANT_IDS]);
  const incoming = toHistoryDay(date, rows, opts.now().toISOString(), VERSION);

  const path = dayPath(dataDir, date);
  const { day, changed } = mergeHistoryDay(existsSync(path) ? readDay(path) : null, incoming);
  if (changed) writeFile(path, `${JSON.stringify(day, null, 2)}\n`);

  // history.json is regenerated from the day files; generatedAt alone is not a change.
  const historyPath = join(dataDir, 'history.json');
  const dataset = buildHistoryDataset(allDays(dataDir), opts.now().toISOString());
  const withoutTime = (value: object) => JSON.stringify({ ...value, generatedAt: '' });
  const previous = existsSync(historyPath)
    ? (JSON.parse(readFileSync(historyPath, 'utf8')) as object)
    : null;
  const wroteHistory = !previous || withoutTime(previous) !== withoutTime(dataset);
  if (wroteHistory) writeFile(historyPath, `${JSON.stringify(dataset)}\n`);

  for (const { id, status } of day.restaurants) {
    opts.log(`${id}: ${status.kind}${status.kind === 'no_menu' ? ` ${status.reason}` : ''}`);
  }
  const failed = day.restaurants.some((r) => r.status.kind === 'error');
  return { exitCode: opts.failOnError && failed ? 1 : 0, wroteDay: changed, wroteHistory };
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
      `history.json ${result.wroteHistory ? 'written' : 'unchanged'}`,
  );
  process.exit(result.exitCode);
}
