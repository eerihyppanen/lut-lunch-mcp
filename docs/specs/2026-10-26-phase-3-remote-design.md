# LUT Lunch MCP — Phase 3 design: remote server on Cloudflare Workers

Status: approved · Date: 2026-10-26 · Builds on:
`docs/specs/2026-10-23-phase-1-design.md`, `docs/specs/2026-10-24-phase-2-history-design.md`

## 1. Purpose

Make the server usable without installing anything, and make history collection start on time.

- Anyone can add a URL as a connector in Claude or ChatGPT (ChatGPT only supports remote servers)
  and use the same four tools as the npm package.
- The daily collection starts within minutes of its scheduled time. GitHub's own scheduled runs
  arrived 4–6.5 hours late (2026-10-25: 06:30 → 11:55 UTC, 10:30 → 14:27 UTC; 2026-10-26: 06:00
  → 12:28 UTC), late enough for Yolo's page to move past the day being collected.

### Success criteria

1. A public `*.workers.dev` URL works as a connector in Claude and ChatGPT with all four tools,
   giving the same answers as the npm package.
2. Collection runs within minutes of 06:30, 08:30 and 10:30 UTC.
3. Everything stays on free plans: Cloudflare Workers Free, GitHub Actions for a public repo,
   npm public packages. No credit card-backed service is required to run it.
4. Every request stays within the Workers Free limits (10 ms CPU, 50 subrequests) as the history
   grows for years; a CPU budget test proves it.

   Measured after the first deploy (2026-10-26, Workers Logs, 40 `menu_stats` requests): a warm
   instance uses 1–4 ms of CPU (median 2 ms). The first request on a fresh instance uses 11–27 ms,
   because it also compiles the code it runs (MCP SDK, zod, ours); minifying the bundle made no
   difference. Cloudflare served every request. Decision: accept this first-run overhead and watch
   the Worker's logs for CPU-limit errors (1102); revisit if they appear.
5. The npm package keeps working as before and shares all menu, history and tool code with the
   Worker.

## 2. Decisions taken during brainstorming

| Topic | Decision |
|---|---|
| Collection | A Worker cron calls `workflow_dispatch` for the existing `collect.yml`; the collector, `data` branch and history files stay on GitHub |
| Access | Public, no login; a per-client rate limit protects the free daily quota |
| Deployment | GitHub Actions deploys on version tags after CI; the first deploy is manual |
| History on Workers | Lighter files: day files for menus, a compact `stats.json` index for statistics |
| Address | `*.workers.dev` (free; a custom domain would cost the domain) |
| Cost | Free plans only (see §1 criterion 3) |

### Why the history format changes

A synthetic year of history (365 days shaped like the real 2026-10-26 day file) is a 1.94 MB
`history.json`. On the development machine, `JSON.parse` takes 12.1 ms, zod validation 6.2 ms and a
full-history `menu_stats` query 12.3 ms: about 30 ms against a 10 ms limit, reached after roughly
three months of history. Waiting on the network does not count as CPU time; parsing and
normalising do.

## 3. Architecture

```
src/
  bin/
    stdio.ts            # npm entry (unchanged apart from the new history store)
    worker.ts           # NEW: Cloudflare Worker entry (fetch + scheduled)
  worker/               # NEW: Worker-only code, no Node APIs
    app.ts              #   createWorker({ http, now, env }) → { fetch, scheduled }
    rate-limit.ts       #   binding or per-instance fallback
    dispatch.ts         #   GitHub workflow_dispatch call
  core/                 # shared, runtime-agnostic (as before)
    cache.ts            #   CacheStore/CachedLoader become asynchronous
    history/
      stats-index.ts    #   NEW: StatsIndex type, buildStatsIndex, schema
      remote.ts         #   history store over day files + stats.json
  mcp/                  # shared tools; createServer gains options
wrangler.jsonc          # NEW
.github/workflows/deploy.yml   # NEW
```

One Worker handles two event types:

- **`fetch`**
  - `POST /mcp` (and the `GET`/`DELETE` the transport defines) is the MCP endpoint. Each
    request creates `createServer(service, { jsonSchemaValidator })` and a stateless
    `WebStandardStreamableHTTPServerTransport` (`sessionIdGenerator: undefined`), connects them,
    and returns the transport's `Response`. No sessions are stored, so any instance can answer.
  - `GET /` returns a short plain-text page: what the server is, the connector URL and a README
    link.
  - Anything else returns 404.
- **`scheduled`**: the collection trigger (§6).

