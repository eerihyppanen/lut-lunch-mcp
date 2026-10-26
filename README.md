# LUT Lunch MCP

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants answer questions about lunch at
LUT University's Skinnarila campus in Lappeenranta: what's on today, where to find something vegan or
gluten-free, whether a dish shows up this week, and how often it has been served before.

It reads the public menus of **LUT Buffet**, **Bistro Skinnarila** and **Yolo**, normalizes their
diet and allergen labels, and explains why a restaurant has no menu (weekend, public holiday, not
published yet, source unavailable) instead of returning an empty list.

```
You:    Any vegan options on campus tomorrow?
Claude: Tomorrow is Saturday, so LUT Buffet and Bistro Skinnarila are closed. Yolo is open and
        has one vegan dish: Vegetable tikka masala (gluten-free; contains celery).
```

## Remote server (no install)

The same server runs on Cloudflare Workers. Add it as a connector, with no authentication:

```
https://lut-lunch-mcp.eerihyppanen-lut-lunch-mcp.workers.dev/mcp
```

- **Claude** (claude.ai or the desktop app): Settings → Connectors → Add custom connector, paste the
  URL.
- **ChatGPT**: Settings → Apps & Connectors → Advanced settings → enable developer mode, then
  create a connector with the URL and no authentication.

It allows 60 requests per minute per client, which a conversation never comes close to.

## Install

To run the server locally instead, you need Node.js 22 or newer. It runs over stdio; nothing to
configure, no API keys.

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "lut-lunch": {
      "command": "npx",
      "args": ["-y", "@eerihyppanen/lut-lunch-mcp"]
    }
  }
}
```

On Windows, if the server doesn't start, use `"command": "cmd"` with
`"args": ["/c", "npx", "-y", "@eerihyppanen/lut-lunch-mcp"]`.

### Claude Code

```bash
claude mcp add lut-lunch -- npx -y @eerihyppanen/lut-lunch-mcp
```

### Cursor

Add the same block as for Claude Desktop to `.cursor/mcp.json` in your project, or to
`~/.cursor/mcp.json` for all projects.

ChatGPT only supports remote servers; use the [remote server](#remote-server-no-install).

## Example questions

- "What's for lunch at LUT today?"
- "Any vegan options on campus this week?"
- "Which restaurant has something gluten-free tomorrow?"
- "Is there salmon anywhere this week?"
- "I'm allergic to egg. What can I eat at LUT Buffet today?"
- "Where's Yolo and when is it open?"
- "How often has salmon been served?"
- "What was on at LUT Buffet last Tuesday?"
- "What's the most common soup on campus?"

## Tools

| Tool               | Use it for                                                           | Main inputs                                                                                                              |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `get_menu`         | Full menus for a day or up to 7 consecutive days, past days included | `date` (`today`, `tomorrow` or `YYYY-MM-DD`), `days`, `restaurants`, `diet`, `exclude_allergens`, `language` (`en`/`fi`) |
| `find_dishes`      | Searching dishes across days and restaurants, past days included     | `query` (English or Finnish), `diet`, `exclude_allergens`, `from`, `to` (≤ 14 days), `restaurants`, `limit`              |
| `menu_stats`       | How often and when dishes were served, trends, most common dishes    | `query`, `diet`, `restaurants`, `from`, `to`, `group_by` (`restaurant`/`month`/`weekday`/`none`), `top`, `language`      |
| `list_restaurants` | Ids, addresses, usual lunch hours, data coverage                     | none                                                                                                                     |

Every result has structured content (validated against an output schema) and a compact text version
for clients that only show text.

- **Restaurant ids:** `lut-buffet`, `bistro-skinnarila`, `yolo`.
- **Diet tags:** `vegan`, `vegetarian`, `gluten_free`, `milk_free`, `lactose_free`, `low_lactose`.
- **Allergens:** the EU's 14 (`gluten`, `milk`, `egg`, `fish`, `crustaceans`, `molluscs`, `peanuts`,
  `nuts`, `soy`, `celery`, `mustard`, `sesame`, `sulphites`, `lupin`).

Each restaurant in a `get_menu` result has a `status` (`open`, `no_menu`, `error`) and, when it isn't
open, a `reason`: `weekend`, `public_holiday` (with its name), `none_listed`, `not_published_yet`,
`history_not_available`, `source_unavailable` (temporary outage; try again later), `source_error`
(the source answered with data the server couldn't read, e.g. after a site redesign) or
`history_unavailable` (the recorded history needed for a past day could not be loaded).
`find_dishes` lists those days in `days_without_data`, so "no matches" and "no data" are never
confused.

## Data sources and credits

| Restaurant        | Operator                                                                                                                             | Source                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| LUT Buffet        | [Kampusravintolat](https://www.kampusravintolat.fi/)                                                                                 | Poweresta public menu API |
| Bistro Skinnarila | [Compass Group / Food & Co](https://www.compass-group.fi/ravintolat-ja-ruokalistat/foodco/kaupungit/lappeenranta/bistro-skinnarila/) | Compass menu API          |
| Yolo              | [Aalef](https://www.aalef.fi/)                                                                                                       | The restaurant's web page |

All menus belong to their operators; every result links back to the source.

> **Allergen disclaimer.** Diet and allergen labels come from the restaurants and can change. People
> with allergies should confirm at the restaurant. The server repeats this whenever diet or allergen
> filters are used.

## History

The restaurants' sites only show current and upcoming menus, so history has to be recorded as it
happens. A [GitHub Actions workflow](.github/workflows/collect.yml) fetches every restaurant's menu
each morning (with two retries later in the morning) and commits it to the
[`data` branch](https://github.com/eerihyppanen/lut-lunch-mcp/tree/data): one JSON file per day, a
combined `history.json` for anyone who wants the whole dataset, and `stats.json`, a compact index
of every dish served. GitHub sometimes skips scheduled runs, so each run also fills in menus
missing from earlier days of the same week. The server reads the day files it needs and
`stats.json` when it is first asked about the past (at most every 6 hours) and answers
past-day, "how often" and "when last" questions from them.

History starts on 2026-10-24, the first day the collector ran; every `menu_stats` result states the period it
covers. Only what the server needs is stored (names, prices, diet labels, allergens), with
attribution to each restaurant. Set `LUT_LUNCH_HISTORY_URL` to the base URL of another data branch, e.g. a
fork's (`https://raw.githubusercontent.com/<owner>/lut-lunch-mcp/data/`); a URL ending in
`history.json`, as used before 0.2.2, still works.

