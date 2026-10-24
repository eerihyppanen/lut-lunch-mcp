# LUT Lunch MCP — Phase 2 design: menu history

Status: draft for review · Date: 2026-10-24 · Builds on: `docs/specs/2026-10-23-phase-1-design.md`

## 1. Purpose

Let AI assistants answer questions about past lunches at LUT Skinnarila campus:

- "How often has salmon been served?"
- "When did Yolo last have salmon soup?"
- "What was on at LUT Buffet last Tuesday?"
- "Has there been more vegan food lately?" / "What's the most common soup?"

### Success criteria

1. A daily collector records every restaurant's menu (or the reason it has none) without anyone
   running anything by hand.
2. The npm package answers the four question types above from that shared history, with no new
   installation steps, keys or settings.
3. Every answer says what period the history covers, so a model can say "since October 2026".
4. Today's and upcoming menus keep working exactly as in phase 1, also when the history cannot be
   loaded.
5. Collection logic, history queries and statistics are covered by offline tests.

## 2. Decisions taken during brainstorming

| Topic | Decision |
|---|---|
| History questions | All four: frequency, last served, a past day's menu, trends and statistics |
| Collection | GitHub Actions on a schedule, writing to a `data` branch of the public repo |
| Storage | One JSON file per day (source of truth) plus a combined `history.json`; no database |
| Distribution | The server downloads `history.json` from `raw.githubusercontent.com`, at most every 6 h |
| Tools | `get_menu` and `find_dishes` accept past dates; new `menu_stats` for frequency and trends |
| "Same dish" | Same Finnish name, case- and diacritic-insensitive; no fuzzy merging |
| Release | 0.2.0 (new tool) |

### Why collection must be central

The sources do not serve the past (checked 2026-10-24): Compass returns empty weeks for every past
week, Poweresta returns empty or HTTP 400 for past days, and Yolo's page lists today onwards. History
therefore has to be recorded daily from now on. A local server would only record the days its user
happened to ask about, so one shared collector is the only way to get complete history.

## 3. Architecture

```
GitHub Actions: collect.yml (06:30 UTC run, 10:30 UTC retry)
  └─ scripts/collect.ts  ── uses createLiveMenuService (src/core, unchanged sources)
       └─ data branch:  days/2026/10/2026-10-26.json   one file per day (source of truth)
                        history.json                   all days combined
npm package
  └─ RemoteHistoryStore (src/core/history/remote.ts) ── fetch + CachedLoader, lazy, 6 h fresh
       └─ LiveMenuService: past dates from history
       └─ menu_stats: statistics over the whole history
```

New and changed files:

| File | Responsibility |
|---|---|
| `src/core/history/types.ts` | `HistoryDay`, `HistoryDataset`, `History`, `HistoryStore` |
| `src/core/history/snapshot.ts` | Pure functions: day from `RestaurantDay[]`, merge rule, build dataset |
| `src/core/history/remote.ts` | `createRemoteHistoryStore`: download, validate, index by date |
| `src/core/menu-service.ts` | Past dates read from history; new `loadHistory()` |
| `src/mcp/stats.ts` | Pure statistics over a `History` |
| `src/mcp/tools/menu-stats.ts` | The `menu_stats` tool |
| `src/mcp/tools/get-menu.ts`, `find-dishes.ts` | Updated descriptions only |
| `src/bin/stdio.ts` | Wires the history store; reads `LUT_LUNCH_HISTORY_URL` |
| `scripts/collect.ts` | Node CLI: fetch today, merge into the day file, rebuild `history.json` |
| `.github/workflows/collect.yml` | Schedule, commit to `data` |

`src/core/**` still uses only `fetch` and standard JavaScript (the lint guard enforces it); file
access lives in `scripts/collect.ts` only.

## 4. Data format

Stored data uses the core's own camelCase types, so collector and server share one definition.

