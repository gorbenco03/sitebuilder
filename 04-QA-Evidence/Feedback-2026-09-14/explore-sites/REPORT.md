# Explore-sites — visitor-experience pass, 2026-09-14

Scope, method and hard rules as given in the dispatch brief (SCOPE: every template/preset/colour/edit ×
widths × engines × interactive/booking/SEO/perf/a11y). This report tries to say plainly what was actually
checked, what was found, and what was checked and found **clean** or **not a bug** — several apparent
findings turned out to be artefacts of my own probes and are documented as such rather than silently dropped
or silently reported as real, per the brief's own warning ("a past round found 96 of 108 'violations' were
sampling artefacts").

**Plan-file note:** the dispatch pointed at `PLAN-FEEDBACK-2026-09-14.md, Suite E`. That file does not exist
in this repo; the closest match is `PLAN-FEEDBACK-2026-09-13.md`, whose Suite E ("Programează-te online" fără
formular) is already shipped and tested (commits `fc0f9d8`/`ab62aeb`, before the `git log --since=2026-09-12`
cutoff for this task). Proceeded directly from the SCOPE section of the dispatch instead.

**Engines:** Chromium only. `~/Library/Caches/ms-playwright` on this machine has no Firefox or WebKit build
installed — no results are claimed for those engines, per the hard rule.

**Method:** all sites rendered through `build.js`'s real `renderHtml()`/`build()` (same pipeline
`bot/webpublish.js` and every existing template test use), served locally, driven with Playwright. The
native-booking pass used the real `bot/server.js` + a seeded `calendar-native` tenant, matching the pattern
in `bot/test/audit-portfolio-fixes.test.js` / `bot/test/calendar-native-public-widget.test.js`. No production
or Stripe calls. Contrast used the same composited-luminance technique as
`bot/test/suite11-booking-select-readable.test.js` / `suite7-portfolio-m9-pricelist-contrast.test.js`, with a
black-on-white / white-on-white self-test run on **every** page load before trusting any reading from it (see
Methodology notes at the end — this caught real probe bugs before they became false findings).

---

## Summary (sorted by severity)

| # | Severity | Finding | Template(s) | Reproduced |
|---|----------|---------|--------------|------------|
| 1 | Major | White CTA text on the **orange** accent (#EA580C) fails contrast: 3.56:1, needs 4.5:1 | portfolio (nav CTA, hero-cta, WhatsApp appt link), professionals ("Programează o consultație") | 2 templates × 2 widths |
| 2 | Major | Booking "Trimite cererea" submit button unreadable on **orange/pink** accents: 2.16:1 / 2.03:1, needs 4.5:1 | professionals (dark "book" section) | 2 colours × 2 widths |
| 3 | Minor | About-section "01 —— Salon/Studio" caption at 40%-opacity white on near-black: 3.73:1, needs 4.5:1 | portfolio, all 3 presets | 3 presets × 320w |
| 4 | Minor (borderline) | "Program" eyebrow label: 4.36:1, just under the 4.5:1 floor | portfolio | 768w, default + pink accent |
| 5 | Minor | Hero CTA anchor scroll lands ~120–200px short of `#contact` (post-scroll layout shift from fade-in sections) | local-service | 3/3 runs |

No blockers found. Everything else checked — see "Clean results" and "Verified NOT bugs" below.

---

## 1 [Major] White text on orange primary buttons fails WCAG AA

**Template/preset/colour:** portfolio (any preset) and professionals (any preset), accent overridden to
`#EA580C` via the same HSL-derivation formula the builder's own colour popover uses
(`builder/app.js` ~698-733, mirrored from `bot/test/suite11-booking-select-readable.test.js`).
**Engine/width:** Chromium, 390 and 1280 (colour-dependent, not layout-dependent — width doesn't change the
result, so "both widths" counts as reproduction across 2 independent template instances, not a fluke).
**Steps:** render portfolio/professionals with `theme.primary=#EA580C` (+derived light/dark), measure computed
`color` vs the real composited background of `.pf-chrome__cta` / `.hero-cta` / `.pf-appt__wa` (portfolio) and
the primary CTA span (professionals).
**Expected:** ≥4.5:1 for normal-size button text (WCAG AA).
**Actual:** `color: rgb(255,255,255)` on `background: rgb(234,88,12)` → **3.56:1**.
**Why it matters:** this is exactly the accent the dispatch brief calls out as a repeat offender, and it's the
template's own primary call-to-action ("Programează o vizită" / "Programează-te pe WhatsApp" /
"Programează o consultație") — the button most owners will point customers at.
**Likely file:** `templates/portfolio/styles.css` (`.pf-chrome__cta`, `.hero-cta`, `.pf-appt__wa` — all
`color:#fff` on `background: var(--accent)`/primary); equivalent pattern in `templates/professionals/styles.css`.
**Evidence:** `screens/stage3/portfolio-orange-w390.png`, `screens/stage3/portfolio-orange-w1280.png`,
`screens/stage3/professionals-orange-w390.png`, raw numbers in `stage3-log.txt`.

