# Maps Lead Export by TheOpenBox

A Chrome side panel that turns the Google Maps results you are already looking
at into a clean CSV lead list. Built for local-SEO freelancers and agencies
prospecting local businesses.

**Export what you see.** The panel collects the listings Google Maps has
rendered in your own tab while you browse. It never runs in the background,
never automates the page, and never sends your data anywhere.

Status: **M1** — scaffold, injection, Level-1 parser, live panel, CSV export.
See [docs/M1-REPORT.md](docs/M1-REPORT.md) for test results, deviations and
proposals.

## The promises, and how the code keeps them

| Promise | Where it is enforced |
| --- | --- |
| Reads only what Maps already rendered | [parser-level1.js](src/content/parser-level1.js) reads the DOM; there is no `fetch` to any Maps endpoint anywhere in the codebase |
| No background collection | Zero `host_permissions` and no `content_scripts` block. The only injection path is a toolbar click, which grants `activeTab` for that one tab |
| No programmatic scrolling or pagination | The collector observes; it never calls `scrollTo`, `scrollIntoView` or `click`. [collector.js](src/content/collector.js) reacts to the user's own scrolling |
| No CAPTCHA interaction | On detecting a challenge the collector detaches its observers and the panel asks the user to solve it themselves |
| No email harvesting, no third-party sites | Not implemented, not stubbed, not flagged |
| Data stays local | Rows live in `chrome.storage.local` and leave only as a file the user downloads |
| Honest data | A field Maps did not show is `null`, never a guess. Website presence is tri-state |
| Red-line calls are never self-adjudicated | An ambiguous call escalates to Yash. If the reviewer is unavailable, work proceeds on the most conservative reading — a blocked reviewer never defaults to approved |
| Enrichment is 1:1 with a user gesture | One gesture, one navigation, gated on the previous detail pane finishing. No batch, no queue, no timer-driven advancement in any form |

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open Google Maps, search for something, click the toolbar icon

Clicking the icon opens the panel and activates collection for that tab. Maps is
a single-page app, so one click covers the whole session; a full page reload
drops the grant and the panel asks for another click.

## How it fits together

```
toolbar click ──> service worker ──> chrome.scripting.executeScript (activeTab)
                       │                        │
                       │                        v
                       │                 collector.js  (observes the feed)
                       │                        │  parsed rows, health
                       │  <─────────────────────┘
                       │
                  session store  (dedupe by place id, cap 2,000, persist)
                       │  snapshot + deltas
                       v
                  side panel  (virtualised list, CSV export)
```

The service worker owns the selector map and hands it to the collector over the
port. That keeps `config/selectors.json` out of `web_accessible_resources`,
which would otherwise need a URL pattern we deliberately do not have.

| Path | What it does |
| --- | --- |
| [manifest.json](manifest.json) | MV3, five permissions, zero host permissions |
| [config/selectors.json](config/selectors.json) | Selector map — pure data, schema-versioned |
| [src/common/constants.js](src/common/constants.js) | Shared constants, message names, Maps URL test |
| [src/common/text.js](src/common/text.js) | Unicode cleanup and locale-aware number parsing |
| [src/common/csv.js](src/common/csv.js) | RFC 4180 CSV, UTF-8 BOM, formula-injection guard |
| [src/common/selector-schema.js](src/common/selector-schema.js) | Strict validation of the selector map |
| [src/common/entitlements.js](src/common/entitlements.js) | Free/Pro scaffold — `BETA_ALL_FREE = true`, nothing gated yet |
| [src/background/service-worker.js](src/background/service-worker.js) | Injection, ports, state machine |
| [src/background/session-store.js](src/background/session-store.js) | Dedupe, cap, persistence |
| [src/content/parser-level1.js](src/content/parser-level1.js) | Result-card parser |
| [src/content/collector.js](src/content/collector.js) | Observers, CAPTCHA watch, batching |
| [src/panel/](src/panel/) | Side panel UI and windowed list |
| [tools/make-icons.ps1](tools/make-icons.ps1) | Regenerates the icon set |

