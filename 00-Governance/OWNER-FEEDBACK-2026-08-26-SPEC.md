# Owner feedback 2026-08-26 — buildable spec

Task `t_7f6ffed8`. Spec only — no product code written. Repo read at `main` = `670fc85`, tree clean except pre-existing untracked `VISION.md` / `package-lock.json`.

## How this spec was produced (evidence, not opinion)

Every "Current state" claim below is either a file:line citation or a real browser observation. Method:

- `node scripts/build-builder.js` → regenerated `builder/generated/` (gitignored, 32 MB).
- Isolated server: `PORT=8799 HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1 DATA_DIR=/tmp/hidook-spec-data node bot/web.js`. No Telegram, no real Stripe, no DNS, no charges.
- Real browser: Brave headless driven over raw CDP (throwaway driver at `/tmp/hidook-spec/cdp.js`; no repo files added). Screenshots in `/tmp/hidook-spec/*.png`.

Nothing below is inferred from "it probably works this way". Where I could not prove something, it is written as an open question.

---

## Executive summary

Three findings change the shape of the work and should be read before the item list:

1. **Item 9 is not a race condition or a lazy-load bug — it is a 32 MB blocking script.** `builder/generated/templates-data.js` is 32,018,969 bytes and is loaded as a render-blocking `<script>` at `builder/index.html:484`, before `app.js`. On a throttled 10 Mbit connection it took **30.5 s** to download; at t=3 s, t=10 s and t=20 s the page showed only the "Loading…" spinner with **0 template cards**. On loopback it is 142 ms, which is why this never showed up in local QA. This also explains "refresh makes it appear": the server sends **no** `Cache-Control`, `ETag` or `Last-Modified` (`bot/server.js:300-310`), so the second load is served from heuristic browser cache. Fixing item 9 properly = splitting the bundle + adding cache headers, not adding a `setTimeout`.

2. **Item 11 is a dead control, and it is worse than "hero background".** The color the user picks is written into config and *does* reach the rendered HTML, but **nothing consumes it**. Proven in-browser: after `applyThemeColor('#16A34A')` and setting `theme.cream` to `#FF0000`, the srcdoc contains `--color-primary: #16A34A` and `--color-cream: #FF0000`, yet `var(--color-primary)` occurs **0 times** and `var(--color-cream)` occurs **0 times** in the professionals stylesheet — the design reads `var(--accent)` (10 uses) and `var(--paper)` instead, both hardcoded in `:root`. Screenshot `/tmp/hidook-spec/pro-after-cream-red.png` shows the page still terracotta/cream after both edits. `theme.cream` is dead in **all four** templates (`grep -c 'var(--color-cream)' templates/*/styles.css` → 0,0,0,0); `theme.primary` is dead in `professionals` only (the other three alias it to `--cta` once).

3. **Items 13/14/15 (Privacy / Cookies / T&C) are a legal gate the studio cannot fully close.** The studio can build the pages, the consent banner and the generator. It **cannot** supply the controller identity, legal entity, VAT number, hosting sub-processor list or retention periods — those are owner-only inputs, and shipping placeholder legal text to paying EU customers is a liability, not a stub. This is the one cluster where "done" genuinely requires the owner.