## 2 [Major] Booking submit button unreadable on orange/pink accents

**Template/preset/colour:** professionals / cabinet-marin (dark "book" section), accent `#EA580C` and
`#DB2777`.
**Engine/width:** Chromium, 390 and 1280.
**Steps:** render professionals with the orange/pink accent, scroll to the booking form, measure
`.pr-appt__submit` ("Trimite cererea").
**Expected:** ≥4.5:1.
**Actual:** direct computed-style check: `color: rgb(168,63,8)` (dark orange) on
`background: rgb(240,140,79)` (light orange) → **2.16:1** for orange, **2.03:1** for pink — both real `rgb()`
values, not a probe artefact (see Methodology).
**Why it matters:** same dark "book" section that got a contrast fix for its `<select>` options in
Suite F (`b0ebce6`, `suite11-booking-select-readable.test.js`) — this is a second, un-fixed instance of the
same root cause (colours tuned for the shipped terracotta demo accent, not validated against the full range
of colours the builder actually lets an owner pick).
**Likely file:** `templates/professionals/styles.css` — `.pr-sec--book .pr-btn--primary { background:
var(--brass); color: var(--ink); }` (~line 579).
**Evidence:** `screens/stage3/professionals-trimite-cererea-orange-1280.png`, `stage3-log.txt`.

## 3 [Minor] Portfolio About-section caption below AA contrast

