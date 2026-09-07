# Typography pass — 2026-09-07

Measurement-first typography review of the five generated templates
(`portfolio`, `local-service`, `product-menu`, `professionals`,
`desserdirina`). Method, raw data, and evidence live in
`04-QA-Evidence/Typography-Pass-2026-09-07/`:

- `measure.js` — builds each template's static export via
  `bot/site-export.js` `buildStaticSiteTree` (first preset in each
  `presets.json`), loads it in headless Chromium at 1440x900 and 390x844, and
  for every element with its own direct text records computed font-family,
  font-size, line-height, letter-spacing, max-width, container width, and
  observed **characters-per-line** (real wrap count from rendered box
  height / line-height, not an estimate from font metrics).
- `raw-measurements-before.json` / `raw-measurements-after.json` — full
  per-element output, before and after the changes below (~90-100 rows per
  template per viewport).
- `style-buckets-before.md` / `style-buckets-after.md` — the same data
  de-duplicated into distinct typographic styles per template/viewport, with
  body-copy CPL min-avg-max per bucket. **This is the measurement table
  required before any change; read it in full for the raw numbers.**
- `fallback-metrics.js` / `fallback-metrics-output.txt` — rendered-width
  comparison of the `Iowan Old Style, Palatino Linotype, Palatino, Georgia,
  serif` stack's fallback tiers.
- `clip-check.js` / `clip-check-before.txt` / `clip-check-after.txt` —
  scans every element containing a Romanian diacritic for actual overflow
  clipping (box overflows its content **and** overflow is not `visible`).
- `screenshots/{before,after}-<template>-<viewport>.png` — full-page
  before/after captures, all five templates, both viewports.

Run any of them with `node <script>.js` from that directory (they resolve
paths relative to the repo root).

## Verdict per template

| Template | Verdict |
|---|---|
| portfolio | One real defect: `.pf-series__b` category blurb had no `max-width`, measured 936px wide / 84-93 CPL on desktop. Fixed. |
| local-service | No change. All body copy (`.ls-text`, 608px cap) measures 33-63 CPL desktop, 30-42 mobile. Nothing exceeds 75. |
| product-menu | No change. `.pm-prose` (608px cap) measures 44.5-71.3 CPL desktop, well inside range; mobile narrows as expected for a 390px column. |
| professionals | No change. `.pr-copy`/`.pr-copy--lg` (608px cap) never exceeds 75 while wrapped; the few single-line answers over 75 chars are one line each, not a wrapping problem. |
| desserdirina | Two line-heights (`.about-text` 1.85, `.category-blurb` 1.75) sat outside the 1.5-1.65 body band with no CPL benefit. Tightened both to 1.6, matching the template's own body baseline. |

Three lines of CSS changed across two files. Three templates get an honest
"already right" verdict with the table to prove it.

## 1. Measure (characters per line)

Filtered `raw-measurements-before.json` for text blocks with `textLength >
40` (body-like), across both viewports, all five templates. Full numbers in
`style-buckets-before.md`; the only element outside 45-75 CPL **while
actually wrapping to more than one line** was:

