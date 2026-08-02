# Monetization decisions

Recorded 2026-08-02, Yash's call.

## 1. Everything is free until roughly 2027-02

Launch free. Revisit premium around **2027-02-02**, six months out.

Mechanically this is already how the code works: `BETA_ALL_FREE = true` in
[entitlements.js](../src/common/entitlements.js) makes every flag read as
granted, and there is no payment code, no upsell string, and no "Pro" badge
anywhere in the UI.

The cap machinery (25 rows/export, 2 exports/day) is built and tested but inert.
It stays that way.

### There is deliberately no date-triggered flip

The constant is flipped by a human, in a release, with a version bump and a
store-listing update. It is not compared against a date at runtime.

A timer would mean the extension quietly starts refusing to do what it did
yesterday, on a machine nobody touched, for a user who never agreed to it. That
is a support incident with a fuse on it, and it would land while nobody is
looking at the calendar.

### The harder problem, for when the date arrives

The free tier as originally specified keeps "live collection, all filters, CSV
export within caps" — and those caps are 25 rows per export, twice a day. For a
lead-list tool that is a very small allowance.

Six months of users will have been exporting 240 rows at a time. Imposing 25 on
them later is not a downgrade they will read as fair, and the review page is
where they will say so.

Two ways out, worth deciding before the date rather than after:

- **Grandfather.** Anyone installed before the switch keeps what they have.
  Cheap to implement: stamp an install date now, so it exists when it is needed.
- **Make premium additive, not restrictive.** Charge for things that did not
  exist in the free version rather than removing things that did. API enrichment
  (Part B) is the obvious candidate — it is genuinely new capability and it
  costs the user real money at Google either way.

Nothing else is being built for this now, with one exception. The install
timestamp (`mle.installedAt.v1`, written once on first install and never
overwritten) ships from the first release, because it cannot be created
retroactively — by the time you want to know who predates the caps, it is too
late to start recording it. Nothing reads it yet.

## 2. Part B (BYO-key Places API) is parked

Not started, and nothing to unwind: there is no `src/enrich/`, no
`optional_host_permissions`, and no reference to `places.googleapis.com`
anywhere in the tree.

**Who pays what, since this drove the decision:**

| | Cost |
| --- | --- |
| The user, in production | Their own Google Cloud key, billed by Google directly to them. We never proxy, pool, cache-for-others, or resell — that is red line 9. |
| TheOpenBox, in production | Nothing. No server, no key, no traffic through us. |
| Yash, to ship it | A billing-enabled Google Cloud project, to run Gate B's ten test rows. |

That last row is the whole reason it is parked. Not wanting to attach a card to
a Cloud project to verify a feature is a reasonable place to stop.

**Do not quote a price for the API here.** Google's Places pricing and its free
tier both change, and the M3 brief already requires reading the current pricing
docs at build time and recording them with a date in `docs/API-ENRICH.md`. That
still applies if this is ever unparked.

**Red line 9 is not written yet** because there is nothing for it to govern. It
lands with the feature, if the feature lands.

## 3. What this leaves as the path to launch

Free product, no payment code, no API dependency:

- **M4** — selector-map remote refresh, parse-health persistence, options page
  (partly built already for the exported index), welcome page, opt-in analytics,
  store listing copy.
- **M5** — hardening across the test matrix, 0.9.0 beta zip.

Only unavoidable spend: **$5**, one-time, Chrome Web Store developer
registration.

The studio-account decision from the M1 checklist is still open and still
Yash's: publish under the shared TheOpenBox account, or a separate $5 account
that isolates routine policy strikes. It will not survive an actual ban either
way — a second account to circumvent one is itself a violation.
