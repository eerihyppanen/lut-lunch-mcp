import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCollect } from '../../scripts/collect.js';
import { decodeStatsIndex } from '../../src/core/history/stats-index.js';
import type { HistoryDataset, HistoryDay } from '../../src/core/history/types.js';
import {
  RESTAURANT_IDS,
  type Course,
  type MenuService,
  type RestaurantDay,
  type RestaurantId,
} from '../../src/core/types.js';

const course: Course = {
  name: { fi: 'Lounas', en: 'Lunch' },
  price: null,
  dishes: [
    {
      name: { fi: 'Keitto', en: 'Soup' },
      tags: [],
      codes: [],
      allergens: { coverage: 'none', contains: [], mayContain: [], assessed: [] },
    },
  ],
};

type Make = (id: RestaurantId, date: string) => RestaurantDay;
const open: Make = (restaurantId, date) => ({
  restaurantId,
  date,
  status: { kind: 'open', courses: [course] },
  stale: false,
  fetchedAt: '2026-10-26T06:30:00.000Z',
});
const err: Make = (restaurantId, date) => ({
  ...open(restaurantId, date),
  status: { kind: 'error', retryable: true },
});
const none: Make = (restaurantId, date) => ({
  ...open(restaurantId, date),
  status: { kind: 'no_menu', reason: 'none_listed' },
});

/** A service whose restaurants answer with the given statuses for any requested date. */
function svc(lut: Make, bistro: Make, yolo: Make): Pick<MenuService, 'today' | 'getDays'> {
  return {
    today: () => '2026-10-26',
    getDays: (dates) =>
      Promise.resolve(
        dates.flatMap((d) => [
          lut('lut-buffet', d),
          bistro('bistro-skinnarila', d),
          yolo('yolo', d),
        ]),
      ),
  };
}

