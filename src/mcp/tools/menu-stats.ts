import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveDateInput } from '../../core/calendar/dates.js';
import type { History } from '../../core/history/types.js';
import { HistorySchemaError } from '../../core/history/remote.js';
import { SourceError } from '../../core/http.js';
import { RESTAURANT_IDS, type MenuService } from '../../core/types.js';
import { READ_ONLY } from '../annotations.js';
import { ToolFailure, ToolInputError, runTool } from '../errors.js';
import { formatStats } from '../format.js';
import { NOTICE } from '../present.js';
import {
  DateInput,
  DietInput,
  LanguageInput,
  MenuStatsOutputSchema,
  RestaurantIdsInput,
  type MenuStatsOutput,
} from '../schemas.js';
import { computeStats } from '../stats.js';

const DESCRIPTION =
  'Statistics from the recorded lunch history of LUT Skinnarila campus restaurants: how often ' +
  'dishes matching a word or diet were served, when they were first and last served, counts per ' +
  'restaurant, month or weekday, and the most common dishes. Use it for questions like "how often ' +
  'is salmon served?", "when did Yolo last have salmon soup?", "what\'s the most common soup?" or ' +
  '"has there been more vegan food lately?". Searches Finnish and English dish names (try the ' +
  'Finnish word, e.g. "lohi", if English finds nothing). History only covers days since collection ' +
  'started; the result says which period it covers.';

const UNAVAILABLE = 'Menu history is temporarily unavailable; try again later.';

export const MenuStatsInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe('Word or part of a dish name, in English or Finnish (e.g. "salmon" or "lohi").'),
  diet: DietInput,
  restaurants: RestaurantIdsInput,
  from: DateInput.optional().describe('First day to include. Default: first recorded day.'),
  to: DateInput.optional().describe('Last day to include. Default: today.'),
  group_by: z
    .enum(['restaurant', 'month', 'weekday', 'none'])
    .default('restaurant')
    .describe('How to split the counts. Default: restaurant.'),
  top: z
    .number()
    .int()
    .min(0)
    .max(20)
    .default(10)
    .describe('How many of the most common matching dishes to list (0–20). Default: 10.'),
  language: LanguageInput,
});
export type MenuStatsInput = z.infer<typeof MenuStatsInputSchema>;

async function loadHistory(service: MenuService): Promise<History> {
  try {
    return await service.loadHistory();
  } catch (error) {
    // Only an unsupported schema has a fix worth naming; any other download or data problem
    // (HTTP errors, malformed data) reads as temporary (spec §8).
    if (error instanceof HistorySchemaError) throw new ToolFailure(error.message);
    if (error instanceof SourceError) throw new ToolFailure(UNAVAILABLE);
    throw error;
  }
}

export async function menuStats(
  input: MenuStatsInput,
  service: MenuService,
): Promise<MenuStatsOutput> {
  const today = service.today();
  // Resolve given dates before loading anything, so a bad date fails fast.
  const givenFrom = input.from === undefined ? undefined : resolveDateInput(input.from, today);
  const to = input.to === undefined ? today : resolveDateInput(input.to, today);
  if (givenFrom !== undefined && to < givenFrom) {
    throw new ToolInputError(`"to" (${to}) is before "from" (${givenFrom}).`);
  }
  const history = await loadHistory(service);
  // A defaulted `from` never lands after `to`, e.g. when `to` is before history starts.
  const firstDay = history.firstDate ?? today;
  const from = givenFrom ?? (firstDay < to ? firstDay : to);

  const restaurants = input.restaurants?.length ? input.restaurants : [...RESTAURANT_IDS];
  const query = input.query?.trim() || null;
  const diet = input.diet ?? [];
  const stats = computeStats(history, {
    query: query ?? undefined,
    diet,
    restaurants,
    from,
    to,
    groupBy: input.group_by,
    top: input.top,
    language: input.language,
  });
  return {
    timezone: 'Europe/Helsinki',
    today,
    history: stats.history,
    searched: { from, to, restaurants, query, diet },
    matches: stats.matches,
    groups: stats.groups,
    top_dishes: stats.top_dishes,
    notice: diet.length ? NOTICE : null,
  };
}

export function registerMenuStats(server: McpServer, service: MenuService): void {
  server.registerTool(
    'menu_stats',
    {
      title: 'Menu history statistics',
      description: DESCRIPTION,
      inputSchema: MenuStatsInputSchema.shape,
      outputSchema: MenuStatsOutputSchema.shape,
      annotations: READ_ONLY,
    },
    (input) =>
      runTool(async () => {
        const out = await menuStats(input, service);
        return { content: [{ type: 'text', text: formatStats(out) }], structuredContent: out };
      }, 'Internal error while computing menu statistics.'),
  );
}
