import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { addDays, datesInRange, resolveDateInput, weekdayName } from '../../core/calendar/dates.js';
import { RESTAURANT_IDS, type MenuService } from '../../core/types.js';
import { READ_ONLY } from '../annotations.js';
import { runTool } from '../errors.js';
import { hasFilters, type DishFilter } from '../filters.js';
import { formatDays } from '../format.js';
import { NOTICE, presentRestaurantDay } from '../present.js';
import {
  AllergenInput,
  DateInput,
  DietInput,
  GetMenuOutputSchema,
  LanguageInput,
  RestaurantIdsInput,
  type GetMenuOutput,
} from '../schemas.js';

const DESCRIPTION =
  "Get lunch menus for LUT University's Skinnarila campus restaurants (Lappeenranta, Finland) for " +
  'one day or several consecutive days, including past days from the recorded history. Use it to ' +
  'show what is or was served, e.g. "what\'s for lunch today?" or "what was on last Tuesday?". To ' +
  'look for a particular dish, ingredient, diet or allergen across days and restaurants, use ' +
  'find_dishes; for "how often" and "when last", use menu_stats. Pass "today" or "tomorrow" ' +
  'rather than computing dates yourself; dates are in Finland time. Restaurants without a menu ' +
  'are still listed with a reason (weekend, public holiday, not published yet, no history for ' +
  'that day, source unavailable).';

export const GetMenuInputSchema = z.object({
  date: DateInput.default('today'),
  days: z
    .number()
    .int()
    .min(1)
    .max(7)
    .default(1)
    .describe('Number of consecutive days starting from `date` (1–7). Default: 1.'),
  restaurants: RestaurantIdsInput,
  diet: DietInput,
  exclude_allergens: AllergenInput,
  language: LanguageInput,
});
export type GetMenuInput = z.infer<typeof GetMenuInputSchema>;

export async function getMenu(input: GetMenuInput, service: MenuService): Promise<GetMenuOutput> {
  const today = service.today();
  const from = resolveDateInput(input.date, today);
  const dates = datesInRange(from, addDays(from, input.days - 1));
  const restaurants = input.restaurants?.length ? input.restaurants : [...RESTAURANT_IDS];
  const filter: DishFilter = { diet: input.diet, excludeAllergens: input.exclude_allergens };

  const rows = await service.getDays(dates, restaurants);
  return {
    timezone: 'Europe/Helsinki',
    today,
    days: dates.map((date) => ({
      date,
      weekday: weekdayName(date),
      restaurants: rows
        .filter((row) => row.date === date)
        .map((row) => presentRestaurantDay(row, input.language, filter)),
    })),
    notice: hasFilters(filter) ? NOTICE : null,
  };
}

export function registerGetMenu(server: McpServer, service: MenuService): void {
  server.registerTool(
    'get_menu',
    {
      title: 'Get lunch menus',
      description: DESCRIPTION,
      inputSchema: GetMenuInputSchema.shape,
      outputSchema: GetMenuOutputSchema.shape,
      annotations: READ_ONLY,
    },
    (input) =>
      runTool(async () => {
        const out = await getMenu(input, service);
        return { content: [{ type: 'text', text: formatDays(out) }], structuredContent: out };
      }, 'Internal error while fetching menus.'),
  );
}
