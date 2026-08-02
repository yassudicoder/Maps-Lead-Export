# Monetization decisions

Ruled 2026-08-02 by Yash. Settled unless he reopens them.

| | |
| --- | --- |
| Free tier | Everything, now. Premium revisited ~2027-02 |
| Flip mechanism | Human, versioned release, version bump. **No runtime date check, ever** |
| Grandfathering | Approved. Pre-flip installs keep their tier, identified by install timestamp |
| Premium model | **Additive**, not restrictive. New capability, never clawed-back rows |
| Part B (API enrich) | Parked |
| Tier-versioning | Deferred until a *second* flip is contemplated |
| Revisit | End of M4, with usage data |

## 1. Everything is free until roughly 2027-02

Launch free. Revisit premium around **2027-02-02**, six months out.

Mechanically this is already how the code works: `BETA_ALL_FREE = true` in
[entitlements.js](../src/common/entitlements.js) makes every flag read as
granted, and there is no payment code, no upsell string, and no "Pro" badge
anywhere in the UI.

The cap machinery (25 rows/export, 2 exports/day) is built and tested but inert.
It stays that way.

### Flip mechanism — ruled, 2026-08-02

The constant is turned over by Yash, in a versioned release, with a version
bump and a store-listing update. **No date-triggered runtime flip, ever.**

An extension that silently starts refusing yesterday's behaviour on an untouched
machine is a fused support incident. This is settled, not a preference to be
revisited when a deadline is inconvenient.

### Grandfathering — approved, 2026-08-02

Installs that predate the flip are identified by the write-once install
timestamp and keep free-tier behaviour **as it stood at their install**.

The timestamp records. It enforces nothing, and nothing reads it, until a future
release explicitly does. It ships now only because it cannot be created
retroactively: by the time you want to know who predates the caps, it is far too
late to start recording it.

`mle.installedAt.v1` — written once on first install, never overwritten, ignored
on update.

**Tier-versioning: deferred, 2026-08-02.** "As it stood at their install" is a
claim about the tier, and the timestamp records only a date. For the *first*
flip that resolves through the changelog — date in, tier-live-at-that-date out —
and no tier-version object is needed.

Introduce one only if and when a **second** flip is contemplated, at which point
date ranges stop being a clean lookup. Building it now is premature: unlike the
timestamp, it carries no irreversibility fuse and can be added at any point
before that second flip.

### The rule these two calls establish

Both went the same way for the same reason, and it is worth naming so the next
one is quick:

> Ship a thing early **only when skipping it is irreversible.**

The install timestamp cannot be backdated, so it shipped before anything reads
it. A tier-version object can be added whenever it is first needed, so it waits.
"We will probably want this later" is not the test; "we will be unable to have
this later" is.

### Preferred model: additive, not restrictive — ruled, 2026-08-02

Charge for capability that never existed free. Do not claw back rows or exports.

Named candidates, neither specified nor built:

- **API enrich** (Part B) — genuinely new capability, and it costs the user real
  money at Google either way, so it prices itself honestly.
- **Audit-lite score** — named by Yash. **Scope is defined at the end of M4, not
  before**, and is not to be invented in the meantime. It appears here as a
  placeholder for a decision, not as a feature awaiting specification.

The consequence worth stating plainly: **if additive covers the business, the
25×2 cap may never bind at all.** The cap machinery stays built, tested and
inert, and may simply never be switched on.

Revisit at the end of M4, with usage data rather than guesses.

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
