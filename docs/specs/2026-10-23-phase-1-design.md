# LUT Lunch MCP — Phase 1 design

Status: draft for review · Date: 2026-10-23

## 1. Purpose

An MCP server that lets AI assistants (Claude, ChatGPT, Cursor, …) answer questions about lunch at
LUT University's Skinnarila campus in Lappeenranta:

- "What's for lunch at LUT today?"
- "Any vegan options on campus this week?"
- "Which restaurant has something gluten-free tomorrow?"
- Later (phase 2): "How often is salmon served?"

It is a portfolio project, so code quality, tool design and documentation are part of the deliverable,
not an afterthought.

### Success criteria for phase 1

1. `npx -y @eerihyppanen/lut-lunch-mcp` starts a working stdio server with no configuration.
2. The three example questions above get correct, grounded answers in Claude Desktop, Claude Code
   and Cursor.
3. Closed days, holidays, unpublished days and source outages produce an explicit status and reason,
   never an empty list the model has to guess about.
4. Parsers, normalization, status logic and tools are covered by tests that run offline in CI.
5. README explains install, usage and design decisions well enough to present in an interview.

### Phases (for context; only phase 1 is designed here)

| Phase | Scope |
|---|---|
| 1 | Local stdio server, npm package, three tools |
| 2 | Store each day's menu (SQLite or similar) for history and frequency questions |
| 3 | Remote MCP server on Cloudflare Workers (free tier) |

Phase 1 must not block phases 2 and 3. Section 11 lists the seams left for them.

## 2. Decisions taken during brainstorming

| Topic | Decision |
|---|---|
| Repo | New standalone repo `lut-lunch-mcp`. Campus Food is not modified. |
| Code reuse | Port Campus Food's fetching/parsing logic into a framework-free `core/`. It cannot be imported as-is (coupled to Next.js `fetch` caching and UI data shape). |
| Language | TypeScript. No strong reason for Python; TypeScript runs on Cloudflare Workers for phase 3. |
| Campus scope | Skinnarila only: LUT Buffet, Bistro Skinnarila, Yolo. No `campus` filter yet; each restaurant records its campus. |
| Output language | English by default; `language: "fi"` switches. Search matches both languages. |
| Allergens | Included in phase 1. Each dish reports how complete its allergen data is; unknowns are never treated as safe. |
| Upstream outreach | No courtesy email. Rely on low request volume, an identifying User-Agent and source links. |
| Package name | `@eerihyppanen/lut-lunch-mcp`, binary `lut-lunch-mcp`. |

## 3. Data sources

Findings from exploring Campus Food (`src/lib/menus.ts`) and the live endpoints on 2026-10-23.

### LUT Buffet — Poweresta public menu API

- Menu list: `GET https://api.fi.poweresta.com/publicmenu/menus/kampusravintolat/lut/`
  returns the published seasonal menus (currently one, slug `syksy`). The slug changes by season, so it is
  looked up, not hardcoded.
- Days: `GET …/publicmenu/dates/kampusravintolat/lut/?menu=<slug>&dates=<d1>,<d2>,…` accepts a
  comma-separated list, so a whole week is one request.
- Per row: Finnish/English names, **allergen lists in fi/en including "may contain"**, ingredients,
  CO₂ per portion. Campus Food discards everything except names.
- Diet codes are appended to the Finnish name (`"Pinaattikeittoa L"`); the structured `diets` field is
  empty. Codes seen: `G`, `L`, `M`, `VE`, `*` (Campus Food also handles `VG`).
- Course names carry prices (`"Lounas 13,00 / 3,10 / …"`); Campus Food strips them. We keep the raw
  price string separately.
- Weekend dates return `isMenuForDate: true` with zero meal options. Dates far ahead are silently
  omitted from the response.
- English names are sometimes just the Finnish name (untranslated).
- robots.txt: the API host has none (HTTP 403). The endpoint is public and used by Poweresta's own
  public menu page.

### Bistro Skinnarila — Compass Group (Food & Co) menu API

