# Changelog

All notable changes to this project. Versions follow [semantic versioning](https://semver.org).

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
