# Instagram teaser — QA evidence

## Status: feature landed, merged, re-verified for real

The Instagram-teaser feature (an example Instagram grid shown only in the
builder preview, in edit mode, when Instagram is not connected) landed on
`main` at commit `5bf43f6` and is merged into this branch. This folder now
holds real measurements and screenshots against the actual shipped markup
and CSS — an earlier pass ran before the feature existed and honestly
reported that (see this file's git history); this pass supersedes it.

Everything below was produced against the REAL `builder/generated/engine.js`
bundle (`window.HidookEngine.renderPreview()`, the exact function
`builder/app.js`'s `buildSrcdoc()` calls for the real iframe srcdoc) with a
REAL Playwright click on `.hb-ig-teaser__badge` to reveal the section —
see `bot/test/lib/suite10-real-preview.js` for why the reveal is driven
through the real bundle instead of hand-simulated, and
`scripts/suite10-ig-teaser-evidence.js` for the capture script.

## 1. Contrast run — 5 templates x 3 themes x 2 widths

Run: `node --test bot/test/suite10-instagram-teaser-a11y-contrast.test.js`
(full per-combo output logged by the test; summary below).

**The CTA fix is confirmed working, everywhere.** `[data-hb-ig-connect]`
had zero contrast failures on all 5 templates x 3 themes x 2 widths.
`professionals` and `desserdirina` specifically — the two templates whose
CTA used to bind to the owner's accent colour (white-on-orange 3.39:1,
white-on-pink 4.37:1, per the fix's own commit) — now have **zero**
contrast failures of any kind (lead text included) on any theme or width.
Both now use a fixed near-white pill / near-black text
(`professionals`) or an equivalent fixed treatment (`desserdirina`) that
does not read the palette at all.

**The CTA-under-blur clickability fix is confirmed working, everywhere.**
A Playwright *trial click* (real actionability check — visible, not
obscured by another element, receives pointer events, without actually
triggering the connect action) on `[data-hb-ig-connect]` succeeded on all
5 templates x 2 widths after reveal. The `position:relative;z-index:1`
fix on `.hb-ig-teaser__veil` does what it says: the blurred grid no longer
swallows clicks meant for the button.

**Remaining real findings — lead text (`.hb-ig-teaser__lead`), not the
CTA — on the three photo-tile templates.** Exact ratios below vary by a
few hundredths between runs (the background is a real screenshot pixel
behind a blurred photo — blur/anti-aliasing sampling has normal run-to-run
jitter), and which exact width/theme combo trips also shifts slightly run
to run — so treat the table as "consistently 3.4–4.5:1, i.e. a genuine
near-miss," not as exact, reproducible-to-the-decimal numbers:

| Template | Width | Theme(s) failing (varies by run) | Ratio (need 4.5:1) |
|---|---|---|---|
| product-menu | 390px and/or 1280px | preset (default), Portocaliu and/or Roz | ~3.96–4.22:1 |
| portfolio | 390px | preset (default), Portocaliu | 3.49:1 |
| portfolio (CTA) | 390px & 1280px | Portocaliu | 3.47:1 |
| portfolio (CTA) | 390px & 1280px | Roz | 4.47:1 |
| local-service | 390px only | preset (default), Portocaliu and/or Roz | ~3.99–4.35:1 |

These three templates render real (blurred) photos behind the veil rather
than professionals' abstract tinted panels or desserdirina's fixed
treatment, and their `.hb-ig-teaser__veil` scrim is a fixed
`rgba(…, 0.55)` dark overlay — sufficient against a dark-averaging blurred
photo, not always against a lighter one. All failures above are near-miss
(3.47–4.47:1 against a 4.5:1 bar), not catastrophic, but real: measured
against actual rendered pixels post-reveal, not a CSS guess.

**The most solid, reproducible finding: portfolio's CTA still reads the
accent colour**, unlike professionals/desserdirina. `[data-hb-ig-connect]`
on portfolio measured 3.47:1 on Portocaliu and 4.47:1 on Roz on every run
of three (both widths, identical numbers each time — no jitter, unlike the
lead-text near-misses above), meaning portfolio's CTA still binds to
`var(--color-primary)`/equivalent the same way professionals/desserdirina
used to before their fix. This is a finding for whoever owns the teaser's
CSS, not something I fixed (out of scope for this pass — tests and
evidence only), but it is the one item here I'd flag as "definitely still
the pre-fix bug, not sampling noise."

**A bug in my own harness, caught and fixed before trusting any of the
above**: my first pass got wildly wrong background readings (e.g. lead
text on professionals apparently sitting on pure, undiluted accent orange
at 3.39:1/4.37:1 — the EXACT numbers the coordinator quoted as the
already-fixed bug). Root cause: Playwright's `.click()` auto-scrolls its
target into view, but `getBoundingClientRect()` is viewport-relative while
`page.screenshot({fullPage:true})` is document-relative — after the
reveal-click scrolled the page, the two coordinate systems disagreed and
the sampler read an unrelated part of the document. Fixed by resetting
scroll to `(0,0)` after all clicking and before measuring (see the test
file's comment at the fix site). Re-measuring after the fix is what
produced the clean professionals/desserdirina result and the realistic
near-miss numbers above — both readings are now anchored to a verified
scrollY=0 alignment between the rect and the screenshot pixel it's checked
against.

## 2. professionals' CSS-panel tiles — confirmed handled, not silently skipped

professionals ships exactly one real photo and uses 6 abstract tinted
`<li class="hb-ig-teaser__tile">` panels instead of `<img>` tags (see
`templates/professionals/styles.css`'s comment on why). This template
contributes zero entries to `suite10-instagram-teaser-never-published`'s
dynamic tile-filename collector (which only looks for `<img src>` inside
the section) — confirmed intentional, not a silent skip: the guard test
still fully covers professionals via (a) the unconditional marker check
(`hb-ig-teaser` / `data-hb-ig-teaser` / `data-hb-ig-connect` absent from
the public render) and (b) the byte-identical-to-baseline check, neither
of which depends on any filenames being collected. Zero filename
candidates means "nothing more to check on this axis for this template,"
not "this template wasn't checked."

## 3. Screenshots — 20 PNGs (5 templates x 2 widths x 2 states)

Captured by `scripts/suite10-ig-teaser-evidence.js`. Naming:
`<template>-<width>-01-rest.png` / `<template>-<width>-02-revealed.png`.
Raw per-shot data (console errors, horizontal-scroll flags, reveal/CTA
checks) in `capture-results.json`.

- **`*-01-rest.png`** proves the AT-REST state: badge visible
  ("EXEMPLU — AȘA VA ARĂTA PE SITE"), grid of 6 tiles **not blurred**
  (`.hb-ig-teaser` has no `.is-revealed` yet), veil absent (`hidden`).
- **`*-02-revealed.png`** proves the REVEALED state after a real click on
  the badge: grid blurred (`filter:blur(6px)` via `.is-revealed`), veil
  visible with lead text and CTA legible and centred over the blur, CTA
  sits correctly (the z-index fix — see contrast run above for the
  clickability re-verification, not just visual placement).
- Both states, at **390px** and **1280px**, for all 5 templates —
  confirms the layout (badge/grid/veil stacking, CTA position) holds at
  both a narrow phone width and a wide desktop width, not just one.
- Visually spot-checked: product-menu (real blurred photos, legible veil),
  professionals (abstract tinted panels, not a repeated single photo —
  confirmed NOT reading as a broken gallery), desserdirina at rest (6 real
  dessert photos, unblurred, badge visible, veil absent) and local-service
  revealed at 1280px (blue accent CTA, legible, correctly centred over the
  blurred grid, footer/legal/social rows unaffected below it).

**Console errors: none.** **Horizontal scroll: none** (`restScroll` /
`revealedScroll` both `false` on every one of the 10 template x width
combinations, at rest and revealed). One harness-only wrinkle worth
naming (not a product defect): `renderPreview()` points the WhatsApp QR
helper script at `/app/generated/qrcode.js`, a root-absolute path that
only resolves under the real builder server; the capture script patches
that one reference to a local copy purely so this harness's own
zero-console-errors result reflects the Instagram teaser, not an
unrelated pre-existing quirk of testing `renderPreview()` output outside
its normal iframe/server context. No production code was touched for
this — see `bot/test/lib/suite10-real-preview.js`'s comment at the fix
site. (A second, similar fix in that same file: it copies every asset
DIRECTORY a template ships next to its source files, not just `images/`
— desserdirina also ships its own `fonts/` directory, self-hosted
@font-face woff2s referenced by relative path, which a hardcoded
"images only" copy left 404ing in this harness even though the real
preview/publish serves them fine.)

## 4. On the leak-guard's baseline exemption (asked directly, answering here too)

The coordinator changed `assertNoTeaserLeak()` in
`suite10-instagram-teaser-never-published.test.js` to exempt a candidate
tile filename from the leak check when that exact filename was ALREADY
present in the frozen pre-teaser baseline (desserdirina's teaser reuses
real gallery photos like `cupcakes-1.jpg`, which legitimately appear on
the public page on their own merits). Assessment: this does not weaken
the guard. The baseline predates the teaser entirely, so anything in it
is guaranteed to be real, already-public content, not something the
teaser introduced — exempting it only removes a false positive, never a
real one. The byte-identical-to-baseline check (unexempted, unconditional)
remains the actual backstop: any change to the public render — including
a new way of reusing that same photo, or the teaser markup itself
appearing — still fails there regardless of the filename exemption. And
the "prove the guard is not vacuous" test calls `assertNoTeaserLeak()`
with no baseline argument at all, so the injected-teaser proof still runs
the strict, unexempted path. No objection.