- Campus Food scrapes `window.__INITIAL_MENU__` from the restaurant's HTML page (fi + en).
- **Better:** the JSON endpoint the site itself uses:
  `GET https://www.compass-group.fi/menuapi/week-menus?costCenter=3363&date=<YYYY-MM-DD>&language=fi|en`
  returns the whole week (structured `diets` arrays, course `price` strings). Two requests per week
  (fi, en).
- `menuapi/feed/json?costNumber=3363&language=en` additionally gives daily `LunchTime` ("11:00–13:00")
  and a disclaimer that diet labels may differ from what is served. Not used for menus (dish strings are
  unstructured), but the disclaimer text is reused (§6.4).
- Closed weeks return `menus: []` (e.g. Christmas week).
- Codes seen: `*`, `A`, `G`, `ILM`, `L`, `M`, `VS`, `Veg`. Compass legend (from other Compass menus):
  `*` meets Finnish nutrition recommendations, `A` contains allergens, `G` gluten-free, `L` lactose-free,
  `VL` low lactose, `M` milk-free, `Veg` vegan, `VS` contains fresh garlic, `ILM` climate-friendly.
- English dishes are matched to Finnish ones by `recipeId` where present, position as fallback
  (Campus Food uses position only).
- robots.txt allows `/menuapi/` (only `/episerver/cms/` is disallowed).

### Yolo — aalef.fi (HTML scraping)

- No API. The front page lists the next ~4 serving days (`<h3>Perjantai 23.10</h3>`, sometimes
  including Saturday) followed by `.pricing__row--type-product` rows: course `fi/en` title, notice codes,
  Finnish and English dish lines.
- Dates have **no year**; the year is inferred from today (a December page showing `2.1` means next year).
  Campus Food keys by day.month only.
- Legend on the page: `G` gluten-free, `M` dairy-free, `L` lactose-free, `VL` low lactose, `V` vegan,
  `+` follows Kela recommendations, and positive allergen markers `SE` celery, `SO` soy, `MU` egg,
  `SI` mustard, `PÄ` nut. Footer asks guests to confirm allergens at the restaurant.
- Some dish lines embed their own codes in parentheses (`"Suklaamousse (L,MU)"`); these are left in the
  name text in phase 1.
- robots.txt allows `/`.

### Terms

No published API terms were found for any source. Policy for this project:

- Identify with `User-Agent: lut-lunch-mcp/<version> (+https://github.com/eerihyppanen/lut-lunch-mcp)`.
- Fetch whole weeks, cache aggressively, never more than one in-flight request per source (§7).
- Every restaurant in every response carries its `source_url`; README credits each provider.
- Pass on the providers' allergen disclaimer whenever diet or allergen filters are used.

## 4. Architecture

```
lut-lunch-mcp/
  src/
    core/                   # runtime-agnostic: only fetch + standard JS, no Node APIs
      types.ts              # domain types (§5)
      restaurants.ts        # static registry: id, name, campus, address, source config, coverage
      sources/
        poweresta.ts        # fetch + parse → SourceWeek
        compass.ts
        aalef.ts            # uses cheerio's slim build (htmlparser2) so it also runs on Workers
        http.ts             # fetch wrapper: timeout, User-Agent, status check
      normalize/
        diets.ts            # source codes → canonical tags (§6)
        allergens.ts        # source allergen data → canonical allergens + coverage
        text.ts             # case/diacritic folding for search
      calendar/
        dates.ts            # Helsinki "today", relative dates, ISO week, weekday names
        holidays.ts         # Finnish public holidays (computed, incl. Easter-based)
      cache.ts              # CacheStore interface + in-memory TTL implementation
      menu-service.ts       # orchestrates sources, caching, request coalescing, status resolution
    mcp/
      server.ts             # createServer(service): McpServer with all tools registered
      tools/
        get-menu.ts
        find-dishes.ts
        list-restaurants.ts
      filters.ts            # diet / allergen / text filtering shared by tools
      format.ts             # compact text rendering of results
    bin/
      stdio.ts              # entry point: createServer(new MenuService(...)) + StdioServerTransport
  test/
    fixtures/               # captured real upstream responses, dated
    *.test.ts
  scripts/
    capture-fixtures.ts     # dev-only: refresh fixtures from live sources
    smoke.ts                # dev-only: call live sources, sanity-check parse results
  docs/specs/               # this document
```