**Template/preset:** portfolio, all 3 presets (atelier-ivoire, studio-forma, atelier-ivoire-ro).
**Engine/width:** Chromium, 320.
**Steps:** load the About section, measure `.pf-about__num` ("01") and `.pf-about__cap` ("Salon"/"Studio").
**Expected:** ≥4.5:1 (normal-size text, not "large text" by WCAG's own size threshold).
**Actual:** `color: rgba(255,255,255,0.4)` on an effectively near-black background → **3.73:1**. Legible in the
screenshot, but under AA.
**Evidence:** `screens/stage1/portfolio-about-caption-contrast-320.png`.

## 4 [Minor/borderline] "Program" eyebrow label just under AA floor

**Template/preset:** portfolio, default + pink-accent variant (colour-independent — same low-opacity label
styling).
**Engine/width:** Chromium, 768.
**Actual:** 4.36:1 vs the 4.5:1 floor — a hair under, same opacity-label pattern as #3.
**Evidence:** `stage1-results.json` / `stage3-log.txt` (numeric only; not separately screenshotted).

## 5 [Minor] local-service hero CTA anchor undershoots `#contact`

**Template/preset:** local-service, renovari-bucuresti (default).
**Engine/width:** Chromium, 1280.
**Steps:** dismiss the cookie banner, click the hero "Cere o ofertă" button (`href="#contact"`), wait 500ms,
read `#contact`'s bounding rect.
**Expected:** `#contact` lands at/near the top of the viewport.
**Actual:** reproduced 3/3 runs — `#contact.top` ≈ 1018–1073px against a 900px-tall viewport, i.e. the section
header is below the fold after the "jump". A direct run (no cookie-banner interaction first) landed correctly
at top≈790. Likely cause: `.fade-in-section` reveal animations/image loads shifting document height shortly
after the native anchor-jump completes, so the browser's own scroll lands short of the now-taller page above
`#contact`. Not blocking (visitor is one scroll away from the target), but the "click to jump straight to the
form" promise slightly fails. desserdirina's identical `hero-cta → #contact` pattern did **not** reproduce
this in the same run.
**Likely file:** `templates/local-service/styles.css` (`.fade-in-section` transition) or `script.js`'s
IntersectionObserver reveal timing.

---

## Clean results (checked, zero exceptions found)

Across the full static matrix — **5 templates × all 12 shipped presets × widths 320/390/768/1024/1280/1920,
plus 844×390 landscape on default presets** (77 page loads, `stage1-results.json`):

- **Zero horizontal scroll** on any page/width.
- **Zero console errors, zero failed requests, zero HTTP 4xx/5xx.**
- **Zero CLS > 0.05** (PerformanceObserver `layout-shift`, 700ms settle after `networkidle`).
- **Zero heading-order violations** — exactly one `<h1>`, no level skips, on every page.
- **Zero missing `alt` attributes.**
- JSON-LD parses as valid JSON everywhere it is present (semantic/schema.org correctness not separately
  checked — see Coverage notes).
- Contrast probe self-test (synthetic black-on-white ≈21:1 / white-on-white ≈1:1 control, injected and
  measured with the exact same function used on real content) passed on **all 77** page loads before any
  reading from that page was trusted.

Interactive / owner-edit / device / keyboard / booking passes (`stage2-log.txt`, `stage3-log.txt`,
`stage4-booking-log.txt`, plus two precision re-tests below):

- **Nav toggle** (portfolio `#pf-nav-toggle`, professionals `#pr-nav-toggle`, product-menu `#pm-mast-burger`)
  at 390: correct `aria-expanded` toggling, ≥44×44 tap target, panel opens/closes, Escape closes and restores
  state.
- **Cookie banner** (portfolio, product-menu): shown on first load, Accept dismisses it, consent persists
  across reload.
- **Lightbox** (product-menu, portfolio, desserdirina): opens on photo click, Escape closes it.
- **desserdirina RO/EN menu-language toggle:** switches active state and `aria-pressed` correctly.
- **WhatsApp float:** visible with a ≥44×44 tap target on product-menu, portfolio, professionals, desserdirina
  at 390 and 1280.
- **Owner edits:**
  - Long business name (`Societatea de Renovări, Amenajări Interioare și Exterioare "Meșterul Popescu & Fiii"
    S.R.L.`) + a long multi-line address on professionals: no horizontal scroll at 390 or 1280.
  - Portfolio gallery with **exactly 1 photo**: no layout break.
  - Portfolio gallery with **20 photos** (cycled from the existing set): tiles stay uniform-width, no page
    overflow, at 390 and 1280 — confirms the `aed7665` gallery-sizing fix holds at both the 1-photo and
    20-photo extremes it was meant to cover.
  - Hidden section (`team: removed`) stays hidden; reordered sections (`services` before `gallery`) render in
    the requested order; structurally-required `about`/`contact` sections still render even when omitted from
    the owner's section list (server-side guardrail in `build.js`'s `NON_REMOVABLE_SECTION_IDS` holds).
- **Device emulation** (portfolio + professionals, 390): DPR 1.25, DPR 1.5, `prefers-reduced-motion: reduce`,
  `forced-colors: active`, dark `color-scheme` — no page errors, no horizontal scroll in any mode.
- **Keyboard walkthrough** (portfolio + professionals, first 12 Tab stops): every stop had a visible focus
  indicator (outline or box-shadow) — no invisible-focus traps found in this sample.
- **Native booking, end to end, against the real local server with a seeded tenant** — professionals (dark
  "book" section) and portfolio (light theme):
  - Happy path (choose service → day → time → submit) confirms correctly on both.
  - **Slot taken meanwhile:** re-tested precisely after an initial imprecise pass (see Methodology) — booking
    the identical slot server-side between selection and submit correctly downgrades the visitor's own request
    to the honest "pending" state (`Cerere înregistrată … Nu e o confirmare falsă`), never a fake "confirmat".
    Backed by a real `BEGIN IMMEDIATE` SQLite transaction in `bot/calendar-native/engine.js`.
  - **Double-submit:** re-tested with true concurrent `dispatchEvent('click')` × 2 + network capture — exactly
    one `POST /api/calendar-native/bookings` fires, exactly one DB row is created.
  - **Invalid email:** blocked (native HTML5 validity + widget stays on the form, no fake success).
  - **Very long name (300 chars):** no page overflow; the form's own `maxlength="80"` caps it.
  - **Network failure** (aborted `POST /bookings`): widget shows an honest RO error with WhatsApp/phone/email
    fallback contacts, never a fake success.

