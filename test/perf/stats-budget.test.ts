import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, daysBetween, isWeekend } from '../../src/core/calendar/dates.js';
import {
  buildStatsIndex,
  decodeStatsIndex,
  encodeStatsIndex,
} from '../../src/core/history/stats-index.js';
import type { HistoryDay } from '../../src/core/history/types.js';
import { RESTAURANT_IDS } from '../../src/core/types.js';
import { computeStats } from '../../src/mcp/stats.js';
import { fixtureHistoryDays } from '../helpers/history-fixture.js';

// A Worker request gets 10 ms of CPU on the free plan (phase 3 spec §1, §9). Three years of
// history must parse and answer a broad menu_stats query in well under that.

const START = '2026-11-02';
const YEARS_OF_DAYS = 3 * 365;

/** Three years of weekdays cycling through the fixture menus, dish names varying by week. */
async function threeYears(): Promise<HistoryDay[]> {
  const templates = (await fixtureHistoryDays()).filter((d) =>
    d.restaurants.some((r) => r.status.kind === 'open'),
  );
  return Array.from({ length: YEARS_OF_DAYS }, (_, i): HistoryDay => {
    const date = addDays(START, i);
    const template = templates[i % templates.length]!;
    if (isWeekend(date)) {
      return {
        ...template,
        date,
        restaurants: RESTAURANT_IDS.map((id) => ({
          id,
          status: { kind: 'no_menu', reason: 'weekend' },
        })),
      };
    }
    const week = Math.floor(daysBetween(START, date) / 7) % 40;
    return {
      ...template,
      date,
      restaurants: template.restaurants.map((r) =>
        r.status.kind !== 'open'
          ? r
          : {
              ...r,
              status: {
                ...r.status,
                courses: r.status.courses.map((c) => ({
                  ...c,
                  dishes: c.dishes.map((d) => ({
                    ...d,
                    name: { fi: `${d.name.fi} ${week}`, en: d.name.en && `${d.name.en} ${week}` },
                  })),
                })),
              },
            },
      ),
    };
  });
}

let text: string;

beforeAll(async () => {
  text = JSON.stringify(encodeStatsIndex(buildStatsIndex(await threeYears(), 'T')));
});

describe('CPU budget', () => {
  it('parses and queries three years of history well within 10 ms', () => {
    const run = () => {
      const index = decodeStatsIndex(JSON.parse(text))!;
      computeStats(index, {
        restaurants: [...RESTAURANT_IDS],
        from: index.firstDate!,
        to: index.lastDate!,
        groupBy: 'month',
        top: 20,
        language: 'en',
        query: 'keitto',
      });
    };
    for (let i = 0; i < 5; i++) run(); // warm up the JIT
    const times = Array.from({ length: 21 }, () => {
      const t = performance.now();
      run();
      return performance.now() - t;
    });
    const median = times.sort((a, b) => a - b)[10]!;
    console.log(
      `stats budget: ${(text.length / 1024).toFixed(0)} KB, median ${median.toFixed(2)} ms`,
    );
    expect(median).toBeLessThan(5);
  });
});