Dependency direction: `bin → mcp → core`. `core` knows nothing about MCP. `mcp/server.ts` takes a
`MenuService` (interface) so tools are tested against a fake, and phase 3's Worker entry reuses
`createServer` unchanged.

**Logging:** stdout is the MCP channel for stdio servers. All logging goes to stderr.

### Tech

| Choice | Notes |
|---|---|
| Node ≥ 22, ESM | CI on Node 22 and 24 |
| `@modelcontextprotocol/sdk` ^1.32 | `McpServer.registerTool` with input and output schemas, tool annotations |
| zod | Version the SDK requires; schemas double as runtime validation |
| cheerio (slim) | Yolo only |
| vitest | Tests; `vi.setSystemTime` for date logic |
| tsup | Build to `dist/`, shebang on the bin |
| ESLint (typescript-eslint) + Prettier | Lint and format in CI |
| GitHub Actions | Lint, typecheck, test, build on push/PR; weekly live smoke run (§9) |
| MIT license | |

## 5. Domain model (core)

```ts
type RestaurantId = 'lut-buffet' | 'bistro-skinnarila' | 'yolo';

type DietTag = 'vegan' | 'vegetarian' | 'gluten_free' | 'milk_free' | 'lactose_free' | 'low_lactose';

type Allergen =
  | 'gluten' | 'milk' | 'egg' | 'fish' | 'crustaceans' | 'molluscs' | 'peanuts' | 'nuts'
  | 'soy' | 'celery' | 'mustard' | 'sesame' | 'sulphites' | 'lupin';

type AllergenCoverage = 'full' | 'partial' | 'none';

interface Dish {
  name: { fi: string; en: string | null };     // en null when the source has no real translation
  tags: DietTag[];                            // canonical, after implication rules (§6.1)
  codes: string[];                            // raw source codes, e.g. ["G", "L", "VS"]
  allergens: {
    coverage: AllergenCoverage;               // how complete `contains` is for this dish
    contains: Allergen[];
    mayContain: Allergen[];
  };
}

interface Course { name: { fi: string; en: string | null }; price: string | null; dishes: Dish[] }

type DayStatus =
  | { kind: 'open'; courses: Course[] }
  | { kind: 'no_menu'; reason: NoMenuReason; holidayName?: string }
  | { kind: 'error'; retryable: boolean };

type NoMenuReason =
  | 'weekend' | 'public_holiday' | 'none_listed'
  | 'not_published_yet' | 'history_not_available';

interface RestaurantDay {
  restaurantId: RestaurantId;
  date: string;          // YYYY-MM-DD, Europe/Helsinki
  status: DayStatus;
  stale: boolean;        // served from cache after a failed refresh
  fetchedAt: string;     // ISO timestamp of the upstream fetch
}
```

`MenuService` interface:

```ts
interface MenuService {
  getDays(dates: string[], restaurants: RestaurantId[]): Promise<RestaurantDay[]>;
  today(): string;       // Helsinki date
}
```

## 6. Normalization

### 6.1 Diet tags

| Canonical tag | Poweresta | Compass | Yolo |
|---|---|---|---|
| `vegan` | `VE`, `VG` | `Veg` | `V` |
| `gluten_free` | `G` | `G` | `G` |
| `milk_free` | `M` | `M` | `M` |
| `lactose_free` | `L` | `L` | `L` |
| `low_lactose` | `VL` | `VL` | `VL` |
| `vegetarian` | inferred | inferred | inferred |

Implication rules, applied after mapping: `vegan ⇒ vegetarian, milk_free`;
`milk_free ⇒ lactose_free`; `lactose_free ⇒ low_lactose`.