---

## Verified NOT bugs (caught before being reported — see brief's own artefact warning)

- **Overflow heuristic (24 flagged combos, 0 real):** a naive `scrollWidth > clientWidth` check flagged nav
  brand marks/CTAs (portfolio, professionals), a menu ticket label (product-menu), and desserdirina's
  hero/hero-content/contact-card at multiple widths including 1920. A deep-dive (ancestor-clip-rect walk +
  full-subtree `getBoundingClientRect` comparison against the container) showed **every one** was either (a)
  intentional `text-overflow:ellipsis` truncation on a `nowrap` label, correctly clipped by its own
  `overflow:hidden`, or (b) decorative pseudo-element/geometry (e.g. `.hero-content::before`'s soft radial
  bloom with `inset:-12% -8%`) that never visually extends past its clipping ancestor or the viewport. Zero
  real "text overflowing its box" bugs in the default-preset matrix.
- **"Broken images" (naturalWidth===0) on all 5 templates:** 100% were `<img id="wa-qr-img">` (WhatsApp QR
  modal) and `<img class="lightbox-img">`/`<img id="lightbox-img">`, both empty and `hidden` until JS
  populates them on interaction. Not broken; not visible until used.
- **desserdirina "invisible text" contrast alarms (ratio ≈1.0–1.06)** on the pink "Comandă acum" contact card
  and the active language pill: two independent probe blind spots, confirmed by direct screenshot/computed-style
  inspection — (a) the card's real fill is a `background-image` gradient, invisible to a `backgroundColor`-only
  compositing walk (screenshot shows a clearly-legible white-on-pink card); (b) the language pill's background
  is expressed as modern `color(srgb 0.57 0.17 0.31)` syntax, which an `rgba?\(...\)`-only regex silently failed
  to parse, defaulting to an assumed white background. Both are now-documented probe limitations, not site
  bugs — see Methodology.
- **local-service "WhatsApp float not visible":** by design. local-service renders a persistent bottom
  `.ls-dock` bar with its own call + WhatsApp buttons, and `body:has(.ls-dock) .whatsapp-float { display:none
  !important }` deliberately suppresses the redundant floating bubble so the two CTAs don't duplicate.
- **desserdirina "WhatsApp float overlaps a fixed element":** the "colliding" element is `.hero-background`,
  `position:fixed; z-index:-2` — a full-viewport parallax backdrop that sits behind every other layer by
  design. A 2D bounding-box overlap check without z-index awareness will always flag it; there is no possible
  visual stacking conflict.

---

## SEO tags — scope clarification, not a bug

Sites rendered directly through `build.js` (bypassing `bot/webpublish.js`) are missing `og:url`/`canonical` on
4 of 5 templates (all but local-service, whose demo preset happens to hardcode a canonical in its own
`presets.json`). This is expected, not a defect: `renderHtml()` only emits what's already in `config.seo`;
injecting the real deployed origin into `seo.canonical`/`og:url` is `webpublish.js`'s job at actual publish
time (`bot/webpublish.js` ~1860-1870), and is already covered by `bot/test/audit-publish-seo.test.js` and
`bot/test/of1-og-image-oracle.test.js`. Not re-verified end-to-end in this pass — flagged as out of scope
rather than silently assumed fine. `title`, `meta description`, favicon and `html[lang]` were present and
non-empty on all 12 preset combos.

## Known, being fixed elsewhere — not dug into, per the dispatch brief

- Booking day picker is a 14-day strip (`data-day-count="14"` observed on the rendered widget root) — a month
  calendar is reportedly being built by another agent.
- Landing-template-preview-broken-on-Windows: not applicable/testable from this macOS environment.

## Coverage notes — what this pass did and did not reach

The full brief's matrix (5 templates × every preset × 2 saturated colours × portrait/landscape × 6 widths ×
3 engines × every device-emulation axis × the complete interactive/booking/SEO/perf/a11y checklist) is very
large; this is what was actually run, stated plainly rather than implied as exhaustive:

- **Engines:** Chromium only (Firefox/WebKit not installed — see top of report).
- **Widths:** all 6 required widths run across the full 12-preset matrix; 844×390 landscape run on default
  presets only.
- **Saturated colours:** orange/pink applied via the builder's real HSL-derivation formula (not eyeballed) to
  all 5 templates at 390/1280, contrast-focused.
