import { z } from 'zod';
import type { CachedLoader } from '../cache.js';
import { addDays, isoWeekMonday } from '../calendar/dates.js';
import { SourceError, type HttpClient } from '../http.js';
import { powerestaAllergens } from '../normalize/allergens.js';
import { splitTrailingCodes } from '../normalize/codes.js';
import { dietTags } from '../normalize/diets.js';
import type { Course, Dish, LocalizedName } from '../types.js';
import type { MenuSource, SourceResult } from './source.js';

// LUT Buffet (Kampusravintolat) via Poweresta's public menu API.
const API = 'https://api.fi.poweresta.com/publicmenu';
const MENUS_URL = `${API}/menus/kampusravintolat/lut/`;
const SLUG_TTL_MS = 6 * 3600_000;
const UNPUBLISHED: SourceResult = { days: {}, coverage: null };

// Course names end in a price list: "Lounas 3,10 / 5,90 / 9,00 / 12,00".
const PRICE_SUFFIX = /\s*\d+,\d{2}(\s*\/\s*\d+,\d{2})+\s*$/;

const Names = z.array(z.object({ language: z.string().nullish(), name: z.string().nullish() }));

const Row = z.object({
  names: Names,
  allergens: z
    .array(z.object({ language: z.string().nullish(), allergens: z.array(z.string()).nullish() }))
    .nullish(),
});

const Dates = z.array(
  z.object({
    date: z.string(),
    data: z
      .object({ mealOptions: z.array(z.object({ names: Names, rows: z.array(Row) })).nullish() })
      .nullish(),
  }),
);

const Slugs = z.array(z.object({ publishUrl: z.string().nullish() }));

function nameIn(names: z.infer<typeof Names>, language: string): string {
  return (names.find((n) => n.language === language)?.name ?? '').trim();
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function splitPrice(raw: string): { name: string; price: string | null } {
  const match = PRICE_SUFFIX.exec(raw);
  if (!match) return { name: collapse(raw), price: null };
  return { name: collapse(raw.slice(0, match.index)), price: collapse(match[0]) };
}

function parseDish(row: z.infer<typeof Row>, courseName: LocalizedName): Dish | null {
  const fi = splitTrailingCodes(nameIn(row.names, 'fi'));
  if (!fi.name) return null;
  const en = splitTrailingCodes(nameIn(row.names, 'en')).name;
  const englishAllergens = row.allergens?.find((a) => a.language === 'en')?.allergens;
  return {
    name: { fi: fi.name, en: en && en !== fi.name ? en : null },
    tags: dietTags('poweresta', fi.codes, courseName),
    codes: fi.codes,
    allergens: powerestaAllergens(englishAllergens ?? undefined),
  };
}

/** Parses one `dates` response (a list of days for one menu slug). */
export function parsePowerestaDates(json: unknown): SourceResult {
  const parsed = Dates.safeParse(json);
  if (!parsed.success) throw new SourceError('Poweresta: unexpected response shape', false);

  const days: Record<string, Course[]> = {};
  for (const entry of parsed.data) {
    days[entry.date] = (entry.data?.mealOptions ?? []).map((option) => {
      const fi = splitPrice(nameIn(option.names, 'fi') || 'Menu');
      const en = splitPrice(nameIn(option.names, 'en'));
      const name: LocalizedName = { fi: fi.name, en: en.name || null };
      const dishes = option.rows
        .map((row) => parseDish(row, name))
        .filter((d): d is Dish => d !== null);
      return { name, price: fi.price ?? en.price, dishes };
    });
  }

  const dates = Object.keys(days).sort();
  const coverage = dates.length ? { from: dates[0]!, through: dates[dates.length - 1]! } : null;
  return { days, coverage };
}

/** Published menu slugs (e.g. "syksy"); the slug changes with the season. */
export function pickSlugs(json: unknown): string[] {
  const parsed = Slugs.safeParse(json);
  if (!parsed.success) return [];
  return parsed.data.map((m) => m.publishUrl ?? '').filter(Boolean);
}

/** Around a season change several menus can be published: per date, the first with dishes wins. */
function mergeBySlugOrder(results: SourceResult[]): SourceResult {
  const days: Record<string, Course[]> = {};
  for (const result of results) {
    for (const [date, courses] of Object.entries(result.days)) {
      if (!days[date]?.length) days[date] = courses;
    }
  }
  const ranges = results.flatMap((r) => (r.coverage ? [r.coverage] : []));
  if (!ranges.length) return { days, coverage: null };
  return {
    days,
    coverage: {
      from: ranges.map((r) => r.from).sort()[0]!,
      through: ranges
        .map((r) => r.through)
        .sort()
        .at(-1)!,
    },
  };
}

export function createPowerestaSource(http: HttpClient, loader: CachedLoader): MenuSource {
  return {
    restaurantId: 'lut-buffet',
    freshMs: 30 * 60_000,
    unitKey: (date) => `poweresta:${isoWeekMonday(date)}`,
    async fetchUnit(date) {
      const { value: slugs } = await loader.load('poweresta:slugs', SLUG_TTL_MS, async () =>
        pickSlugs(await http.getJson(MENUS_URL)),
      );
      if (!slugs.length) throw new SourceError('Poweresta: no published menu', true);

      const monday = isoWeekMonday(date);
      const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).join(',');
      const results = await Promise.all(
        slugs.map(async (slug) => {
          const url = `${API}/dates/kampusravintolat/lut/?menu=${encodeURIComponent(slug)}&dates=${week}`;
          try {
            return parsePowerestaDates(await http.getJson(url));
          } catch (error) {
            // Poweresta answers 400 when none of the requested dates is published yet.
            if (error instanceof SourceError && error.status === 400) return UNPUBLISHED;
            throw error;
          }
        }),
      );
      return mergeBySlugOrder(results);
    },
  };
}