`vegetarian` has no code at any source. It is inferred when the dish is vegan **or** sits in a course
whose name marks it vegetarian (`kasvis`, `vege`, `vegetarian`). This is a documented heuristic; README
says so.

Other codes (`*`, `+`, `A`, `ILM`, `VS`, allergen markers) stay in `codes`. They are not filterable
tags in phase 1 (YAGNI); the model can still read them.

Unknown codes are kept in `codes`, ignored for tags, and logged once to stderr so legend changes are
noticed.

The Poweresta legend was not found published; its mapping is inferred from the codes used and the shared
Finnish convention. Verified against live data during implementation.

### 6.2 Allergens

| Source | How `contains` / `mayContain` are filled | Coverage |
|---|---|---|
| Poweresta | Allergen lists (English list mapped to the enum; "May contain: X" → `mayContain`) | `full` |
| Yolo | `SE`, `SO`, `MU`, `SI`, `PÄ` markers → contains; `G` absent ⇒ gluten unknown, present ⇒ not gluten; same for `M`/milk | `partial` |
| Compass | Only `G`/`M`/`L` tell us anything about gluten/milk | `none` (beyond gluten/milk) |

Exclusion logic for `exclude_allergens` (per dish, per allergen):

- `gluten` excluded unless the dish is tagged `gluten_free`. Works for every source.
- `milk` excluded unless tagged `milk_free`. Works for every source.
- Other allergens: excluded if in `contains` or `mayContain`. If the source cannot tell (Compass for
  anything, Yolo for allergens outside its five markers), the dish is **unverifiable**.
- Unverifiable dishes are left out of results, and the response says how many were left out and why.
  A model can then say "Bistro's menu doesn't list egg information; check at the counter" instead of
  wrongly reporting "no egg".

### 6.3 Text search

Case-insensitive, diacritic-folded substring match over Finnish and English dish names. No synonym
dictionary in phase 1. The tool description tells the model to also try the Finnish word if an English
search finds nothing (many Finnish dish names are compounds, e.g. "lohikeitto" contains "lohi").

### 6.4 Disclaimer

When a diet or allergen filter is used, responses include:

> Diet and allergen labels come from the restaurants and can change. People with allergies should
> confirm at the restaurant.

## 7. Dates, statuses and caching

### 7.1 Dates

- All dates are Europe/Helsinki calendar dates. The server resolves `today` / `tomorrow` itself and
  echoes the resolved date and weekday in every response. AI clients often do not know the current date.
- Accepted window: **from 7 days ago to 14 days ahead.** Dates outside it are answered without any
  upstream request: past → `history_not_available` (phase 2 adds history), future →
  `not_published_yet`.
- Range inputs are capped: `get_menu.days` ≤ 7, `find_dishes` span ≤ 14 days.

### 7.2 Status resolution (per restaurant, per date, first match wins)

1. Source returned dishes for the date → `open` (even on weekends or holidays).
2. Source fetch failed and nothing is cached → `error` (`retryable: true` for timeouts and 5xx).
3. Date is after the last date the source publishes (`publishedThrough`, per source fetch) →
   `no_menu / not_published_yet`.
4. Date is a Finnish public holiday → `no_menu / public_holiday` with `holidayName`.
5. Date is Saturday or Sunday → `no_menu / weekend`.
6. Otherwise → `no_menu / none_listed` (e.g. summer break, exam period).

Finnish public holidays are computed: New Year's Day, Epiphany, Good Friday, Easter Monday, May Day,
Ascension Day, Midsummer Eve and Day, All Saints' Day, Independence Day, Christmas Eve, Christmas Day,
Boxing Day. (Midsummer Eve and Christmas Eve are de facto holidays; included because restaurants close.)

### 7.3 Caching and upstream etiquette

