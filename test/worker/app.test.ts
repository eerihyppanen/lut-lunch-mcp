import { describe, expect, it } from 'vitest';
import type { MenuService, RestaurantDay } from '../../src/core/types.js';
import { VERSION } from '../../src/version.js';
import { createWorker } from '../../src/worker/app.js';
import { RATE_LIMIT } from '../../src/worker/rate-limit.js';
import { fakeService } from '../helpers/fakes.js';
import { ORIGIN, initialize, mcpPost, toolCall } from '../helpers/worker.js';

const open: RestaurantDay = {
  restaurantId: 'lut-buffet',
  date: '2026-10-23',
  status: {
    kind: 'open',
    courses: [
      {
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
      },
    ],
  },
  stale: false,
  fetchedAt: '2026-10-23T09:00:00.000Z',
};

function worker(
  service: MenuService = fakeService([open]),
  log: (line: string) => void = () => {},
) {
  return createWorker({ service, log });
}

/** The parts of a JSON-RPC response these tests read. */
interface RpcResponse {
  result: {
    serverInfo?: { name: string; version: string };
    tools: { name: string }[];
    isError?: boolean;
    content: { text: string }[];
  };
}

const json = async (res: Response) => (await res.json()) as RpcResponse;

describe('Worker /mcp', () => {
  it('initializes as lut-lunch-mcp', async () => {
    const res = await mcpPost(worker(), initialize);
    expect(res.status).toBe(200);
    expect((await json(res)).result.serverInfo).toEqual({
      name: 'lut-lunch-mcp',
      version: VERSION,
    });
  });

  it('lists the four tools', async () => {
    const res = await mcpPost(worker(), { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = (await json(res)).result.tools.map((t) => t.name);
    expect(names.sort()).toEqual(['find_dishes', 'get_menu', 'list_restaurants', 'menu_stats']);
  });

  it('answers a get_menu call', async () => {
    const res = await mcpPost(worker(), toolCall('get_menu', { date: '2026-10-23' }));
    const { result } = await json(res);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('Soup');
  });

  it('logs one line per tool call, without the client IP or arguments', async () => {
    const lines: string[] = [];
    await mcpPost(
      worker(fakeService([open]), (line) => lines.push(line)),
      toolCall('get_menu', { date: '2026-10-23' }),
      { 'CF-Connecting-IP': '203.0.113.9' },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"tool":"get_menu"');
    expect(lines[0]).not.toContain('203.0.113.9');
    expect(lines[0]).not.toContain('2026-10-23');
  });

  it('keeps stack traces out of answers', async () => {
    const broken: MenuService = {
      ...fakeService(),
      today: () => {
        throw new Error('boom');
      },
    };
    const res = await mcpPost(worker(broken), toolCall('get_menu', {}));
    expect(await res.text()).not.toMatch(/\bat \S+ \(/);
  });

  it('answers HTTP 500 with a JSON-RPC internal error when the Worker itself fails', async () => {
    const failing = worker(fakeService([open]), () => {
      throw new Error('log sink down');
    });
    const res = await mcpPost(failing, toolCall('get_menu', { date: '2026-10-23' }));
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal error' },
      id: null,
    });
  });

  it.each(['GET', 'DELETE'])(
    'answers %s /mcp with a 4xx, not a 500 (review focus)',
    async (method) => {
      const res = await worker().fetch(
        new Request(`${ORIGIN}/mcp`, { method, headers: { Accept: 'text/event-stream' } }),
        {},
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    },
  );
});

describe('Worker other paths', () => {
  it('describes itself at /', async () => {
    const res = await worker().fetch(new Request(`${ORIGIN}/`), {});
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/plain/);
    const text = await res.text();
    expect(text).toContain(`${ORIGIN}/mcp`);
    expect(text).toContain('github.com/eerihyppanen/lut-lunch-mcp');
  });

  it('answers 404 elsewhere', async () => {
    expect((await worker().fetch(new Request(`${ORIGIN}/nope`), {})).status).toBe(404);
  });
});

describe('Worker rate limit', () => {
  const list = { jsonrpc: '2.0', id: 2, method: 'tools/list' };

  it('answers requests over the limit in a minute from one client with 429', async () => {
    const w = worker();
    const ip = { 'CF-Connecting-IP': '1.2.3.4' };
    for (let i = 0; i < RATE_LIMIT; i++) expect((await mcpPost(w, list, ip)).status).toBe(200);
    const res = await mcpPost(w, list, ip);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect((await mcpPost(w, list, { 'CF-Connecting-IP': '5.6.7.8' })).status).toBe(200);
    expect((await w.fetch(new Request(`${ORIGIN}/`), {})).status).toBe(200); // the page isn't limited
  });

  it('counts requests without a client IP under one key (review focus)', async () => {
    const w = worker();
    for (let i = 0; i < RATE_LIMIT; i++) await mcpPost(w, list);
    expect((await mcpPost(w, list)).status).toBe(429);
  });
});
