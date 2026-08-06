# Privacy Policy — notes and store-listing answers

**The policy itself is now a real page: [`website/privacy.html`](../website/privacy.html).**
It deploys with the site to `https://maps-lead-export.vercel.app/privacy`, which
is the URL the Chrome Web Store field wants.

**One blocker remains in that page:** the contact address. There is no contact
email anywhere on the site, so there was none to use. It is marked with a loud
dashed box that is impossible to scroll past, and the page must not go live
until it is replaced.

The prose below is kept as the source text. The section on the website was
corrected after reading `website/site.js`: `WAITLIST_ENDPOINT` is an empty
string, so the form posts nothing and replies "Not taking names quite yet."
The site therefore collects **nothing at all** today, and saying otherwise would
have been inaccurate in the direction people never check.

---

Last updated: 2 August 2026

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

**The waitlist form is not currently active.** Submitting it stores nothing and
sends nothing; it replies that we are not taking names yet. At present this
website collects no personal information at all.

When the form is switched on, the only thing collected will be the email address
you type, used for one purpose: to send you a single email when the extension is
released. It will not be sold, rented, or shared, and it will not be added to
any other list. This policy will be updated to name the service that stores it
**before** the form starts accepting addresses, not afterwards.

This website sets no advertising or tracking cookies.

> **Wiring the form is therefore a privacy-policy event, not just a code
> change.** Setting `WAITLIST_ENDPOINT` in `website/site.js` turns a page that
> collects nothing into a page that collects an email address. Update this
> policy in the same commit.

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
