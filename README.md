# LUT Lunch menu history (data branch)

This branch holds the daily lunch menu history used by
[lut-lunch-mcp](https://github.com/eerihyppanen/lut-lunch-mcp). It is written automatically by
the `Collect history` GitHub Actions workflow on `main`; nothing here is edited by hand.

## Contents

| Path | What it is |
|---|---|
| `days/YYYY/MM/YYYY-MM-DD.json` | One file per day: every restaurant's menu, or why it had none (weekend, holiday, failed collection). The source of truth. |
| `history.json` | All days combined, regenerated on every run. This is what the MCP server downloads. |

Both files carry `"schema": 1`. The format is described in
[the phase 2 design](https://github.com/eerihyppanen/lut-lunch-mcp/blob/main/docs/specs/2026-10-24-phase-2-history-design.md#4-data-format).

## Sources and attribution

Menus by [Kampusravintolat](https://www.kampusravintolat.fi/) (LUT Buffet),
[Compass Group / Food & Co](https://www.compass-group.fi/ravintolat-ja-ruokalistat/foodco/kaupungit/lappeenranta/bistro-skinnarila/)
(Bistro Skinnarila) and [Aalef](https://www.aalef.fi/) (Yolo); collected by lut-lunch-mcp.
Only what the server needs is stored: dish and course names, prices, diet labels and allergens.

Diet and allergen labels come from the restaurants and can change. People with allergies should
confirm at the restaurant.

History starts on the first day the collector ran; the restaurants' own sites do not publish past
menus.
