# M2 report — Level-2 enrichment

Triggered by two real exports (15 Mumbai cafes, 10 Mumbai gyms) in which
`website_status` was `unknown` on all 25 rows.

## What the exports showed

| | cafes (15) | gyms (10) |
| --- | --- | --- |
| `website_status=unknown` | 15 / 15 | 10 / 10 |
| phone | no column | no column |
| address containing a postcode | 0 | 0 |
| rows outside the searched area | 1 | 2 |

Gyms are the important half. The no-chip card layout is not a restaurant quirk —
it covers the consumer verticals a local-SEO freelancer actually prospects, so
the "no website" filter was returning nothing usable at Level 1. Only trade
verticals (plumbers, electricians) expose the chip row.

Address quality was worse than M1 credited: `Aarogya Gym` had an empty address,
`Powerzone Gym` echoed the business name, `Get Set Fit` gave "2nd floor, 213",
and `cafe shah` gave a landmark. The card address line is a fragment by design.

**The encoding is not a defect.** The file begins `EF BB BF` and is valid UTF-8.
Decoding those exact bytes as cp1252 reproduces the reported `CafÃ©` and
`peopleâs` precisely, so the mojibake comes from opening the file through
Excel's Data → From Text wizard or a text editor set to ANSI. Double-clicking
the file honours the BOM.

## M1 defects fixed first

Each of these was already shipped, and the first two would have made M2 fail
silently rather than loudly.

1. **`extractPlaceId` kept only one identifier.** A place detail URL carries
   `!1s` (ftid) and `!16s` (mid) but **no `!19s`**, so a row keyed on place_id
   could never be matched to the pane the user opened. Now
   `extractIdentifiers` retains every id as an alias and the store resolves
   through an alias index. Verified live: Cafe Sentiments' detail URL yields
   `[ftid, mid]` with no place_id at all, and still matches its row.
2. **`addRows` replaced rows wholesale.** Level-2 fields would have been wiped
   by the next Level-1 rescan, milliseconds later, as the user kept scrolling.
   `mergeLevel1` now refuses to overwrite any field whose provenance is
   `detail`. This is the single most important line of M2 and has a dedicated
   regression test.
3. **`startRecheck` leaked a `setInterval` per toolbar re-click** — INIT arrives
   again on every re-click and nothing cleared the old timer.
4. **`reannounce` cleared the collector's paused flag but not the worker's**, so
   the panel could read "Paused" while actively collecting.
5. **The CSV formula guard vs phone numbers.** Reviewed and deliberately left
   as-is: quoting does not exempt a field from evaluation in Excel, so a bare
   `+91 …` renders `#NAME?`. The apostrophe stays and is documented.

## How enrichment works

The collector notices the tab's URL has become a `/maps/place/` URL and reads
the pane the user opened. It never opens one — see the red-line section below.

The pane anchors on `data-item-id`, a code value rather than display text, so it
holds across locales:

| Attribute | Field |
| --- | --- |
| `[data-item-id="authority"]` | website URL |
| `[data-item-id^="phone:tel:"]` | phone, read from the attribute itself |
| `[data-item-id="address"]` | full address |
| `[data-item-id="oloc"]` | plus code |

`website=none` is only asserted once the pane has hydrated **and** at least one
other info item has rendered. A half-rendered pane also has no website link, and
calling that `none` would be exactly the false negative the tri-state exists to
prevent. Address alone is not a usable hydration signal: service-area businesses
legitimately have none.

## Correction (2026-07-31)

**The verification below was flow-invalid and the feature failed in the field.**
It was produced with `page.goto(placeURL)` — a hard load — against a session
created seconds earlier by the current code. Yash reaches a place by clicking a
card, which is a pushState SPA navigation, and his session predates M2.

Rows written by M1 carry no `ftid`/`mid`, so they matched no detail pane and
enrichment silently did nothing. Cause, fix and the instrumentation added are in
[VERIFICATION.md](VERIFICATION.md). The parser results below are still accurate
for what they measured; they simply did not measure the thing that mattered.

