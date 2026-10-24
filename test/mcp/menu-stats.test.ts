import { describe, expect, it } from 'vitest';
import { buildHistoryDataset, indexHistory } from '../../src/core/history/snapshot.js';
import { HistorySchemaError } from '../../src/core/history/remote.js';
import { SourceError } from '../../src/core/http.js';
import type { MenuService } from '../../src/core/types.js';
import type { GetMenuOutput, MenuStatsOutput } from '../../src/mcp/schemas.js';
import { call, callText, connectClient } from '../helpers/connect.js';
import { fakeService } from '../helpers/fakes.js';
import { fixtureHistory, historyService } from '../helpers/history-fixture.js';

const withHistory = async () =>
  connectClient(fakeService([], '2026-10-30', await fixtureHistory()));

describe('menu_stats', () => {
  it('answers "how often salmon" from history', async () => {
    const client = await withHistory();
    const out = await call<MenuStatsOutput>(client, 'menu_stats', { query: 'lohi' });
    expect(out.searched).toEqual({
      from: '2026-10-19',
      to: '2026-10-30',
      restaurants: ['lut-buffet', 'bistro-skinnarila', 'yolo'],
      query: 'lohi',
      diet: [],
    });
    expect(out).toMatchObject({ timezone: 'Europe/Helsinki', today: '2026-10-30', notice: null });
    expect(out.matches.days_served).toBe(1);
    expect(await callText(client, 'menu_stats', { query: 'lohi' })).toMatch(
      /History 2026-10-19 to 2026-10-25 \(6 days recorded\)[\s\S]*Salmon soup/,
    );
  });

  it('writes counts in plain English', async () => {
    const client = await withHistory();
    const text = await callText(client, 'menu_stats', { query: 'keitto' });
    expect(text).toContain('Missing: 1 day.');
    expect(text).toContain('Served on 5 restaurant-days (8 dishes).');
    expect(text).toContain('LUT Buffet: 4 of 4 open days · Bistro Skinnarila: 0 of 4 open days');
  });

  it('accepts a future "to" and rejects to before from (review focus 2)', async () => {
    const client = await withHistory();
    const out = await call<MenuStatsOutput>(client, 'menu_stats', {
      query: 'lohi',
      to: 'tomorrow',
    });
    expect(out.matches.days_served).toBe(1);
    const res = await client.callTool({
      name: 'menu_stats',
      arguments: { from: '2026-10-25', to: '2026-10-20' },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('is before');
  });

  it('reports an unavailable history with retry wording, today still works (review focus 3)', async () => {
    const client = await connectClient(fakeService([], '2026-10-30'));
    const res = await client.callTool({ name: 'menu_stats', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain(
      'Menu history is temporarily unavailable; try again later.',
    );
    expect(
      (await client.callTool({ name: 'list_restaurants', arguments: {} })).isError,
    ).toBeFalsy();
  });

  it('says when nothing is recorded yet', async () => {
    const client = await connectClient(
      fakeService([], '2026-10-30', indexHistory(buildHistoryDataset([], 'T'))),
    );
    expect(await callText(client, 'menu_stats', {})).toContain('No history recorded yet');
  });

  it('adds the notice for diet filters and lists four tools', async () => {
    const client = await withHistory();
    expect((await call<MenuStatsOutput>(client, 'menu_stats', { diet: ['vegan'] })).notice).toMatch(
      /confirm at the restaurant/,
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'find_dishes',
      'get_menu',
      'list_restaurants',
      'menu_stats',
    ]);
    expect(tools.find((t) => t.name === 'menu_stats')!.description).toMatch(
      /^Statistics from the recorded lunch history/,
    );
  });

  it('serves a past day through get_menu end to end', async () => {
    const client = await connectClient(historyService());
    const out = await call<GetMenuOutput>(client, 'get_menu', {
      date: '2026-10-20',
      restaurants: ['lut-buffet'],
    });
    expect(out.days[0]!.restaurants[0]!.status).toBe('open');
  });

  const failingHistory = (error: Error): MenuService => ({
    ...fakeService([], '2026-10-30'),
    loadHistory: () => Promise.reject(error),
  });

  it('keeps the schema message but words other history failures as temporary (review finding 1/2)', async () => {
    const schema = await connectClient(failingHistory(new HistorySchemaError(2)));
    expect(await callText(schema, 'menu_stats', {})).toBe(
      'History data uses schema 2; update lut-lunch-mcp.',
    );
    const notFound = await connectClient(
      failingHistory(
        new SourceError(
          'Request to https://raw.githubusercontent.com/x/data/history.json failed with HTTP 404',
          false,
        ),
      ),
    );
    const text = await callText(notFound, 'menu_stats', {});
    expect(text).toBe('Menu history is temporarily unavailable; try again later.');
  });

  it('starts at "to" when "to" is before the recorded history (review finding 5)', async () => {
    const out = await call<MenuStatsOutput>(await withHistory(), 'menu_stats', {
      query: 'lohi',
      to: '2026-10-10',
    });
    expect(out.searched).toMatchObject({ from: '2026-10-10', to: '2026-10-10' });
    expect(out.matches.days_served).toBe(0);
    const empty = await connectClient(
      fakeService([], '2026-10-30', indexHistory(buildHistoryDataset([], 'T'))),
    );
    expect(await callText(empty, 'menu_stats', { to: '2026-10-10' })).toContain(
      'No history recorded yet',
    );
  });

  it('matches a query without diacritics (review focus 5)', async () => {
    const out = await call<MenuStatsOutput>(await withHistory(), 'menu_stats', {
      query: 'Itamaista',
    });
    expect(out.matches.first_seen).toMatchObject({ dish: 'Itämaista linssikeittoa' });
  });
});
