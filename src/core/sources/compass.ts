import { z } from 'zod';
import { addDays, isoWeekMonday } from '../calendar/dates.js';
import { SourceError, type HttpClient } from '../http.js';
import { compassAllergens } from '../normalize/allergens.js';
import { dietTags } from '../normalize/diets.js';
import type { Course, Dish, LocalizedName } from '../types.js';
import type { MenuSource, SourceResult } from './source.js';

// Bistro Skinnarila (Compass Group / Food & Co). The JSON endpoint the restaurant's own page uses.
const WEEK_URL = 'https://www.compass-group.fi/menuapi/week-menus?costCenter=3363';

const Meal = z.object({
  name: z.string(),
  recipeId: z.number().nullish(),
  diets: z.array(z.string()).nullish(),
});
type Meal = z.infer<typeof Meal>;

const Package = z.object({
  name: z.string().nullish(),
  price: z.string().nullish(),
  meals: z.array(Meal),
});
type Package = z.infer<typeof Package>;

const Week = z.object({
  menus: z.array(z.object({ date: z.string(), menuPackages: z.array(Package) })),
});
type Week = z.infer<typeof Week>;

function clean(s: string | null | undefined): string {
  return (s ?? '').trim();
}

/** English meal for `fiMeals[index]`: same recipeId when that id is usable, else same position. */
function pairMeal(fiMeals: Meal[], enMeals: Meal[], index: number): Meal | undefined {
  const id = fiMeals[index]?.recipeId;
  const unique = (meals: Meal[]) => meals.filter((m) => m.recipeId === id).length === 1;
  if (id && unique(fiMeals) && unique(enMeals)) return enMeals.find((m) => m.recipeId === id);
  return enMeals[index];
}

function parseCourse(fiPkg: Package, enPkg: Package | undefined): Course {
  const fiName = clean(fiPkg.name);
  const name: LocalizedName = fiName
    ? { fi: fiName, en: clean(enPkg?.name) || null }
    : { fi: 'Menu', en: 'Menu' };
  const enMeals = enPkg?.meals ?? [];
  const dishes = fiPkg.meals.map((meal, i): Dish => {
    const enMeal = pairMeal(fiPkg.meals, enMeals, i);
    const codes = [...new Set((meal.diets ?? []).map((d) => d.trim()).filter(Boolean))];
    return {
      name: { fi: clean(meal.name), en: clean(enMeal?.name) || null },
      tags: dietTags('compass', codes, name),
      codes,
      allergens: compassAllergens(),
    };
  });
  return { name, price: clean(enPkg?.price) || clean(fiPkg.price) || null, dishes };
}

/** Parses one week of week-menus responses. `en` is null when the English request failed. */
export function parseCompassWeek(
  fi: unknown,
  en: unknown,
  monday: string,
  today: string,
): SourceResult {
  const fiWeek = Week.safeParse(fi);
  if (!fiWeek.success) throw new SourceError('Compass: unexpected response shape', false);
  const enWeek: Week | undefined = Week.safeParse(en).data;
  const enByDate = new Map(enWeek?.menus.map((m) => [m.date.slice(0, 10), m.menuPackages]));

  const days: Record<string, Course[]> = {};
  for (const menu of fiWeek.data.menus) {
    const date = menu.date.slice(0, 10);
    const enPackages = enByDate.get(date) ?? [];
    days[date] = menu.menuPackages.map((pkg, i) => parseCourse(pkg, enPackages[i]));
  }

  // An empty future week may simply not be published yet; an empty current or past week is closed.
  const published = fiWeek.data.menus.length > 0 || monday <= isoWeekMonday(today);
  return { days, coverage: published ? { from: monday, through: addDays(monday, 6) } : null };
}

export function createCompassSource(http: HttpClient): MenuSource {
  return {
    restaurantId: 'bistro-skinnarila',
    freshMs: 30 * 60_000,
    unitKey: (date) => `compass:${isoWeekMonday(date)}`,
    async fetchUnit(date, today) {
      const monday = isoWeekMonday(date);
      const url = (language: string) => `${WEEK_URL}&date=${monday}&language=${language}`;
      const [fi, en] = await Promise.all([
        http.getJson(url('fi')),
        // English is optional; Finnish names suffice.
        http.getJson(url('en')).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          console.error(`lut-lunch-mcp: Compass English menu failed, using Finnish: ${reason}`);
          return null;
        }),
      ]);
      return parseCompassWeek(fi, en, monday, today);
    },
  };
}