### 4.1 Day file — `days/YYYY/MM/YYYY-MM-DD.json`

```jsonc
{
  "schema": 1,
  "date": "2026-10-26",
  "collectedAt": "2026-10-26T06:30:12.000Z",
  "collectorVersion": "0.2.0",
  "restaurants": [
    { "id": "lut-buffet", "status": { "kind": "open", "courses": [ /* Course[] as in phase 1 §5 */ ] } },
    { "id": "bistro-skinnarila", "status": { "kind": "no_menu", "reason": "public_holiday", "holidayName": "All Saints' Day" } },
    { "id": "yolo", "status": { "kind": "error", "retryable": true } }
  ]
}
```

- `restaurants` is in registry order and contains every restaurant.
- `Course`/`Dish` are stored exactly as the core produces them: names fi/en, price, tags, codes,
  allergens (`coverage`, `contains`, `mayContain`, `assessed`). Nothing else from the sources
  (no Poweresta ingredients or CO₂ values) is stored.
- Files are written as 2-space JSON with a trailing newline, so daily diffs stay readable.

### 4.2 Combined file — `history.json`

```jsonc
{
  "schema": 1,
  "generatedAt": "2026-10-26T06:30:15.000Z",
  "firstDate": "2026-10-26",
  "lastDate": "2026-10-26",
  "attribution": "Menus by Kampusravintolat, Compass Group (Food & Co) and Aalef; collected by lut-lunch-mcp. Diet and allergen labels come from the restaurants and can change.",
  "sources": [ { "id": "lut-buffet", "name": "LUT Buffet", "operator": "Kampusravintolat", "menuUrl": "https://www.kampusravintolat.fi/" } ],
  "days": [ /* HistoryDay[] sorted by date, same shape as the day files */ ]
}
```

- Written compact (no indentation); it is regenerated from the day files on every run.
- Expected size: about 100 dishes a day, a few MB per year uncompressed.

### 4.3 Schema versioning

Both files carry `"schema": 1`. The server accepts only schema versions it knows; anything else is a
non-retryable `SourceError` ("History data uses schema N; update lut-lunch-mcp.").

## 5. Collection

### 5.1 `scripts/collect.ts`

```
tsx scripts/collect.ts [--data-dir data] [--date YYYY-MM-DD] [--fail-on-error]
```

1. `date` defaults to today in Helsinki.
2. Fetch that date for all restaurants with `createLiveMenuService` (live sources only).
3. Turn the result into a `HistoryDay` (`toHistoryDay`).
4. If a day file already exists, merge (`mergeHistoryDay`, §5.2). Write the file only if the merged
   content differs from what is on disk (ignoring `collectedAt` when nothing else changed).
5. Rebuild `history.json` from all day files (`buildHistoryDataset`) and write it if it changed.
6. Print a one-line summary per restaurant to stderr.
7. With `--fail-on-error`, exit 1 if any restaurant is still `error` after merging. Without it, exit
   0 even when a source failed (the retry run follows).

### 5.2 Merge rule (per restaurant)

Rank: `open` > `no_menu` > `error`. The merged entry is the higher-ranked of existing and new; on a
tie the existing entry stays. A recorded menu is therefore never replaced by a failure or an empty
answer, and a later run can only improve a day. `collectedAt` becomes the time of the run that
changed something.

### 5.3 Workflow — `.github/workflows/collect.yml`

- Triggers: `schedule` at `30 6 * * *` and `30 10 * * *` (UTC), plus `workflow_dispatch`.
- `permissions: contents: write`; `concurrency: { group: collect, cancel-in-progress: false }`.
- Steps:
  1. Check out `main` (code).
  2. Check out branch `data` into `./data`.
  3. Set up Node 24 and run `npm ci`.
  4. Run the collector with `--data-dir data`. The 10:30 run (`github.event.schedule ==
     '30 10 * * *'`) and manual runs (`workflow_dispatch`) add `--fail-on-error`. The exit code is
     saved, not acted on yet.
  5. If `data/` changed, commit as `github-actions[bot]` with message `data: <date>` and push.
  6. Fail the job if step 4 failed, so the owner gets GitHub's failure email.
