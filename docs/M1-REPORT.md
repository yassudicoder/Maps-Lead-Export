# M1 report

Scaffold, injection, Level-1 parser, side panel with live table, CSV export.

M1's gate is **three different queries × 60+ visible results each parsing at
≥95%**. Reaching 60+ results requires a human scrolling the feed, so the gate
itself is yours to sign off. What is recorded below is everything that could be
verified without automating Maps, which is a red line rather than a convenience.

## Automated results

Parser run against live Google Maps on 2026-07-31 (Chromium 1223) by loading the
real `parser-level1.js` and the shipped `config/selectors.json` into the page.
No scrolling: these are the cards Maps renders on arrival.

| Query | Cards seen | Parsed | Rate | id source | Website mix |
| --- | --- | --- | --- | --- | --- |
| plumbers in austin tx | 10 | 10 | 100% | place_id ×10 | has 10 |
| restaurants in austin tx | 7 | 7 | 100% | place_id ×7 | unknown 7 |
| taqueria in austin tx | 7 | 7 | 100% | place_id ×7 | unknown 7 |
| nail salon in austin tx | 7 | 7 | 100% | place_id ×7 | unknown 7 |
| plumbers in delhi (hl=hi, gl=IN) | 10 | 10 | 100% | place_id ×10 | has 8, none 2 |
| hardware store in marfa tx | — | — | n/a | — | no feed, see below |
| **Total** | **41** | **41** | **100%** | | |

Across all 41 rows: 0 ratings leaked into the category column, 0 private-use
glyphs leaked into any text field, 0 duplicate place ids, 0 selectors dropped as
unparsable.

All three website states were exercised on real data, including `none` on two
Delhi plumbers that render a chip row without a Website chip.

### Other checks

| Check | Result |
| --- | --- |
| Unit tests: number parsing, Unicode cleanup, CSV rules | 49 assertions, all pass |
| Extension loads unpacked, service worker registers | Pass |
| Selector map validates inside the real worker | Pass |
| Console errors or warnings, worker + panel | **None** |
| i18n coverage — untranslated nodes in the panel | 0 |
| Virtualised list: 240 rows in session | 11 row nodes in the DOM, sizer 15360px |
| CSV from real Devanagari Maps rows | BOM, CRLF, 12 columns, commas quoted, script preserved |
| Export click path: build → blob → `chrome.downloads` | Accepted, no error, toast confirms |

## Still needs a human

These are on the test matrix and cannot be checked without either a real toolbar
click, a real CAPTCHA, or scrolling Maps:

- **The ≥95% gate at 60+ results per query** — the panel's Diagnostics drawer
  shows the live figure while you scroll; that is the instrument to read
- Dense city query (120+), map pan/zoom re-collection
- CAPTCHA appearing → pause state
- 2,000-row session cap and its notice
- Panel reactivation after a hard navigation
- CSV opening cleanly in Excel **and** Google Sheets
- The download actually landing on disk (headless Chrome would not write it,
  though the API call was accepted)

## Findings worth knowing

**Review counts are absent on whole verticals.** The plumbers query returned
`aria-label="4.9 stars"` with no count at all on one run and `"4.8 stars 2,539
Reviews"` on another; restaurants always carried counts. `reviews` is therefore
nullable and exports blank, never zero. This directly constrains M2: the "fewer
than n reviews" filter has to exclude unknowns rather than treat them as the
lowest value, or it will silently recommend every business Maps was quiet about.

**Restaurant-style cards render no action chips at all.** This is what the
`unknown` state exists for, and it is not an edge case — it was 21 of 41 rows
here.

**A single-result query is not a search.** "hardware store in marfa tx"
redirected to `/maps/place/…` with no feed element. The extension handles this
safely: no feed, no rows, no false layout-change alarm, panel sits in its empty
state. It is not *helpful* yet, but M2's Level-2 work is exactly the code that
would make it so.

**An icon glyph hides in the info row.** Maps injects a Material icon ligature
(U+E934, a private-use code point) between the category and the address. It is
not whitespace, so it survives a normal trim and shifts the address into the
category column. `text.js` strips the whole private-use range; there is a
regression test for it.

**Devanagari was being shredded in filenames.** The slug helper allowed
`\p{L}` and `\p{N}` but not `\p{M}`, so the virama and anusvara in `प्लंबर`
became hyphens: `प-ल-बर`. Fixed and covered by a test.

## Deviations from the brief

**1. A non-Maps click opens the panel, not a popup.**
The brief asks for "a small popup explaining where it works". MV3 cannot have
both `action.default_popup` and `chrome.action.onClicked` — registering a popup
suppresses the click event we need in order to inject — and
`chrome.action.openPopup()` requires a popup to already be registered. Routing
through a popup first would also cost a second click before the panel could
open, because `sidePanel.open()` needs its own user gesture.

So the icon always opens the side panel, and on a non-Maps tab the panel renders
a designed "Open Google Maps to start" state with a button that opens Maps. Same
information, one surface, one click. Say the word if you want the popup back and
I will take the second click.

**2. The parse-health readout ships now rather than in M4.**
M1's own acceptance gate is a percentage, and there was no way to measure it
without building the instrument. What ships is the in-session counter and the
Diagnostics readout. M4 still owns persisting it across sessions and the remote
selector refresh.

**3. The selector-map validator ships now too.**
It is small, and having M4's remote map checked by exactly the code that already
checks the bundled map is worth more than deferring it. Nothing fetches a remote
map yet.

## Proposals

Not built. Listed here per the originality budget rather than added to M1.

1. **Phone numbers are already on the card.** Service-business cards render the
   phone in the second info row (`+1 512-601-6173`). The brief assigns phone to
   Level 2, so it is not collected — but it is free, needs no place-opening, and
   phone-without-a-click is a real advantage over the incumbent. Worth
   reconsidering the L1/L2 split for this one field.
2. **The website URL is also free at Level 1.** The chip's `href` is the actual
   business site. M1 records presence only, as specified.
3. **Social-only websites are a pitch angle.** One Austin plumber's Website chip
   pointed at `m.facebook.com`. "Has a Facebook page instead of a website" is
   arguably a better lead than "no website" and is one hostname check away.
4. **Coordinates come free in the href.** `!3d`/`!4d` are parsed already as an id
   fallback; they are not exported.
5. **Expose "unknown" as a first-class filter in M2**, not just a value — "show
   me the ones I still need to check" is a real workflow, and it is the honest
   counterpart to the no-website filter.
6. **Sponsored results are not distinguished.** None appeared in sampling. If
   they matter for lead quality, a flag column would be cheap.

## Known limits

- One session is shared across Maps tabs. Two Maps tabs collect into the same
  list, deduped by place id.
- Rows are persisted on a 1.2s debounce. If the service worker is killed at the
  wrong moment, the last second of scrolling can be lost. Rows already written
  are safe.
- The `has` fallback for unsampled locales matches an off-Google chip href, which
  can over-report `has`. That direction is deliberate: over-reporting costs a
  missed lead, under-reporting puts a business that has a website onto a
  no-website pitch list.