## Verified (hard load, en-US — see correction above)

Level-2 parser run against live Maps on the user's own three places:

| Place | website | phone | full address |
| --- | --- | --- | --- |
| Love & Latte Malad | `has` → lovenlatte.com | 07208935965 | …Mumbai, Maharashtra 400064 |
| Cafe Sentiments | `none`, proven | 09967797857 | …Mumbai, Maharashtra 400064 |
| Aarogya Gym (empty at L1) | `none`, proven | — | Malad, Navy Colony, … 400064 |

Every full address carries a postcode; not one of the 25 Level-1 rows did.

Other checks: 76 unit assertions pass, including the rescan-does-not-clobber
regression and the alias-matching path. Extension loads unpacked, selector map
with the new `detail` section validates inside the real worker, panel renders
240 rows in 9 DOM nodes, **zero console errors**, 0 untranslated strings.

## Row-click enrichment (E1 approved, implemented)

Yash resolved E1 on 2026-07-31: synthetic activation of the result card's
existing link is approved, `chrome.tabs.update` is rejected, and an unrendered
card must produce a hint rather than a scroll. Red line 2 is amended in
[RED-LINES.md](RED-LINES.md).

Clicking a row in the panel now relays that one gesture to the matching card's
link. Measured: the document survives (so the collector and the activeTab grant
persist) and the pane renders by ~3s. The three constraints — fresh gesture,
one in flight, rendered cards only — are enforced in `relayOpen` and covered by
`test/collector-lifecycle.js`.

Refusals are visible rather than silent: "isn't on screen in Maps", "still
reading the last place", "that click expired". Success is announced by the row
filling in, which is the point.

## `enriched_at`

Added per the gate ruling. ISO, populated only on rows the detail pane has been
read for, blank on Level-1 rows. 18 columns now. It separates "seen in a list"
from "confirmed at source" and dates the confirmation, so a list that has been
sitting for a month can be re-checked selectively.

## Red lines

Red lines 7 and 8 were added mid-build and are recorded in
[RED-LINES.md](RED-LINES.md).

Escalation **E1 is open and awaiting Yash**: a 1:1 row-click navigation can be a
`chrome.tabs.update()` to the place URL, which is cross-document and destroys
the activeTab grant — forcing a toolbar re-click per place — or an activation of
the result card's existing link, which is an SPA navigation that keeps the
session alive but is a synthetic click on a place, which red line 2 forbids.

Per red line 7 this was **not** self-adjudicated. Work proceeded on the most
conservative reading: **the extension initiates no navigation at all.** The
retry ladder in the collector waits for a pane the user opened to hydrate, stops
at the first successful read, and re-checks on every attempt that the URL is
still the one the user opened. There is no code path that opens a place or moves
to the next one.

If E1 is answered in favour of link activation, row-click enrichment is a small
addition on top; nothing built here has to be unwound either way.

## Still needs a human

- Opening places in a real browser and watching rows fill in
- CSV opening cleanly in Excel **and** Google Sheets with the 17-column layout
- The ≥95% Level-1 parse gate at 60+ results (carried over from M1)
- Whether the resolve banner's wording reads right after using it for an hour

## Proposals

Not built.

1. **Out-of-area rows.** "gym in malad" returned a Bandra gym ~13 km away.
   Coordinates are already parsed as an id fallback and could drive a distance
   column or filter, but neither is in the specified filter set.
2. **Price range and service options** are on the cafe card and dropped.
3. **`Cafe Emearald` exported "…Hanuman MandirNew"** — a suspected missing space
   from `textContent` joining sibling elements. Not yet reproduced; worth a
   look before M3.
4. **Social-only websites** — a Website chip pointing at facebook.com is a
   better lead than "no website", and is one hostname check away.
5. **Re-export merge.** The file is a one-shot dump; a freelancer maintaining a
   list would want the export to reconcile with the previous one.