- The `data` branch is created once, empty, with a short README (what the data is, attribution,
  schema), before the workflow is enabled.
- `main`'s `.gitignore` adds `/data/` so a local checkout of the data branch is never committed to
  `main`.

### 5.4 History start

History begins on the first collection day. README and every `menu_stats` result state the covered
period.

## 6. Server side

### 6.1 Types

```ts
interface HistoryDay {
  schema: 1;
  date: string;
  collectedAt: string;
  collectorVersion: string;
  restaurants: { id: RestaurantId; status: DayStatus }[];
}

interface History {
  firstDate: string | null;          // null when no day is recorded yet
  lastDate: string | null;
  days: ReadonlyMap<string, HistoryDay>;
}

interface HistoryStore {
  load(): Promise<History>;          // throws SourceError when unavailable or unsupported
}
```

`MenuService` gains `loadHistory(): Promise<History>`.

### 6.2 `RemoteHistoryStore`

- `createRemoteHistoryStore(http: HttpClient, loader: CachedLoader, url: string): HistoryStore`.
- Loads through `loader.load('history', 6 * 3600_000, …)`: lazy (first history question only),
  shared in-flight request, stale copy on failure as in phase 1.
- Validates the dataset with zod; indexes days by date.
- Default URL: `https://raw.githubusercontent.com/eerihyppanen/lut-lunch-mcp/data/history.json`.
  `src/bin/stdio.ts` uses `LUT_LUNCH_HISTORY_URL` instead when set.

### 6.3 Past dates in `LiveMenuService`

For each requested date before today (today and later are unchanged):

1. Load the history (only when the request contains a past date).
2. Day recorded and restaurant `open` or `no_menu` → that status, `stale: false`,
   `fetchedAt` = the day's `collectedAt`.
3. Day recorded but restaurant `error` → `no_menu / history_not_available` (the past cannot be
   fetched again).
4. Day not recorded, or history failed to load → phase 1 behaviour: live sources inside the
   7-day window, otherwise `no_menu / history_not_available`. Exception: if the history failed to
   load and the date is outside the window, the status is `error` with the load error's `retryable`
   (shown as `source_unavailable` / `source_error`), because trying later can help.

`WINDOW_PAST_DAYS` keeps its meaning (how far back live sources are asked); dates further back are
now served from history instead of being refused.

### 6.4 Tool descriptions

`get_menu` (replaces the phase 1 text):

> Get lunch menus for LUT University's Skinnarila campus restaurants (Lappeenranta, Finland) for one
> day or several consecutive days, including past days from the recorded history. Use it to show what
> is or was served, e.g. "what's for lunch today?" or "what was on last Tuesday?". To look for a
> particular dish, ingredient, diet or allergen across days and restaurants, use find_dishes; for "how
> often" and "when last", use menu_stats. Pass "today" or "tomorrow" rather than computing dates
> yourself; dates are in Finland time. Restaurants without a menu are still listed with a reason
> (weekend, public holiday, not published yet, no history for that day, source unavailable).

`find_dishes` (last sentence replaced):

> … if an English word finds nothing, try the Finnish one (e.g. "lohi" for salmon). Past dates are
> searched in the recorded history, up to 14 days per search; for "how often" or "when last" over
> longer periods use menu_stats.

## 7. `menu_stats`

**Description:**

> Statistics from the recorded lunch history of LUT Skinnarila campus restaurants: how often dishes
> matching a word or diet were served, when they were first and last served, counts per restaurant,
> month or weekday, and the most common dishes. Use it for questions like "how often is salmon
> served?", "when did Yolo last have salmon soup?", "what's the most common soup?" or "has there been
> more vegan food lately?". Searches Finnish and English dish names (try the Finnish word, e.g.
> "lohi", if English finds nothing). History only covers days since collection started; the result
> says which period it covers.

