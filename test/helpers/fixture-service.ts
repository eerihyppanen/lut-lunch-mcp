import { CachedLoader, MemoryCacheStore } from '../../src/core/cache.js';
import { isoWeekMonday } from '../../src/core/calendar/dates.js';
import { LiveMenuService } from '../../src/core/menu-service.js';
import { parseAalefPage } from '../../src/core/sources/aalef.js';
import { parseCompassWeek } from '../../src/core/sources/compass.js';
import { parsePowerestaDates } from '../../src/core/sources/poweresta.js';
import type { SourceResult } from '../../src/core/sources/source.js';
import { fakeSource } from './fakes.js';
import { fixtureJson, fixtureText } from './fixtures.js';

/** Fixtures were captured on Friday 2026-10-23 (ISO week starting 2026-10-19). */
export const FIXTURE_NOW = new Date('2026-10-23T09:00:00Z');
const TODAY = '2026-10-23';
const FIXTURE_WEEK = '2026-10-19';
const UNPUBLISHED: SourceResult = { days: {}, coverage: null };

/** A real LiveMenuService whose sources serve the captured fixtures instead of the network. */
export function fixtureService(): LiveMenuService {
  const lut = parsePowerestaDates(fixtureJson('poweresta/week-2026-10-19.json'));
  const bistro = parseCompassWeek(
    fixtureJson('compass/week-2026-10-19-fi.json'),
    fixtureJson('compass/week-2026-10-19-en.json'),
    FIXTURE_WEEK,
    TODAY,
  );
  const yolo = parseAalefPage(fixtureText('aalef/2026-10-23.html'), TODAY);
  const forWeek = (result: SourceResult) => (date: string) =>
    isoWeekMonday(date) === FIXTURE_WEEK ? result : UNPUBLISHED;

  return new LiveMenuService({
    sources: [
      fakeSource('lut-buffet', forWeek(lut)),
      fakeSource('bistro-skinnarila', forWeek(bistro)),
      fakeSource('yolo', yolo),
    ],
    loader: new CachedLoader(new MemoryCacheStore(), () => FIXTURE_NOW.getTime()),
    now: () => FIXTURE_NOW,
  });
}
