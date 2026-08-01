# The defensible-zone contract

Violating any of these is a failed build, regardless of how good the feature is.
This file is the authority; the README table is a summary of it.

1. **DOM-read only, user-driven.** The extension collects ONLY what Google Maps
   has rendered in the user's own tab while they browse. No background tabs, no
   offscreen documents touching Maps, no `fetch()` to any Maps endpoint, no
   headless anything.

2. **No programmatic scrolling or pagination.** The panel collects passively as
   the human scrolls. No auto-click on places (machine-initiated); a 1:1
   synthetic relay of a fresh user gesture, per red line 8, is user-initiated
   and permitted. No "collect all results" automation.

   **E2 amendment.** On the same 1:1 gesture, the target's card may be
   `scrollIntoView`-ed when it is present in the DOM but off-viewport, and then
   activated: one gesture buys one position and one navigation. If Maps has
   pruned the target from the DOM, the same gesture may position the nearest
   surviving *collected* neighbour, by stored feed order — Maps' own lazy render
   restores the pruned card, the observer re-links it, and the control re-arms.
   Re-arming means pressable, never opened.

   Still prohibited: any scroll not anchored to a specific requested row,
   scroll-to-load-more, scroll loops, and anything that advances without a fresh
   gesture. A card never seen in the current feed has no anchor and is refused
   rather than hunted for.

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

## Escalations

| # | Question | Status |
| --- | --- | --- |
| E1 | Should a 1:1 row-click navigation use `chrome.tabs.update()` or activation of the result card's existing link? | **Resolved 2026-07-31 by Yash** — see below |

### E1 ruling

**Approved mechanism:** synthetic activation of the result card's existing link
(SPA-preserving). Red line 2's "no auto-click on places" targets
machine-initiated clicks; a synthetic dispatch that is the direct 1:1 relay of a
fresh user gesture on our own UI is user-initiated in substance. Red line 2 is
amended above accordingly.

**Rejected mechanism:** `chrome.tabs.update` — destroys the activeTab grant and
the collector for zero compliance gain.

**Boundary:** if the target card is not currently rendered in Maps' feed, the
row-click does nothing except hint "scroll to it in Maps". No programmatic
scrolling to hunt for cards.

## How enrichment works

Two paths, both ending in the same passive read.

1. **The user opens a place in Maps themselves.** The collector notices the URL
   became a place URL and reads the pane. It never caused the pane to appear.
2. **The user clicks a row in our panel.** That gesture is relayed 1:1 to the
   matching card's existing link in the feed, which Maps routes as an in-page
   navigation. The same passive reader then handles the pane.

Path 2 is constrained by construction, not by convention:

- **Fresh gesture.** The relay carries the click's timestamp and is refused if it
  is not fresh, so a request can never be replayed later.
- **One at a time.** A relay is refused while another is in flight. In-flight
  clears when the pane finishes being read, or on timeout — which is red line
  8's "gated on the prior pane finishing".
- **Rendered cards only.** The relay matches against cards Maps has already
  drawn. If the card is not there, the answer is a hint to the user, never a
  scroll.
- **No advancement.** Nothing schedules, queues or chains a second relay. Each
  one requires another human click.

### Where each constraint lives

| Constraint | Enforced in | Covered by |
| --- | --- | --- |
| Fresh gesture | `relayOpen`, against `RELAY_GESTURE_MAX_AGE_MS` | `test/collector-lifecycle.js` |
| One in flight | `relayInFlight`, released only by a finished pane read | `test/collector-lifecycle.js` |
| Rendered cards only | `findRenderedCard`, scans the live feed and nothing else | `test/collector-lifecycle.js` |
| No advancement | no code path schedules a second relay | review |

The worker forwards and never originates: it does not synthesise a gesture,
retry, or send a second relay of its own accord. The collector re-checks
freshness and the in-flight rule for itself rather than trusting the sender.

### Measured behaviour of the approved mechanism

A synthetic `.click()` on the card's own link routes through Maps' in-page
navigation: the document survives (no reload, so the collector and the activeTab
grant both persist) and the detail pane renders. Timing measured on a warmed
browser profile, en-GB: nothing at +1.5s, fully rendered by +3s. The read ladder
runs to 7s to leave margin.

A caveat that cost two wrong conclusions before it was understood: in a *fresh*
browser profile the pane does not render at all, and that is true of real
human-equivalent clicks as much as synthetic ones. It is a property of the
profile, not of the mechanism. See VERIFICATION.md.