Sequencing recommendation: **9 → 11 → 17** share the render/bundle path and should go first (item 17's answer is largely "fix 9+11 and add sections"), then 12/10/2/5, then the legal cluster 13/14/15 gated on owner input, then 8/16, then 1/19, with 18 as a spike and 6/7 as a pure owner decision.

---

## Item-by-item spec

### 1. Second design system (research-first)

**Current state.** There is no template named "Dessedina" in the repo. `templates/registry.json` lists **four** systems: `product-menu` (Restaurant), `local-service` (Trades), `portfolio` (Salon), `professionals` (Professional services). The rejected DESSERD look survives only as the leftover bakery sample at repo root (`index.html`, `config.json`, `styles.css`) — `AGENTS.md` and the delivery skill both say to leave those bytes alone. So the premise "avem deja template-ul Dessedina" needs reconciling: either the owner means the root bakery sample (rejected, not a product template), or they mean one of the four shipped systems.

**Target state.** A stranger opening the catalog sees one additional design system, visually distinct from the existing four, built from captured real reference sites — not assembled from leftover bakery CSS.

**Scope / affected surfaces.** New `templates/<new-id>/{template.html,styles.css,script.js,schema.json,presets.json,images/}`; one entry in `templates/registry.json`; one filter chip in `builder/index.html:134-140`; `npm run build:app` regenerates the bundle. Note the chip list is **hardcoded HTML**, so adding a template without touching `index.html` yields a template that exists but has no filter chip — that is a real trap.

**Acceptance test.** Open `/app/` in a real browser → the new system appears as a card with a rendered live preview (not a shimmer) → its filter chip filters to exactly it → "Start" opens the editor and the preview renders → the design does not reuse the `pm-`/`pf-`/`ls-`/`pr-` class prefixes or palettes of the existing four.

**Dependencies / risk.** Blocked-ish on **item 9**: adding a fifth template makes the 32 MB bundle bigger, so shipping this before the bundle split makes the first-load bug measurably worse. Also interacts with **11** (a new template must consume `theme.*`, not hardcode) and **5** (must carry the badge) and **2** (must not hardcode English).

**Owner-only?** kNo — studio can fully build it. Owner input useful on *which vertical* (a fifth vertical is a commercial choice).

**Open question.** Which existing thing is "Dessedina", and is the fifth system a new vertical or a second visual treatment of an existing one?

---

### 2. Romanian language support (with diacritics)

**Current state.** Mixed, and the gap is in the templates, not the encoding. Encoding is fine: `<meta charset="UTF-8">` is present and `build.js` reads/writes `utf8`. But:
- All eight presets ship `"lang": "en"` (`grep -n '"lang"' templates/*/presets.json`).
- Generated-site UI strings are **hardcoded English in the markup**, not templated: `templates/professionals/template.html:186` `<legend>Type of consultation</legend>`, `:205` `Date`, `:209` `Time`, `:218` `Name`, `:222` `Email`, `:228` `Phone (optional)`, `:232` `Note (optional, no confidential details)`, `:245` `Prefer a different channel?`, `:256` `Request sent — awaiting confirmation`. A Romanian customer cannot change these from the builder at all.
- Builder chrome is English (`builder/index.html`), with two stray Romanian leftovers in `builder/app.js:2579` ("Designurile nu sunt disponibile momentan.") — an inconsistency a stranger can hit on the error path.
- Romanian strings *do* exist correctly in `bot/flow.js:345-346`, but that is the Telegram surface, which is **locked** and out of scope.

**Target state.** A Romanian customer's published site shows correct Romanian with diacritics (Ȩ ț ă î â) in every visible string — including form labels and status messages — and `<html lang="ro">`. Decision needed on whether the *builder chrome* is also localized or stays English.

**Scope.** Extract every hardcoded string in all four `templates/*/template.html` into `labels.*` config keys + matching `schema.json` fields + `presets.json` values; add a RO preset per template; set `business.lang`. Optionally an i18n layer for `builder/index.html` + `builder/app.js`.

**Acceptance test.** Pick a template → set language RO → publish (test pay) → open the live URL in a real browser → every visible string is Romanian, diacritics render as ș/ț/ă/î�¢(not s/t/a/i/a and not mojibake `È�™The appointment form labels are Romanian too.

**Dependencies.** Must land **before or with item 1**, otherwise the new template hardcodes English and doubles the extraction work. Overlaps **12** (WhatsApp prefill message is Romanian text) and **13/14/15** (legal text must exist in RO).

**Owner-only?** No. Owner decision needed on scope: sites-only vs sites + builder UI.

---

### 3. Instafidget widget position (slot only — paid separately)

**Current state.** The social section is a fixed block in each template with a hardcoded position: `templates/professionals/template.html:287-315` sits between FAQ and Contact; other templates differ. Position is not configurable. Per `PRODUCT.md:37-39` and `VISION.md:33-37` Instafidget is another team and Site Builder keeps only a provider-neutral slot.

**Target state (this task).** No implementation. Reserve a config key — recommend `socialFeed.position` with an enum of named anchor slots (e.g. `after-hero` / `after-services` / `after-gallery` / `before-contact` / `hidden`) — documented in the schema but not wired, so the paid task later has a stable contract instead of inventing one.

**Acceptance test (of the spec, not the feature).** `schema.json` documents the key and allowed values; no behavior change; the section still renders exactly where it does today; the slot still hides completely when Instafidget is not connected (existing `VISION.md:35` rule).

**Dependencies.** Named slots must be defined *by* the templates, so if items 1/2 restructure template markup, define the anchor names in the same pass to avoid a second rewrite.

**Owner-only?** Billing is owner/other-team. The slot contract is studio work.

**Note.** Owner's list skips item 4. Not an omission on my side — there is no item 4 in the feedback.

---

### 5. "Build by hidook.tech powered by hidook.agency" badge

**Current state.** Absent. No `hidook` string in any `templates/*/template.html` footer. The professionals footer (`templates/professionals/template.html:363-372`) renders only business name, address, year and `footer.note` — and `footer.note` is customer copy (`"Appointment requests confirmed separately."` at `presets.json:186`), so it is not a safe place for the badge: a customer editing their footer note would delete the attribution.

**Target state.** Every generated site carries the attribution, in a place the customer cannot accidentally remove, on all four (soon five) templates.

**Scope.** A dedicated non-editable footer element in each `template.html` (deliberately *not* a `{{config}}` value, and excluded from the `data-hb-edit` injection so the inline editor cannot blank it). Both `hidook.tech` and `hidook.agency` linked.

**Acceptance test.** Publish each template → open the live URL → the badge text is visible in the footer → both links resolve → return to the editor, attempt to edit the badge inline: it is not editable → republish → badge still present. Also verify it appears in the *editor preview*, not only the published output.

**Dependencies.** Touches every `template.html`, same files as **1/2/12**. Batch these into one template pass to avoid three separate rewrites of the same four files.

**Owner-only?** No. Owner should approve exact wording/casing ("Build by" is likely meant as "Built by" — worth confirming rather than silently correcting).

---

### 6. Price: 99 USD one-time (currently 100)

**Current state.** `bot/pricing.js:28` `PRICE_CENTS = 10000`, `:31` `RENEWAL_CENTS = 2900`, with per-country bucketing EUR/GBP/USD (`:34-38`, `:138-143`). Verified live: `GET /api/config` → `{"amount":100,"amountCents":10000,"currency":"eur","renewal":29,...}`. UI reads it from the API, not hardcoded — landing showed "100€" at `#hero-price`, `#proof-price` and "Pay 100€". `PRODUCT.md:16` and `VISION.md:19` both say 100.

Pricing is cleanly centralized, so the code change is trivial. What is **not** trivial is that the owner's "99 USD" collapses a three-currency model into one currency. Today a Romanian customer is charged 100 **EUR**; "99 USD" is ambiguous between:
(a) keep buckets, change the number to 99 → 99 EUR / 99 GBP / 99 USD;
(b) drop buckets, charge 99 USD worldwide (an EU customer now pays USD — VAT/invoicing implications).

**Target state.** Blocked pending that decision. Do not guess.

**Scope once decided.** `bot/pricing.js` constants; `PRODUCT.md:16`; `VISION.md:19`; and the tests that assert the current numbers — `bot/test/pricing.test.js:60-70`, `bot/test/api.test.js:276-279`, `bot/test/payments-brand.test.js:77-84`. Per `AGENTS.md`, tests are updated to the new contract, not weakened.

**Acceptance test.** `GET /api/config` returns the new amount for each country bucket → landing, publish modal and success button all show it → a test-mode Stripe checkout is created for the new amount → `node bot/test/*.test.js` passes.

**Owner-only?** **Yes — decision.** Studio cannot pick this. Production Stripe price objects are also owner-gated (`PRODUCT.md:41-45`).

---

### 7. Maintenance 30 USD/year only if Hidook deploys

**Current state.** Renewal is unconditional: `RENEWAL_CENTS = 2900`, one flat 29/year, no notion of *who* hosts. `PRODUCT.md:18` "Renewal: 29 in the same currency / year." There is no `selfHosted` flag on a site record and no branch anywhere that varies renewal by hosting mode.

**Target state.** Two mutually exclusive post-purchase states: (A) Hidook-hosted → 30/year recurring; (B) customer self-hosted (item 8) → no recurring charge, and correspondingly no managed hosting, no republish-through-us, no version history on our infra.

**Scope.** A hosting-mode field on the site record (`bot/store.js` / `bot/registry.js`); renewal logic in `bot/pricing.js` + the renewal path in `bot/flow.js`; dashboard copy in `builder/app.js:2824 buildSiteCard`; `PRODUCT.md` + `VISION.md`.

**Acceptance test.** Two sites, one per mode → the Hidook-hosted one shows a renewal date and a 30/year renewal checkout → the self-hosted one shows no renewal obligation and no charge → confirm what happens to a Hidook-hosted site when renewal lapses (currently `isHostingExpired`, `builder/app.js:1925`).

**Dependencies.** **Hard dependency on item 8** — "only if we deploy" is meaningless until self-hosting exists. Also depends on **6** (same pricing decision).

**Owner-only?** **Yes — the whole billing model.** Note 29 → 30 is a second, separate price change from item 6; both need explicit confirmation. Also worth flagging: a customer who self-hosts and pays nothing recurring still holds a site carrying the hidook badge (item 5) — the owner should decide whether that is desired marketing or unpaid support surface.

---

### 8. Site export / self-hosted deploy

**Current state.** Does not exist. The full route table is documented at `bot/server.js:5-30` and dispatched at `:1365-1451`; there is no export endpoint. The only way to get a site is a Hidook publish. `build.js` already renders a complete self-contained static site to a directory (`build.js:568-573`), so the *rendering* half is done — the missing part is packaging + an authenticated download route.

**Target state.** After paying, a customer can download a ZIP containing their complete static site (HTML/CSS/JS/images) that works when dropped on any static host, with no Hidook runtime dependency.

**Scope.** New authenticated `GET /api/sites/:id/export` (paid-only, mirroring the existing paid gate); a zero-dependency ZIP writer (repo is zero-dep by policy — Node has `zlib` but no ZIP container, so this is real work); dashboard button in `buildSiteCard`; a short README in the archive.

**Acceptance test.** Pay (test mode) → Download → unzip to an empty dir → serve it with any plain static server → the site renders identically to the live one, including images, with **zero** requests to any Hidook domain (verify in the network panel) → an *unpaid* draft returns 403, not a ZIP.

**Dependencies.** **Blocks item 7.** Interacts with **13/14/15** (exported sites must carry their legal pages) and **5** (badge must survive export). Sharp edge: images are stored as data-URLs in config (`builder/app.js:2001 extractImages`, `buildImgMap`), so export must re-materialize them as real files or the ZIP will contain one enormous HTML file.

**Owner-only?** kNo — studio can build it. Owner decision on *policy*: does export require payment (recommended: yes, it is the product), and does self-hosting forfeit support?

---

### 9. BUG — template does not appear on first load; manual refresh needed

**Current state — root cause found and reproduced.**

`builder/index.html:484` loads `/app/generated/templates-data.js` as a render-blocking classic script, before `engine.js` and `app.js`. That file is **32,018,969 bytes** (every template's HTML, CSS, JS *and* base64 images inlined). `builder/app.js:3326 boot()` cannot run until it finishes, and `renderTemplatesGrid()` needs `window.HIDOOK_TEMPLATES`.

Measured in a real browser at 10 Mbit / 60 ms latency, cache disabled:

| t | readyState | template cards | `HidookEngine` |
|---|---|---|---|
| 0 s | loading | 0 | undefined |
| 3 s | loading | 0 | undefined |
| 10 s | loading | 0 | undefined |
| 20 s | loading | 0 | undefined |
| ~31 s | complete | 4 | object |

`templates-data.js` duration **30,566 ms**; `domContentLoadedEventEnd` 30,710 ms. Screenshot at 20 s (`/tmp/hidook-spec/slow-20s.png`) is a bare "Loading…" spinner. On loopback the same file takes 142 ms — which is exactly why local QA never saw it.

The "manual refresh fixes it" half: `serveStatic` (`bot/server.js:300-310`) sets only `Content-Type` and `Content-Length` — **no `Cache-Control`, no `ETag`, no `Last-Modified`**. The browser then applies heuristic caching, so the reload is near-instant and the user concludes "you have to refresh". Two defects, one symptom.

Secondary: `serveStatic` does a synchronous `fs.readFileSync` of 32 MB **per request** (`:302`), blocking the single-threaded event loop for every other user.

**Target state.** First visit on an ordinary connection shows template cards in a couple of seconds, with no refresh.

**Scope.** (a) Split `templates-data.jsc — ship a light registry (id/name/description/thumbnail) that renders the grid immediately, and fetch each template's heavy payload on demand; (b) move template images out of base64-in-JS into real cacheable files; (c) add `Cache-Control` + `ETag`/`Last-Modified` + 304 handling, with content-hashed filenames; (d) replace the per-request `readFileSync` with a stream or cached buffer. Files: `scripts/build-builder.js`, `builder/index.html`, `builder/app.js`, `bot/server.js`.

**Acceptance test (must be throttled — this is the whole point).** DevTools → Network → "Fast 3G" or 10 Mbit, **cache disabled** → open `/app/` → template cards with rendered previews visible in ≤ 3 s → no manual refresh → repeat with a hard reload and confirm it still holds → confirm the generated bundle returns `304` on a warm load. Testing this on localhost proves nothing and should be rejected in review.

**Dependencies.** Should land **first**. Every new template (1) and every template edit (2/5/12) inflates this bundle; the payoff and the regression risk both scale with how much lands before it.

**Owner-only?** No — entirely studio.

---

### 10. "Details" section must open automatically

**Current state.** Ambiguous between two surfaces; both are real and cheap, so spec both and let the owner pick.

(a) *Builder "Details" drawer* — `builder/index.html:271` `<aside id="details-drawer" style="display:none">`, opened only by the topbar button (`:89-96`) via `openDrawer()` (`builder/app.js:1168`). Verified live: on entering the editor, `drawerDisplay: "none"`. Contents are meaningful — 11 fields including phone, WhatsApp, WhatsApp link, Instagram, Facebook, map link, share image — so a stranger who never presses that button never sees where the contact fields live.

(b) *Generated-site `<details>` blocks* — restaurant menu groups already ship `open` (`templates/product-menu/template.html`, `<details class="pm-group" open>`), but the professionals FAQ does **not** (`templates/professionals/template.html:275` `<details class="pr-faq__item">`), so FAQ answers are collapsed on the live site.

**Target state.** (a) The drawer is open by default the first time a user enters the editor (with the close button still working, and the choice remembered). (b) FAQ/details blocks on generated sites are expanded by default.

**Acceptance test.** (a) Fresh browser profile → Start a design → the Details panel is visible without any click → close it → reload → it stays closed. (b) Publish the professionals template → open live → FAQ answers are readable without clicking.

**Dependencies.** (a) is independent. (b) touches `template.html` — batch with **1/2/5/12**.

**Owner-only?** No. Owner should confirm which surface they meant; recommend doing both since each is a few lines.

---

### 11. BUG — hero / plain-section background color not editable

**Current state — dead control, proven in-browser.** This is the most misleading item on the list: the UI behaves as if it worked.

The color picker (`builder/app.js:1044-1162`) writes `theme.primary`/`primaryLight`/`primaryDark`; `theme.cream` is exposed as a `color` field in every schema (e.g. `templates/professionals/schema.json:228-230` "Paper / warm background"). Each `template.html` head declares them (`templates/professionals/template.html:27-33`).

The values arrive correctly. In a live editor session I set the theme to `#16A34A` and `theme.cream` to `#FF0000`, then read the iframe srcdoc:

- `--color-primary` declarations found: `["#9A4030", "#16A34A"]` ← user value present
- `--color-cream` declarations found: `["#F3EFE8", "#FF0000"]` ← user value present
- `var(--color-primary)` **used: 0 times**
- `var(--color-cream)` **used: 0 times**
- `var(--accent)` used: 10 times, declared `--accent: #9A4030` (hardcoded `styles.css:16`)
- `--paper: #F3EFE8` (hardcoded `styles.css:14`)

Screenshot `/tmp/hidook-spec/pro-after-cream-red.png`: page unchanged, still terracotta + cream. The stylesheet's own `:root` re-declares the same names and the design reads the hardcoded aliases instead.

Static confirmation across all templates:
- `grep -c 'var(--color-cream)' templates/*/styles.css` → **0, 0, 0, 0** — `theme.cream` is dead everywhere.
- `grep -c 'var(--color-primary)' templates/*/styles.css` → 1, 1, 1, **0** — the other three alias it once (`--cta: var(--color-primary)`); `professionals` ignores it entirely, so the theme picker does nothing at all on that template.

Separately, `hero.background` is a free-text CSS field (`schema.json:254-256`, `type: "text"`, "gradient or url(...)"), marked `required: true` on three templates, and `isDrawerField()` returns **false** for it (verified: `{"key":"hero.background","type":"text","drawer":false}`) — so it appears in neither the drawer nor as an inline-editable element. A non-technical user cannot set a hero background at all, and if they could, they would be hand-writing CSS.

**Target state.** Changing the theme color visibly recolors accents on every template. Changing the page/section background visibly changes it. The hero background is settable through a real control (color picker / image picker), not a raw CSS string.

**Scope.** Make each `styles.css` consume the themable variables instead of hardcoded aliases (`--accent: var(--color-primary)`, `--paper: var(--color-cream)`, etc.) across all four templates; add a background control to the color popover in `builder/app.js`; replace the free-text `hero.background` with a structured control (`type: "color"` / `type: "image"`), migrating existing presets.

**Acceptance test.** Editor → Color → pick green → the preview's buttons/accents turn green **within the iframe**, verified visually, on **each** template (professionals is the one that currently fails hardest) → set background red → the page background is red → publish → the live site matches the preview. Reviewer must check the rendered pixels, not just that config changed — that is exactly the trap here.

**Dependencies.** Touches all `styles.css` — batch with the **1/2/5/12** template pass. Item **1**'s new template must be built themable from day one.

**Owner-only?** No — pure studio bug.

---

### 12. WhatsApp — official badge + custom prefilled message

**Current state, two distinct defects.**

*Badge:* the floating button is the literal text **"WA"** in a circle — `<a href="{{contact.waHref}}" class="whatsapp-float" ...>WA</a>` at `templates/product-menu/template.html:273`, `portfolio:296`, `local-service:359`, `professionals:374`. No official glyph. Colors are off-brand too: professionals uses `background: #1f3d2b` (`styles.css:572`), others use `var(--ink)` / `var(--cta)` — none is WhatsApp green `#25D366`. Visible in `/tmp/hidook-spec/pro-after-cream-red.png` bottom-right. (The builder's own share button at `builder/index.html:378-383` *does* have an SVG and `.btn-whatsapp` is `#25D366`-ish with `#1EBE59` hover, `app.css:419-434` — so the *builder* has a badge and the *product* does not. Inverted.)

*Custom message:* `waHref` is a free-text URL field the user must hand-assemble (`templates/*/schema.json`, e.g. `product-menu:316` "Full WhatsApp link with a pre-filled message (https://wa.me/...)"). The logic that builds a proper `wa.me/<digits>?text=<encoded>` link exists — `bot/flow.js:453-462`, with `WA_DEFAULT_MSG` — but it lives on the **Telegram** side, which is locked. The browser builder has no equivalent: the user gets a raw URL box and must URL-encode their own message.

**Target state.** The float shows the official WhatsApp mark on brand-green. The user types a plain-language message ("Bună ziua, aș dori o programare") in a normal text field and the correct `wa.me` link is generated for them; `waHref` stops being hand-edited.

**Scope.** Replace the "WA" text with an inline SVG mark + `#25D366` in all four `styles.css`/`template.html`; add a `contact.waMessage` field to each `schema.json`; derive `waHref` in the builder (port the `buildWaHref` logic from `bot/flow.js` into shared/browser code — **do not modify `bot/flow.js`**, Telegram is locked); demote `waHref` to derived/hidden.

**Acceptance test.** Set a WhatsApp number and a Romanian message with diacritics → publish → open live on a real phone (or `web.whatsapp.com`) → tap the float → WhatsApp opens with the exact message prefilled, diacritics intact → the float visually reads as WhatsApp (green, official mark) → with no number set, the float is absent, not broken.

**Dependencies.** Message text must survive **item 2**'s encoding path (URL-encoding + UTF-8). Same four `template.html` files as **1/5/10b**.

**Owner-only?** No. One caveat worth raising: WhatsApp's mark is a trademark with brand guidelines — the owner should confirm usage rather than the studio deciding.

---

### 13/14/15. Privacy Policy · Cookie consent · Terms & Conditions

Specced together — same gate, same generator, same blocker.

**Current state.** Completely absent from generated sites. No `privacy`/`cookie`/`terms` string in any `templates/*/template.html`. The only occurrences anywhere are **Instafidget's** links in the builder's Instagram modal (`builder/index.html:466-468`, pointing at `instafidget.hidook.agency/terms` and `/privacy`) — i.e. another company's policies, not the customer's.

This is a live-fire problem, not cosmetic: sites are sold in the EU (EUR bucket includes RO, `bot/pricing.js:34-38`), they collect personal data through contact and appointment forms (`POST /api/appointments`, `bot/server.js:1443`, taking name/email/phone), and `templates/professionals/template.html:250` already renders an `appointment.privacyNotice` string that points at a privacy policy **that does not exist**.

**Target state.** Every generated site ships: a Privacy Policy page, a Terms & Conditions page, a cookie consent banner that blocks non-essential storage until consent, and footer links to all of them.

**Scope.** New `privacy.html` / `terms.html` output in `build.js`; a consent banner component in each template; footer links; schema fields for the customer's controller details; the customer-facing intake that collects them. Also: exported sites (**item 8**) must include these pages.

**Acceptance test.** Publish a site → footer shows Privacy / Terms / Cookies links → each resolves to a real page naming the actual business as controller → first visit shows the consent banner → declining leaves no non-essential cookies/localStorage (verify in Application tab) → the choice persists across reloads → submitting the appointment form shows a privacy notice linking to the real policy → the same pages exist inside the exported ZIP.

**Dependencies.** Depends on **2** (RO versions) and **8** (must be in the export). Blocks nothing technically but is a **commercial blocker for EU sales** and should be treated as launch-gating, above cosmetic items.

**Owner-only? — Partially, and this is the important line.** The studio can build the pages, the banner, the generator and the intake. The studio **cannot** invent: legal entity name and address, VAT/registration number, data-controller identity, the sub-processor list (Cloudflare, Stripe, Resend, Instafidget), retention periods, or governing law. `PRODUCT.md:43` already lists "legal entity / VAT copy" as an owner gate. Recommendation: build the machinery now with clearly-marked required inputs, and do **not** ship generated legal text to paying customers until the owner (ideally with a lawyer) supplies the substance. Shipping plausible-looking placeholder legal text is worse than shipping none.

**Open questions.** Who is controller for form submissions — the customer, Hidook, or joint? Is there a DPA between Hidook and its customers? Which jurisdiction governs the T&C?

---

### 16. Preview before publish/payment

**Current state — arguably already satisfied; needs the owner to say what is missing.** There are three preview surfaces today:
- Catalog "Preview" button per card → full-screen modal with desktop/mobile toggle (`builder/app.js:2754 openPreviewModal`, `builder/index.html:390-416`).
- The editor itself is a live WYSIWYG preview (`#preview-iframe`, `buildSrcdoc()` at `app.js:647`) with desktop/mobile toggle (`app.js:1977 setDeviceMode`).
- Card thumbnails render live template previews (verified: 3 preview iframes present after load).

And publish is correctly gated: unpaid `POST /api/publish` saves a draft and returns a checkout URL rather than deploying (`bot/server.js:27`), matching the pay-before-publish golden rule.

So "preview before payment" *technically* exists. The likely real gap: there is **no shareable preview URL** — the customer cannot send a link to a colleague before paying; they can only look at it inside their own browser session. Also the editor preview is a sandboxed `srcdoc` iframe, so links aren't clickable and multi-page navigation isn't exercised.

**Target state (proposed, pending owner).** A time-limited, `noindex`, unguessable preview URL for an unpaid draft that a stranger can open — while the *real* slug stays unpublished until payment.

**Acceptance test.** Unpaid draft → generate preview link → open in a different browser with no session → the site renders → response carries `X-Robots-Tag: noindex` → the actual `{slug}.sites.hidook.agency` address still 404s → the link expires.

**Dependencies.** Direct tension with **`VISION.md:13`**: "Dacă cineva poate vedea site-ul live fără să fi plătit, produsul e greșit." A public preview URL is exactly that, unless deliberately fenced (unguessable token, noindex, expiry, watermark). **This needs explicit owner sign-off before implementation** — it touches the product's one non-negotiable rule.

**Owner-only?** Decision yes; implementation studio.

---

### 17. Builder is too weak vs. a real site builder

**Current state — concrete gaps, not vibes.** The editor is: one page, inline text editing, image replace, one theme color, a details drawer, add/remove on whitelisted lists. `builder/app.js` is 3,353 lines and the capability ceiling is visible in the code:

1. **Single page only.** No page management anywhere; `build.js` renders one `index.html`. Every template is one scrolling page. (Also blocks 13/14/15, which need real pages.)
2. **No section add/remove/reorder.** Sections are fixed in `template.html`; a user cannot add a "Testimonials" block or move Gallery above Services. `data-hb-list` supports item-level add/remove only, and only for whitelisted lists (`SAFE_LIST_PATHS` in the overlay).
3. **Colors barely work — see item 11.** One accent color that is dead on `professionals`, and a background control that is dead everywhere.
4. **No typography control.** Fonts are hardcoded per stylesheet (`--font`, `--display`).
5. **No undo/redo.** Text edits go straight to `draft.config` + `saveDraft()`. Version history exists but is per-publish, not per-edit.
6. **No spacing/layout control.**
7. **Fragile inline-edit mapping.** `injectDataHb()` (`app.js:574-635`) locates editable text by **regex-matching config values against the rendered HTML**, first occurrence only, with heuristic skips (`value.length < 3`, `startsWith('http')`, `/^\d+$/`, `background`, `seo.`). Any value appearing twice, or shorter than 3 chars, or coinciding with markup, silently becomes non-editable — an entire class of "why can't I edit this?" bugs. Note the newer `data-hb-edit` path (85 attributes in the rendered professionals template) partially supersedes this, but both code paths are live simultaneously, which is its own maintenance hazard.
8. **No form builder** beyond the fixed appointment form.
9. **No SEO controls surfaced** — `seo.jsonLd`/`seo.canonical` are deliberately hidden (`HIDDEN_DRAWER_KEYS`, `app.js:401`), and title/description are not clearly presented.
10. **Images are base64 in config** (`resizeImageToDataUrl`, `app.js:1022`), which is what makes the bundle enormous (item 9) and will make export awkward (item 8).

**Target state.** Owner-prioritized subset. Recommended order by value-per-effort: (11) fix colors → (2) real section add/remove/reorder → (5) undo/redo → (1) multi-page → (4) typography presets. Multi-page is the largest architectural change and should be its own epic, not a line item.

**Acceptance test.** Per capability, exercised by a stranger in a real browser without help — e.g. "add a testimonials section, move it above the gallery, change the heading font, undo twice, publish, verify live".

**Dependencies.** Depends on **9** (bundle/perf) and **11** (colors) landing first. Multi-page is a prerequisite for a clean **13/14/15**.

**Owner-only?** No — but the owner must prioritize; this is easily several weeks and should not be attempted as one card.

---

### 18. Self-hosted calendar — cal.diy for "Professional" plan

**Current state.** `templates/professionals` already ships a self-contained appointment **request** form — no external calendar, no OAuth, no availability sync. Client logic reads `data-pr-appt` attributes (weekly windows, slot interval, duration, lead time, timezone) and posts to `POST /api/appointments` (`bot/server.js:1443`), stored locally. The UI is explicit that it is a request, not a confirmed booking ("Request sent — awaiting confirmation", `template.html:256`). `bot/test/s70-professionals-appointments.test.js` asserts no Calendly.

**Feasibility of cal.diy — verified from the source repo.** `github.com/calcom/cal.diy` is a community fork of Cal.com, **MIT licensed** (the fork's stated purpose was removing the Enterprise Edition and relicensing from AGPL-3.0 to MIT). ~47.9k stars, 984 contributors, latest release v6.2.0, last commit ~3 weeks before this spec. Stack: **95.8% TypeScript** (Next.js monorepo) with **PostgreSQL/Prisma**.

**Licensing verdict: green.** MIT permits commercial use and self-hosting without copyleft obligations — materially better than upstream Cal.com's AGPL, which would have raised questions about offering it as a hosted service. Recommend recording the exact commit/release used and retaining the MIT notice.

**Effort verdict: red-amber, and the reason is architectural, not legal.** Hidook Site Builder is deliberately **zero-dependency CommonJS Node with JSON-file storage** (`bot/server.js:31` "Zero dependencies (Node 18+ built-ins only)"). cal.diy brings a Next.js/TypeScript monorepo, Prisma and a Postgres database. This is not a library you import — it is a second application with its own deployment, migrations, backups, upgrade treadmill and attack surface. Realistic options:

- **A. Do nothing** — keep the existing request form. Cost 0. Already ships.
- **B. Link out** sto a cal.com/cal.diy booking page the customer owns. Days. No infra. Contradicts "no external calendar" but is honest and cheap.
- **C. Hidook hosts one cal.diy instance** for Professional customers. Weeks, plus permanent ops burden (Postgres, upgrades, GDPR for booking data, email deliverability). Justifiable only if the calendar is a real revenue driver.
- **D. Build availability/confirmation natively** on the existing form. Weeks, but stays inside the current architecture and dependency policy.

**Recommendation:** spike **B** or **D** before considering **C**. Adopting a Postgres/Next.js app to add booking to a zero-dep static-site product is a large, permanent architectural commitment that should not be made from a feature request.

**Acceptance test (of the spike).** A written spike report with a running throwaway instance, measured resource footprint, upgrade/backup plan, and a GDPR note on booking data — **not** an integration.

**Dependencies.** Ties to **7** (Professional plan pricing) and **13** (booking data = personal data).

**Owner-only?** Decision on option A–D; any hosting/infra cost is owner-gated.

---

### 19. Landing page — hidook.agency brand colors + Awwwards-caliber design

**Current state.** The builder's landing is `#screen-templates` inside `builder/index.html:111-218` — hero, catalog chips, template grid, proof row, "How it works", minimal footer. It is not a separate site. Palette is the paper/ink/terracotta system in `builder/app.css` (1,663 lines), which is *not* stated anywhere to be the hidook.agency brand palette — no brand token file exists in the repo. Content issues visible in the live screenshot: pricing is hardcoded-looking "100€" (driven by `/api/config`, and it will need to change with item 6), and the "How it works" step 3 literally reads "Pay 100€" (`index.html:203`).

**Target state.** The Site Builder LP uses the actual hidook.agency brand colors and is designed from real high-caliber references rather than generic AI-gradient output.

**Scope.** A brand token layer in `builder/app.css`; restructure of the landing section; research capture of reference sites per the research-first rule (`AGENTS.md`, and the delivery skill's `references/awwwards-firecrawl-design-remake.md`).

**Acceptance test.** Open `/app/` → the palette matches the documented hidook.agency brand tokens (side-by-side against the brand source) → responsive at 1440 and 390 → no generic purple-blue gradients / stock icons / obvious template layout → price copy reads from `/api/config`, with no hardcoded amount surviving in markup.

**Dependencies.** Copy depends on **6/7** (final prices) — doing the LP before pricing is settled guarantees a rework. Independent of the template items otherwise.

**Owner-only?** **Blocked on owner input for the brand palette** — the exact hidook.agency hex values are not in this repo and must not be guessed from a screenshot of the website. Everything else is studio.

---

## Cross-cutting sequencing

Recommended waves (each wave's items share files, so batching avoids rewriting the same four templates repeatedly):

1. **Wave 1 — foundation:** 9 (bundle split + cache headers), 11 (themable variables). Everything else gets cheaper and safer after these.
2. **Wave 2 — one template pass** over all four `template.html`/`styles.css`/`schema.json`/`presets.json`: 2 (string extraction + RO), 5 (badge), 12 (WhatsApp badge + message), 10b (`<details open>`). One coordinated edit, not four.
3. **Wave 3 — legal, owner-gated:** 13/14/15. Build the machinery; hold the text for owner input.
4. **Wave 4 — portability:** 8 (export), then 7 (conditional renewal, which 8 unblocks).
5. **Wave 5 — decisions:** 6/7 pricing (owner), 16 preview (owner sign-off vs. the pay-before-publish rule), 18 calendar (spike first).
6. **Wave 6 — design:** 1 (fifth system), 19 (LP) — 19 after pricing is final.
7. **Ongoing epic:** 17, prioritized by the owner, decomposed into separate cards.

**Hotspot warning for the orchestrator:** `templates/*/template.html` and `templates/*/styles.css` are touched by items **1, 2, 5, 10b, 11, 12**. Six cards editing the same four file pairs will collide continuously. Strongly recommend decomposing by *file* (one card per template, doing all six changes) rather than by *feature* (six cards each touching all four templates). Same applies to `builder/app.js`, touched by 9, 10a, 11, 16, 17.

## Owner-only last-mile items (consolidated)

| # | What the owner must supply | Studio can build without it? |
|---|---|---|
| 6 | Is 99 a price change or correction; does it replace the EUR/GBP/USD buckets | No — do not guess |
| 7 | Confirm 29 → 30, and the conditional-renewal model | No |
| 13/14/15 | Legal entity, VAT, controller identity, sub-processors, retention, jurisdiction | Machinery yes; text no |
| 16 | Sign-off that a shareable pre-payment preview does not violate the pay-before-publish rule | No |
| 18 | Choose option A/B/C/D; approve any hosting spend | Spike yes; adoption no |
| 19 | Exact hidook.agency brand hex values | No — must not be guessed |
| 5 | Confirm exact badge wording ("Build by" vs "Built by") | Mostly yes |
| 12 | Confirm WhatsApp trademark usage | Yes, with the caveat flagged |
| 1 | Clarify what "Dessedina" refers to; pick the fifth vertical | Partially |
| — | Production Stripe, hidook.agency DNS, production email sender (pre-existing gates, `PRODUCT.md:41-45`) | No |

## Constraints respected

- No product code written — spec only.
- No Telegram surface touched or specced for change (the `bot/flow.js` WhatsApp logic is cited as a **source to port from**, explicitly not to modify).
- No push, no production deploy, no live DNS, no real charges. All testing on an isolated loopback server with `HIDOOK_TEST_PAY` / `HIDOOK_ISOLATED_DEPLOY`.
- `main` untouched; no commits.
- Throwaway browser tooling kept in `/tmp`, not committed.