| Unit fetched | Key | Fresh for |
|---|---|---|
| Poweresta menu slug list | `poweresta:slugs` | 6 h |
| Poweresta week (Mon–Sun, one request) | `poweresta:<isoWeek>` | 30 min |
| Compass week (fi + en, two requests) | `compass:<isoWeek>` | 30 min |
| Yolo page | `aalef:page` | 30 min |

- **Request coalescing:** concurrent callers for the same key share one in-flight promise.
- **Stale on error:** if a refresh fails and a previous value is younger than 24 h, serve it with
  `stale: true`.
- **Negative cache:** a failed fetch with nothing to fall back on is remembered for 60 s, so a down
  source is not retried on every tool call.
- **Timeout:** 8 s per request. One restaurant failing never fails the whole response.
- `CacheStore` is an interface (`get`, `set` with TTL). Phase 1 ships an in-memory implementation; phase 3
  swaps in Workers Cache API or KV.

Worst case per installed client: a few upstream requests per source per hour, and only while it is being used.

## 8. Tools

All tools are read-only. Annotations: `readOnlyHint: true`, `idempotentHint: true`,
`openWorldHint: true`. Each returns `structuredContent` (validated by an `outputSchema`) and a compact
text rendering for clients that only display text.

Restaurant ids: `lut-buffet`, `bistro-skinnarila`, `yolo`.

### 8.1 `get_menu`

**Description (shown to the model):**

> Get lunch menus for LUT University's Skinnarila campus restaurants (Lappeenranta, Finland) for one day
> or several consecutive days. Use it to show what is being served, e.g. "what's for lunch today?".
> To look for a particular dish, ingredient, diet or allergen across days and restaurants, use
> find_dishes instead. Pass "today" or "tomorrow" rather than computing dates yourself; dates are in
> Finland time. Restaurants without a menu are still listed with a reason (weekend, public holiday, not
> published yet, source unavailable).

**Input:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `date` | `"today"` \| `"tomorrow"` \| `YYYY-MM-DD` | `"today"` | First day |
| `days` | integer 1–7 | 1 | Consecutive days from `date` |
| `restaurants` | array of restaurant ids | all | |
| `diet` | array of `DietTag` | none | Dish must have all tags |
| `exclude_allergens` | array of `Allergen` | none | §6.2 |
| `language` | `"en"` \| `"fi"` | `"en"` | |

**Output (`structuredContent`):**

```jsonc
{
  "timezone": "Europe/Helsinki",
  "today": "2026-10-23",
  "days": [
    {
      "date": "2026-10-23",
      "weekday": "Friday",
      "restaurants": [
        {
          "id": "bistro-skinnarila",
          "name": "Bistro Skinnarila",
          "status": "open",                      // open | no_menu | error
          "reason": null,                        // see NoMenuReason, or "source_unavailable"
          "holiday_name": null,
          "stale": false,
          "source_url": "https://www.compass-group.fi/…/bistro-skinnarila/",
          "courses": [
            {
              "name": "Bistro vegetarian lunch",
              "price": "13,00/ STUDENT 3,10",
              "dishes": [
                {
                  "name": "Chickpeas and vegetables with korma sauce",
                  "untranslated": false,         // true when the English name was missing
                  "tags": ["gluten_free", "lactose_free", "low_lactose"],
                  "codes": ["*", "A", "G", "ILM", "L", "VS"],
                  "allergens": { "coverage": "none", "contains": [], "may_contain": [] }
                }
              ]
            }
          ],
          "hidden_by_filters": 0,                // dishes removed by diet/allergen filters
          "unverifiable": 0                      // dishes removed because allergen data is missing
        }
      ]
    }
  ],
  "notice": null                                 // disclaimer when filters are used (§6.4)
}
```

**Text rendering (example):**

```
Friday 2026-10-23 (today)
Bistro Skinnarila — open
  Bistro vegetarian lunch (13,00 / student 3,10): Chickpeas and vegetables with korma sauce [GF, LF] · Rice [vegan, GF]
  …
Yolo — open
  …
LUT Buffet — no menu: source unavailable (try again later)
```

### 8.2 `find_dishes`

**Description:**