The `MenuService` and its `CachedLoader` are created once per Worker instance (module level) and
reused across requests.

`createServer(service, options?)` gains an optional `jsonSchemaValidator`. The Worker passes the
SDK's `CfWorkerJsonSchemaValidator` (`@modelcontextprotocol/sdk/validation/cfworker`, needs the
`@cfworker/json-schema` package), because Workers forbid the code generation the default Ajv
validator uses. The stdio entry keeps the default.

`wrangler.jsonc` has no `nodejs_compat` flag, so a Node-only import anywhere in the Worker's
graph fails the build (§9).

## 4. History for the Worker

### 4.1 `stats.json`

The collector writes `stats.json` to the root of the `data` branch on every run, next to
`history.json`, built in memory from the same set of days (no extra file reads). Parsing is most
of a cold request's CPU, so the file is compact; it names its own orders, so it still explains
itself:

```jsonc
{
  "schema": 1,
  "generatedAt": "2026-10-26T13:28:49.398Z",
  "firstDate": "2026-10-24",
  "lastDate": "2026-10-26",
  "attribution": "…same text as history.json…",
  "restaurants": ["lut-buffet", "bistro-skinnarila", "yolo"], // order of each day's entries
  "tags": ["vegan", "vegetarian", "gluten_free", "milk_free", "lactose_free", "low_lactose"], // bit order
  // Every distinct dish once: [fi, en, diet-tag bits, search text, group]; days refer to it by index.
  "dishes": [["Lohikeitto", "Salmon soup", 20, "lohikeitto salmon soup", 0]],
  // [date, one entry per restaurant: [status] or [status, dish indexes], null when not recorded]
  "days": [["2026-10-26", [["open", [0, 4, 9]], ["no_menu"], ["error"]]]]
}
```

- A dish's identity is its `fi` name, `en` name and tags together; the same dish served on many
  days is stored once.
- `search` (the folded Finnish and English names a text query matches) and `group` (the index of
  the first dish with the same folded Finnish name, which "most common" counts as one dish) are
  computed by the collector. Folding text is the most expensive step of a query (about 4.7 ms for
  three years of dishes), so queries never do it.
- `status` is the status kind only (`open`, `no_menu`, `error`); dish indexes appear only for
  `open` and keep menu order (course order, then dish order).
- Days are sorted by date.
- `buildStatsIndex(days: HistoryDay[], generatedAt)` in `src/core/history/stats-index.ts` builds
  the in-memory `StatsIndex` (objects, readable in code) and is deterministic.
  `encodeStatsIndex` turns it into the file; `decodeStatsIndex` validates and decodes the file in
  one pass (no zod: a hand-written check is cheaper than parsing twice) and returns null when it
  is malformed.
- Measured for three years of synthetic history (1,095 days, 2,320 distinct dishes): 370 KB,
  versus 743 KB for the same index as plain objects and about 5.8 MB for `history.json`.
  Parsing, decoding and a broad query take a median of about 2.3 ms on the development machine.

### 4.2 Statistics over the index

`computeStats(index: StatsIndex, query)` replaces `computeStats(history: History, query)` and
produces exactly the same output for the same data:

- The text query and diet filter are evaluated once per distinct dish (`judgeDish` as today), not
  once per serving.
- Counting then walks the days' dish indexes only.
- The history summary (`days_recorded`, `days_missing`, `restaurant_days_unavailable`) comes from
  the index's days.

### 4.3 `HistoryStore`

```ts
interface HistoryStore {
  /** The parsed stats.json; also the list of recorded dates. */
  statsIndex(): Promise<StatsIndex>;
  /** Recorded days among `dates`; dates without a day file are absent from the map. */
  days(dates: string[]): Promise<Map<string, HistoryDay>>;
}
```

- `days()` first reads the index for the set of recorded dates, then fetches only those day files
  (`days/YYYY/MM/YYYY-MM-DD.json`) in parallel, so a missing date never causes a request.
- Both go through `CachedLoader` with the 6-hour freshness of phase 2 (keys `stats` and
  `day:YYYY-MM-DD`). Unknown schema → `HistorySchemaError`; malformed data → non-retryable
  `SourceError`, as in phase 2.
- `MenuService.loadHistory()` becomes `loadStatsIndex()`; `LiveMenuService.getDays` uses
  `days()` for past dates and for today's recorded menu (§6.3 of the phase 2 spec, unchanged in
  behaviour).
