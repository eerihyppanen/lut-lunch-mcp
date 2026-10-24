import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/version.js';
import { connectClient } from '../helpers/connect.js';
import { fakeService } from '../helpers/fakes.js';

describe('list_restaurants', () => {
  it('lists the three restaurants with ids in registry order', async () => {
    const client = await connectClient(fakeService());
    const res = await client.callTool({ name: 'list_restaurants', arguments: {} });
    const out = res.structuredContent as { restaurants: { id: string; campus: string }[] };
    expect(out.restaurants.map((r) => r.id)).toEqual(['lut-buffet', 'bistro-skinnarila', 'yolo']);
    expect(out.restaurants.every((r) => r.campus === 'Skinnarila (Lappeenranta)')).toBe(true);
  });

  it('describes allergen coverage honestly', async () => {
    // LUT Buffet lists allergens for most dishes but not all, so it is "partial" too.
    const client = await connectClient(fakeService());
    const res = await client.callTool({ name: 'list_restaurants', arguments: {} });
    const out = res.structuredContent as { restaurants: { allergen_coverage: string }[] };
    expect(out.restaurants.map((r) => r.allergen_coverage)).toEqual(['partial', 'none', 'partial']);
  });

  it('marks every tool read-only', async () => {
    const { tools } = await (await connectClient(fakeService())).listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.annotations).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
  });

  it('keeps VERSION in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
