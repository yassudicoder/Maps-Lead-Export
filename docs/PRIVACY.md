# Privacy Policy — Maps Lead Export by TheOpenBox

**Draft for publication. Two placeholders marked `⟨FILL⟩` must be completed
before this goes live — they are facts only Yash knows.**

Publish at a stable URL (e.g. `https://maps-lead-export.vercel.app/privacy`) and
paste that URL into the Chrome Web Store's Privacy policy field.

---

Last updated: ⟨FILL: date of publication⟩

Maps Lead Export is a Chrome extension published by TheOpenBox. This policy
covers two separate things: **the extension**, and **this website**. They behave
very differently, so they are described separately.

## The extension

**It collects nothing, sends nothing, and has no account.**

That is not a promise about our intentions — it is a property of how the
extension is built, and you can verify it yourself:

- The extension requests **no host permissions**. Chrome will not let it contact
  any website or server. You can confirm this in the "Permissions" section of
  its Chrome Web Store listing.
- It contains **no analytics, no tracking, no telemetry, and no login**.
- The business listings it collects are stored **on your own computer**, using
  Chrome's local extension storage. They are never uploaded.
- Exported CSV files are written **directly to your device** by Chrome's own
  download mechanism.
- Nothing is synchronised to your Google account or shared between your devices.

### What it reads, and when

The extension reads business listings that Google Maps has **already displayed
in your own browser tab** — name, category, rating, review count, address, and
whether the listing shows a website. When you open a place yourself, it also
reads that place's public contact details.

It only runs after you click its toolbar icon on a Google Maps tab. It does not
run in the background, does not open pages on its own, and does not visit any
third-party website.

All of that information is public business information shown on Google Maps. The
extension does not read your browsing history, your Google account, your
personal data, or any other website.

### Deleting your data

Clear the session from the panel, clear the exported-place index from the
extension's options page, or uninstall the extension — which removes its local
storage entirely. Because nothing was ever sent anywhere, there is nothing to
request from us.

## This website

If you enter your email address in the "get one email when it ships" form, we
store that address for one purpose: **to send you a single email when the
extension is released.**

- Provided to: ⟨FILL: the service that receives and stores the address — e.g.
  the hosting provider's database, or the named email service. Do not publish
  this until it is confirmed; naming the wrong processor is worse than naming
  none.⟩
- We do not sell, rent, or share it.
- We do not add you to any other list. As the site says: no list beyond that one
  email.
- To be removed at any time, contact us at the address below and the record is
  deleted.

The website itself sets no advertising or tracking cookies.

## Changes

If this ever changes — for example if optional, opt-in usage statistics are
added — this policy will be updated before the change ships, and anything of
that kind will be **off by default** and will never include the business
listings you collect.

## Contact

⟨FILL: contact email address for privacy questions and deletion requests.⟩

---

## Notes for the Chrome Web Store form (not part of the published policy)

**Data usage declarations.** These are a separate, sworn section of the listing
and a wrong tick is a policy violation, not a typo. Based on how the extension
actually behaves:

| Category | Declare |
| --- | --- |
| Personally identifiable information | **No** |
| Health information | **No** |
| Financial and payment information | **No** |
| Authentication information | **No** |
| Personal communications | **No** |
| Location | **No** — business coordinates come from the Maps page, never the user's own location |
| Web history | **No** |
| User activity | **No** |
| Website content | **No** — see the note below before ticking |

The three certifications ("not being sold to third parties", "not being used or
transferred for purposes unrelated to the item's core functionality", "not being
used or transferred to determine creditworthiness or for lending purposes") are
all truthfully checkable.

> **The one that deserves a second look: "Website content."** The extension does
> read text from a web page. It reads it entirely on the user's own device and
> transmits none of it, which is why "No" is the honest answer — the declaration
> is about *collection and transfer*, not about reading. If a reviewer queries
> it, the answer is that no data leaves the device and the extension holds no
> host permissions with which to send it. This is worth deciding deliberately
> rather than clicking through.

**Permission justifications.** Each field wants one or two plain sentences:

- **activeTab** — Lets the panel read the Google Maps results already open in
  the user's tab, and only after they click the extension's icon on that tab.
- **scripting** — Used to insert the reader into that one Maps tab when the user
  clicks the icon. It is not injected anywhere else and never runs
  automatically.
- **storage** — Keeps the collected list and the user's settings on their own
  computer between sessions.
- **downloads** — Saves the exported CSV file to the user's device.
- **sidePanel** — The extension's interface is a Chrome side panel, so it never
  covers or alters the Maps page.
- **Remote code** — Declare **"No, I am not using remote code."** All code ships
  in the package. The bundled `config/selectors.json` is data, not code, and is
  never evaluated.
