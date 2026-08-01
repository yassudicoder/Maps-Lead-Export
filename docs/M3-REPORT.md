# M3 report (in progress)

Verification protocol applies: every claim names the pushed commit, the flow and
the locale. Milestone artifacts come from Yash's machine. See
[VERIFICATION.md](VERIFICATION.md).

## Done

| Item | Commit | Notes |
| --- | --- | --- |
| Task 0 — feed identity, no-strike viewing-place, 3 DOM fixtures, `feed:identity` logging, banner CSS | `030c871` | Triggering state **not reproduced**; see below |
| A1 — three carried nits | `91b5e34` | 53→45 delta **not reconciled**; see below |
| A6 — Open-next accelerator | `09a7859` | E1 mechanism verbatim, one press one place |
| A7 — centroid distance filter | `74f522b` | Plus the M2 filter set, which was missing |
| A2 — cross-session exported index | `d9ad8eb` | LRU 50k, badge, toggle, options page |
| A5 — column picker + clipboard TSV | `6fb86f4` | 20 columns, 11 default |
| A3 — saved filter presets | this commit | |
| A4 — free-cap enforcement | this commit | Wired and tested; `BETA_ALL_FREE` stays `true` |
| A8 — missing-space bug | this commit | Reproduced; it is Google's data, see below |

## Two things that are not what they look like

**Task 0's defect was real; its symptom was not reproduced.** The brief
specified a feed-misidentification fix. The unsound code was there —
`seen = cards.length || feed.children.length` scores 0% against a large
denominator for any feed-shaped element with no cards, and two such scans stop
collection. But every state probed on live Maps (reviews view, empty-results
query, six samples across the first four seconds of a load) produced either no
`div[role="feed"]` or one already holding cards. The fallback never fired. Fix
shipped and mutation-tested; the user-visible failure remains hypothetical.

**The 53→45 row delta was not reconciled.** That session's diagnostics are not
available here and I will not invent a cause. What was done instead: every point
a row can vanish was audited. The store does not drop — `all()` is unfiltered
and `addRows` skips only on session-full or missing identity — so the likeliest
reading is 53 cards *seen* against 45 *parsed*, not a drop at export. Two
changes make it answerable next time: unrepairable rows are marked rather than
dropped (`enrich_status` column), and the export log now records `rowsHeld`,
`rowsWritten`, `gap`, `capApplied`, `unrepairable` and `unresolved`.

## Gap found: M2's filter set was never built

The original brief scoped M2 as "Level-2 enrichment on user place-opens,
provenance badges, **full filter set with tri-state website**". The first two
shipped; the third did not exist anywhere in `src/`, and M2 was closed without
it. A7's radius filter presupposes that framework, so it was built here:

- website tri-state (any / no website / unknown / has), all four always visible
- rating at most *x*
- reviews under *n*
- category contains, name contains
- within *n* km (A7)

Export writes the filtered set, not the session — a filter the user can see is
one they meant.

**The unknown rule.** Every numeric filter carries an explicit decision about
missing values, defaulting to keeping them. Maps omits review counts on whole
verticals, so "reviews under 50" must not sweep in every business Maps was
merely quiet about. Excluding unknowns is possible but deliberate, and the count
of what it hid is shown rather than left invisible.

## A7 specifics

Distance is measured from the **median** lat/lng of the session, not the mean.
The "gym in malad" session returned a result in Bandra ~14km away and another in
Kandivali; a mean is dragged by those and would move the reference for every
other row. Rows without coordinates show blank distance — never 0, which would
sort as "nearest" — and are unknown to the radius filter.

Coordinates come from the `!3d`/`!4d` segment already parsed into `geo`, so
there is no extra page reading and no network. Coverage is logged once per
session as `geo:coverage {withGeo, total, rate}`, because the distance column is
only as trustworthy as that rate.

## A8: the missing space is Google's, not ours

Reproduced on the live place page. The address renders as
"…near Shree Icchapurti Hanuman MandirNew, Malad, …" and a `TreeWalker` over
the element finds **one text node** containing exactly that. The aria-label
carries the same string. There is no element boundary, no stripped separator and
no concatenation on our side — Google is serving it that way, and the result
card shows the identical string.

