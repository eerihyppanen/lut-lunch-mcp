# LUT Lunch MCP

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants answer questions about lunch at
LUT University's Skinnarila campus in Lappeenranta: what's on today, where to find something vegan or
gluten-free, and whether a dish shows up this week.

It reads the public menus of **LUT Buffet**, **Bistro Skinnarila** and **Yolo**, normalizes their
diet and allergen labels, and explains why a restaurant has no menu (weekend, public holiday, not
published yet, source unavailable) instead of returning an empty list.

```
You:    Any vegan options on campus tomorrow?
Claude: Tomorrow is Saturday, so LUT Buffet and Bistro Skinnarila are closed. Yolo is open and
        has one vegan dish: Vegetable tikka masala (gluten-free; contains celery).
```

## Install

Requires Node.js 22 or newer. The server runs locally over stdio; nothing to configure, no API keys.

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

ChatGPT needs a remote server; that is planned for phase 3 (see [Roadmap](#roadmap)).

## Example questions

- "What's for lunch at LUT today?"
- "Any vegan options on campus this week?"
- "Which restaurant has something gluten-free tomorrow?"
- "Is there salmon anywhere this week?"
- "I'm allergic to egg. What can I eat at LUT Buffet today?"
- "Where's Yolo and when is it open?"

## Tools

| Tool               | Use it for                                       | Main inputs                                                                                                              |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `get_menu`         | Full menus for a day or up to 7 consecutive days | `date` (`today`, `tomorrow` or `YYYY-MM-DD`), `days`, `restaurants`, `diet`, `exclude_allergens`, `language` (`en`/`fi`) |
| `find_dishes`      | Searching dishes across days and restaurants     | `query` (English or Finnish), `diet`, `exclude_allergens`, `from`, `to` (≤ 14 days), `restaurants`, `limit`              |
| `list_restaurants` | Ids, addresses, usual lunch hours, data coverage | none                                                                                                                     |

Every result has structured content (validated against an output schema) and a compact text version
for clients that only show text.

- **Restaurant ids:** `lut-buffet`, `bistro-skinnarila`, `yolo`.
- **Diet tags:** `vegan`, `vegetarian`, `gluten_free`, `milk_free`, `lactose_free`, `low_lactose`.
- **Allergens:** the EU's 14 (`gluten`, `milk`, `egg`, `fish`, `crustaceans`, `molluscs`, `peanuts`,
  `nuts`, `soy`, `celery`, `mustard`, `sesame`, `sulphites`, `lupin`).

Each restaurant in a `get_menu` result has a `status` (`open`, `no_menu`, `error`) and, when it isn't
open, a `reason`: `weekend`, `public_holiday` (with its name), `none_listed`, `not_published_yet`,
`history_not_available`, `source_unavailable` (temporary outage; try again later) or `source_error`
(the source answered with data the server couldn't read, e.g. after a site redesign).
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

## Design decisions

**Tools designed for an AI caller, not mirrored from the sources.** Three tools match the questions
people ask: browse (`get_menu`), search (`find_dishes`) and look up (`list_restaurants`). Which
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

**Polite to the sources.** Each source is fetched a whole week per request, cached for 30 minutes,
and concurrent requests share one fetch. If a source fails, the last good copy is served (marked
`stale`) for up to a day, and the source isn't retried for a minute. Dates far in the past or future
are answered without any request. Requests identify the project in their User-Agent.

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
npm run lint && npm run typecheck && npm run build
```

Tests run against real menus captured on 2026-10-23 (`test/fixtures/`), so they are deterministic and
make no network requests. The smoke check runs weekly in GitHub Actions to catch upstream changes.

To try a local build in a client, point it at `node /absolute/path/to/dist/bin/stdio.js` instead of
`npx`.

Layout: `src/core/` (sources, normalization, calendar, cache, menu service; no Node or MCP imports),
`src/mcp/` (tools, schemas, formatting), `src/bin/stdio.ts` (entry point). Design notes are in
[`docs/specs/`](docs/specs/); changes per release are in [CHANGELOG.md](CHANGELOG.md).

Releasing (from an up-to-date `main`):

```bash
npm version patch         # bumps package.json and src/version.ts, commits and tags
git push --follow-tags
npm publish               # runs lint, typecheck, tests and build first; asks for npm 2FA
```

## Limitations

- Skinnarila campus only, and only menus that are currently published (no history yet).
- Yolo is scraped from its web page; a redesign breaks it until the parser is updated.
- Yolo publishes about four serving days ahead and no per-course prices.
- "Vegetarian" is inferred from course names (no source has a vegetarian label).
- Lunch hours in `list_restaurants` are the usual hours and can change; check the menu link.
- Gluten filtering trusts the restaurant's gluten-free label, even over a "may contain" note (see
  [Design decisions](#design-decisions)).

## Roadmap

1. **Phase 1 (this release):** local stdio server on npm.
2. **Phase 2:** store each day's menu to answer "how often is salmon served?"-style questions.
3. **Phase 3:** remote MCP server on Cloudflare Workers, so it can be added as a connector without
   installing anything (including in ChatGPT).

## License

[MIT](LICENSE)
