// Live check against the real menu sources (not part of the normal test run).
// Fetches the next 7 days for every restaurant and fails when a source looks broken:
// every date errors, or no day is open although the range contains a normal working day.
// During summer or Christmas breaks the second check fails legitimately; the log shows why.
//
// Run: npm run smoke   (about 8 requests in total)

import { addDays, isWeekend } from '../src/core/calendar/dates.js';
import { finnishHoliday } from '../src/core/calendar/holidays.js';
import { USER_AGENT, createFetchHttpClient } from '../src/core/http.js';
import { createLiveMenuService } from '../src/core/menu-service.js';
import { RESTAURANT_IDS } from '../src/core/types.js';

const service = createLiveMenuService(createFetchHttpClient({ userAgent: USER_AGENT }));
const today = service.today();
const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i));
const rows = await service.getDays(dates, [...RESTAURANT_IDS]);
const hasWorkingDay = dates.some((d) => !isWeekend(d) && !finnishHoliday(d));

console.error(`Smoke run ${dates[0]} to ${dates.at(-1)} (today ${today})`);
const problems: string[] = [];

for (const id of RESTAURANT_IDS) {
  const own = rows.filter((r) => r.restaurantId === id);
  const open = own.filter((r) => r.status.kind === 'open');
  const errors = own.filter((r) => r.status.kind === 'error');
  const reasons = own.flatMap((r) => (r.status.kind === 'no_menu' ? [r.status.reason] : []));
  const dishes = open.reduce(
    (n, r) =>
      n +
      (r.status.kind === 'open' ? r.status.courses.reduce((m, c) => m + c.dishes.length, 0) : 0),
    0,
  );
  console.error(
    `  ${id.padEnd(18)} open ${open.length} (${dishes} dishes), ` +
      `no menu ${reasons.length} [${reasons.join(', ')}], error ${errors.length}`,
  );
  if (errors.length === own.length) problems.push(`${id}: every date failed`);
  else if (open.length === 0 && hasWorkingDay) {
    problems.push(`${id}: no open day although the range has a working day`);
  }
}

if (problems.length) {
  console.error(`\nFAILED:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.error('\nOK');