- **portfolio, desktop, `.pf-series__b`** (category blurb under a photo
  wall heading, e.g. "Gel, acril, BIAB sau manichiura simpla - unghii
  ingrijite..."): `max-width: none`, rendered at the full `.pf-shell` column
  width (936px), one line, 84-93 characters. `.pf-copy` two paragraphs away
  in the same template already caps at `max-width: 36rem` (576px) for
  exactly this reason - `.pf-series__b` was the one body block in the
  template that never got that treatment. **Fixed**: same `36rem` cap.
  After: 576px, wraps to 2 lines, 42-46.5 CPL.

Everything else that reads low (30-42 CPL) is either:
- the shared cookie-consent card copy ("Folosim stocare locala..."), same
  CSS across all five templates, deliberately a narrow 200-270px floating
  card, not body prose; or
- mobile-width columns, where 30-45 CPL at 390px is the expected outcome of
  the viewport being narrow, not a defect (you cannot hit 60 CPL at 390px
  without an uncomfortably large or small font); or
- narrow multi-up card grids at desktop (`.pf-copy--sm` bios, 3-up grid,
  262-312px columns, 32-36 CPL) - a deliberate card-layout choice, not
  flowing body prose; narrowing further would be the actual violation.

Nothing measured **above** 75 CPL on a wrapped multi-line block except the
one fixed above.

## 2. Line-height

Grepped every `line-height` declaration in all five stylesheets (22 total
declarations). Display/heading line-heights all sit in 1.05-1.2 already
(portfolio 1.06/1.15, local-service 1.1/1.12/1.18, product-menu
1.12/1.15/1.2, professionals 1.12, desserdirina 1.05/1.15/1.2). Body
baselines are 1.5 (portfolio, local-service), 1.55 (product-menu,
professionals), 1.6 (desserdirina) - all inside 1.5-1.65.

Two exceptions, both in desserdirina, both now fixed:
- `.about-text` (the "Despre noi" paragraph): `line-height: 1.85` - well
  outside the 1.5-1.65 band, on a 6-line (desktop) / 10-line (mobile)
  paragraph, so it compounded into real extra scroll length for no CPL
  benefit (CPL was already a comfortable 50.5 desktop before the change).
  -> `1.6`, matching `body`'s own baseline.
- `.category-blurb`: `line-height: 1.75` -> `1.6`, same rationale.

Verified via `clip-check.js` before and after: **no diacritic clipping** on
any template/viewport in either state (sampled every element containing
a/a-breve/i-circumflex/s-comma/t-comma). Tightening 1.85->1.6 and
1.75->1.6 still leaves ample descender room and doesn't remove a line
from either paragraph (verified in `raw-measurements-after.json`: `lines`
unchanged, `charsPerLine` unchanged - only the vertical rhythm tightened).

## 3. Scale coherence - distinct font-size values (declared, per stylesheet)

```
portfolio        20 distinct declared font-size values (incl. 3 clamp()s)
local-service    17 distinct declared font-size values (incl. 2 clamp()s)
product-menu     15 distinct declared font-size values (incl. 2 clamp()s)
professionals    22 distinct declared font-size values (incl. 2 clamp()s)
desserdirina     30 distinct declared font-size values (incl. 6 clamp()s)
```

(Full literal lists captured via
`grep -oE "font-size\s*:\s*[^;]+;" templates/<id>/styles.css | sort -u` -
reproducible from the repo, not re-pasted here to keep this file short.)

professionals (22) and desserdirina (30) are the two outliers. Most of the
spread is small utility deltas (e.g. 0.85rem / 0.86rem / 0.88rem / 0.92rem
all exist as separate declarations within a couple px of each other) rather
than a designed type scale. **Not changed**: consolidating a 20-odd-value
scale into a tighter set touches dozens of selectors per template, none of
which is individually justified by a CPL, contrast, or line-height
measurement - it's a redesign, not a measurement-driven fix, and the task
is explicit that a large count is itself the reportable finding, not a
mandate to rescale. Recorded here so a future scale audit doesn't have to
re-derive it.

## 4. clamp() resolution

Every `font-size: clamp(min, Nvw, max)` in all five templates (18 total),
evaluated at 390/768/1024/1440/1920px. All 18 have a genuine mid-zone
(the pixel-width band where the value is neither pinned to MIN nor MAX) of
200-490px wide - none is a clamp "pretending to be responsive" (a
degenerate clamp would have a mid-zone near 0, i.e. min approx max, or a
vw term so steep it jumps straight from MIN to MAX). Narrowest mid-zone
found: portfolio's `clamp(1.05rem, 1.6vw, 1.3rem)` at 1050-1300px (still a
real 250px transition, just positioned between the 1024 and 1440 sample
points, so it doesn't show as "mid" in a 5-point spot-check - continuous
evaluation confirms it is not degenerate). Cross-checked against the
`fontSizePx` values actually observed in `raw-measurements-before.json` at
1440/390 - they match hand computation. **No change.**

## 5. Fallback stacks

