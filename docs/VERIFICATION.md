# Verification protocol

Permanent, from 2026-07-31. Introduced because a "verified" claim in the M2
report was true of the wrong flow, and the difference is exactly what broke in
the field.

## Every verification claim must name three things

1. **The pushed commit hash.** Not "committed" — pushed, and confirmed present
   on `origin`. Work that only exists locally is unauditable, so it does not
   count as verified.
2. **The flow.** `SPA click` (a card clicked inside a live results list,
   pushState navigation) or `hard load` (a place URL opened directly). These are
   not equivalent and a result from one says nothing about the other.
3. **The locale.** The Maps interface language used, e.g. `en-GB`, `en-US`,
   `hi`. Layout and card composition differ by locale and by vertical.

A claim missing any of the three is not a verification claim. Write "checked
locally, unverified" instead.

## Milestone gates come from Yash's machine

Automated checks in this repo are development instruments. They catch
regressions early and they are not a milestone gate. **M-gate artifacts come
from Yash's machine only** — an unpacked build, a real toolbar click, a real
session, real queries.

That distinction exists because the failure that prompted this protocol was
invisible to every automated check: the code was correct, the tests passed, and
it still did nothing on a real machine, because the state on that machine
predated the code.

## What the automated checks can and cannot see

| | Covered | Not covered |
| --- | --- | --- |
| `test/unit.js` | parsing, CSV rules, merge semantics | anything needing a browser |
| `test/migration.js` | pre-M2 sessions being repaired on load | a real `chrome.storage.local` |
| live-Maps parser runs | selectors against today's DOM | the worker, the store, the panel |
| in-Chrome load harness | manifest, worker registration, panel render, console errors | the toolbar click, the activeTab grant, downloads landing on disk |

The gap in the middle column is where the field failure lived: a stale session
in real storage, reached through a real toolbar click.

## Post-mortem: enrichment did nothing (2026-07-31)

**Symptom.** M2 shipped, Yash opened places, nothing filled in. No error
anywhere.

**Cause.** Rows already in `chrome.storage.local` were written by M1 and carry
only `placeId`. A detail pane produces aliases of `[ftid, mid]` and never a
place id, so those rows matched nothing. `applyDetail` returned null and the
worker returned silently.

**Why it passed here.** The M2 verification used `page.goto(placeURL)` — a hard
load — against a session created seconds earlier by the current code. Both
halves were wrong: the wrong flow, and a session that could not be stale.

**Fix.** `migrateAliases()` rebuilds ftid and mid from the stored `placeUrl`,
which retains the full `/data=!...` segment. The session is repaired, not
discarded.

**Instrumentation added, so this class of failure is diagnosable next time.**
Per-row status chip (`not opened` / `confirmed` / `partial` with the missing
field names) and a 200-event local ring buffer exported by **Diagnostics → Copy
diagnostics** in the panel. The decisive log line is:

```
detail:unmatched {"aliases":["0x…:0x…","/g/…"],"rowsHeld":13,"aliasesIndexed":0}
```

`aliasesIndexed: 0` alongside a healthy `rowsHeld` names the bug immediately.

The buffer stays local: it goes to the user's clipboard and nowhere else, and
holds identifiers and counts rather than row content.
