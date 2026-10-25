import { z } from 'zod';
import { WEEKDAYS } from '../core/calendar/dates.js';
import { ALLERGENS, DIET_TAGS, RESTAURANT_IDS } from '../core/types.js';

// Input and output schemas shared by get_menu and find_dishes. Output field names are
// snake_case (spec §8); core types stay camelCase.

export const LANGUAGES = ['en', 'fi'] as const;
export type Language = (typeof LANGUAGES)[number];

// Validated by resolveDateInput so the error can tell the caller which forms are accepted.
export const DateInput = z
  .string()
  .describe('"today", "tomorrow" or a date as YYYY-MM-DD (Finland time).');

export const RestaurantIdsInput = z
  .array(
    z.enum(RESTAURANT_IDS, {
      error: `Unknown restaurant id. Valid ids: ${RESTAURANT_IDS.join(', ')}`,
    }),
  )
  .optional()
  .describe('Restaurant ids to include. Default: all.');

export const DietInput = z
  .array(z.enum(DIET_TAGS))
  .optional()
  .describe('Only dishes labelled with every one of these diets.');

export const AllergenInput = z
  .array(z.enum(ALLERGENS))
  .optional()
  .describe(
    'Leave out dishes that contain or may contain these allergens. Dishes whose allergens ' +
      'are not published are left out too and counted as "unverifiable".',
  );

export const LanguageInput = z
  .enum(LANGUAGES)
  .default('en')
  .describe('Language for dish and course names. Default: en.');

export const DishOutSchema = z.object({
  name: z.string(),
  untranslated: z.boolean(),
  tags: z.array(z.enum(DIET_TAGS)),
  codes: z.array(z.string()),
  allergens: z.object({
    coverage: z.enum(['full', 'partial', 'none']),
    contains: z.array(z.enum(ALLERGENS)),
    may_contain: z.array(z.enum(ALLERGENS)),
  }),
});
export type DishOut = z.infer<typeof DishOutSchema>;

const NoMenuReasonOut = z.enum([
  'weekend',
  'public_holiday',
  'none_listed',
  'not_published_yet',
  'history_not_available',
  'source_unavailable', // temporary: timeout, network error, server error
  'source_error', // permanent: the source answered with data that could not be read
  'history_unavailable', // the recorded history could not be loaded; try again later
]);

export const RestaurantDayOutSchema = z.object({
  id: z.enum(RESTAURANT_IDS),
  name: z.string(),
  status: z.enum(['open', 'no_menu', 'error']),
  reason: NoMenuReasonOut.nullable(),
  holiday_name: z.string().nullable(),
  stale: z.boolean(),
  source_url: z.string(),
  courses: z.array(
    z.object({ name: z.string(), price: z.string().nullable(), dishes: z.array(DishOutSchema) }),
  ),
  hidden_by_filters: z.number().int(),
  unverifiable: z.number().int(),
});
export type RestaurantDayOut = z.infer<typeof RestaurantDayOutSchema>;

export const GetMenuOutputSchema = z.object({
  timezone: z.literal('Europe/Helsinki'),
  today: z.string(),
  days: z.array(
    z.object({
      date: z.string(),
      weekday: z.enum(WEEKDAYS),
      restaurants: z.array(RestaurantDayOutSchema),
    }),
  ),
  notice: z.string().nullable(),
});
export type GetMenuOutput = z.infer<typeof GetMenuOutputSchema>;

export const FindDishesOutputSchema = z.object({
  timezone: z.literal('Europe/Helsinki'),
  today: z.string(),
  searched: z.object({
    from: z.string(),
    to: z.string(),
    restaurants: z.array(z.enum(RESTAURANT_IDS)),
  }),
  matches: z.array(
    z.object({
      date: z.string(),
      weekday: z.enum(WEEKDAYS),
      restaurant_id: z.enum(RESTAURANT_IDS),
      restaurant: z.string(),
      course: z.string(),
      dish: DishOutSchema,
    }),
  ),
  total_matches: z.number().int(),
  truncated: z.boolean(),
  days_without_data: z.array(
    z.object({
      date: z.string(),
      restaurant_id: z.enum(RESTAURANT_IDS),
      status: z.enum(['no_menu', 'error']),
      reason: NoMenuReasonOut,
      holiday_name: z.string().nullable(),
    }),
  ),
  unverifiable: z.number().int(),
  notice: z.string().nullable(),
});
export type FindDishesOutput = z.infer<typeof FindDishesOutputSchema>;

const SeenSchema = z.object({
  date: z.string(),
  restaurant_id: z.enum(RESTAURANT_IDS),
  dish: z.string(),
});

/** menu_stats output (spec §7). */
export const MenuStatsOutputSchema = z.object({
  timezone: z.literal('Europe/Helsinki'),
  today: z.string(),
  history: z.object({
    first_date: z.string().nullable(),
    last_date: z.string().nullable(),
    days_recorded: z.number().int(),
    days_missing: z.number().int(),
    restaurant_days_unavailable: z.number().int(),
  }),
  searched: z.object({
    from: z.string(),
    to: z.string(),
    restaurants: z.array(z.enum(RESTAURANT_IDS)),
    query: z.string().nullable(),
    diet: z.array(z.enum(DIET_TAGS)),
  }),
  matches: z.object({
    days_served: z.number().int(),
    dishes_matched: z.number().int(),
    first_seen: SeenSchema.nullable(),
    last_seen: SeenSchema.nullable(),
  }),
  groups: z.array(
    z.object({ key: z.string(), open_days: z.number().int(), days_served: z.number().int() }),
  ),
  top_dishes: z.array(
    z.object({
      name: z.string(),
      times: z.number().int(),
      restaurants: z.array(z.enum(RESTAURANT_IDS)),
      last_seen: z.string(),
    }),
  ),
  notice: z.string().nullable(),
});
export type MenuStatsOutput = z.infer<typeof MenuStatsOutputSchema>;
