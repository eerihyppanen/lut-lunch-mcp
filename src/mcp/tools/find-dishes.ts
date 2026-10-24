import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  addDays,
  datesInRange,
  daysBetween,
  resolveDateInput,
  weekdayName,
} from '../../core/calendar/dates.js';
import { getRestaurant } from '../../core/restaurants.js';
import { RESTAURANT_IDS, type MenuService } from '../../core/types.js';
import { READ_ONLY } from '../annotations.js';
import { ToolInputError, runTool } from '../errors.js';
import { hasFilters, judgeDish, type DishFilter } from '../filters.js';
import { formatMatches } from '../format.js';
import { NOTICE, explainNoMenu, localName, presentDish } from '../present.js';
import {
  AllergenInput,
  DateInput,
  DietInput,
  FindDishesOutputSchema,
  LanguageInput,
  RestaurantIdsInput,
  type FindDishesOutput,
} from '../schemas.js';

const DESCRIPTION =
  'Search LUT Skinnarila campus lunch menus for dishes matching a word, diet or allergen ' +
  'restriction, across several days and restaurants. Use it for questions like "any vegan options ' +
  'this week?", "where is something gluten-free tomorrow?" or "is there salmon this week?". ' +
  'Returns a flat list of matching dishes with date and restaurant. Searches Finnish and English ' +
  'dish names; if an English word finds nothing, try the Finnish one (e.g. "lohi" for salmon). ' +
  'Past dates are searched in the recorded history, up to 14 days per search; for "how often" ' +
  'or "when last" over longer periods use menu_stats.';

const MAX_SPAN_DAYS = 14;

export const FindDishesInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe('Word or part of a dish name, in English or Finnish (e.g. "salmon" or "lohi").'),
  diet: DietInput,
  exclude_allergens: AllergenInput,
  from: DateInput.default('today').describe('First day to search. Default: today.'),
  to: DateInput.optional().describe(
    'Last day to search (at most 14 days). Default: from + 6 days.',
  ),
  restaurants: RestaurantIdsInput,
  language: LanguageInput,
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .describe('Maximum matches to return (1–100). Default: 30.'),
});
export type FindDishesInput = z.infer<typeof FindDishesInputSchema>;

export async function findDishes(
  input: FindDishesInput,
  service: MenuService,
): Promise<FindDishesOutput> {
  const filter: DishFilter = {
    query: input.query?.trim() || undefined,
    diet: input.diet,
    excludeAllergens: input.exclude_allergens,
  };
  if (!filter.query && !hasFilters(filter)) {
    throw new ToolInputError(
      'Give at least one of query, diet or exclude_allergens. To list full menus use get_menu.',
    );
  }

  const today = service.today();
  const from = resolveDateInput(input.from, today);
  const to = input.to ? resolveDateInput(input.to, today) : addDays(from, 6);
  if (to < from) throw new ToolInputError(`"to" (${to}) is before "from" (${from}).`);
  if (daysBetween(from, to) >= MAX_SPAN_DAYS) {
    throw new ToolInputError(`The search range can cover at most ${MAX_SPAN_DAYS} days.`);
  }
  const restaurants = input.restaurants?.length ? input.restaurants : [...RESTAURANT_IDS];

  const rows = await service.getDays(datesInRange(from, to), restaurants);
  const matches: FindDishesOutput['matches'] = [];
  const daysWithoutData: FindDishesOutput['days_without_data'] = [];
  let unverifiable = 0;

  for (const row of rows) {
    if (row.status.kind !== 'open') {
      daysWithoutData.push({
        date: row.date,
        restaurant_id: row.restaurantId,
        status: row.status.kind,
        ...explainNoMenu(row.status),
      });
      continue;
    }
    for (const course of row.status.courses) {
      for (const dish of course.dishes) {
        const verdict = judgeDish(dish, filter);
        if (verdict === 'unverifiable') unverifiable++;
        if (verdict !== 'keep') continue;
        matches.push({
          date: row.date,
          weekday: weekdayName(row.date),
          restaurant_id: row.restaurantId,
          restaurant: getRestaurant(row.restaurantId).name,
          course: localName(course.name, input.language),
          dish: presentDish(dish, input.language),
        });
      }
    }
  }

  return {
    timezone: 'Europe/Helsinki',
    today,
    searched: { from, to, restaurants },
    matches: matches.slice(0, input.limit),
    total_matches: matches.length,
    truncated: matches.length > input.limit,
    days_without_data: daysWithoutData,
    unverifiable,
    notice: hasFilters(filter) ? NOTICE : null,
  };
}

export function registerFindDishes(server: McpServer, service: MenuService): void {
  server.registerTool(
    'find_dishes',
    {
      title: 'Find dishes',
      description: DESCRIPTION,
      inputSchema: FindDishesInputSchema.shape,
      outputSchema: FindDishesOutputSchema.shape,
      annotations: READ_ONLY,
    },
    (input) =>
      runTool(async () => {
        const out = await findDishes(input, service);
        return { content: [{ type: 'text', text: formatMatches(out) }], structuredContent: out };
      }, 'Internal error while searching menus.'),
  );
}
