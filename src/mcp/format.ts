import { addDays } from '../core/calendar/dates.js';
import { getRestaurant } from '../core/restaurants.js';
import { RESTAURANT_IDS, type DietTag, type RestaurantId } from '../core/types.js';
import type {
  DishOut,
  FindDishesOutput,
  GetMenuOutput,
  MenuStatsOutput,
  RestaurantDayOut,
} from './schemas.js';

// Compact text versions of tool results, for clients that only show the text content.

const TAG_LABELS: Record<DietTag, string> = {
  vegan: 'vegan',
  vegetarian: 'veg',
  gluten_free: 'GF',
  milk_free: 'MF',
  lactose_free: 'LF',
  low_lactose: 'LL',
};

// Tags implied by a stronger one are left out of the text: a vegan dish shows "vegan, GF".
const IMPLIED_BY: Partial<Record<DietTag, DietTag[]>> = {
  vegetarian: ['vegan'],
  milk_free: ['vegan'],
  lactose_free: ['vegan', 'milk_free'],
  low_lactose: ['vegan', 'milk_free', 'lactose_free'],
};

type Reason = NonNullable<RestaurantDayOut['reason']>;

const REASON_TEXT: Record<Reason, string> = {
  weekend: 'weekend',
  public_holiday: 'public holiday',
  none_listed: 'nothing listed for this day',
  not_published_yet: 'not published yet',
  history_not_available: 'past menus are not available',
  source_unavailable: 'menu source unavailable, try again later',
  source_error: 'the menu source could not be read (its site may have changed)',
  history_unavailable: 'menu history unavailable, try again later',
};

function tagText(tags: DietTag[]): string {
  const shown = tags.filter((t) => !IMPLIED_BY[t]?.some((strong) => tags.includes(strong)));
  return shown.length ? ` [${shown.map((t) => TAG_LABELS[t]).join(', ')}]` : '';
}

function dishText(dish: DishOut): string {
  const parts = [`${dish.name}${tagText(dish.tags)}${dish.untranslated ? ' (Finnish name)' : ''}`];
  if (dish.allergens.contains.length) parts.push(`contains ${dish.allergens.contains.join(', ')}`);
  if (dish.allergens.may_contain.length) {
    parts.push(`may contain ${dish.allergens.may_contain.join(', ')}`);
  }
  return parts.join('; ');
}

function reasonText(reason: Reason, holidayName: string | null): string {
  return reason === 'public_holiday' && holidayName
    ? `public holiday (${holidayName})`
    : REASON_TEXT[reason];
}

function dayLabel(date: string, today: string): string {
  if (date === today) return ' (today)';
  if (date === addDays(today, 1)) return ' (tomorrow)';
  return '';
}

function restaurantText(r: RestaurantDayOut): string[] {
  if (r.status !== 'open') {
    const label = r.status === 'error' ? 'unavailable' : 'no menu';
    return [`${r.name} — ${label}: ${reasonText(r.reason!, r.holiday_name)}`];
  }
  const lines = [
    `${r.name} — open${r.stale ? ' (cached copy; source currently unreachable)' : ''}`,
  ];
  for (const course of r.courses) {
    const price = course.price ? ` (${course.price})` : '';
    lines.push(`  ${course.name}${price}: ${course.dishes.map(dishText).join(' · ')}`);
  }
  if (r.courses.length === 0 && r.hidden_by_filters + r.unverifiable === 0) {
    lines.push('  (no dishes listed)');
  }
  const left: string[] = [];
  if (r.hidden_by_filters) left.push(`${r.hidden_by_filters} filtered out`);
  if (r.unverifiable) left.push(`${r.unverifiable} without allergen data`);
  if (left.length) lines.push(`  (dishes left out: ${left.join(', ')})`);
  return lines;
}

export function formatDays(out: GetMenuOutput): string {
  const lines: string[] = [];
  for (const day of out.days) {
    if (lines.length) lines.push('');
    lines.push(`${day.weekday} ${day.date}${dayLabel(day.date, out.today)}`);
    for (const r of day.restaurants) lines.push(...restaurantText(r));
  }
  if (out.notice) lines.push('', out.notice);
  return lines.join('\n');
}

export function formatMatches(out: FindDishesOutput): string {
  const { from, to, restaurants } = out.searched;
  const names = restaurants.map((id) => getRestaurant(id).name).join(', ');
  const count = `${out.total_matches} match${out.total_matches === 1 ? '' : 'es'}`;
  const lines = [`Searched ${from} to ${to} at ${names}: ${count}.`];
  for (const m of out.matches) {
    lines.push(`${m.weekday} ${m.date} · ${m.restaurant} · ${m.course}: ${dishText(m.dish)}`);
  }
  if (out.truncated) lines.push(`(showing ${out.matches.length} of ${out.total_matches})`);
  if (out.unverifiable) {
    lines.push(`${out.unverifiable} dishes left out because their allergen data is not published.`);
  }
  if (out.days_without_data.length) {
    lines.push('No menu data for:');
    for (const d of out.days_without_data) {
      lines.push(
        `  ${getRestaurant(d.restaurant_id).name} on ${d.date}: ${reasonText(d.reason, d.holiday_name)}`,
      );
    }
  }
  if (out.notice) lines.push('', out.notice);
  return lines.join('\n');
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

function restaurantNames(ids: RestaurantId[]): string {
  return ids.length === RESTAURANT_IDS.length
    ? 'all restaurants'
    : ids.map((id) => getRestaurant(id).name).join(', ');
}

export function formatStats(out: MenuStatsOutput): string {
  const { history, searched, matches } = out;
  if (!history.first_date || !history.last_date) {
    return 'No history recorded yet; collection has not stored any days.';
  }
  const what = searched.query ? `"${searched.query}"` : 'all dishes';
  const diet = searched.diet.length ? ` (${searched.diet.join(', ')})` : '';
  const lines = [
    `History ${history.first_date} to ${history.last_date} ` +
      `(${plural(history.days_recorded, 'day')} recorded).` +
      (history.days_missing ? ` Missing: ${plural(history.days_missing, 'day')}.` : ''),
    `Searched ${what}${diet} at ${restaurantNames(searched.restaurants)}, ` +
      `${searched.from} to ${searched.to}.`,
  ];
  const { first_seen: first, last_seen: last } = matches;
  if (!first || !last) {
    lines.push('No matching dishes in this period.');
  } else {
    const at = (s: typeof first) => `${s.date} at ${getRestaurant(s.restaurant_id).name}`;
    lines.push(
      `Served on ${plural(matches.days_served, 'restaurant-day')} ` +
        `(${plural(matches.dishes_matched, 'dish', 'dishes')}). First ${at(first)}, last ${at(last)}.`,
    );
  }
  const label = (key: string) =>
    (RESTAURANT_IDS as readonly string[]).includes(key)
      ? getRestaurant(key as RestaurantId).name
      : key;
  if (out.groups.length) {
    lines.push(
      '  ' +
        out.groups
          .map((g) => `${label(g.key)}: ${g.days_served} of ${plural(g.open_days, 'open day')}`)
          .join(' · '),
    );
  }
  if (out.top_dishes.length) {
    lines.push(
      'Most common: ' +
        out.top_dishes.map((t) => `${t.name} (${t.times}×, last ${t.last_seen})`).join(' · '),
    );
  }
  if (out.notice) lines.push('', out.notice);
  return lines.join('\n');
}
