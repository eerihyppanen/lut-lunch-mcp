import { describe, expect, it, vi } from 'vitest';
import { CachedLoader, MemoryCacheStore } from '../../src/core/cache.js';
import { SourceError } from '../../src/core/http.js';
import { LiveMenuService } from '../../src/core/menu-service.js';
import type { MenuService } from '../../src/core/types.js';
import type { FindDishesOutput, GetMenuOutput } from '../../src/mcp/schemas.js';
import { call, callText, connectClient } from '../helpers/connect.js';
import { fakeSource } from '../helpers/fakes.js';
import { FIXTURE_NOW } from '../helpers/fixture-service.js';

function allSourcesDown(): LiveMenuService {
  const down = new SourceError('down', true);
  return new LiveMenuService({
    sources: [
      fakeSource('lut-buffet', down),
      fakeSource('bistro-skinnarila', down),
      fakeSource('yolo', down),
    ],
    loader: new CachedLoader(new MemoryCacheStore(), () => FIXTURE_NOW.getTime()),
    now: () => FIXTURE_NOW,
  });
}

const broken: MenuService = {
  today: () => '2026-10-23',
  getDays: () => Promise.reject(new TypeError('boom')),
  loadHistory: () => Promise.reject(new TypeError('boom')),
};

describe('when every source is down', () => {
  it('get_menu answers normally with every restaurant unavailable', async () => {
    const client = await connectClient(allSourcesDown());
    const out = await call<GetMenuOutput>(client, 'get_menu', {});
    expect(out.days[0]!.restaurants.map((r) => [r.status, r.reason])).toEqual([
      ['error', 'source_unavailable'],
      ['error', 'source_unavailable'],
      ['error', 'source_unavailable'],
    ]);
    expect(await callText(client, 'get_menu', {})).toMatch(/try again later/i);
  });

  it('find_dishes reports the unavailable days instead of "no matches"', async () => {
    const client = await connectClient(allSourcesDown());
    const out = await call<FindDishesOutput>(client, 'find_dishes', {
      query: 'salmon',
      to: 'today',
    });
    expect(out.matches).toEqual([]);
    expect(out.days_without_data.map((d) => d.reason)).toEqual([
      'source_unavailable',
      'source_unavailable',
      'source_unavailable',
    ]);
    expect(await callText(client, 'find_dishes', { query: 'salmon', to: 'today' })).toMatch(
      /try again later/i,
    );
  });
});

describe('unexpected exceptions', () => {
  it.each([
    ['get_menu', {}, 'Internal error while fetching menus.'],
    ['find_dishes', { query: 'x' }, 'Internal error while searching menus.'],
  ])('%s turns them into a tool error without leaking details', async (name, args, message) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await (await connectClient(broken)).callTool({ name, arguments: args });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain(message);
    expect(JSON.stringify(res.content)).not.toContain('boom');
    expect(log).toHaveBeenCalled(); // details go to stderr
    log.mockRestore();
  });
});
