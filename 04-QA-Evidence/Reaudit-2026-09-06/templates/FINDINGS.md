# Re-audit 2026-09-06 -- templates: product-menu, local-service, portfolio, professionals, desserdirina

Status: COMPLETE for the 5 in-scope templates.

Baseline commit tested: `7736ed7` ("docs: record production as it is actually configured, read from the live
service"), plus the freshly-fixed `probe.mjs` harness described below.

Method: isolated Node server per run (`HIDOOK_TEST_PAY=1`, `HIDOOK_ISOLATED_DEPLOY=1`, temp `DATA_DIR`, no real
keys, `--experimental-sqlite` since the SQLite registry backend requires it on this Node version) via
`04-QA-Evidence/Audit-2026-09-06-2225ca7/_audit-harness.mjs`, driven with Playwright Chromium from
`node_modules` (never Brave/hardcoded browser path). Owner-persona pass per template: inline text edit, colour,
photo replace, every "+ Adaugă"/"x" list add+remove, gallery lightbox, business rename cascade (title/footer/
meta/JSON-LD), publish + live-site check at 1440px/390px + 200% zoom (CSS `zoom`, an approximation of real
browser zoom), WhatsApp QR decoded with `zbarimg` (a real, independent decoder -- not an eyeball check), and on
`professionals` a page-section reorder + remove + publish check. Scripts live under
`04-QA-Evidence/Reaudit-2026-09-06/templates/*.mjs` (scratch, not product code -- no product code, tests, or
docs were edited for this audit; `probe.mjs` is the reusable per-template driver, `professionals-sections.mjs`
and the `debug-*.mjs` files are targeted follow-ups).

**A note on method, in the spirit of being adversarial about my own tooling too:** my first pass at `probe.mjs`
had a real bug that produced several false "add/remove doesn't work" defects on product-menu, local-service and
portfolio -- `Locator.evaluate(fn, arg)` passes the matched DOM element as `fn`'s first argument and `arg` as
the second, not `arg` alone as I'd assumed (that's `Page.evaluate`'s signature, not `Locator`'s). My function
signatures were off-by-one, so `arg` silently landed in an unused parameter while `fn` operated on the `<body>`
element instead of my intended value. I found this by writing minimal, isolated repro scripts every time a
"defect" looked surprising, and only escalated a finding to the report once it reproduced outside my own script's
control flow (or, where it didn't, labelled it explicitly as unconfirmed/test-artifact-suspected). Every defect
below survived that check.

## Scores

| Template | Score /10 | One-line reason |
|---|---|---|
| product-menu | 8 | Editorial design, and every owner interaction worked (lists, lightbox, rename cascade, WhatsApp QR) except one unconfirmed edge case and a real 200%-zoom mobile overflow. |
| local-service | 9 | Zero defects reproduced this pass -- all four lists, gallery, rename cascade, and QR all worked cleanly on a premium, cohesive design. |
| portfolio | 6 | Rename cascade and most lists work, but "+ Adaugă" on the pricing list is confirmed to add nothing and transiently strip a sibling item's delete control. |
| professionals | 7 | Section reorder/remove now genuinely works end-to-end through publish (a capability the original audit said didn't exist), but the WhatsApp button becomes unclickable (covered by the header) after a realistic multi-step edit session. |
| desserdirina | 4 | Hero-disappears bug is fixed and rename/QR are clean, but I reproduced live, published menu-category content corruption (wrong items under a category heading, originals missing) plus a broken, tiny gallery layout. |

## Findings by severity (cross-template summary; full detail with steps and evidence paths is in each template's section below)

### Critical

- **desserdirina** -- live, published menu shows a category ("Torturi") with a DIFFERENT category's items, while the original items are missing from the entire page, after a normal sequence of menu add/remove edits. Visually confirmed on the live site screenshot. See the desserdirina section for the caveat on isolating the exact trigger.

### High

- **portfolio** -- "+ Adaugă" on the pricing list (`.pf-price`) adds nothing (no new row ever appears) and transiently strips the `hb-list-item` class and `.hb-remove-btn` from a different, existing row, while mistagging the list container itself as a list item. Self-heals on the next edit, but the core defect (button does nothing) persists.
- **professionals** -- after a realistic multi-step edit session, the WhatsApp floating button is visually correct but not clickable: `elementFromPoint` at its screen position resolves to the page header, not the link. Reproduced in 2 of 2 identical full-flow runs; not reproducible from a fresh minimal session, so the exact trigger inside the sequence is not isolated.
- **desserdirina** -- the photo gallery renders as a single, tiny (~170px) cramped collage instead of a normal-width grid, and gallery photos could not be reliably clicked in this state (4/4 attempts timed out).

### Medium

- **product-menu, portfolio, professionals** -- horizontal overflow at CSS `zoom: 2` (200%, an approximation of real device/browser zoom) on a 390px mobile base (product-menu, professionals) and portfolio at the same. No overflow observed at 100% zoom on the same viewports.
- **desserdirina** -- the same zoom-200% overflow, but far worse: 2040px scrollWidth against a 1440px viewport (42% overflow) at desktop width, plus the standard mobile-width overflow too.
- **professionals** -- (see above, same zoom-200% class of finding).

### Low

- None reproduced and confirmed at low severity specifically for this pass (see each template's section for cosmetic/minor observations folded into other severities).

## What works (verified across the suite)

- **The product's core "empty card" defect (PM-02 in the original audit) appears fixed everywhere it was tested**: every "+ Adaugă" I could successfully click (i.e. not in a hidden inactive-language-tab) produced a real Romanian placeholder ("Specialitate nouă", "Serviciu nou", "Pas nou", "Categorie nouă", "Certificare nouă", "Punct forte nou"), never a blank/empty item -- across product-menu, local-service, professionals, and 2 of 3 lists on portfolio.
- **Business rename cascades correctly and completely on all 5 templates**: the old name was not found anywhere in any live page's full HTML after renaming, and the new name correctly appeared in `<title>`, `og:title`, the footer, and the JSON-LD structured data every time -- including portfolio's previously-flagged `team.title` field, which now updates too.
- **The WhatsApp QR code is a real, scannable code on every template tested**, decoded independently with `zbarimg` (not eyeballing) to the exact configured phone number and message, diacritics intact -- a full reversal of the original audit's critical, cross-template finding.
- **Gallery lightbox works on product-menu, local-service, and portfolio** (6/6, 5/5, and 4/4 photos respectively opened a working lightbox with a close control on the live site).
- **Page-section reorder and remove now work end-to-end on professionals**, through publish: a removed section is absent from the live DOM entirely (not just hidden), a reordered section renders in its new position, and locked sections correctly resist removal.
- Text edits, colour changes, and photo replacements all survived a full page reload on every template tested.
- No horizontal overflow at 100% zoom, at either 1440px or 390px, on any of the 5 templates.

## Not covered / unconfirmed

- Real physical-device QR scan (iOS/Android camera) -- used `zbarimg` (ZBar) as an independent real decoder instead of eyeballing; this differs from a phone camera's scanner but is a genuine, independent decode rather than a visual check.
- Real Stripe/Resend/Cloudflare keys -- used test-pay/isolated-deploy flags per the harness, consistent with the original audit's methodology.
- Docker image build / production Node runtime -- out of scope for this template-only task (noted only in passing: the local test environment needed `--experimental-sqlite` to boot the server at all on Node 23, which the production `Dockerfile` addresses by pinning to Node 22.20.0 with `NODE_OPTIONS=--experimental-sqlite`; did not independently verify that image).
- No axe-core/Lighthouse automated accessibility or performance scanning -- out of scope for this task.
- The portfolio `icon` raw-HTML-sink XSS hardening was code-reviewed (looks correct against the two documented bypasses) but not re-exploited live through the publish pipeline in this pass.
- Did not test on a real physical browser/device (all testing via Playwright Chromium, per the task's instructions).
- Per-template gaps are listed at the end of each template's own section below.

---

## Template: product-menu (Restaurant) -- Score: 8/10

**One sentence:** Editorial serif typography and warm food photography read as genuinely premium, and every owner-facing interaction I could drive (text edit, colour, photo, add/remove list items, gallery lightbox, rename cascade, WhatsApp QR, publish/export) worked correctly except one unconfirmed edge case and a real 200%-zoom overflow on mobile.

Evidence dir: `04-QA-Evidence/Reaudit-2026-09-06/templates/product-menu/` (screenshots `01`-`24`, `oracle-log.json`, `list-add-results.json`, `list-remove-results.json`, `rename-cascade.json`, `wa-qr-decoded.txt`).

### What works (verified)

- **Inline text edit, colour, and photo replace all survive reload.** Renamed the business, did a second inline edit, changed the accent colour, and swapped the hero photo via the drawer's file picker; after `page.reload()` the business name (and the rest) were still there (`10-after-reload.png`).
- **"+ Adaugă" / "x" on every list works, with real Romanian placeholder text.** Clicked every `.hb-add-btn` in the editor: the specialties list (`pm-tickets`) and 4 of the 6 menu-category item lists (`pm-items`, the 2 skipped ones being in the inactive EN language tab, `hidden` by markup -- correctly not interactable, not a bug) all added a new item with real text ("Specialitate nouă", "Preparat nou"), never an empty card. The "+ Adaugă categorie" control (adds a whole new menu category, `DIV.pm-groups`) also produced a real placeholder ("Categorie nouă" / "Preparat nou"), confirmed present through publish->live (`13-live-1440.png`). This directly contradicts the original audit's PM-02/finding #4 ("carduri goale"), at least on this template as it stands today.
- **Removing an original (not newly-added) item works and leaves siblings untouched**, confirmed on 6 of 7 lists tested: removed the first item from `pm-tickets` (7->6) and 5 of 6 `pm-items` categories; in each case the remaining items matched exactly what was expected, position-for-position (`list-remove-results.json`). Visually confirmed on the live site: "Pâine maia, unt cultivat" (removed) is gone from "Aperitive", "Antricot maturat" gone from "De la vatră", "Ciocolată neagră" gone from "Desert" -- the surviving items in each category are intact and undisturbed (`13-live-1440.png`).
- **Gallery lightbox works: 6/6 photos opened it on the live site**, each click opened `.lightbox` with a close control that worked. This contradicts the original audit's finding #3 ("lightbox complet nestilizat") for this template -- it now renders and functions correctly.
- **Business rename cascade is clean and complete.** After renaming, the OLD name does not appear anywhere in the live page's full HTML. The NEW name correctly propagates to `<title>`, `og:title`, the footer copyright line, and the JSON-LD `LocalBusiness`/`Restaurant` `name` field (`rename-cascade.json`).
- **WhatsApp QR is a real, scannable code.** Decoded the live QR panel's `<img>` with `zbarimg` (ZBar, an independent real decoder, not eyeballing): it decodes to `https://wa.me/40721234567?text=Bună ziua, aș dori o rezervare.` -- an exact match for the configured number and message, diacritics intact. This directly contradicts the original audit's critical finding #1 (QR not decodable on any template) for this template.
- **Mobile nav exists.** At 390px a hamburger icon appears next to the business name in a sticky bar (`20-live-390.png`), contradicting the original finding #18 ("no mobile nav on product-menu"). Not click-tested (menu open/close behaviour not verified -- see gaps below).
- **Hero CTA is a solid colour, not transparent.** "REZERVĂ O MASĂ" renders with a solid accent-coloured fill on the live site, contradicting the original finding #17.
- No horizontal overflow at 1440px or 390px (base 100% zoom).
- Publish -> live -> export HTML/ZIP completed without console errors (other than the expected pre-login `/api/me` 401).

### Findings by severity

**High (unconfirmed -- could not reproduce in isolation, flagging per instructions rather than dropping):** In the one full end-to-end run, removing the first item from a 2-item menu category (`pm-items`, EN "Desert" tab, hidden by the language toggle) left the category with **zero** items instead of the expected one ("Seasonal fruit, crème fraîche" also disappeared). I wrote two isolated, targeted repro scripts (`debug-remove2.mjs`) that removed from the exact same 2-item "Desert" category, both with the EN tab hidden and with it made visible, and in both cases removal behaved correctly (1 item removed, 1 remained, stable across a 3s poll). I could not reproduce the full-empty behaviour outside the full multi-step run. This may be a genuine order-dependent edge case (only manifesting after several prior edits/adds in the same session) or an artifact of my own test harness; I'm not confident enough to call it a confirmed defect, but it's worth a real second look given the stakes of silent content loss.

**Medium:** At CSS `zoom: 2` (200%, an approximation of real browser zoom -- Chromium supports `document.documentElement.style.zoom` but this is not identical to native pinch/ctrl-zoom) on a 390px mobile base, the page scrolls horizontally (scrollWidth 513 vs clientWidth 390). Not observed at 100% zoom on the same viewport.

**Low / cosmetic:** None specific to this template beyond what's already covered by the shared editor-chrome findings (out of this task's scope).

### Not covered / unconfirmed

- Did not click-test the mobile hamburger menu's open/close behaviour, only confirmed it is present and rendered.
- Did not pixel-verify the exact accent colour hex on the CTA background (visually consistent with the chosen `#B5432E`, but not asserted programmatically in this run).
- Did not test the EN language tab's own live-site rendering (only the RO tab, the default, was checked end-to-end on the published site).

---

## Template: local-service (Meserii / renovări) -- Score: 9/10

**One sentence:** Every interaction I could drive worked cleanly on the first fully-corrected test run -- text edit, colour, photo, all four repeatable lists' add AND remove, gallery lightbox, rename cascade, WhatsApp QR, publish/export -- with zero automated defects raised and a premium, cohesive dark-navy/terracotta design.

Evidence dir: `04-QA-Evidence/Reaudit-2026-09-06/templates/local-service/` (screenshots `01`-`23`, `oracle-log.json`, `list-add-results.json`, `list-remove-results.json`, `rename-cascade.json`).

### What works (verified)

- **All four repeatable lists have real add/remove controls, and both directions work.** This template uses its own CSS classes (`.hb-ls-add` / `.hb-ls-remove`, not the generic `.hb-add-btn`/`.hb-remove-btn` used elsewhere) -- my first pass against this template found 0 lists because it only looked for the generic class names; after widening detection to include both naming schemes, all four lists (`ls-certs` certifications, `ls-punch` services, `ls-trust__grid` "why choose us", `ls-wrap` portfolio categories) were exercised successfully:
  - "+ Adaugă" on all 4 added a new item with real Romanian placeholder text every time ("Certificare nouă", "Serviciu nou", "Punct forte nou", "Categorie de lucrări nouă") -- never an empty card.
  - Removing the FIRST (original, not newly-added) item on all 4 lists worked correctly and left every other item -- including the newly-added one -- untouched and in the right order (`list-remove-results.json`). This directly contradicts the original audit's finding ("mecanism de add/remove ... complet neconectat în UI, dead code") -- it is now wired and working end to end.
- **Gallery lightbox: 5/5 photos opened it on the live site**, each with a working close control.
- **Business rename cascade is clean.** Old name not found anywhere in the live page HTML; new name correctly appears in `<title>`, `og:title`, footer copyright, and the JSON-LD `HomeAndConstructionBusiness` `name` field.
- **WhatsApp QR is real and scannable**: decoded via `zbarimg` to `https://wa.me/40721234567?text=Bună ziua! Aș dori mai multe informații despre serviciile dumneavoastră.`, matching the configured number and message exactly, diacritics intact. Contradicts the original audit's finding that this template's QR did not decode.
- Text edit, colour change, and photo replace all survived `page.reload()`.
- No horizontal overflow at 1440px or 390px, and (unlike product-menu) none detected at 200% CSS-zoom either, at either width.
- Publish -> live -> export completed with zero unexpected console errors and zero automated defects logged for this run.
- Visually this is the strongest of the five templates so far: a cohesive dark-navy/terracotta palette, confident large type, real trade photography (not stock-looking), and a persistent bottom "Sună / WhatsApp" action dock on mobile that is arguably a better fit for a single-page local-service site than a conventional hamburger menu.

### Findings by severity

None reproduced this run. (The original audit's WhatsApp-QR and dead-add/remove findings for this template both appear fixed; see above.)

### Not covered / unconfirmed

- No mobile hamburger/nav menu exists (single long page relies on the sticky call-to-action dock instead) -- consistent with the original audit's observation; not re-flagged as a defect here since there is no secondary navigation need on a single-page layout, but noted for completeness.
- Did not pixel-verify the exact accent colour hex.
- Did not test the "Instagram" grid or the "trust" stat counters beyond the drawer-driven year/projects fields already covered by the generic pass.

---

## Template: portfolio (Salon) -- Score: 6/10

**One sentence:** Boutique salon design still reads as premium and most interactions work (lists, lightbox, rename cascade including the previously-residual "team.title", QR), but "+ Adaugă" on the pricing list is confirmed broken -- it adds nothing and transiently corrupts a sibling item's delete control.

Evidence dir: `04-QA-Evidence/Reaudit-2026-09-06/templates/portfolio/` (screenshots `01`-`22`, `oracle-log.json`, `list-add-results.json`, `list-remove-results.json`, `rename-cascade.json`, plus standalone repros `debug-pf2.mjs`, `debug-pf-team.mjs`).

### What works (verified)

- **Gallery category add (`pf-gal`) and services chips add (`pf-chips`) both work correctly**, with real Romanian placeholder text ("Categorie de lucrări nouă", "Serviciu nou") and no corruption of sibling items.
- **Removing an original item worked cleanly on `pf-gal` and `pf-chips`**, leaving all other items (including newly-added ones) untouched.
- **Gallery lightbox: 4/4 photos opened it on the live site**, matching the original audit's already-fixed status for this template.
- **Rename cascade is clean, INCLUDING the specific field the original audit flagged as a leftover-branding bug**: `team.title` ("Echipa Atelier Ivoire" in the preset) correctly updates to "Echipa <new business name>" when the business is renamed (verified directly, `debug-pf-team.mjs`) -- old name not found anywhere in the live page HTML; `<title>`, `og:title`, footer, and JSON-LD `BeautySalon` `name` all reflect the new name.
- **WhatsApp QR decodes correctly** via `zbarimg` to the exact configured `wa.me` link and message, diacritics intact.
- Text edit, colour, and (once the test's own hero-background selector bug was fixed to target `.pf-hero__bg` specifically instead of a generic wrapper) photo replace all persisted correctly.
- I read (did not live re-exploit) the `icon` raw-HTML sink hardening in `build.js` (~line 355-397, the fix cited in commit `02fe24c`): it now strips `<script>`/`<foreignObject>`, neutralizes `on*=` handlers, and -- specifically addressing the original bypasses -- normalizes tabs/CR/LF and decodes numeric HTML entities in URL-bearing attributes *before* testing for `javascript:`/`data:`/`vbscript:` schemes, which is the correct fix for the `jav<TAB>ascript:` and `&#106;avascript:` bypasses documented in the original finding. I did not craft a live payload through the publish pipeline to confirm end-to-end -- flagging as code-reviewed, not independently re-exploited.

### Findings by severity

**High (confirmed, reproduced twice):** Clicking "+ Adaugă" on the pricing list (`.pf-price`) does not add a new pricing row at all -- before and after, there are exactly 10 `pricing.N` entries, never an 11th. Worse, the click also **transiently corrupts a different, existing item**: in a clean isolated repro (`debug-pf2.mjs`), clicking the pricing add button caused `pricing.1` ("Vopsirea rădăcinilor") to silently lose its `hb-list-item` class and its `.hb-remove-btn` -- meaning that row becomes **un-deletable** through the UI -- while the outer `.pf-price` container itself was incorrectly tagged with `hb-list-item` (a class meant for a repeatable *item*, not its container). This state was stable across a 2-second poll, then self-healed after a subsequent edit triggered another re-render (confirmed in the full run: the item's delete control came back). Net effect for an owner: clicking "+ Adaugă" on their price list does nothing visible, and if they happen to look closely right after, one of their price rows temporarily has no delete "×" -- confusing, though not permanently destructive since the app self-heals on the next edit and the published site ends up correct.

**Medium:** At 200% CSS-zoom on a 390px mobile base, the page scrolls horizontally (same class of finding as product-menu).

### Not covered / unconfirmed

- Did not craft and submit a live `javascript:`-scheme payload through the icon field via the actual publish pipeline to re-confirm the XSS fix end-to-end (reviewed the sanitizer code only, see above).
- Did not test the mobile hamburger nav's open/close interaction, only that the page has no horizontal overflow at 390px/100% zoom.
- Did not verify `pf-sched__list` (schedule/hours) or `pf-team__grid` (team members) add/remove -- only `pf-gal`, `pf-chips`, and `pf-price` were exercised in this pass (these three had the only add-buttons rendered on this preset; team/schedule may not be user-extensible by design).

---

## Template: professionals (Servicii profesionale / avocat) -- Score: 7/10

**One sentence:** The most mature template in the suite -- page-section reorder AND remove now genuinely work end-to-end through publish (a capability the original audit said didn't exist at all), and every list add/remove worked cleanly, but a real, twice-reproduced bug leaves the WhatsApp floating button unclickable (covered by the header at the hit-testing level) after a realistic multi-step editing session.

Evidence dir: `04-QA-Evidence/Reaudit-2026-09-06/templates/professionals/` and a dedicated `04-QA-Evidence/Reaudit-2026-09-06/templates/professionals-sections/` run for the section-management test (screenshots, `sections-before.json`, `sections-after-move.json`, `sections-final-state.json`, `live-sections.json`).

### What works (verified)

- **Page-section reorder and remove work correctly, end-to-end through publish.** This is the feature the original audit's PS-01/finding #44 said flatly did not exist ("fără add/remove/reorder de SECȚIUNI"). In the drawer's `.hb-sections-list` panel: removed the "Servicii / expertiză" section (clicked its remove toggle, confirmed `hb-secrow--removed` applied) and moved "Cum lucrezi" up one position (swapped with Servicii). Published, opened the live site, and the DOM matched exactly: the `services` `<section>` is **completely absent** from the live page (not just hidden -- true removal, not a display:none stub), and `process` ("Cum lucrezi") now renders immediately after the hero, before `about` -- precisely the new order set in the drawer. Locked sections (`about`, `contact`) correctly could not be removed. Visually confirmed too (`professionals-sections/04-live-site-after-publish.png`).
- **Both repeatable lists (services `pr-svc`, process steps `pr-steps`) add and remove correctly**, with real Romanian placeholder text ("Serviciu nou", "Pas nou") and no corruption of sibling items -- contradicting the original audit's finding that list edits corrupted the DOM on this template.
- **Rename cascade is clean**: old name absent from the live page; new name in `<title>`, `og:title`, footer, and JSON-LD `LocalBusiness` `name`.
- Text edit, colour, and photo replace all persisted through reload.
- Design remains the most premium and calm of the suite: warm terracotta/cream palette, confident serif headings, a genuinely useful appointment-request form.

### Findings by severity

**High (confirmed, reproduced in 2 of 2 identical full-flow runs):** After a realistic full editing session (rename, second text edit, colour, photo, add/remove list items, reload, rename again, publish), the WhatsApp floating button (`a.whatsapp-float`, `position:fixed`, bottom-right) is **visually present and correctly positioned but not clickable** -- `document.elementFromPoint()` at its exact screen center returns `HEADER.pr-nav` instead of the link, meaning the page header is intercepting clicks at that screen location even though it renders only as a normal 59px top bar. This is not a Playwright artifact: both a real mouse-simulated click and a forced click time out identically; a raw `element.click()` (which bypasses hit-testing) does work, confirming the click handler itself is fine and the problem is specifically that something makes the header's hit-testing area extend over the WhatsApp button's screen position. I was **not** able to reproduce this from a fresh, minimal session (publish immediately, or replay just the zoom/viewport sequence) -- it only appeared after the fuller edit sequence, so I could not isolate the exact single trigger. What this means for a real owner: after spending a few minutes customizing their site, they (or their customers) may find WhatsApp -- the product's headline contact channel -- silently unclickable, with no visual sign anything is wrong.

**Medium:** At CSS zoom 200% on a 390px mobile base, horizontal overflow (scrollWidth 598 vs clientWidth 390) -- same class of finding as product-menu and portfolio.

### Not covered / unconfirmed

- Did not isolate the exact action in the edit sequence that triggers the WhatsApp/header hit-testing bug -- flagging it as real and reproduced-in-context, but the minimal repro remains unidentified. Whoever picks this up should start from `probe.mjs`'s full sequence and bisect it.
- Did not decode the WhatsApp QR code for this template specifically in this pass, since the panel could not be opened via the affected click path in the runs where the bug was present (a JS-dispatched click does open it -- see `debug-pr-wa.mjs` -- so the QR itself is very likely fine, just untested with the real decoder in this session).
- Did not test add/remove on the `pr-cred__list` (credentials) or `pr-faq` (FAQ items) lists, or the appointment "weekly"/"types" lists -- only `pr-svc` and `pr-steps` had visible add buttons on this preset.

---

## Template: desserdirina (Cofetărie) -- Score: 4/10

**One sentence:** The hero-disappears bug from the original audit is fixed and the rename cascade/QR are clean, but I reproduced a severe, visually-confirmed content-corruption bug where editing the menu leaves a category showing a DIFFERENT category's items while the original items vanish, plus a gallery that renders as a tiny, cramped thumbnail instead of a real photo grid.

Evidence dir: `04-QA-Evidence/Reaudit-2026-09-06/templates/desserdirina/` (screenshots `01`-`18`, `oracle-log.json`, `list-add-results.json`, `list-remove-results.json`, `rename-cascade.json`).

### What works (verified)

- **The hero background no longer disappears after editing** -- the original audit's descaling critical finding for this template (hero goes fully blank after any background edit) did not reproduce; the hero photo and business name render correctly on the live site after a photo swap, colour change, and rename (`13-live-1440.png`).
- **Business rename cascade is clean**: old name absent from the live HTML; new name in `<title>`, `og:title`, footer, and JSON-LD `Bakery` `name`.
- **WhatsApp QR decodes correctly** via `zbarimg` to the exact configured link and message, diacritics intact.
- Adding items/categories to the menu produces real Romanian placeholder text ("Preparat nou", "Categorie nouă"), never an empty card, and several individual item removals (`menu-items` at several positions) worked cleanly with siblings untouched.
- Text edit, colour, and photo replace persisted through reload.

### Findings by severity

**Critical (confirmed, visually verified on the published live site):** After a normal sequence of adding and removing menu items/categories, the "Torturi" (cakes) category on the LIVE, PUBLISHED site displays the WRONG items -- "Smântânel, Medovic, Preparat nou" (which belong to a different category, originally "Napoleon, Poveste, Smântânel, Medovic") -- while "Torturi"'s own original items ("Tort de morcovi", "Tort Oreo", "Pandispan Victoria", "Tort de ciocolată") are gone from the entire page, not just that category. See `13-live-1440.png`: the "Meniu" panel plainly shows this mismatch. This is content-integrity corruption on a paid, published site, in the vertical where the menu literally is the product -- a customer relying on this after making a few normal edits would be advertising the wrong cakes under the wrong heading, with the real ones missing entirely. This matches the class of defect the original audit flagged for this template's gallery categories (build.js's `@each` category handling), but here reproduced on the menu-categories path instead.
- I want to flag my own uncertainty about the *exact* trigger: my test script also removed a whole category (via a "menu-groups" remove control found in what may have been a hidden EN/RO language tab), and category-level removal restructures the nested item lists underneath it -- so I cannot rule out that my own test sequence (rather than a single isolated user action) is what tipped this into a corrupted state. What I can state with confidence, because it is a direct screenshot of the live published output, is that this exact sequence of ordinary owner actions (add a menu item, add a category, remove a couple of original items) left the live site showing scrambled menu content. That is a real, reproducible outcome regardless of which exact step inside the sequence is the proximate cause.

**High:** The photo gallery ("Galeria noastră" / "Creațiile noastre") renders as a single, tiny (~170px-wide) cramped collage box instead of a normal-width photo grid (compare to product-menu's or local-service's full-width galleries) -- see `13-live-1440.png`. Consequently, clicking gallery photos in this run consistently timed out (4/4 attempts) rather than opening a lightbox; the images are packed so tightly into the undersized frame that they may not present clean, individually-clickable hit areas. This matches the original audit's compact finding ("Galerie fără titlu, minusculă în layout chiar necoruptă") -- still present.

**Medium:** By far the worst zoom-200% horizontal overflow of the five templates: at a 1440px base, scrollWidth reaches 2040px (clientWidth 1440) -- a 42% overflow, not a marginal few pixels like the other templates. Also overflows at 390px base (562 vs 390).

### Not covered / unconfirmed

- Did not isolate whether the menu-corruption bug requires a whole-category removal specifically, or reproduces from item-level add/remove alone -- see caveat above.
- Did not get a working lightbox click through in this run given the gallery sizing issue; cannot confirm whether the lightbox mechanism itself still works once a photo is successfully clicked.
- Did not test the gallery add/remove-category flow in isolation (separate from the menu one) due to time -- the original audit's specific claim was about gallery categories, not menu categories; both areas share the same underlying `@each`/category-group code path in `build.js`, which is consistent with, but does not by itself prove, a shared root cause.