> Search LUT Skinnarila campus lunch menus for dishes matching a word, diet or allergen restriction,
> across several days and restaurants. Use it for questions like "any vegan options this week?",
> "where is something gluten-free tomorrow?" or "is there salmon this week?". Returns a flat list of
> matching dishes with date and restaurant. Searches Finnish and English dish names; if an English word
> finds nothing, try the Finnish one (e.g. "lohi" for salmon). Only currently published menus are
> searchable; history is not available yet.

**Input:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `query` | string | none | Substring match, §6.3 |
| `diet` | array of `DietTag` | none | |
| `exclude_allergens` | array of `Allergen` | none | |
| `from` | `"today"` \| `"tomorrow"` \| `YYYY-MM-DD` | `"today"` | |
| `to` | same | `from` + 6 days | Span ≤ 14 days |
| `restaurants` | array of restaurant ids | all | |
| `language` | `"en"` \| `"fi"` | `"en"` | |
| `limit` | integer 1–100 | 30 | |

At least one of `query`, `diet`, `exclude_allergens` is required; otherwise the tool returns an error
that suggests `get_menu`.

**Output:**

```jsonc
{
  "timezone": "Europe/Helsinki",
  "today": "2026-10-23",
  "searched": { "from": "2026-10-23", "to": "2026-10-25", "restaurants": ["lut-buffet", "bistro-skinnarila", "yolo"] },
  "matches": [
    {
      "date": "2026-10-23", "weekday": "Friday",
      "restaurant_id": "yolo", "restaurant": "Yolo",
      "course": "Soup",
      "dish": { /* same Dish shape as get_menu */ }
    }
  ],
  "total_matches": 1,
  "truncated": false,
  "days_without_data": [
    { "date": "2026-10-24", "restaurant_id": "lut-buffet", "status": "no_menu", "reason": "weekend" }
  ],
  "unverifiable": 0,
  "notice": null
}
```

`days_without_data` lets the model say "nothing found, but Yolo hasn't published Monday yet" instead of
"nothing found".

### 8.3 `list_restaurants`

**Description:**

> List the LUT Skinnarila campus lunch restaurants this server covers, with ids for the other tools,
> address, operator, menu link and how complete their diet and allergen data is. No menus; use
> get_menu or find_dishes for those.

**Input:** none.

**Output:**

```jsonc
{
  "restaurants": [
    {
      "id": "yolo",
      "name": "Yolo",
      "campus": "Skinnarila (Lappeenranta)",
      "operator": "Aalef",
      "address": "Laserkatu 10, Lappeenranta",
      "menu_url": "https://www.aalef.fi/",
      "usual_lunch_hours": "Mon–Fri 10:30–13:00",   // illustrative; verified in step 1
      "menus_published_ahead": "about 4 serving days",
      "allergen_coverage": "partial"
    }
  ]
}
```

Addresses and lunch hours are static registry values, verified against each restaurant's own page during
implementation; any that cannot be verified are `null` rather than guessed.

### 8.4 Not included (and why)

- **No per-source tools** (`get_poweresta_menu`, …): the model should not need to know data
  provenance.
- **No MCP resources or prompts in phase 1:** client support is uneven (ChatGPT, Cursor); everything is
  reachable through tools. Can be added later without breaking changes.
- **No `campus` parameter:** one campus. The registry already stores campus, so adding one is
  non-breaking.

## 9. Error handling

| Situation | Behaviour |
|---|---|
| Invalid input (bad date, unknown id, impossible date like 2026-02-31) | Tool error (`isError: true`) with a message saying what is valid |
| One source down | That restaurant gets `status: "error"` or stale data; others unaffected |
| All sources down | Normal response with every restaurant in `error`; text says to try later |
| Upstream shape changed (parse failure) | Treated as source error; logged to stderr with source name; weekly smoke run catches it |
| Date outside window | `no_menu` with reason, no upstream request |
| Unexpected exception in a tool | Caught at the tool boundary; generic tool error; details to stderr |

## 10. Testing