## Design decisions

**Tools designed for an AI caller, not mirrored from the sources.** Four tools match the questions people ask: browse (`get_menu`), search (`find_dishes`), count (`menu_stats`) and look up (`list_restaurants`). Which
source a restaurant uses is an implementation detail the model never needs. Tool descriptions say
when to use which tool and when to try the Finnish word.

**Every empty answer has a reason.** Sources return empty lists for weekends, holidays, unpublished
weeks and outages alike. The server works out which one it is (checked in order: dishes → error →
not covered by the source → Finnish public holiday → weekend → nothing listed) so the model can say
"closed for All Saints' Day" instead of guessing.

**The server resolves dates.** Models often don't know today's date. Tools accept `today` and
`tomorrow`, resolve them in Europe/Helsinki time, and always echo the resolved date and weekday.
Invalid dates get an error that says which forms are accepted.

**Unknown is never safe.** Allergen data differs by source: LUT Buffet publishes full lists for most
dishes, Yolo marks five allergens on some dishes, Bistro only labels gluten-free and milk-free. Each
dish records which allergens its source actually assessed. A Yolo marker proves an allergen is
present, but a missing marker proves nothing (its "Tuna and eggs" salad carries no egg marker), and an
allergen name the server doesn't recognise makes that dish's list count as incomplete. When
excluding, say, egg, a dish without reliable egg data is left out and counted as `unverifiable`,
never shown as egg-free. Gluten and milk are decided by the gluten-free/milk-free labels every source
has (so gluten-free oats pass even though oats appear in the allergen list). That also means a dish
labelled gluten-free passes a gluten filter when its list says it _may contain_ wheat or other gluten
cereals; the "may contain" warning is still shown with the dish, so people with coeliac disease
should look for it.

**History is collected once, centrally.** A local server could only record the days its own user
happened to ask about, so one scheduled collector writes a shared, public dataset instead. It reuses
the server's own fetching code, never overwrites a recorded menu with a later failure, and only
commits when something changed. Plain JSON on a branch was enough: no database, no hosting, no keys.

**Polite to the sources.** Each source is fetched a whole week per request, cached for 30 minutes,
and concurrent requests share one fetch. If a source fails, the last good copy is served (marked
`stale`) for up to a day, and the source isn't retried for a minute. Dates far in the future are answered without any request, and past dates come from the recorded history. Requests identify the project in their User-Agent.