const now = () => new Date('2026-10-26T06:30:00Z');
const later = () => new Date('2026-10-26T07:30:00Z');
const log = () => {};
let dataDir: string;
const dayFile = (date: string) =>
  join(dataDir, 'days', date.slice(0, 4), date.slice(5, 7), `${date}.json`);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'collect-'));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('runCollect', () => {
  it('creates the day file and history.json', async () => {
    const r = await runCollect({
      dataDir,
      date: '2026-10-26',
      failOnError: false,
      service: svc(open, open, err),
      now,
      log,
    });
    expect(r).toEqual({
      exitCode: 0,
      wroteDay: true,
      wroteHistory: true,
      wroteStats: true,
      backfilled: [],
    });
    const day = readJson<HistoryDay>(dayFile('2026-10-26'));
    expect(day.restaurants.map((x: { status: { kind: string } }) => x.status.kind)).toEqual([
      'open',
      'open',
      'error',
    ]);
    expect(readFileSync(dayFile('2026-10-26'), 'utf8')).toMatch(/^\{\n {2}"schema": 1,[\s\S]*\n$/);
    const hist = readJson<HistoryDataset>(join(dataDir, 'history.json'));
    expect(hist).toMatchObject({ schema: 1, firstDate: '2026-10-26', lastDate: '2026-10-26' });
  });

  it('keeps a recorded menu when the retry fails, and fails only with --fail-on-error', async () => {
    const first = await runCollect({
      dataDir,
      date: '2026-10-26',
      failOnError: false,
      service: svc(open, open, err),
      now,
      log,
    });
    expect(first.exitCode).toBe(0);
    const r = await runCollect({
      dataDir,
      date: '2026-10-26',
      failOnError: true,
      service: svc(err, open, err),
      now,
      log,
    });
    expect(r.exitCode).toBe(1);
    expect(readJson<HistoryDay>(dayFile('2026-10-26')).restaurants[0]!.status.kind).toBe('open');
  });

  it('rewrites nothing when the day is already complete (review focus 4)', async () => {
    await runCollect({
      dataDir,
      date: '2026-10-26',
      failOnError: false,
      service: svc(open, open, open),
      now,
      log,
    });
    const before = readFileSync(join(dataDir, 'history.json'), 'utf8');
    const statsBefore = readFileSync(join(dataDir, 'stats.json'), 'utf8');
    const r = await runCollect({
      dataDir,
      date: '2026-10-26',
      failOnError: true,
      service: svc(open, open, open),
      now: later,
      log,
    });
    expect(r).toEqual({
      exitCode: 0,
      wroteDay: false,
      wroteHistory: false,
      wroteStats: false,
      backfilled: [],
    });
    expect(readFileSync(join(dataDir, 'history.json'), 'utf8')).toBe(before);
    expect(readFileSync(join(dataDir, 'stats.json'), 'utf8')).toBe(statsBefore);
  });

  it('includes earlier days in history.json', async () => {
    for (const date of ['2026-10-26', '2026-10-27']) {
      await runCollect({
        dataDir,
        date,
        failOnError: false,
        service: svc(open, open, open),
        now,
        log,
      });
    }
    const hist = readJson<HistoryDataset>(join(dataDir, 'history.json'));
    expect(hist.days.map((d: { date: string }) => d.date)).toEqual(['2026-10-26', '2026-10-27']);
  });

  it('logs one line per restaurant', async () => {
    const lines: string[] = [];
    await runCollect({
      dataDir,
      date: '2026-10-26',
      failOnError: false,
      service: svc(open, open, err),
      now,
      log: (line) => lines.push(line),
    });
    expect(lines).toEqual(['lut-buffet: open', 'bistro-skinnarila: open', 'yolo: error']);
  });

  it('backfills earlier days of the week with menus only (code review #2)', async () => {
    const statuses = (date: string) =>
      readJson<HistoryDay>(dayFile(date)).restaurants.map((x) =>
        x.status.kind === 'no_menu' ? x.status.reason : x.status.kind,
      );
    await runCollect({
      dataDir,
      date: '2026-10-26',
      failOnError: false,
      service: svc(err, none, open),
      now,
      log,
    });
    const asked: string[][] = [];
    const service = svc(open, open, none);
    const r = await runCollect({
      dataDir,
      date: '2026-10-28',
      failOnError: false,
      service: { getDays: (dates, ids) => (asked.push(dates), service.getDays(dates, ids)) },
      now: later,
      log,
    });
    expect(asked).toEqual([['2026-10-26', '2026-10-27', '2026-10-28']]);
    expect(r.backfilled).toEqual(['2026-10-26', '2026-10-27']);
    expect(statuses('2026-10-26')).toEqual(['open', 'open', 'open']); // menus fill in, Yolo kept
    expect(statuses('2026-10-27')).toEqual(['open', 'open', 'error']); // missed run: not collected
    expect(statuses('2026-10-28')).toEqual(['open', 'open', 'none_listed']);
    const hist = readJson<HistoryDataset>(join(dataDir, 'history.json'));
    expect(hist.days.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
  });

  it('backfills neither before the history starts nor days without a menu (review)', async () => {
    const exists = (date: string) => existsSync(dayFile(date));
    const first = await runCollect({
      dataDir,
      date: '2026-10-27',
      failOnError: false,
      service: svc(open, open, open),
      now,
      log,
    });
    expect(first.backfilled).toEqual([]);
    expect(exists('2026-10-26')).toBe(false); // before the first recorded day
    const byDate: Record<string, Make> = { '2026-10-28': open, '2026-10-29': none };
    const r = await runCollect({
      dataDir,
      date: '2026-10-30',
      failOnError: false,
      service: {
        getDays: (dates) =>
          Promise.resolve(
            dates.flatMap((d) =>
              RESTAURANT_IDS.map((id) => (id === 'lut-buffet' ? (byDate[d] ?? open) : none)(id, d)),
            ),
          ),
      },
      now: later,
      log,
    });
    expect(r.backfilled).toEqual(['2026-10-28']);
    expect(exists('2026-10-29')).toBe(false); // nothing recovered: stays missing
    expect(
      readJson<HistoryDay>(dayFile('2026-10-28')).restaurants.map((x) => x.status.kind),
    ).toEqual(['open', 'error', 'error']);
  });

  it('updates history.json without rereading every day file (code review #9)', async () => {
    const run = (date: string) =>
      runCollect({ dataDir, date, failOnError: false, service: svc(open, open, open), now, log });
    await run('2026-10-19');
    // An old day file the run has no reason to read.
    mkdirSync(join(dataDir, 'days', '2026', '09'), { recursive: true });
    writeFileSync(dayFile('2026-09-01'), 'not json');
    await run('2026-10-26');
    const hist = readJson<HistoryDataset>(join(dataDir, 'history.json'));
    expect(hist.days.map((d) => d.date)).toEqual(['2026-10-19', '2026-10-26']);
  });

  it('rebuilds history.json from the day files when it is missing or unreadable', async () => {
    const run = (date: string) =>
      runCollect({ dataDir, date, failOnError: false, service: svc(open, open, open), now, log });
    await run('2026-10-19');
    writeFileSync(join(dataDir, 'history.json'), '{"schema": 2}');
    await run('2026-10-26');
    const hist = readJson<HistoryDataset>(join(dataDir, 'history.json'));
    expect(hist).toMatchObject({ schema: 1, firstDate: '2026-10-19', lastDate: '2026-10-26' });
  });

  it('writes stats.json for the same days as history.json (phase 3)', async () => {
    const run = (date: string) =>
      runCollect({ dataDir, date, failOnError: false, service: svc(open, open, err), now, log });
    await run('2026-10-26');
    await run('2026-10-27');
    const stats = decodeStatsIndex(readJson(join(dataDir, 'stats.json')))!;
    const hist = readJson<HistoryDataset>(join(dataDir, 'history.json'));
    expect(stats.days.map((d) => d.date)).toEqual(hist.days.map((d) => d.date));
    expect(stats.days[0]!.restaurants.map((r) => r.status)).toEqual(['open', 'open', 'error']);
    expect(stats.dishes.map((d) => d.fi)).toEqual(['Keitto']);
  });

  it('rebuilds both files from the day files when history.json is unreadable (review focus)', async () => {
    const run = (date: string) =>
      runCollect({ dataDir, date, failOnError: false, service: svc(open, open, open), now, log });
    await run('2026-10-19');
    writeFileSync(join(dataDir, 'history.json'), '{"schema": 2}');
    const r = await run('2026-10-26');
    expect(r).toMatchObject({ wroteHistory: true, wroteStats: true });
    const stats = decodeStatsIndex(readJson(join(dataDir, 'stats.json')))!;
    const hist = readJson<HistoryDataset>(join(dataDir, 'history.json'));
    expect(stats.days.map((d) => d.date)).toEqual(['2026-10-19', '2026-10-26']);
    expect(hist.days.map((d) => d.date)).toEqual(['2026-10-19', '2026-10-26']);
  });
});