- **Parser tests:** each source parsed from captured fixtures (`test/fixtures/<source>/<date>.json|html`),
  including a weekend, an empty/closed week, an untranslated English name, and Yolo's year rollover.
- **Normalization tests:** code → tag mapping, implication rules, allergen mapping and coverage,
  vegetarian inference, unknown codes.
- **Calendar tests:** Helsinki today across midnight and DST changes, Easter-based holidays for several
  years, Midsummer and All Saints' Day rules.
- **MenuService tests:** status resolution order, cache TTL, coalescing, stale-on-error, negative cache,
  one source failing. Sources are injected, time is faked.
- **Tool tests:** filter logic and input validation against a fake `MenuService`.
- **End-to-end:** SDK `Client` connected to `createServer` over an in-memory transport; list tools,
  call each tool, validate output against its schema.
- **Live smoke (not in normal CI):** `npm run smoke` hits the real sources and checks the parsers return
  plausible data. A weekly scheduled GitHub Action runs it so upstream changes are noticed early
  (3–4 requests per week).
- CI runs with `TZ=UTC` so Helsinki handling is genuinely exercised.

## 11. Seams for later phases

- **Phase 2 (history):** `MenuService` gains a persistence hook (`onDayFetched`) and a `MenuStore`
  interface. `find_dishes` extends to past dates via the store; a new `dish_stats` tool answers
  frequency questions. `history_not_available` disappears for stored dates.
- **Phase 3 (remote):** a Worker entry calls the same `createServer`, with a Workers-backed
  `CacheStore` and Streamable HTTP transport. `core` already avoids Node APIs; cheerio's slim build runs
  on Workers. Central caching means fewer upstream requests than many local installs.

## 12. Packaging and documentation

- `package.json`: name `@eerihyppanen/lut-lunch-mcp`, `bin: { "lut-lunch-mcp": "dist/stdio.js" }`,
  `files: ["dist"]`, `publishConfig.access: "public"`, `engines.node: ">=22"`.
- Install: `npx -y @eerihyppanen/lut-lunch-mcp`.
- README sections: what it does (with a short example conversation), install for Claude Desktop,
  Claude Code (`claude mcp add`), Cursor (`.cursor/mcp.json`), example questions, tool reference,
  data sources and credits, design decisions (drawn from §2, §6–§8), development and testing with MCP
  Inspector, limitations (allergen coverage, Yolo scraping), license.
- No secrets exist in this project; `.gitignore` covers `.env*` anyway.
- Publishing is done by the owner from their npm account. The plan ends at a verified `npm pack`.

## 13. Build order (detailed in the implementation plan)

1. Scaffold: repo, tooling, CI, license; `list_restaurants` with static data.
2. Core pure logic: types, calendar and holidays, diet and allergen normalization.
3. Compass source + fixtures.
4. Poweresta source + fixtures.
5. Yolo source + fixtures.
6. `MenuService`: caching, coalescing, stale-on-error, status resolution.
7. `get_menu`.
8. `find_dishes`.
9. End-to-end tests, error paths, live smoke script and scheduled workflow.
10. README, `npm pack`, manual test in Claude Desktop, Claude Code and Cursor.

Each step ends with instructions for testing it with MCP Inspector
(`npx @modelcontextprotocol/inspector npx tsx src/bin/stdio.ts`) or `npm test` where nothing is
user-visible yet.

## 14. Risks and open items

| Item | Mitigation |
|---|---|
| Yolo HTML changes | Isolated parser, fixtures, weekly smoke run; failure degrades to `error` for Yolo only |
| Poweresta legend not published | Mapping inferred and verified against live data; LUT Buffet has full allergen lists anyway |
| Compass `A` code meaning ("contains allergens") is non-specific | Not used for exclusion; Compass coverage stays `none` |
| Undocumented endpoints may change or be restricted | Low volume, identifying User-Agent, source links; no workaround if a provider objects |
| npm scope `@eerihyppanen` must match the owner's npm username | Confirm before publishing |