**professionals + portfolio**: `Iowan Old Style, Palatino Linotype,
Palatino, Georgia, serif`. Availability by OS: Iowan Old Style is
macOS-only; Palatino Linotype is Windows-only; Palatino (no "Linotype") is
macOS; Georgia ships on macOS + Windows but not stock Android/Linux. So in
practice: **macOS visitor -> Iowan Old Style. Windows visitor -> Palatino
Linotype. Android/Linux visitor -> generic `serif`** (none of the four
named faces exist there).

This machine is a Mac, so `fallback-metrics.js` could only actually render
Iowan Old Style, Palatino (the closest available proxy for Palatino
Linotype - same Zapf design), and Georgia, plus whatever generic `serif`
resolves to locally. Measured on the real `.pf-copy` and `.pr-copy`
paragraphs (canvas `measureText` of a 49-character Romanian sample):

| Font requested | Sample width | Delta vs Iowan |
|---|---|---|
| Iowan Old Style | 349.1px | - |
| Palatino | 345.7px | -1.0% |
| Georgia | 344.2px | -1.4% |
| serif (generic) | 314.9px | -9.8% |

Line count and CPL on both real paragraphs were **identical across all four
fonts** (`.pf-copy`: 3 lines / 67.7 CPL; `.pr-copy`: 2 lines / 43 CPL) - the
width deltas here aren't large enough to move a wrap point in these
columns. Conclusion: **Mac vs Windows visitors see near-identical measure**
(under 1.5% width difference between the two OS-native fallback tiers).
Android/Linux visitors land on generic `serif`, ~10% narrower, which packs
*more* characters per line, not fewer - it tightens already-comfortable
columns toward the top of the 45-75 range rather than blowing past it. No
CSS change is justified by this measurement; the stack is not miscalibrated
for its actual fallback behavior, and rewriting it would need a webfont
(prohibited) to actually equalize it across OSes.

**local-service + product-menu**: `Helvetica Neue, Helvetica, Arial,
sans-serif` - a standard cross-platform sans stack (Helvetica Neue on
macOS, Arial substitutes near-identically on Windows/Linux/Android; the two
are metric-compatible by design). No measurement issue.

**desserdirina**: self-hosts Cormorant Garamond + Montserrat from
`templates/desserdirina/fonts/` (both SIL OFL, already in the repo, no
network request). Every visitor sees the same face regardless of OS - the
one template with no fallback question to answer.

## Changes made

1. `templates/portfolio/styles.css` - `.pf-series__b { max-width: 36rem; }`
   added (matches the existing `.pf-copy` cap in the same file). Measured:
   936px / 84-93 CPL uncapped -> 576px / 42-46.5 CPL capped, at 1440px
   desktop, first preset config.
2. `templates/desserdirina/styles.css` - `.about-text` line-height
   `1.85 -> 1.6`. Measured: outside the 1.5-1.65 body band; CPL and line
   count unaffected by the change (50.5 CPL / 6 lines before and after),
   only vertical rhythm tightened to match `body`'s own 1.6 baseline.
3. `templates/desserdirina/styles.css` - `.category-blurb` line-height
   `1.75 -> 1.6`. Same measurement and rationale as above.

No font-size was changed (contrast bar unaffected), no color changed, no
max-width/line-height change altered a CLS-relevant box before first paint
(both are static properties present from the first render, not
consent-triggered).

## Proof

- Before/after full-page screenshots, all five templates, both viewports:
  `04-QA-Evidence/Typography-Pass-2026-09-07/screenshots/`.
- `node --experimental-sqlite --test bot/test/*.test.js`: 419 tests, 418
  pass, 1 fail - `bot/test/flow3-legal-export.test.js`, the known
  pre-existing Brave-specific red. Nothing else regressed (contrast,
  touch-target, CLS, consent-clearance and no-foreign-brand oracles all
  green).
- `node --experimental-sqlite bot/test/fullpass-63230d2.mjs`: see
  `04-QA-Evidence/Typography-Pass-2026-09-07/fullpass-after.txt`.
- `node scripts/build-builder.js` run after the template edits.
