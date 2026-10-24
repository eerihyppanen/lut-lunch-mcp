import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FindDishesOutput } from '../../src/mcp/schemas.js';
import { call, callText, connectClient } from '../helpers/connect.js';
import { fakeService } from '../helpers/fakes.js';
import { fixtureService } from '../helpers/fixture-service.js';

let client: Client;
const find = (args: Record<string, unknown>) => call<FindDishesOutput>(client, 'find_dishes', args);

beforeAll(async () => {
  client = await connectClient(fixtureService());
});

describe('find_dishes', () => {
  it('finds salmon at Yolo on Friday', async () => {
    const out = await find({ query: 'salmon' });
    expect(out.searched).toEqual({
      from: '2026-10-23',
      to: '2026-10-29',
      restaurants: ['lut-buffet', 'bistro-skinnarila', 'yolo'],
    });
    expect(out.matches.map((m) => [m.date, m.restaurant_id, m.course, m.dish.name])).toEqual([
      ['2026-10-23', 'yolo', 'Soup', 'Salmon soup'],
    ]);
    expect(out.notice).toBeNull();
  });

  it.each(['LOHI', 'lohi', 'Lohikeitto'])(
    'matches Finnish and case-insensitively: %s (review focus 5)',
    async (query) => {
      expect((await find({ query })).total_matches).toBeGreaterThan(0);
    },
  );

  it('matches across diacritics (review focus 5)', async () => {
    expect(
      (await find({ query: 'kasvis tikka', from: 'tomorrow', to: 'tomorrow' })).total_matches,
    ).toBe(1);
    expect((await find({ query: 'Itamaista' })).total_matches).toBe(1);
  });

  it('lists vegan dishes tomorrow and reports days without data', async () => {
    const out = await find({ diet: ['vegan'], from: 'tomorrow', to: 'tomorrow' });
    expect(out.matches.map((m) => [m.restaurant_id, m.dish.name])).toEqual([
      ['yolo', 'Vegetable tikka masala'],
    ]);
    expect(out.days_without_data).toEqual([
      {
        date: '2026-10-24',
        restaurant_id: 'lut-buffet',
        status: 'no_menu',
        reason: 'weekend',
        holiday_name: null,
      },
      {
        date: '2026-10-24',
        restaurant_id: 'bistro-skinnarila',
        status: 'no_menu',
        reason: 'weekend',
        holiday_name: null,
      },
    ]);
    expect(out.notice).toMatch(/confirm at the restaurant/);
  });

  it('counts dishes left out for missing allergen data', async () => {
    const out = await find({
      exclude_allergens: ['egg'],
      from: 'today',
      to: 'today',
      restaurants: ['bistro-skinnarila'],
    });
    expect(out.matches).toEqual([]);
    expect(out.unverifiable).toBe(9);
  });

  it('never offers an unmarked Yolo dish as egg-free (review finding 1)', async () => {
    const out = await find({
      exclude_allergens: ['egg'],
      restaurants: ['yolo'],
      to: '2026-10-27',
      limit: 100,
    });
    const names = out.matches.map((m) => m.dish.name);
    expect(names).not.toContain('Tuna and eggs (Inc. light soup)');
    expect(names).not.toContain('Chocolate mousse/chocolate cake (L,MU)');
    expect(out.unverifiable).toBeGreaterThan(0);
  });

  it('names the public holiday for days without data', async () => {
    const holiday = await connectClient(
      fakeService([
        {
          restaurantId: 'lut-buffet',
          date: '2026-10-31',
          status: { kind: 'no_menu', reason: 'public_holiday', holidayName: "All Saints' Day" },
          stale: false,
          fetchedAt: '2026-10-23T09:00:00.000Z',
        },
      ]),
    );
    const args = {
      query: 'lohi',
      from: '2026-10-31',
      to: '2026-10-31',
      restaurants: ['lut-buffet'],
    };
    const out = await call<FindDishesOutput>(holiday, 'find_dishes', args);
    expect(out.days_without_data).toEqual([
      {
        date: '2026-10-31',
        restaurant_id: 'lut-buffet',
        status: 'no_menu',
        reason: 'public_holiday',
        holiday_name: "All Saints' Day",
      },
    ]);
    expect(await callText(holiday, 'find_dishes', args)).toContain(
      "LUT Buffet on 2026-10-31: public holiday (All Saints' Day)",
    );
  });

  it('truncates at limit', async () => {
    const out = await find({ diet: ['lactose_free'], limit: 2 });
    expect(out.matches).toHaveLength(2);
    expect(out.truncated).toBe(true);
    expect(out.total_matches).toBeGreaterThan(2);
  });

  it('orders matches by date, then restaurant, then course', async () => {
    const out = await find({ diet: ['vegan'], from: 'today', to: 'today', limit: 100 });
    expect(out.matches.map((m) => m.restaurant_id)).toEqual([
      'lut-buffet',
      'lut-buffet',
      'bistro-skinnarila',
      'bistro-skinnarila',
      'bistro-skinnarila',
      'yolo',
    ]);
  });

  it('returns a compact text rendering', async () => {
    const text = await callText(client, 'find_dishes', { query: 'salmon' });
    expect(text).toContain('Friday 2026-10-23 · Yolo · Soup: Salmon soup');
  });

  it('requires a criterion and a valid range', async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{}, /at least one of query, diet or exclude_allergens.*get_menu/],
      [{ query: 'x', from: '2026-10-25', to: '2026-10-23' }, /before/],
      [{ query: 'x', to: '2026-11-07' }, /14 days/],
      [{ query: 'x', from: 'Friday' }, /YYYY-MM-DD/],
    ];
    for (const [args, message] of cases) {
      const res = await client.callTool({ name: 'find_dishes', arguments: args });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(message);
    }
  });
});
