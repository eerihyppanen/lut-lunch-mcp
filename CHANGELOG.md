# Changelog

All notable changes to this project. Versions follow [semantic versioning](https://semver.org).

## 0.2.1 (unreleased)

### Fixed

- In the evening, when Yolo's page has already moved on to the next days, today shows the menu
  recorded that morning instead of "weekend" or "nothing listed".
- A past day whose collection failed is fetched live again while the source still lists it.
- A past day that can't be answered because the history download failed now says
  `history_unavailable` instead of blaming the restaurant's source.
- `menu_stats` checks that `from` is not after `to` before downloading the history, and no
  longer prints an empty line when no group falls in the period.
- The history download no longer delays today's menus when past days are asked for too; both
  are fetched in parallel.

### Changed

- The collector also runs at 08:30 UTC and fills in menus missing from earlier days of the week,
  since GitHub can skip scheduled runs (only days with a recovered menu, from the first recorded
  day on). It updates `history.json` incrementally.
- The collector records "not published yet" as nothing listed and a date the source no longer
  covers as not collected, so the history needs no interpretation when read.

## 0.2.0 (2026-10-24)

### Added

- Menu history: a daily GitHub Actions collector records every restaurant's menu (or why it had
  none) to the `data` branch, and the server downloads it on demand (`LUT_LUNCH_HISTORY_URL`
  overrides the location).
- `menu_stats` tool: how often and when dishes matching a word or diet were served, counts per
  restaurant, month or weekday, and the most common dishes.
- `get_menu` and `find_dishes` answer past dates from the recorded history.

## 0.1.1 (2026-10-24)

### Fixed

- Yolo dishes with allergen codes in their name, e.g. "Suklaamousse/suklaakakku(L,MU)", now count as
  containing those allergens (here: egg).
- A source that answers with data the server can't read (for example after a site redesign) is now
  reported as `source_error` instead of `source_unavailable`, and no longer says "try again later".
- `find_dishes` names the public holiday for days without data (`holiday_name`), as `get_menu`
  already did.
- `list_restaurants` reports LUT Buffet's allergen coverage as `partial`: most dishes have a full
  list, some have none.
- Dates accept `Today` / `tomorrow` regardless of case and spaces, and only years 2000–2100.

### Changed

- "Today" is computed from date parts instead of relying on one locale's date format.
- Development: tests no longer print the server's expected outage logs; the core lint rule also
  blocks bare Node imports and Node globals; `npm version` keeps `src/version.ts` in sync.

## 0.1.0 (2026-10-23)

First release: a local stdio MCP server for LUT University Skinnarila campus lunch menus
(LUT Buffet, Bistro Skinnarila, Yolo) with the tools `get_menu`, `find_dishes` and
`list_restaurants`.