## Parsing, and why it is built this way

Google rotates its CSS class names. Every selector is therefore anchored on
structure and ARIA first, with class names only as later fallbacks:

- cards are `div[role="article"]` inside `div[role="feed"]`
- the name is the place link's `aria-label`
- rating and review count come from one `aria-label` such as `4.4 stars 677
  Reviews`. Numbers keep their order across locales, so the parser reads them by
  position rather than matching English words — that is what makes the hi-IN
  string `4.9 स्टार 85 समीक्षाएं` parse correctly
- the place id is the `!19s` segment of the href, the canonical `ChIJ…` Place ID,
  with the `!1s` feature id, `!16s` mid and coordinates as fallbacks. Every row
  records which one it got in `id_source`

### Website presence is tri-state

This is the part that matters most, and the part naive extractors get wrong.

| Value | Meaning |
| --- | --- |
| `has` | The card renders a Website chip |
| `none` | The card renders an action-chip row, and no Website chip is in it |
| `unknown` | The card renders no chip row at all, so absence proves nothing |

Restaurant cards carry no chip row. An extractor that reads "no chip" as "no
website" reports every restaurant in a city as a no-website lead. This one says
it does not know and asks you to open the place — Level 2 in M2 resolves it.

### Parse health

Every scan reports how many visible cards produced a usable row. If fewer than
half parse across two consecutive scans, collection stops and the panel says the
layout moved rather than quietly filling your sheet with rubbish. The live figure
sits under **Diagnostics** in the panel footer.

## CSV

RFC 4180 with CRLF, UTF-8 with a BOM so Excel opens non-Latin names correctly,
and a formula-injection guard: a value starting `=`, `+`, `-`, `@` or a control
character is prefixed with an apostrophe unless it is a plain number. Filename is
`maps-leads-{query}-{yyyy-mm-dd}.csv`.

Columns: `name, category, rating, reviews, phone, website_status, website_url,
website_source, address_line, full_address, plus_code, place_url, place_id,
id_source, source_query, collected_at, data_level`.

Empty means Maps did not show it. `reviews` in particular is blank rather than
zero when the card omitted the count, which happens on whole verticals.

`website_source` is the column that makes the rest trustworthy: `card` means the
status was inferred from the results list, `detail` means it was proven on the
place's own page. A `none` from a card is an inference; a `none` from a detail
pane is a fact. Sort by it before you pitch.

International phone numbers carry a leading apostrophe. That is deliberate:
Excel evaluates a cell starting `+` as a formula and renders `#NAME?`, and CSV
quoting does not exempt it. Indian numbers as Maps returns them (`072089 35965`)
start with a digit and are untouched.

## Diagnosing a problem

Open **Diagnostics** at the foot of the panel. It shows live parse health, and
**Copy diagnostics** puts a self-contained report on your clipboard: the last
200 events in the collect → match → enrich chain, plus the extension version and
UI locale. It stays local — nothing is transmitted, and it holds identifiers and
counts rather than row content.

Each row also carries an enrichment chip once enrichment has started:
`not opened`, `confirmed`, or `partial` with the fields the place page did not
show.

Verification claims about this codebase follow [VERIFICATION.md](docs/VERIFICATION.md):
they name the pushed commit, the flow (SPA click vs hard load) and the locale,
and milestone gates come from Yash's machine.

## Conventions

Vanilla JS, no build step, no frameworks, no vendored libraries. Every file is an
IIFE attaching to a single `MLE` namespace, loaded as classic scripts
(`importScripts` in the worker, `<script>` in the panel, `executeScript` files in
the tab). All user-facing strings go through `chrome.i18n`; `_locales/en` is
complete and is the template for further locales.

## Not in M1

Level-2 enrichment, filters, saved presets, cross-session "already exported"
tracking, the column picker, clipboard export, remote selector refresh, the
options and welcome pages, and analytics. Free-tier caps are scaffolded but not
enforced — `BETA_ALL_FREE` is `true`.