So there is nothing to fix, and fixing it would be worse than leaving it. Any
repair means inserting a space into a business address on a guess ("Mandir" +
"New"), and addresses are full of legitimate runs like "MandirNew" that a
heuristic cannot distinguish from a typo. The parser's job is to report what
Maps shows; a lead list that silently rewrites addresses is less trustworthy
than one that shows the source's own mistake.

Recorded rather than closed silently, because "we looked and it is upstream" is
a different answer from "we fixed it".

## A6.1: anchored positioning (E2)

The accelerator no longer refuses a card just because it has scrolled out of
view. Both permitted paths are implemented:

- **Off-viewport, still in the DOM** → position it, then activate, on the same
  gesture. Reported as `positioned`.
- **Pruned by Maps** → position the nearest surviving *collected* neighbour and
  wait. Maps' lazy render brings the card back, the observer re-links it, and
  the control re-arms. **Nothing is activated on this path** — re-arming means
  pressable, not opened.

"Nearest" is by the feed order recorded when each card was last seen, not by
pixel position: the target is gone, so it has no pixel position. A card never
seen in the current feed has no anchor and is refused rather than searched for,
and `seenOrder` is cleared whenever the feed is replaced — anchoring to a stale
index would scroll somewhere arbitrary, which is exactly what E2 forbids.

**The red toast is gone.** Most of those states describe work in progress, and
colouring them like errors called a working feature broken. Neutral chips now:
"Bringing it into view…", "Restoring it — Maps is redrawing that card". Only a
genuine dead end — the feed re-rendered by a new search — asks the user to do
anything.

**Every attempt is named.** `accel:ok {placeId, how}` or `accel:miss {placeId,
reason}` with reason one of `not-rendered`, `pruned`, `activation-noop`,
`pane-timeout`, `stale-gesture`, `busy`, `relink-timeout`. The chip shows the
same word. "Sometimes it doesn't work" now resolves to a term in Copy
diagnostics.

`activation-noop` is new: a click that changed nothing used to be
indistinguishable from one still loading, so it now checks after 1.6s whether
the URL actually moved.

Verified on live Maps, en-GB: "Cafe Emearald" sitting at top 753 against a feed
bottom of 683 — genuinely off-viewport, and the exact case previously refused —
positioned, activated, pane read, `detail` posted, on one gesture.

Mutation-tested, because these are the boundaries E2 turns on:
making the neighbour fallback also navigate fails
`E2: the neighbour was not activated`; letting an unanchored target scroll
anyway fails `E2: exactly one scroll per scrolling gesture`.

## A4: enforcement is live, the cap is not

`BETA_ALL_FREE` stays `true`, so nothing is currently withheld. What changed is
that the gate is now a real code path rather than a constant nobody reads:
`checkExport` returns `allowed`, `rowLimit`, `willTruncate` and
`remainingToday`, the panel consults it before writing a file, and the daily
tally is loaded at start-up and reset on a **local** calendar day — a cap that
rolled over at UTC midnight would read as a bug to anyone east of Greenwich.

Truncation is announced before the file is written. Silently exporting the first
25 of 240 rows is the kind of surprise that loses a user permanently.

`test/entitlements.js` covers the arithmetic independently of the flag, so
flipping the constant in M3 is a one-line change with the behaviour already
pinned.

## Part A is complete

Gate A is next, and it is yours: an export showing the distance column and
exported badges, a description or capture of the accelerator advancing one press
at a time, and Copy diagnostics — all from your machine.

Part B is not started and must not be: it is gated on Gate A and on your Google
Cloud key.

## Verification so far

199 assertions across four suites, all passing:
`unit.js` 110 · `fixtures-run.js` 50 · `collector-lifecycle.js` 22 ·
`migration.js` 17.

Mutation-tested rather than assumed: the feed-identity denominator (fails with
`seen:10` against `want:0`), the website-provenance nit, and the naive name
strip (turns "Blue Tokai Coffee Roasters | Malad West" into "Blue Tokai Coffee
Roasters").

In a real Chrome load, zero console errors, and: filters 240 → 97 on "No
website" with the badge and summary agreeing, `zzzz` → the no-matches state,
reset → 240; accelerator hidden with no collector, 356×31 enabled with one,
disabled while a pane reads; banner action 117×27 and no longer collapsing at
280px.

None of that is a gate. The gate is Yash's machine.
