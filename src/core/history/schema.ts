import { z } from 'zod';
import { ALLERGENS, DIET_TAGS, RESTAURANT_IDS } from '../types.js';

// Runtime validation of stored history, mirroring the core types. `schema` is a plain number
// here so readers can report an unsupported version before validating the rest.

const LocalizedName = z.object({ fi: z.string(), en: z.string().nullable() });

const Dish = z.object({
  name: LocalizedName,
  tags: z.array(z.enum(DIET_TAGS)),
  codes: z.array(z.string()),
  allergens: z.object({
    coverage: z.enum(['full', 'partial', 'none']),
    contains: z.array(z.enum(ALLERGENS)),
    mayContain: z.array(z.enum(ALLERGENS)),
    assessed: z.array(z.enum(ALLERGENS)),
  }),
});

const Course = z.object({
  name: LocalizedName,
  price: z.string().nullable(),
  dishes: z.array(Dish),
});

const DayStatus = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open'), courses: z.array(Course) }),
  z.object({
    kind: z.literal('no_menu'),
    reason: z.enum([
      'weekend',
      'public_holiday',
      'none_listed',
      'not_published_yet',
      'history_not_available',
    ]),
    holidayName: z.string().optional(),
  }),
  z.object({ kind: z.literal('error'), retryable: z.boolean() }),
]);

export const HistoryDaySchema = z.object({
  schema: z.number(),
  date: z.string(),
  collectedAt: z.string(),
  collectorVersion: z.string(),
  restaurants: z.array(z.object({ id: z.enum(RESTAURANT_IDS), status: DayStatus })),
});

export const HistoryDatasetSchema = z.object({
  schema: z.number(),
  generatedAt: z.string(),
  firstDate: z.string().nullable(),
  lastDate: z.string().nullable(),
  attribution: z.string(),
  sources: z.array(
    z.object({
      id: z.enum(RESTAURANT_IDS),
      name: z.string(),
      operator: z.string(),
      menuUrl: z.string(),
    }),
  ),
  days: z.array(HistoryDaySchema),
});