- The default location becomes the `data` branch root
  (`https://raw.githubusercontent.com/eerihyppanen/lut-lunch-mcp/data/`).
  `LUT_LUNCH_HISTORY_URL` now names that base URL; a value ending in `history.json` is accepted
  and its directory used, so existing overrides keep working.
- The npm server uses the same store, so both runtimes have one code path. `history.json` stays
  on the data branch for other consumers of the dataset; the server no longer reads it.

### 4.4 Collector and migration

- `runCollect` writes `stats.json` whenever its content (ignoring `generatedAt`) changes, from the
  same day map it uses for `history.json`.
- A missing or unreadable `stats.json` is simply rebuilt, so the first run of the new collector
  creates it from the existing days.
- This part ships first as **0.2.2**, so `stats.json` exists on the data branch before a Worker or
  npm server depends on it.

## 5. Caching, rate limiting, errors and logs

### 5.1 Caching

- `CacheStore.get/set` return promises; `CachedLoader` awaits them. Behaviour (freshness, shared
  in-flight requests, stale-on-error for a day, 60 s negative cache) is unchanged.
- stdio: the in-memory store resolves immediately.
- Worker: the same in-memory store at module level, shared by all requests an instance serves.
  A cold instance refetches what it needs (a few small requests).
- No Workers KV (free tier allows 1,000 writes a day). No Cache API for now: the documentation
  does not confirm it works on `*.workers.dev`. The asynchronous interface leaves room to add a
  shared cache later without touching the tools.

### 5.2 Rate limiting

- Key: the `CF-Connecting-IP` header. Default limit: 60 MCP requests per minute per IP (a
  conversation turn is typically 2–5 requests).
- Implementation step 1 verifies whether the Workers Rate Limiting binding (`ratelimits` in
  `wrangler.jsonc`, `simple: { limit: 60, period: 60 }`) is available on the Free plan. If it
  is, use it; otherwise an approximate per-instance counter (fixed one-minute windows, entries
  pruned as they expire) does the same job.
- Over the limit: HTTP 429 with `Retry-After: 60` and a short JSON body.
- Cloudflare's 100,000 requests/day is the outer backstop: beyond it requests fail with error
  1027 and nothing is billed.

### 5.3 Errors

- Tool and source errors behave exactly as in the npm package (shared tool code).
- An unexpected exception in the Worker becomes a JSON-RPC internal error (`-32603`) with HTTP
  500 and no stack trace in the response.
- CPU-limit errors (Cloudflare 1102) cannot be caught; the CPU budget test (§9) prevents them.

### 5.4 Logs

- Workers Logs (`observability.enabled`) on.
- One line per MCP request: method, tool name (for `tools/call`), duration, outcome.
- No IP addresses and no tool arguments are logged.

### 5.5 Limits per request

Worst case is `find_dishes` over 14 past days: up to 14 day files, `stats.json` and up to three
live sources, well under the 50-subrequest limit. `get_menu` covers at most 7 days.

## 6. Collection trigger

### 6.1 Worker `scheduled`

- Crons in `wrangler.jsonc`: `30 6 * * *`, `30 8 * * *`, `30 10 * * *` (UTC; 3 of the 5 free
  Cron Triggers).
- The handler reads `event.cron` and sends
  `POST https://api.github.com/repos/eerihyppanen/lut-lunch-mcp/actions/workflows/collect.yml/dispatches`
  with `{ "ref": "main", "inputs": { "fail_on_error": "<true only for 30 10>" } }` and headers
  `Authorization: Bearer <GITHUB_DISPATCH_TOKEN>`, `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28` and the project's User-Agent.
- GitHub answers 204. Any other status or a network error is logged with the status and the
  handler throws, so the Cloudflare dashboard shows the run as failed. No retry inside the
  handler: the next slot two hours later is the retry, and GitHub's own crons are the backup.
- The repository and workflow are constants in `src/worker/dispatch.ts`; a fork changes them
  there.

### 6.2 `collect.yml`

- `workflow_dispatch` gains an input `fail_on_error` (boolean, default `true`), so a manual run
  from the Actions tab behaves as today.
- `--fail-on-error` is added when the event is `workflow_dispatch` and the input is true, or when
  the event is the `30 10 * * *` schedule.
- GitHub's three crons stay as a backup. A late duplicate run is harmless: merges are idempotent,
  a recorded menu always wins, and an unchanged run makes no commit.

### 6.3 Token

- `GITHUB_DISPATCH_TOKEN`: a fine-grained personal access token for this repository only, with
  **Actions: read and write** and nothing else. It can start workflows; it cannot push code or
  read private data.
