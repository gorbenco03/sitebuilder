# Suite E — editor exploration across all 5 templates (2026-09-14)

Explorer role only — no product code, schema, or test changes. Scope: the
**editor** experience (builder/index.html + builder/app.js +
builder/edit-overlay.js) on all five templates (product-menu, local-service,
portfolio, professionals, desserdirina), at 1280px and 390px, driven with
Playwright against the local server exactly the way
`bot/test/audit-editor-list-add.test.js` does (`startServer({port:0})`,
`HIDOOK_TEST_PAY=1`, no Telegram files touched, no production/Stripe calls).

Checked against `git log --since=2026-09-12 --oneline`: none of the findings
below match anything already fixed in the last two days (the list-add/remove
defects fixed 2026-09-12/13 were re-verified as fixed — see "false leads
ruled out" in `console-excerpts.md`).

## Summary

| id | severity | template(s) | viewport | one-line |
|---|---|---|---|---|
| E-01 | major | desserdirina | desktop + mobile | Editor preview never loads the template's own fonts (Cormorant Garamond / Montserrat) — CORS-blocked by the sandboxed iframe's opaque origin, silent fallback to Georgia/sans-serif |
| E-02 | major | desserdirina | desktop + mobile | Details-drawer backdrop intermittently blocks all clicks on the canvas for 10+ seconds right after opening a fresh design, even though the drawer was already closed — reads as a frozen editor |
| E-03 | minor | professionals (likely all 5, only exposed here) | desktop + mobile | "Replace photo" wraps the internal WhatsApp QR-code image, a 0x0 non-owner element that can never actually be clicked |
| E-04 | polish | all 5 | mobile (390px) | Secondary topbar buttons (Instagram, Culoare, Poze, Detalii, Descarcă HTML/ZIP) lose their text labels and become icon-only, with no touch-reachable hint of what each icon does |

Everything else exercised — inline text editing (long text, diacritics,
emoji, clearing a field), undo/redo, repeatable lists (add to schema max,
remove to zero, add again) on product-menu/portfolio/professionals/
desserdirina, local-service's own custom list controls, colour presets and
custom hex (incl. a near-background accent — contrast stayed excellent,
17.4:1, because the theme auto-picks button text colour), the sections panel
(hide/show/reorder), the Instagram connect modal, the professionals native
booking toggle, the mobile preview toggle, and reload persistence — behaved
correctly on all five templates at both viewports, with zero console errors
and zero >200ms long tasks recorded outside of E-01/E-02's own template.

---

## E-01 — desserdirina: editor preview never shows the template's real fonts

- **Template:** desserdirina. **Viewport:** 1280px and 390px (identical
  cause, both confirmed).
- **Severity:** major — the one visual promise of a WYSIWYG editor ("what
  you see is what you publish") is broken for this entire template; the
  brand's decorative serif (Cormorant Garamond) and body font (Montserrat)
  never render while editing, only after publish/export.
- **Steps to reproduce:**
  1. Open the builder, pick "Desserdirina" (Cofetărie template).
  2. Look at the hero heading, or open devtools console inside the preview
     iframe.
- **Expected:** the preview shows the same Cormorant Garamond / Montserrat
  fonts the published site uses.
- **Actual:** the heading renders in a plain fallback (Georgia/serif or
  system sans), and the console shows 20 CORS errors, one pair per font
  file:
  ```
  Access to font at '.../app/fonts/montserrat-400-normal-latin.woff2' from
  origin 'null' has been blocked by CORS policy: No 'Access-Control-Allow-
  Origin' header is present on the requested resource.
  Failed to load resource: net::ERR_FAILED
  ```
  `document.fonts` inside the preview iframe confirms every Cormorant
  Garamond/Montserrat face ends in `status: "error"`, and
  `document.location.origin` inside the iframe is the literal string
  `"null"` (an opaque origin).
- **Likely cause:** `builder/index.html:355` — `#preview-iframe`'s
  `sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"`
  omits `allow-same-origin`, which forces an opaque origin for the iframe.
  Cross-origin `@font-face` `url()` requests from an opaque-origin document
  are blocked by CORS with no `Access-Control-Allow-Origin` response header
  to satisfy. desserdirina is the only one of the five templates that
  declares `@font-face` at all (`templates/desserdirina/styles.css`), which
  is why the other four never show this.
- **Evidence:** `screens/desserdirina-desktop-01-open.png` (wordmark in
  fallback font); full console excerpt and the `document.fonts` dump in
  `console-excerpts.md` section F1; raw counts in `raw-log.json` ->
  `desserdirina/*` -> `diagnostics.consoleErrors` (20 entries each run).

## E-02 — desserdirina: the Details-drawer backdrop can block the whole canvas

- **Template:** desserdirina. **Viewport:** 1280px and 390px (both hit it in
  the same automated pass).
- **Severity:** major — while it lasts (10+ seconds observed), nothing on
  the canvas responds to clicks; a first-time owner would reasonably
  conclude the editor has frozen. Flagged as **intermittent**: it fired in
  2/2 runs of the reference methodology (desktop then mobile, same script,
  same timing, applied identically to all 5 templates — only desserdirina
  showed it), reproduced a 3rd time in an isolated re-run, but did **not**
  reproduce a 4th time under slightly different instrumentation — so it is
  a genuine, timing-dependent race, not deterministic every load.
- **Steps to reproduce:**
  1. Open the builder, pick "Desserdirina".
  2. Details opens automatically ("Details opens for every newly selected
     design" — by design). Close it.
  3. Edit the business-name field, then Ctrl+Z (undo), then Ctrl+Shift+Z
     (redo) via the toolbar buttons.
  4. Try to click the same field again.
- **Expected:** the field is clickable/editable again immediately.
- **Actual (when it hits):** the click hangs; Playwright's trace shows
  `<div id="drawer-overlay" class="drawer-overlay"></div> intercepts pointer
  events`, with the element also reported "not stable" for dozens of
  retries — i.e. the (invisible, `#details-drawer`-closed) overlay is
  covering the canvas and something keeps re-touching the DOM under it.
- **Likely cause:** `builder/app.js` ~line 8330 — on `showScreen('edit')`
  for a freshly selected design, `shouldAutoOpenDrawer() && !drawerOpen`
  schedules `openDrawer()` via a double `requestAnimationFrame` guard. The
  standard "close the drawer if it ended up open, then wait ~400ms before
  editing" pattern (used identically here and in
  `bot/test/audit-editor-list-add.test.js`'s `openTemplateEditor()`) can
  race that rAF-scheduled auto-open specifically when the surrounding paint
  is slower — which lines up with desserdirina being the one template
  paying the 20-request CORS/font-load cost from E-01 before its canvas
  settles.
- **Evidence:** `raw-log.json` -> `desserdirina/desktop` and
  `desserdirina/mobile` -> the second `edit-long-text` step entry (mislabeled
  by the harness's shared catch block — the failing call was actually the
  post-redo re-click); full Playwright trace and a 3rd isolated repro in
  `console-excerpts.md` section F2.

## E-03 — professionals: "Replace photo" on the WhatsApp QR image is a dead control

- **Template:** professionals. Same root cause (an unfiltered `<img>` sweep)
  exists in the shared `templates/*/template.html` `wa-qr-img` markup on all
  five templates, but professionals is where it surfaces first — it has
  only two `<img>` tags in the whole document (the logo, which the editor's
  wrapper skips, and this QR image), so it is the one landed on by DOM
  order. **Viewport:** 1280px and 390px, both confirmed.
- **Severity:** minor — the element is 0x0 (`wrapRect`/`imgRect` both
  `{width:0, height:0}`, `btnOpacity: "0"`) and not reachable by ordinary
  pointer browsing (it only exists once the public site's WhatsApp-QR panel
  is opened, which the editor canvas never shows), so real-world exposure is
  low. Recorded because it is a genuine broken affordance — an
  "Inlocuieste fotografia" button that can never do anything — on content
  that was never meant to be owner-editable in the first place.
- **Steps to reproduce:**
  1. Open the builder, pick "Servicii profesionale" (professionals).
  2. Close Details, then query the preview iframe for the first
     `.hb-img-btn` (or: tab through editable elements, or automate "click
     the first replace-photo button").
- **Expected:** the first replace-photo control encountered belongs to a
  real, owner-editable photo (hero/team/gallery).
- **Actual:** it is
  `<span class="hb-img-wrap"><img id="wa-qr-img" alt="WhatsApp QR" width="240" height="240"><button class="hb-img-btn">Inlocuieste fotografia</button></span>`
  — `imgSrc: null`, both wrapper and image at 0x0. Clicking it (or waiting
  for a file-chooser after clicking) times out; there is nothing to click.
- **Likely cause:** `builder/edit-overlay.js`'s `setupImages()` (~line 1094
  onward) wraps every `<img>` in the document as an editable photo slot; it
  excludes Instagram-teaser tiles and inline SVG icons, but has no exclusion
  for `templates/professionals/template.html:583`'s
  `<img id="wa-qr-img">` (present verbatim in all five templates' own
  `script.js`/`template.html`, per `grep -rl wa-qr-img templates/`).
- **Evidence:** `raw-log.json` -> `professionals/desktop` and
  `professionals/mobile` -> `photo-replace` step
  (`Timeout 5000ms exceeded while waiting for event "filechooser"`); DOM
  dump in `console-excerpts.md` section F3.

## E-04 — mobile editor (390px): secondary toolbar is icon-only, no text

- **Template:** all five (structural, not template-specific). **Viewport:**
  390px only.
- **Severity:** polish — the buttons remain reachable (the topbar's
  `.editor-topbar-scroll` rail scrolls horizontally rather than overlapping,
  which is the Wave 11 mobile fix already in place and working correctly;
  this is *not* a regression of that fix). But at 390px every
  `.btn-topbar-label` (Instagram, Culoare, Poze, Detalii, Descarcă HTML,
  Descarcă ZIP) disappears, leaving bare icons — a plain outlined circle for
  "Culoare", three dots for "Detalii" — with `title` tooltips that don't
  fire on touch. A first-time, non-technical owner editing from a phone (the
  scenario this suite was explicitly asked to judge — "can the owner
  actually edit on a phone") has no textual confirmation of what an icon
  does until they tap it.
- **Evidence:** `screens/product-menu-mobile-01-open.png`,
  `screens/professionals-mobile-01-open.png` (both show the icon-only rail
  under the undo/redo/device-toggle row).

---

## Coverage notes

- Long-text edits used a 300+ character Romanian string with diacritics
  (ăâîșț/ĂÂÎȘȚ) and emoji on the first text field of every template; all
  five accepted, truncated to a per-field max length (expected — see the
  `S1-6 (m3/m21)` character-limit comments in `edit-overlay.js`), and
  undo/redo correctly round-tripped the exact before/after text on every
  run.
- Repeatable lists: exercised add-to-schema-max -> remove-to-minimum ->
  add-one-back on 3 lists each for product-menu (`.pm-tickets` 6->12->2->3,
  `.pm-items` x2), portfolio (`#gallery` 3->7, `.pf-chips` 6->16->2,
  `.pf-price` 10->20->2), professionals (`.pr-svc` 4->8->1, `.pr-steps` 3->5->2,
  `.pr-cred__list` 3->8->2), and desserdirina's 3 bilingual `.menu-items`
  lists (all pinned at their max of 4, add button correctly disabled).
  local-service uses its own template-owned `.hb-ls-add`/`.hb-ls-remove`
  controls (by design — it strips the generic ones at load, see
  `console-excerpts.md` section F4) — confirmed present, enabled, and correctly
  labelled for all 4 of its lists, not deep-tested to max/zero given time
  budget.
- Photos: replaced one slot per template across a landscape JPEG, a
  portrait JPEG, a transparent PNG, and a 6000x4000/7.7MB JPEG
  (`fixtures/*.jpg`, `fixtures/transparent.png`) — all four accepted and
  rendered without error or a long task, except professionals (see E-03).
- Colours: cycled all 6 presets and set a custom hex (including a
  near-white one deliberately chosen to probe contrast) on every template;
  the theme engine recomputed button text colour for contrast every time —
  no unreadable-text or invisible-button case found.
- Sections panel: hid a section, restored it, reordered the first section
  down and back — worked cleanly on all five templates; the row count
  (`sectionRowCount`) matches each template's `schema.json` `pageSections`.
- Instagram connect modal: opened and closed cleanly on all five templates.
- Native booking (professionals only — the only template declaring
  `appointment.nativeBooking`): toggled on via Details, no error, page
  re-rendered with the calendar section present.
- Mobile preview toggle (desktop viewport, toggling the canvas to a
  simulated 375px column) and reload persistence (edited text and list
  state both survived a full page reload) were clean on all five templates.
- Not covered given the time budget: two-tabs conflict banner, offline
  mid-save, Playwright network throttling, and exhausting every list to its
  literal schema max for every single list on every template (a
  representative 3-per-template sample was used instead) — none of these
  turned up signal in the areas that were covered, so they were not
  prioritized over verifying E-01/E-02/E-03 twice each.

## Evidence

- `raw-log.json` — full structured run log (steps, list add/remove counts,
  undo/redo checks, per-run console/pageerror/long-task diagnostics) for all
  10 template x viewport combinations.
- `console-excerpts.md` — console/DOM evidence for E-01/E-02/E-03, plus two
  false leads investigated and ruled out.
- `EVIDENCE-INDEX.md` — full listing of all 160 screenshots in `screens/`.
- `fixtures/` — the 4 test images used for photo-replace testing (not
  committed content, just local fixtures).
