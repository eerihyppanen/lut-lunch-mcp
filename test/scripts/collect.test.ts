import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCollect } from '../../scripts/collect.js';
import type { HistoryDataset, HistoryDay } from '../../src/core/history/types.js';
import type { Course, MenuService, RestaurantDay, RestaurantId } from '../../src/core/types.js';

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
    expect(r).toEqual({ exitCode: 0, wroteDay: true, wroteHistory: true });
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
    const r = await runCollect({
      dataDir,
      date: '2026-10-26',
      failOnError: true,
      service: svc(open, open, open),
      now: later,
      log,
    });
    expect(r).toEqual({ exitCode: 0, wroteDay: false, wroteHistory: false });
    expect(readFileSync(join(dataDir, 'history.json'), 'utf8')).toBe(before);
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
});