- Stored with `wrangler secret put GITHUB_DISPATCH_TOKEN`; never in the repository or logs.
- When it expires (GitHub emails a reminder first), dispatches fail with 401 while GitHub's crons
  keep collecting, late, and the 10:30 failure email still works. README "Maintenance" says how
  to renew it.

## 7. Deployment

- `wrangler` is a dev dependency. `wrangler.jsonc`: `name: "lut-lunch-mcp"`,
  `main: "src/bin/worker.ts"`, a fixed `compatibility_date`, the crons, the rate-limit binding (if
  available), `observability.enabled: true`, `workers_dev: true`.
- `.github/workflows/deploy.yml` on tags `v*`:
  1. The same checks as CI (lint, typecheck, tests, build).
  2. `wrangler deploy` with `CLOUDFLARE_API_TOKEN` (Workers edit permission only) and
     `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets.
  3. A live smoke test against the deployed URL: `initialize`, `tools/list` (four tools) and one
     `get_menu` call. A failure fails the job, which emails the owner.
- The first deploy is manual, together with the owner: the owner creates the Cloudflare account,
  the API token and the GitHub dispatch token and enters them; everything else is prepared in the
  repository.
- Versioning: phase 3 is **0.3.0**. npm and the Worker always run the same version;
  `serverInfo.version` shows it.

## 8. Documentation

- README:
  - "Remote server" section with the connector URL and steps for Claude (custom connector) and
    ChatGPT (developer mode connector).
  - "Maintenance" section: renewing the dispatch token, forcing a rebuild of `history.json` /
    `stats.json` (delete the file on the data branch; the next run rebuilds it), and where
    Worker logs are.
  - Roadmap updated.
- Data branch README: describes `stats.json`.
- CHANGELOG: 0.2.2 and 0.3.0 entries.
- Phase 2 spec §11 gets a pointer to this spec.

## 9. Testing

- **Asynchronous cache:** the existing `CachedLoader` tests pass unchanged in behaviour.
- **Stats index:** `buildStatsIndex` unit tests (dishes stored once, statuses kept, deterministic
  output, empty history). The existing `menu_stats` tests run against an index built from the
  fixture history with the same expected numbers.
- **History store:** fake HTTP client; only recorded dates fetched; caching; schema and malformed
  data errors; `LUT_LUNCH_HISTORY_URL` accepting a base URL or a `history.json` URL.
- **Collector:** writes `stats.json`, no rewrite when unchanged, rebuild when missing or
  unreadable.
- **Worker** (via `createWorker` with fakes, run in Vitest):
  - `initialize`, `tools/list`, a `get_menu` call over HTTP; `/` page; 404; 429 after the limit;
    500 with no stack trace on an unexpected error.
  - `scheduled`: the request body per cron slot (`fail_on_error` only at 10:30), the headers,
    and a thrown error on a non-204 answer.
- **CPU budget:** a synthetic three-year index (shaped like real day files) is parsed and queried
  with a broad `menu_stats` query; the test fails if the median exceeds 5 ms on a development
  machine (half the limit, as margin) or 10 ms on CI. Shared CI runners measured the same work
  1.5–2.4× slower than the development machine and varied between runs, so CI checks the limit
  itself. The deciding measurement is Cloudflare's own CPU time for a cold `menu_stats` request
  after the first deploy (Workers Logs).
- **Bundle check:** CI runs `wrangler deploy --dry-run`, building the real bundle without
  deploying, which catches Node-only imports in any file the Worker loads.
- **Live:** the deploy workflow's smoke test (§7); `npm run smoke` keeps checking the sources.

## 10. Build order (detailed in the implementation plan)

1. Asynchronous `CacheStore` / `CachedLoader`.
2. `StatsIndex`, `buildStatsIndex` and `computeStats` over the index.
3. New `HistoryStore`, collector writing `stats.json`, `MenuService.loadStatsIndex`; release
   **0.2.2** and let one collection write `stats.json`.
4. Worker entry, MCP over HTTP, `/` page, validator option in `createServer`.
5. Rate limiting (verify the binding on the Free plan first).
6. Collection trigger and the `collect.yml` input.
7. `wrangler.jsonc`, deploy workflow, bundle check, docs; first manual deploy; release **0.3.0**.

## 11. Out of scope

- Login or per-user features.
- A custom domain.
- Moving collection or storage off GitHub (D1, KV, R2).
- A shared cache across Worker instances (Cache API or KV); revisit if upstream load or latency
  calls for it.
