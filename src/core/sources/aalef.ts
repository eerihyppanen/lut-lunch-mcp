import { load } from 'cheerio/slim';
import { daysBetween, isValidIsoDate } from '../calendar/dates.js';
import { SourceError, type HttpClient } from '../http.js';
import { aalefAllergens } from '../normalize/allergens.js';
import { parseCodes } from '../normalize/codes.js';
import { dietTags } from '../normalize/diets.js';
import type { Course, Dish, LocalizedName } from '../types.js';
import type { MenuSource, SourceResult } from './source.js';

// Yolo (Aalef). No API: the menu is scraped from the front page, which lists the next few
// serving days as "<h3>Perjantai 23.10</h3>" followed by product rows.
const PAGE_URL = 'https://www.aalef.fi/';
const DAY_HEADING = /(?:^|\s)(\d{1,2})\.(\d{1,2})(?:\.|\s|$)/;
const LIGHT_SOUP = /inc\. light soup/i;

/** The page shows "23.10" without a year: pick the year that puts the date closest to today. */
export function inferYear(day: number, month: number, today: string): string {
  const year = Number(today.slice(0, 4));
  const pad = (n: number) => String(n).padStart(2, '0');
  const candidates = [year - 1, year, year + 1]
    .map((y) => `${y}-${pad(month)}-${pad(day)}`)
    .filter(isValidIsoDate);
  return candidates.reduce((best, d) =>
    Math.abs(daysBetween(today, d)) < Math.abs(daysBetween(today, best)) ? d : best,
  );
}

function splitTitle(title: string): LocalizedName {
  const slash = title.indexOf('/');
  if (slash < 0) return { fi: title.trim() || 'Menu', en: null };
  return { fi: title.slice(0, slash).trim(), en: title.slice(slash + 1).trim() || null };
}

function parseDish(lines: string[], codes: string[], course: LocalizedName): Dish {
  const [fi = '', en, ...extras] = lines;
  const extra = extras.join(', ');
  const fiExtra = LIGHT_SOUP.test(extra) ? 'sis. kevytkeitto' : extra;
  return {
    name: {
      fi: extra ? `${fi} (${fiExtra})` : fi,
      en: en ? (extra ? `${en} (${extra})` : en) : null,
    },
    tags: dietTags('aalef', codes, course),
    codes,
    allergens: aalefAllergens(codes),
  };
}

export function parseAalefPage(html: string, today: string): SourceResult {
  const $ = load(html);
  const days: Record<string, Course[]> = {};

  $('h3').each((_, heading) => {
    const match = DAY_HEADING.exec($(heading).text().trim());
    const headingRow = $(heading).closest('.pricing__row');
    if (!match || headingRow.length === 0) return;
    const [day, month] = [Number(match[1]), Number(match[2])];
    if (day < 1 || day > 31 || month < 1 || month > 12) return;

    const courses: Course[] = [];
    headingRow
      .nextUntil('.pricing__row--type-subtitle', '.pricing__row--type-product')
      .each((__, row) => {
        const description = $(row).find('.pricing__row__description');
        description.find('br').replaceWith('\n');
        const lines = description
          .text()
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length === 0) return;

        const name = splitTitle($(row).find('.pricing__row__title').text());
        const codes = parseCodes($(row).find('.pricing__row__notices').text());
        // Consecutive rows with the same title belong to one course.
        let course = courses.at(-1);
        if (!course || course.name.fi !== name.fi || course.name.en !== name.en) {
          course = { name, price: null, dishes: [] };
          courses.push(course);
        }
        course.dishes.push(parseDish(lines, codes, name));
      });

    days[inferYear(day, month, today)] = courses;
  });

  const dates = Object.keys(days).sort();
  if (dates.length === 0) throw new SourceError('Aalef: no menu days found', false);
  return { days, coverage: { from: dates[0]!, through: dates[dates.length - 1]! } };
}

export function createAalefSource(http: HttpClient): MenuSource {
  return {
    restaurantId: 'yolo',
    freshMs: 30 * 60_000,
    unitKey: () => 'aalef:page',
    async fetchUnit(_date, today) {
      return parseAalefPage(await http.getText(PAGE_URL), today);
    },
  };
}
