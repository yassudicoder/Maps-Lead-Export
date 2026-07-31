# The defensible-zone contract

Violating any of these is a failed build, regardless of how good the feature is.
This file is the authority; the README table is a summary of it.

1. **DOM-read only, user-driven.** The extension collects ONLY what Google Maps
   has rendered in the user's own tab while they browse. No background tabs, no
   offscreen documents touching Maps, no `fetch()` to any Maps endpoint, no
   headless anything.

2. **No programmatic scrolling or pagination.** The panel collects passively as
   the human scrolls. No auto-click on places, no "collect all results"
   automation.

3. **No CAPTCHA interaction.** If Maps shows one, the panel pauses collection
   and tells the user to slow down and solve it themselves.

4. **No email harvesting and no visiting third-party sites.** Out of scope by
   design — do not build it even behind a flag.

5. **Data stays local.** Rows live in `chrome.storage.local` and export to the
   user's disk. Extracted content never leaves the machine; analytics (opt-in,
   off by default) may send feature counts only, never row content or queries.

6. **Language discipline.** "Export what you see" framing everywhere
   user-facing. The words scrape/scraper/bot/automation never appear in the
   listing, UI strings, or website copy.

7. **Ambiguous red-line calls are never self-adjudicated** by the build agent or
   sub-agents. If the red-line reviewer is unavailable for any reason, the
   question escalates to Yash and work proceeds on the most conservative reading
   until he answers. "Blocked reviewer" never defaults to "approved."

8. **Detail-pane enrichment fires only on a 1:1 user gesture** (row click /
   "Open next"). One gesture, one navigation, gated on the prior pane finishing.
   No batch, queue, or timer-driven advancement in any form.

## Open escalations

| # | Question | Status | Conservative reading in force |
| --- | --- | --- | --- |
| E1 | A 1:1 row-click navigation can be done as `chrome.tabs.update()` to the place URL (cross-document — destroys the activeTab grant and the collector, so the user must re-click the toolbar icon for every place), or by activating the result card's existing link (SPA navigation, session survives, but a synthetic click on a place, which red line 2 forbids). Does red line 8's "one navigation" authorise the latter, or does red line 2 still bar it? | **Awaiting Yash** | The extension initiates no navigation at all. Enrichment fires passively when the user opens a place themselves. |

## How enrichment works under the conservative reading

The collector watches for a place detail pane appearing in the tab. It does not
cause one to appear. When the user opens a place — by clicking it in Maps, by
searching for it, however they like — the collector reads the pane and patches
the matching collected row.

That is strictly weaker than what red line 8 permits, and deliberately so: it is
valid under every possible ruling on E1, so no work done now has to be unwound.