**Ported, not imported, from Campus Food.** The menu logic started in my
[Campus Food](https://github.com/eerihyppanen/campus-food) web app, but it was tied to Next.js
caching and a UI-shaped data model. Here it lives in a framework-free `src/core/` that only uses
`fetch` (ready for Cloudflare Workers) and switches Bistro from HTML scraping to the JSON API the
restaurant page itself uses.

**TypeScript.** The official MCP SDK is first-class in TypeScript, and the same core can run as an
npm package now and on Cloudflare Workers later.

## Development

```bash
npm install
npm test            # unit and end-to-end tests against captured menus (offline)
npm run inspect     # open the server in MCP Inspector
npm run smoke       # check the live sources still parse (about 8 requests)
npm run collect -- --data-dir <folder>   # record today's menus into a local history folder
npm run worker:dev  # run the Worker locally at http://127.0.0.1:8787/mcp
npm run smoke:remote -- <url of /mcp>    # check a running remote server like a client would
npm run lint && npm run typecheck && npm run build && npm run worker:check
```

Tests run against real menus captured on 2026-10-23 (`test/fixtures/`), so they are deterministic and
make no network requests. The smoke check runs weekly in GitHub Actions to catch upstream changes.

To try a local build in a client, point it at `node /absolute/path/to/dist/bin/stdio.js` instead of
`npx`.

Layout: `src/core/` (sources, normalization, calendar, cache, menu service; no Node or MCP imports),
`src/mcp/` (tools, schemas, formatting), `src/worker/` (remote server: HTTP, rate limit, collection
trigger; no Node imports), `src/bin/stdio.ts` and `src/bin/worker.ts` (entry points). Design notes are in
[`docs/specs/`](docs/specs/); changes per release are in [CHANGELOG.md](CHANGELOG.md).

Releasing (from an up-to-date `main`):

```bash
npm version patch         # bumps package.json and src/version.ts, commits and tags
git push --follow-tags
npm publish               # runs lint, typecheck, tests and build first; asks for npm 2FA
```

The tag also deploys the Worker (`.github/workflows/deploy.yml`) and smoke-tests the deployed
server.

## Maintenance

- **Collection trigger token.** The Worker starts the daily collection with a fine-grained GitHub
  token (this repository only, Actions: read and write). GitHub emails before it expires; create a
  new one and store it with `npx wrangler secret put GITHUB_DISPATCH_TOKEN`. Until then GitHub's
  own schedule keeps collecting, hours late.
- **Deploy secrets.** `deploy.yml` needs the repository secrets `CLOUDFLARE_API_TOKEN` (template
  "Edit Cloudflare Workers") and `CLOUDFLARE_ACCOUNT_ID`, and the variable `WORKER_URL` (the
  deployed `/mcp` URL).
- **Rebuilding the history files.** After editing day files on the `data` branch by hand, delete
  `history.json` and `stats.json` there; the next collection rebuilds both from the day files.
- **Logs.** The Worker logs one line per request (method, tool, duration, status; no IP addresses
  or arguments) and each collection trigger. They are in the Cloudflare dashboard under the
  Worker's Observability tab.

## Limitations

- Skinnarila campus only.
- History starts when collection started; earlier menus can't be recovered from the sources.
- `menu_stats` treats dishes with the same name as the same dish; slightly different names count
  separately (searching a word like "lohi" still finds all of them).
- Yolo is scraped from its web page; a redesign breaks it until the parser is updated.
- Yolo publishes about four serving days ahead and no per-course prices.
- "Vegetarian" is inferred from course names (no source has a vegetarian label).
- Lunch hours in `list_restaurants` are the usual hours and can change; check the menu link.
- The remote server runs on Cloudflare's free plan. The first request a new Worker instance
  serves takes slightly more CPU than the plan's 10 ms budget (later ones about 2 ms);
  Cloudflare has served them all so far, and the logs are watched for limit errors.
- Gluten filtering trusts the restaurant's gluten-free label, even over a "may contain" note (see
  [Design decisions](#design-decisions)).

## Roadmap

1. **Phase 1:** local stdio server on npm.
2. **Phase 2:** daily history collection and `menu_stats` for "how often" and trend questions.
3. **Phase 3 (this release):** remote MCP server on Cloudflare Workers, so it can be added as a
   connector without installing anything (including in ChatGPT), and a collection trigger that
   starts on time.

## License

[MIT](LICENSE)
