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
| A7 — centroid distance filter | this commit | Plus the M2 filter set, which was missing |

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

## Still to do in Part A

A2 cross-session exported index · A3 saved presets · A4 free-cap enforcement ·
A5 column picker and clipboard TSV · A8 the Cafe Emearald missing-space bug.

Part B is not started and must not be: it is gated on Gate A and on Yash
confirming his Google Cloud key.

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
