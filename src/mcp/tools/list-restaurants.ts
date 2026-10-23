import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RESTAURANTS } from '../../core/restaurants.js';
import { RESTAURANT_IDS } from '../../core/types.js';
import { READ_ONLY } from '../annotations.js';

const DESCRIPTION =
  'List the LUT Skinnarila campus lunch restaurants this server covers, with ids for the other tools, ' +
  'address, operator, menu link and how complete their diet and allergen data is. No menus; use ' +
  'get_menu or find_dishes for those.';

const RestaurantOut = z.object({
  id: z.enum(RESTAURANT_IDS),
  name: z.string(),
  campus: z.string(),
  operator: z.string(),
  address: z.string().nullable(),
  menu_url: z.string(),
  usual_lunch_hours: z.string().nullable(),
  menus_published_ahead: z.string(),
  allergen_coverage: z.enum(['full', 'partial', 'none']),
});

export function registerListRestaurants(server: McpServer): void {
  server.registerTool(
    'list_restaurants',
    {
      title: 'List restaurants',
      description: DESCRIPTION,
      outputSchema: { restaurants: z.array(RestaurantOut) },
      annotations: READ_ONLY,
    },
    () => {
      const restaurants = RESTAURANTS.map((r) => ({
        id: r.id,
        name: r.name,
        campus: r.campus,
        operator: r.operator,
        address: r.address,
        menu_url: r.menuUrl,
        usual_lunch_hours: r.usualLunchHours,
        menus_published_ahead: r.menusPublishedAhead,
        allergen_coverage: r.allergenCoverage,
      }));
      const text = restaurants
        .map(
          (r) =>
            `${r.name} (id: ${r.id}) — ${r.address ?? 'address unknown'}; ` +
            `lunch ${r.usual_lunch_hours ?? 'hours unknown'}; allergen data: ${r.allergen_coverage}; ${r.menu_url}`,
        )
        .join('\n');
      return { content: [{ type: 'text', text }], structuredContent: { restaurants } };
    },
  );
}
