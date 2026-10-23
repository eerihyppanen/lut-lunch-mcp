import type { AllergenCoverage, RestaurantId } from './types.js';

export interface RestaurantInfo {
  id: RestaurantId;
  name: string;
  campus: string;
  operator: string;
  address: string | null;
  menuUrl: string;
  usualLunchHours: string | null;
  menusPublishedAhead: string;
  allergenCoverage: AllergenCoverage;
}

const CAMPUS = 'Skinnarila (Lappeenranta)';

// Addresses and hours are taken from each operator's own page (checked 2026-10-23).
export const RESTAURANTS: readonly RestaurantInfo[] = [
  {
    id: 'lut-buffet',
    name: 'LUT Buffet',
    campus: CAMPUS,
    operator: 'Kampusravintolat',
    address: 'LUT University main building, 2nd floor, Lappeenranta',
    // The Poweresta menu page URL changes with the season; the operator's site always links to it.
    menuUrl: 'https://www.kampusravintolat.fi/',
    usualLunchHours: 'Mon–Fri 10:30–15:00',
    menusPublishedAhead: 'current week',
    allergenCoverage: 'full',
  },
  {
    id: 'bistro-skinnarila',
    name: 'Bistro Skinnarila',
    campus: CAMPUS,
    operator: 'Compass Group (Food & Co)',
    address: 'Laserkatu 6, 53850 Lappeenranta',
    menuUrl:
      'https://www.compass-group.fi/ravintolat-ja-ruokalistat/foodco/kaupungit/lappeenranta/bistro-skinnarila/',
    usualLunchHours: 'Mon–Fri 11:00–13:00',
    menusPublishedAhead: 'current week',
    allergenCoverage: 'none',
  },
  {
    id: 'yolo',
    name: 'Yolo',
    campus: CAMPUS,
    operator: 'Aalef',
    address: 'Laserkatu 10, 53850 Lappeenranta',
    menuUrl: 'https://www.aalef.fi/',
    usualLunchHours: 'Mon–Thu 10:30–16:00, Fri 10:30–15:30, Sat 11:00–14:00',
    menusPublishedAhead: 'about 4 serving days',
    allergenCoverage: 'partial',
  },
];

export function getRestaurant(id: RestaurantId): RestaurantInfo {
  const restaurant = RESTAURANTS.find((r) => r.id === id);
  if (!restaurant) throw new Error(`Unknown restaurant id: ${id}`);
  return restaurant;
}