- **Owner edits:** long name/address + gallery 1-vs-20-photo + hidden/reordered sections run on
  portfolio/professionals (the templates that most exercise those features), not repeated across all 5.
- **Interactive:** nav toggle, WhatsApp float, cookie banner, lightbox, language toggle, anchor-scroll
  covered; the **local-service request form** was only exercised incidentally (via the anchor-scroll test),
  not with a full field-by-field validation pass; the **Instagram-connected stub-embed** path was **not**
  tested this round (budget) — flagged as untested, not assumed fine.
- **Device emulation + keyboard walkthrough:** portfolio + professionals only, not all 5 templates.
- **Booking E2E:** professionals (dark) + portfolio (light) only, not product-menu/local-service/desserdirina
  (only professionals ships the native-booking widget markup by default among the templates checked here per
  `templates/*/template.html`'s `@if appointment.nativeBooking` block — see the suite11 test file's own note
  that portfolio and professionals are the two templates carrying it).
- **Not covered at all this round:** WebKit/Firefox on any axis; JSON-LD *semantic* (schema.org field/type)
  correctness beyond "parses as JSON"; structured-data validity via an external validator; a full screen-reader
  pass (only a 12-stop keyboard/focus-visibility spot check was done, not a full AT walkthrough).

## Evidence index

- `stage1-results.json` — raw per-page audit data for all 77 static page loads (console/network/scroll/
  contrast-candidates/headings/images/SEO/CLS).
- `stage2-log.txt` — interactive-element pass/fail log (nav, WhatsApp float, cookie banner, lightbox, language
  toggle, anchor scroll).
- `stage3-log.txt` — saturated-colour, owner-edit, device-emulation, keyboard-walkthrough log.
- `stage4-booking-log.txt` — first-pass native booking E2E log (see note: double-submit/slot-taken lines in
  this file were superseded by the precision re-tests below).
- `screens/stage1/` (55 files) — full-page screenshots at 320/390/1280/1920 for every template×preset, plus
  the two manual deep-dive shots (`portfolio-about-caption-contrast-320.png`,
  `desserdirina-contact-card-gradient-falsepositive-320.png`).
- `screens/stage2/` (6 files) — nav-open and lightbox-open screenshots.
- `screens/stage3/` (37 files) — orange/pink accent screenshots per template/width, owner-edit variants,
  device-emulation screenshots, plus `professionals-trimite-cererea-orange-1280.png` (finding #2 evidence).
- `screens/stage4-booking/` (9 files) — confirmation/double-submit/slot-taken/network-failure screenshots per
  template, plus `professionals-slottaken-correct-pending-state.png` (the precision re-test proving correct
  behaviour).

## Methodology notes — probe self-checks that caught real false positives

Per the brief's explicit instruction to validate any contrast/overflow probe on a known-good element before
trusting it:

1. A synthetic black-on-white/white-on-white contrast control was injected and measured with the *same*
   function on every one of the 77 static page loads (`probeSelfTestOk` in `stage1-results.json`) — all 77
   passed (≈21:1 / ≈1:1) before any real-content reading from that page was used.
2. Every raw "overflow" and "broken image" candidate from the automated pass was individually re-verified by
   hand (ancestor-clip walk, full bounding-rect comparison, or direct DOM/computed-style inspection) before
   being written up — this is why the two sections above list specific false positives with root causes
   instead of a flat "no issues found".
3. Two probe blind spots were found and are now documented rather than silently producing wrong numbers:
   `background-image`/gradient fills are invisible to a `backgroundColor`-only compositing walk, and the
   modern `color(srgb …)` CSS colour-function syntax is not matched by an `rgba?\(...\)` regex. Any future
   contrast pass over these templates should be aware both patterns exist in the shipped CSS.
4. The initial native-booking "slot taken meanwhile" and "double-submit" checks bucketed the widget's
   `.hnb__result--ok` (confirmed) and `.hnb__result--wait` (pending) states together, which would have
   produced two false "MAJOR" findings. Both were re-tested with sharper assertions (distinguishing the two
   result classes; capturing the actual network response body; true concurrent `dispatchEvent` clicks) and
   found to be correct, well-engineered behaviour — see `screens/stage4-booking/professionals-slottaken-correct-pending-state.png`.
