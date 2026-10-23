import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GetMenuOutput } from '../../src/mcp/schemas.js';
import { call, callText, connectClient } from '../helpers/connect.js';
import { fixtureService } from '../helpers/fixture-service.js';

let client: Client;
const getMenu = (args: Record<string, unknown>) => call<GetMenuOutput>(client, 'get_menu', args);

beforeAll(async () => {
  client = await connectClient(fixtureService());
});

describe('get_menu', () => {
  it('returns today by default with weekday and resolved date', async () => {
    const out = await getMenu({});
    expect(out.today).toBe('2026-10-23');
    expect(out.timezone).toBe('Europe/Helsinki');
    expect(out.days.map((d) => [d.date, d.weekday])).toEqual([['2026-10-23', 'Friday']]);
    expect(out.days[0]!.restaurants.map((r) => [r.id, r.status])).toEqual([
      ['lut-buffet', 'open'],
      ['bistro-skinnarila', 'open'],
      ['yolo', 'open'],
    ]);
  });

  it('covers several days and filters restaurants', async () => {
    const out = await getMenu({ date: 'tomorrow', days: 2, restaurants: ['yolo'] });
    expect(out.days.map((d) => d.date)).toEqual(['2026-10-24', '2026-10-25']);
    expect(out.days[0]!.restaurants[0]).toMatchObject({ id: 'yolo', status: 'open' });
    expect(out.days[1]!.restaurants[0]).toMatchObject({
      id: 'yolo',
      status: 'no_menu',
      reason: 'weekend',
    });
  });

  it('adds the notice only when diet or allergen filters are used', async () => {
    expect((await getMenu({})).notice).toBeNull();
    expect((await getMenu({ diet: ['vegan'] })).notice).toMatch(/confirm at the restaurant/);
  });

  it('applies diet filters and switches language', async () => {
    const vegan = await getMenu({ diet: ['vegan'], restaurants: ['yolo'] });
    const names = vegan.days[0]!.restaurants[0]!.courses.flatMap((c) =>
      c.dishes.map((d) => d.name),
    );
    expect(names).toEqual(['BBQ pulled oats hot dogs, roasted potatoes, vegan mayonnaise']);
    const fi = await getMenu({ language: 'fi', restaurants: ['yolo'] });
    expect(fi.days[0]!.restaurants[0]!.courses[0]!.name).toBe('Kasvisruoka');
  });

  it('returns a compact text rendering', async () => {
    const text = await callText(client, 'get_menu', { restaurants: ['yolo'] });
    expect(text).toContain('Friday 2026-10-23 (today)');
    expect(text).toContain('Salmon soup');
  });

  it.each(['Friday', '2026-10-23T10:00', 'next monday', '2026-02-31'])(
    'rejects date %j with guidance (review focus 1)',
    async (date) => {
      const res = await client.callTool({ name: 'get_menu', arguments: { date } });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(/today.*tomorrow.*YYYY-MM-DD/);
    },
  );

  it.each(['Yolo', 'bistro'])(
    'rejects restaurant id %j listing valid ids (review focus 3)',
    async (id) => {
      const res = await client.callTool({ name: 'get_menu', arguments: { restaurants: [id] } });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain('bistro-skinnarila');
    },
  );

  it('rejects days outside 1–7', async () => {
    for (const days of [0, 8]) {
      const res = await client.callTool({ name: 'get_menu', arguments: { days } });
      expect(res.isError).toBe(true);
    }
  });
});