**Input:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `query` | string | none | Same matching as `find_dishes` |
| `diet` | array of `DietTag` | none | Dish must have all tags |
| `restaurants` | array of restaurant ids | all | |
| `from` | `"today"` \| `"tomorrow"` \| `YYYY-MM-DD` | first recorded day | |
| `to` | same | today | |
| `group_by` | `"restaurant"` \| `"month"` \| `"weekday"` \| `"none"` | `"restaurant"` | |
| `top` | integer 0–20 | 10 | Number of most common dishes to list |
| `language` | `"en"` \| `"fi"` | `"en"` | |

`query` and `diet` are both optional: without them, statistics cover all dishes (e.g. "most common
dishes overall"). `to` before `from` is an input error.

**Definitions** (over recorded days in `[from, to]`, selected restaurants):

- *Restaurant-day*: one restaurant on one date.
- `open_days`: restaurant-days with status `open`.
- A dish *matches* when `judgeDish(dish, { query, diet })` is `keep`.
- `days_served`: restaurant-days with at least one matching dish.
- `dishes_matched`: matching dish occurrences (a dish listed twice on one day counts twice).
- `first_seen` / `last_seen`: earliest / latest matching occurrence (date, restaurant, dish name; for
  several matches on the same date, the first in restaurant then course order).
- `top_dishes`: matching dishes grouped by folded Finnish name; `times` = restaurant-days on which the
  dish appeared. Sorted by `times` desc, then `last_seen` desc, then name. `name` is taken from the
  most recent occurrence, in the requested language.
- Groups: `restaurant` → id, in registry order; `month` → `YYYY-MM`, ascending; `weekday` → Monday to
  Sunday; `none` → one group `"all"`. Every group in the period is listed, also with zero matches.

**Output (`structuredContent`):**

```jsonc
{
  "timezone": "Europe/Helsinki",
  "today": "2026-11-20",
  "history": {
    "first_date": "2026-10-26",        // null when nothing is recorded yet
    "last_date": "2026-11-20",
    "days_recorded": 26,
    "days_missing": 0,                 // dates between first and last with no day file
    "restaurant_days_unavailable": 1   // recorded restaurant-days whose collection failed
  },
  "searched": { "from": "2026-10-26", "to": "2026-11-20", "restaurants": ["lut-buffet", "bistro-skinnarila", "yolo"], "query": "lohi", "diet": [] },
  "matches": {
    "days_served": 7,
    "dishes_matched": 8,
    "first_seen": { "date": "2026-10-27", "restaurant_id": "lut-buffet", "dish": "Salmon soup" },
    "last_seen":  { "date": "2026-11-18", "restaurant_id": "yolo", "dish": "Salmon soup" }
  },
  "groups": [ { "key": "lut-buffet", "open_days": 19, "days_served": 3 } ],
  "top_dishes": [ { "name": "Salmon soup", "times": 4, "restaurants": ["lut-buffet", "yolo"], "last_seen": "2026-11-18" } ],
  "notice": null                       // allergen notice when diet is used (phase 1 §6.4)
}
```

**Text rendering (example):**

```
History 2026-10-26 to 2026-11-20 (26 days recorded). Searched "lohi" at all restaurants.
Served on 7 restaurant-days (8 dishes). First 2026-10-27 at LUT Buffet, last 2026-11-18 at Yolo.
  LUT Buffet: 3 of 19 open days · Bistro Skinnarila: 1 of 18 · Yolo: 3 of 17
Most common: Salmon soup (4×, last 2026-11-18) · Creamy salmon soup (2×) · …
```

**Errors:** history unavailable → tool error "Menu history is temporarily unavailable; try again
later." (retryable) or the schema message (§4.3). No recorded days → normal result with zeros and
`first_date: null`, and the text says collection has not recorded any days yet.

## 8. Error handling summary

| Situation | Behaviour |
|---|---|
| History download fails, past date inside 7-day window | Live sources as in phase 1 |
| History download fails, older past date | `error` → `source_unavailable` (try later) |
| History download fails, `menu_stats` | Tool error, retryable wording |
| Unknown history schema | Non-retryable error asking to update the package |
| Day recorded, restaurant collection failed | `history_not_available` |
| Collector: one source fails | Day file written with `error`; 10:30 run retries; job fails if still `error` |
| Collector: run fails entirely | No commit; `menu_stats` reports the day in `days_missing` |

## 9. Testing

- **Snapshot logic:** `toHistoryDay`, merge rank and tie rule, "no change → no write" comparison,
  `buildHistoryDataset` ordering and first/last dates.
- **Collector:** `scripts/collect.ts` against a temporary directory with a fake menu service:
  creates the day file and `history.json`, a second run with a failing source keeps the recorded
  menu, `--fail-on-error` exit codes, no rewrite when nothing changed.
- **Remote store:** valid dataset indexed by date, invalid shape and unknown schema → `SourceError`,
  caching through `CachedLoader`.
- **Menu service:** past recorded day → history status; recorded `error` → `history_not_available`;
  unrecorded day inside / outside the window; history load failure inside / outside the window.
- **Statistics:** a fixture `History` built from the phase 1 fixtures plus a few synthetic days, with
  exact expected counts, first/last seen, each `group_by`, `top_dishes` order and ties, language,
  empty history.
- **End to end:** `menu_stats`, `get_menu` for a past date and `find_dishes` over a past range through
  the in-memory MCP client.
- **Live:** one manual `workflow_dispatch` run before release; check that the `data` branch gets its
  first day file and `history.json`, and that the published package answers from it.

## 10. Documentation and release

- README: a "History" section (where the data comes from, when it starts, the `data` branch,
  attribution), `menu_stats` in the tools table, new example questions, limitations (history starts
  at launch, "same dish" means same name).
- CHANGELOG entry; version 0.2.0 via `npm version minor`.
- The `data` branch README states attribution and the schema.

## 11. Seams for phase 3

- A Worker can use `createRemoteHistoryStore` as it is (`fetch` only), or swap in a D1-backed
  `HistoryStore` with the same interface; tools do not change.
- The Worker's own cron can replace the Actions collector by calling the same pure functions in
  `src/core/history/snapshot.ts`.
- Making `CacheStore` asynchronous stays a phase 3 task; nothing in phase 2 needs it.

## 12. Build order (detailed in the implementation plan)

1. History types and pure snapshot functions (`toHistoryDay`, merge, build dataset).
2. Collector script and its tests (temporary directory, fake service).
3. `RemoteHistoryStore` with validation and caching.
4. `LiveMenuService` past-date path and `loadHistory()`; updated descriptions for `get_menu` and
   `find_dishes`.
5. Statistics module.
6. `menu_stats` tool, text rendering, end-to-end tests; wiring in `src/bin/stdio.ts`.
7. `data` branch, `collect.yml`, `.gitignore`; first manual collection run.
8. README, CHANGELOG, release 0.2.0.

## 13. Risks and open items

| Item | Mitigation |
|---|---|
| GitHub disables schedules after 60 days without repository activity | Daily bot commits keep the repository active; if a schedule is disabled anyway, GitHub emails the owner and it can be re-enabled |
| Scheduled runs start late (GitHub can delay cron by up to about an hour) | Two runs a day; menus are published long before |
| `raw.githubusercontent.com` caches files for a few minutes | Irrelevant for daily data |
| History is thin at first | Every result states the covered period |
| Same dish under slightly different names counts separately | Documented; queries by word ("lohi") still find all variants |
| Republishing menu data | Only what the tools need, with attribution and links to each restaurant |
