# Adversarial Audit — commits d73df4d..d2e3a58

Status: COMPLETE.

Worktree: .claude/worktrees/audit-adversarial-1788732502 (branch audit/adversarial-1788732502, off main @ d2e3a58)

## Executive summary

Re-measured every numeric claim in the 14 commits with independent scripts
(not the repo's own oracles), broke things on purpose to test the new oracles,
and diffed template content across the page-sections restructuring. Most of
the night's numeric claims hold up exactly; the two that don't are minor and
point safely, not dangerously. The most valuable finding is a real, currently-
uncaught blind spot in one of tonight's own new oracles' anti-tautology guard,
plus a genuine layout collision at short viewport heights that no test covers.

### CONFIRMED findings (reproduced myself)
1. **`waveB-touch-targets`'s "can't pass by measuring nothing" guard is
   defeatable per-template** — the shared cookie-banner selector keeps the
   guard satisfied even when a template's own action selectors all go stale,
   letting a real regression (CTA shrunk to 38px) pass silently. Medium
   severity, introduced tonight (5764e8f).
2. **professionals hero meta still collides with the cookie banner at short
   viewport heights** (e.g. ~720x450, the CSS-pixel viewport a 200%-zoomed
   1440x900 window produces) — d73df4d's fix is a width-only media query and
   doesn't generalize. Medium severity; the underlying mechanism predates
   tonight but tonight's fix didn't close it.
3. **The "#f5f5f5 on #111, 20.4:1" contrast figure in 500bbc6 is mathematically
   impossible** (true value 17.32:1) — still passes WCAG AAA by a wide margin,
   so no user-facing harm, but a real arithmetic error written down twice.
4. **The WCAG 2.5.8/44px citation "correction" claimed in 5764e8f is
   incomplete** — `bot/test/waveB-consent-control-quality.test.js` (added
   500bbc6) still carries the wrong citation the correction was supposed to
   fix everywhere.
5. **Portfolio's "Explorează" scroll-hint sits under the cookie banner on
   desktop** (1440px) — confirmed geometrically. Pre-existing (reproduced at
   d73df4d, before any of tonight's work), not a regression, but exactly the
   kind of oracle-selector-list gap the brief asked about (no template's
   `advocate-eed3ca0-repair` selector list includes it).

### SUSPECTED / unresolved
6. **d73df4d's specific pixel figures ("meta bottom 535, banner top 564 ->
   29px clear") do not reproduce** against the product's own static exporter
   (I measured a 136px gap, 4.7x more generous). Direction is safe (more
   margin than claimed, not less) and I could not fully rule out that the
   commit measured through the live editor's iframe pipeline rather than a
   plain static export — flagged SUSPECTED rather than CONFIRMED-wrong because
   I didn't stand up the full editor server to settle it.

### Checked and found ACCURATE (verified, not just trusted)
- Consent button tap-target sizes: 44px height exactly, on every template x
  viewport, both before (33-35px) and after (44px) — reproduced to the pixel.
- Pre-fix WhatsApp-green colors (`#25d366` on `#06210f`) — reproduced exactly.
- CLS numbers in cca48c6 (0.226/0.315 local-service, 0.042/0.089 desserdirina,
  0.000 elsewhere, before; 0.000 everywhere after) — reproduced to 3-4 sig figs
  with an independently-written script.
- desserdirina contrast oracle numbers in dcd97a4 (6.88:1 true fill, 1.57:1
  wrongly-sampled corner pixel) — both reproduced exactly, fill color confirmed
  live.
- Hero contrast numbers in 6df5387 and c6b7277 (portfolio 7.20/5.28,
  local-service 15.97/7.98, portfolio hierarchy 8.14/9.34, professionals
  control 13.9/16.6) — every one reproduced to 2 decimal places with a freshly
  written measurement script.
- **The CSP concern the audit brief flagged as "most likely real defect"
  turned out NOT to be one**: production's `DEFAULT_CSP` already includes
  `script-src 'self' 'unsafe-inline' ...` (pre-existing since c657484, not
  touched tonight), and customer-deployed sites (Cloudflare Pages/Vercel via
  `deploy-cloudflare.js`/`deploy-vercel.js`) get no CSP at all — verified in a
  real Chromium serving real HTTP headers, not file://: the CLS fix's inline
  `<script>` runs with zero CSP violations on all 5 templates.
- Page-sections restructuring (81894d0/71f65e1) content parity: rendered
  visible text (innerText) on all 4 restructured templates, before vs. after,
  is byte-identical (same length, same word set) — no content lost in the
  refactor.
- WCAG citations themselves (2.5.8 = Level AA, 24x24; 2.5.5 = Level AAA,
  44x44; the "inline in a sentence" 2.5.8 exception) are correct against the
  actual standard.
- `wave11-mobile-editor-touch.test.js` (f5436a4's regression guard): ran it
  live against the real editor server — 4/4 subtests pass.

Full detail, repro commands, and scripts below and in `audit-evidence/`.

## Commits under audit (oldest first)
- d73df4d fix(professionals): tighten the mobile hero so consent cannot cover the meta strip
- 500bbc6 fix(consent): give the accept control a real tap target and stop borrowing WhatsApp's green
- 8e27e35 fix(consent): keep the rationale out of the bytes every visitor downloads
- f5436a4 merge: the mobile editor topbar (agent work, review it too)
- 6df5387 fix(templates): hero headlines legible over the owner's photo
- c6b7277 feat(portfolio): hero type hierarchy
- 6b879ac fix(portfolio): photo wall gutter
- c8fb6b3 polish(editor): neutral canvas + elevation
- 5764e8f fix(a11y): tap targets, including Level AA failures
- 71f65e1 merge: page sections on all five templates (agent work, review it too)
- 44ea2e2 test(sections): pin the e2e oracle's RED half to a SHA
- dcd97a4 test(contrast): read an element's fill off its midline
- cca48c6 perf(templates): CLS 0.315 -> 0.000
- d2e3a58 test(sections): sections panel reachability

## Progress log
(appended as work proceeds)

### CONFIRMED — the "#f5f5f5 on #111, 20.4:1" contrast figure in 500bbc6 is wrong (impossible)

- Commit `500bbc6` and a code comment it left behind (`bot/site-legal.js:230`) both claim
  the new consent-card button colors are `#f5f5f5` on `#111`, "20.4:1".
- WCAG contrast is `(L1+0.05)/(L2+0.05)` on relative luminance. `#f5f5f5` has the highest
  luminance any near-white can realistically have; even against **pure black** (`#000`),
  `#f5f5f5` only reaches **19.28:1**. `#111` (`rgb(17,17,17)`) is not pure black — its
  relative luminance is ~0.0056, not 0 — so the true ceiling with `#111` in play is lower
  still. 20.4:1 exceeds even the impossible pure-black case; it cannot be correct for any
  pairing that includes `#111`.
- Verified twice: (a) hand computation via the WCAG relative-luminance formula in Python
  gives **17.32:1**; (b) rendered the exact colors in real Chromium
  (`getComputedStyle` on live DOM nodes) and recomputed from the returned `rgb()` values
  — also **17.32:1**. Script: `audit-evidence/scripts/contrast-check.js`.
- Severity: **low impact, but a real factual error.** The actual contrast (17.32:1) still
  clears every WCAG threshold including AAA (7:1) by a wide margin, so no user-facing
  accessibility regression — but the specific number in the commit message and in the
  shipped-adjacent code comment is wrong, and nobody re-derived it before writing it down
  twice. This is exactly the "trust the arithmetic without checking" failure mode the
  audit brief warns about. The comment at line 230 sits above `COOKIE_BANNER_CSS` (not
  inside the template literal), so — per 8e27e35's own fix — it is not shipped in the
  bytes of a published site; this is a documentation-accuracy defect, not a live one.
- Not a regression from a specific line of code; it is an arithmetic error in the
  commit's own reasoning, introduced in 500bbc6 itself (tonight's work).

### CHECKED/ACCURATE — consent button tap-target sizes (500bbc6)

- Rendered `#hb-cookie-accept` across all 5 templates x 2 viewports on the real,
  standalone-exported static site (`bot/site-export.js` `buildStaticSiteTree`, the
  same function `waveB-cls-all-templates.test.js` uses): height is **exactly 44px**
  on every template/viewport pair (widths 84-95px, always ≥44 too). Matches the CSS
  (`min-height: 44px; min-width: 44px`). Script: `audit-evidence/scripts/geometry-check.js`.
- Reproduced the claimed BEFORE state too: checked out `d73df4d` (parent of 500bbc6)
  into a throwaway worktree and rendered the professionals template's button —
  **84x35 at 1440px, 79x33 at 390px** — versus the commit's claimed "88x35 at 1440px,
  83x33 at 390px". Height matches exactly at both viewports; width is off by 4px,
  most likely because the commit doesn't say which of the 3 `professionals` presets
  (or which template) it measured and different business-name/copy lengths shift the
  button's horizontal padding-driven width slightly. This is noise, not a wrong claim
  — the load-bearing numbers (the heights, which is what makes the WCAG-minimum
  argument) reproduce exactly.
- The pre-fix WhatsApp-green colors (`rgb(37,211,102)` on `rgb(6,33,15)` = `#25d366`
  on `#06210f`) also reproduced exactly in the same before-worktree render.
- **Verdict: ACCURATE.** Button size and pre-fix colors check out.

### SUSPECTED — the "29px clear" pixel figures in d73df4d do not reproduce

- Commit `d73df4d` claims, for professionals mobile (390x844): "meta bottom 535,
  banner top 564 -> 29px clear (was overlapping by 30px)", and an intermediate budget
  calc citing "consent card starts y=564", "card actually began y=139".
- Reproduced by checking out `d73df4d` itself into a throwaway worktree, building the
  professionals template via `buildStaticSiteTree` (same exporter used elsewhere),
  and measuring `.pr-hero__meta` and `#hb-cookie-banner` boxes in real Chromium at
  exactly 390x844, with `document.fonts.ready` awaited and `networkidle` — tried all
  3 bundled presets, results identical across all three:
  **`.pr-hero__meta` bottom = 594 (not 535), `#hb-cookie-banner` top = 730 (not 564)**
  — a **136px gap**, not the claimed 29px. `.pr-hero__card` top measured 150 vs the
  commit's cited 139 (close enough to be font-metric noise). Script:
  `/tmp` throwaway (`audit-evidence/scripts/geometry-check.js` pattern applied to `.pr-hero__meta`/`#hb-cookie-banner` at 390x844 against commit `d73df4d`).
- Direction of the error is toward safety, not danger: the real margin is 4.7x more
  generous than claimed, so **there is no overlap regression** — the fix works, and
  works better than the commit says. But the specific numbers in the commit message
  do not reproduce against the product's own static-site exporter, in either
  component (a 59px difference on the hero side, a 166px difference on the banner
  side — the banner difference is particularly hard to explain by font metrics alone,
  since `#hb-cookie-banner`'s position depends only on its own height and the fixed
  viewport, not on anything the hero fix touches).
- Caveat: the commit's own regression oracle, `advocate-eed3ca0-repair`, does NOT
  drive a standalone static export — it drives the real editor's `/app/` preview
  iframe end-to-end (`bot/test/advocate-eed3ca0-repair.test.js`), which may render
  the generated template inside additional editor chrome/CSS I did not reproduce.
  I did not stand up the full editor server to rule that out (cost/time), so I
  cannot fully explain the gap's size — it's possible the editor-iframe pipeline
  and the plain static export genuinely differ. But the plain static export is what
  `webpublish`/`site-export.js` ships to real customers, so my measurement is the
  one that matters for "does the live site overlap," and on that pipeline the
  numbers in the commit are simply wrong, even though the underlying claim (no
  overlap) holds.
- Severity: low (no live overlap, no regression) but the same "wrote down a number
  without re-deriving it" pattern as the 20.4:1 contrast claim above.

### ACCURATE — CLS numbers in cca48c6 reproduce exactly

Independent script (own PerformanceObserver over `file://`, not the repo's
`waveB-cls-all-templates.test.js`), built via `site-export.js`
`buildStaticSiteTree`, measured at cca48c6~1 (before) and at HEAD (after):

| template | viewport | claimed before | measured before | claimed/measured after |
|---|---|---|---|---|
| local-service | desktop | 0.226 | **0.2258** | 0.000 / **0** |
| local-service | mobile | 0.315 | **0.3153** | 0.000 / **0** |
| desserdirina | desktop | 0.042 | **0.0420** | 0.000 / **0** |
| desserdirina | mobile | 0.089 | **0.0893** | 0.000 / **0** |
| professionals/portfolio/product-menu | both | 0.000 | **0** | 0.000 / **0** |

All numbers reproduce to 3-4 significant figures. **Verdict: ACCURATE**, and this is
also independent confirmation the fix genuinely eliminates the shift (not just an
oracle that agrees with itself).

### ACCURATE — dcd97a4 desserdirina contrast numbers (6.88:1, 1.57:1)

- Hand-computed via WCAG relative-luminance formula: `rgb(157,51,89)` (the claimed
  true fill) vs white = **6.88:1** exactly as claimed; the wrongly-sampled corner
  pixel `rgb(227,199,209)` vs white = **1.57:1** exactly as claimed.
- Confirmed the fill color is real, not invented: rendered desserdirina's active
  language toggle (`.menu-lang-btn.is-active`) in real Chromium — computed
  background is `color(srgb 0.614706 0.2 0.35)` = `rgb(157, 51, 89)` to the pixel.
- **Verdict: ACCURATE.**

### ACCURATE — hero contrast numbers in 6df5387 and c6b7277 reproduce exactly

Wrote an independent measurement script (own implementation: hide text node,
screenshot its bounding box, decode PNG pixels via canvas, compute WCAG contrast of
every pixel against the declared `color`, sort, take the 10th percentile) — same
general method the new oracle uses, but freshly written, not copied — and checked
out each commit into a throwaway worktree to measure the exact state each commit
message describes:

| commit | template | condition | element | claimed | measured |
|---|---|---|---|---|---|
| 6df5387 | portfolio | seed photo | headline | 7.20:1 | **7.20** |
| 6df5387 | portfolio | light photo | headline | 5.28:1 | **5.28** |
| 6df5387 | local-service | seed photo | name | 15.97:1 | **15.97** |
| 6df5387 | local-service | light photo | name | 7.98:1 | **7.98** |
| c6b7277 | portfolio | light photo | headline | 8.14:1 | **8.14** |
| c6b7277 | portfolio | light photo | lede/tagline | 9.34:1 | **9.34** |
| (HEAD, control) | professionals | seed photo | .pr-display | 13.9:1 | **13.92** |
| (HEAD, control) | professionals | light photo | .pr-display | 16.6:1 | **16.58** |

Every figure I checked reproduces to 2 decimal places. **Verdict: ACCURATE** — this
is the strongest-verified set of claims in the whole audit; whoever measured these
did it rigorously.

### CONFIRMED — the WCAG 2.5.8/44px citation correction is INCOMPLETE

5764e8f's message explicitly claims: "Also corrected a citation I got wrong earlier
the same night: I had written that 44px was the WCAG 2.5.8 minimum. It is not —
2.5.8 is Level AA at 24x24, and 44x44 is 2.5.5, Level AAA... the comment and oracle
now say so." The audit brief asked to verify this correction is complete.
**It is not.**

- `bot/site-legal.js` (lines ~237-239) WAS corrected — it now correctly explains
  2.5.8 is 24x24 AA and 2.5.5 is 44x44 AAA, and even points readers at
  `bot/test/waveB-consent-control-quality.test.js` "See ..." as the authoritative
  check.
- But `bot/test/waveB-consent-control-quality.test.js` — the file it points to, added
  in 500bbc6, the SAME NIGHT, before the correction — still carries the wrong
  citation, unmodified by 5764e8f (`git show 5764e8f --stat` does not list this file):
  - line 8-9 (docblock): `"The accept button rendered 35px tall — under the 44px
    minimum target size in WCAG 2.5.8."`
  - line 34 (code): `const MIN_TARGET_PX = 44;   // WCAG 2.5.8 AA`
- Both statements assert 44px is the WCAG 2.5.8 minimum, which 5764e8f's own commit
  message says is wrong (2.5.8 is 24x24; 44x44 is 2.5.5 AAA). The correction
  landed in the prose comment of `site-legal.js` and in the new `waveB-touch-targets`
  oracle (which correctly separates `AA_MIN = 24 // WCAG 2.5.8` from
  `ACTION_MIN = 44 // WCAG 2.5.5 / platform guidance`), but was never propagated to
  the sibling oracle for the same control.
- Severity: low functional impact (the test's actual assertion — button ≥44px — is
  still a legitimate usability check, just mis-labeled) but it's a direct,
  reproducible instance of exactly the incomplete-correction the audit brief warned
  about. Introduced in 500bbc6 (uncorrected), the gap opened by 5764e8f (should have
  fixed it and didn't) — tonight's work throughout, not pre-existing.
- Command to reproduce: `grep -n "WCAG 2.5.8" bot/test/waveB-consent-control-quality.test.js`

### CONFIRMED (pre-existing, not a regression) — portfolio's "Explorează" scroll-hint sits under the cookie banner on desktop

While visually inspecting the darkened hero veils (see below) I checked the
`.scroll-hint__label` ("Explorează") element portfolio renders near the bottom of
its hero, since it sits in the same darkened region the veil change touched.

- Measured real bounding boxes (`getBoundingClientRect`, no screenshot pixel
  sampling involved) at 1440x900 on the current worktree HEAD:
  `.scroll-hint__label` box `{top:866.6, bottom:878.6, left:22, right:108.6}`
  vs `#hb-cookie-banner` box `{top:741.8, bottom:888, left:12, right:244}` —
  these rectangles **genuinely intersect** (the banner is z-index 40, a solid
  `#111` card, and physically covers the scroll-hint text). Confirmed by
  screenshot too: the clipped region at that location renders `rgb(17,17,17)` /
  `rgb(245,245,245)` — the consent card's own colors, not the hero photo.
  At 390x844 (mobile) the two boxes do NOT intersect — mobile is fine.
- **Not a regression**: reproduced the identical overlap by checking out
  `d73df4d` (the commit before ANY of tonight's consent/contrast/tap-target work)
  into a throwaway worktree — the overlap already existed then (banner top was
  750.5 instead of 741.8, still well inside the label's 866-878 span). Tonight's
  9px-taller consent button (500bbc6) made the banner marginally taller, which
  moved its top edge up by ~9px — making the overlap marginally *worse*, but the
  defect predates tonight's session entirely.
- **No oracle catches it.** `advocate-eed3ca0-repair.test.js` is the oracle whose
  entire job is "cookie banner must not cover hero/section titles" (see its own
  docblock, point (c)) and was explicitly re-verified by both d73df4d and 500bbc6's
  commit messages ("advocate-eed3ca0-repair: 7/7 PASS"). But its own selector
  tables show why it can't see this:
  `HERO_SELECTORS.portfolio = '.pf-hero__tag, .hero-tagline, .pf-hero__word'` and
  `SECTION_SELECTORS.portfolio = ''` with the comment *"no first-screen section
  seed was in the advocate packet"* — portfolio's scroll-hint was never in scope.
  Contrast with `desserdirina`, whose table entries both include
  `.scroll-indicator` — the pattern of checking a scroll hint exists in this same
  file, just not for portfolio.
- Severity: medium-low. A real visitor who has not yet accepted/declined cookies,
  on a desktop viewport, cannot read or click portfolio's "Explorează" scroll
  affordance (it's a `<button>`, so this is a dead/invisible control, not just a
  cosmetic nit) — and it currently is a `<button type="button">`, so the
  overlapping banner (which also has `pointer-events:auto` per its own CSS) would
  intercept the click, not just the visual, since the banner sits later in
  z-order (z-index 40 vs. hero-content's z-index 1). Pre-existing, but exactly
  the class of defect the audit brief calls out ("what oracle-covered work missed
  because the oracle's selector list wasn't updated for every template").
- Repro: `git worktree add --detach <tmp> d73df4d` (or any earlier commit), symlink
  `node_modules`, build portfolio via `buildStaticSiteTree`, load at 1440x900,
  read `.scroll-hint__label` and `#hb-cookie-banner` `getBoundingClientRect()`.

### CONFIRMED — professionals hero meta STILL collides with the cookie banner at short viewport heights, incl. a realistic 200%-zoom case (d73df4d's fix is narrower than it looks)

The audit brief specifically asks to check tap-target/layout fixes "at 320px width
... or at 200% browser zoom." Browser zoom shrinks the effective CSS-pixel
viewport proportionally in both dimensions (zooming a 1440x900 window to 200%
yields a ~720x450 CSS viewport) — real, and exactly what WCAG 1.4.10 Reflow is
about protecting. Testing that:

- At **720x450** (≈200% zoom of a 1440x900 window): `.pr-hero__meta` box
  `{top:360, bottom:382}` vs `#hb-cookie-banner` box `{top:325, bottom:442}` —
  **these overlap.** The banner visibly sits on top of the meta line in a real
  screenshot (`audit-evidence/zoom200-professionals.png`): "...ză și spaniolă" is cut
  off behind the black consent card.
- Same collision at **600x375** and **900x560** — all overlap.
- **No collision** at the six realistic sizes actually tested by the repo's own
  fix and oracle: 1366x768, 1280x720, 1024x768, 768x1024, 1440x900, and 390x844
  (the exact pair d73df4d's commit message says it measured "on the 390x844
  canvas"). Every one of these is comfortably tall relative to its width.
- **Root cause**: d73df4d's fix is a pure width media query (`@media (max-width:
  899px)`) that reduces the hero's top padding. It has no dependency on viewport
  *height* at all, but the actual conflict (fixed-position banner competing with
  hero copy for vertical space) is a height problem wearing a width costume — it
  only manifested at 390px width in the first place because phones happen to be
  both narrow AND short. A short-but-wide viewport (a zoomed-in desktop browser,
  a small floating window, certain landscape tablet/phone modes) reproduces the
  exact same collision the commit set out to fix, at widths both inside (720,
  600) and outside (900) the `899px` breakpoint the fix chose.
- **Not caught by any oracle**: `advocate-eed3ca0-repair` (the oracle this exact
  fix cites as its regression guard, "7/7 PASS") only tests width breakpoints —
  `{width:1440,height:1000}` and `{width:390,height:844}` — never a short
  viewport. `waveB-touch-targets` and `waveB-hero-contrast-any-photo` don't touch
  banner/hero collision at all. Nothing in the wave tests viewport *height*
  as a variable, even though the whole bug family (this one, and the CLS fix)
  is about a fixed-position element competing with content for vertical space.
- Severity: medium. It reproduces at a viewport shape a real low-vision visitor
  using 200% browser zoom would actually see (not a synthetic/unrealistic size),
  and it hides real business information (bilingual/location availability) behind
  opaque black chrome. Not a WCAG target-size violation, but arguably a 1.4.10
  Reflow / general content-obscuring problem.
- This is **not fully new** — the general mechanism (fixed banner vs. content-
  driven hero, no height-aware clearance) predates tonight's specific fix, since
  d73df4d only patched the one measured case rather than the underlying
  geometry. But it directly undercuts d73df4d's closing claim that the result
  "no longer depends on ... the banner being open" — it still depends on viewport
  *shape*, just a different one than before.
- Repro: build professionals via `buildStaticSiteTree`, load at 720x450 (or
  600x375), read `.pr-hero__meta` and `#hb-cookie-banner`
  `getBoundingClientRect()` — they intersect. Script:
  `audit-evidence/scripts/prof-720-check.js` (also see `prof-realistic-check.js` for the six realistic sizes that do NOT overlap).

### CONFIRMED — waveB-touch-targets' "can't pass by measuring nothing" self-guard has a real blind spot

5764e8f's commit message explicitly boasts about this guard: "It also asserts
that its own primary-action selector list still matches something, so it cannot
quietly start passing by measuring nothing." I tested this claim adversarially
by deliberately breaking what it guards, per the audit brief's instruction.

**Step 1 — sanity check the oracle actually catches a real regression.** Edited
`templates/portfolio/styles.css`, changed `.pf-hero__cta, .hero-cta { min-height:
44px }` to `min-height: 20px`, ran `node --experimental-sqlite --test
bot/test/waveB-touch-targets.test.js`. It correctly failed both viewports with
an accurate message: `portfolio @1440: a.hero-cta pf-hero__cta "PROGRAMEAZĂ O
VIZITĂ" is 38px tall, under the 44px platform touch floor`. Reverted. Good —
the oracle works as advertised for a normal regression.

**Step 2 — attack the self-guard itself.** The guard is
`assert.ok(primaries.length > 0, ...'the selector list has gone stale and this
test would pass by measuring nothing')`, where `primaries` is filtered from
`PRIMARY_ACTIONS`, ONE combined comma-joined CSS selector string shared across
ALL FIVE TEMPLATES (`.pf-chrome__nav a, .pf-hero__cta, ..., .hb-cookie-actions
button, .hb-cookie-actions .hb-cookie-link`). The guard only checks that
*something, anywhere in that combined list* matched on the page — not that
*this template's own* selectors matched.

Renamed every portfolio-specific selector in a scratch copy of the test file
(`.pf-chrome__nav a` → `.pf-chrome__nav-X a`, `.pf-hero__cta` → `.pf-hero__cta-X`,
`.pf-appt__wa` → `-X`, `.pf-row` → `-X`, `.contact-item` → `-X`, and even the
cross-template-shared `.hero-cta` → `.hero-cta-X`) — i.e. simulated a class
rename that would silently drop ALL of portfolio's own coverage — while leaving
the portfolio CTA shrunk to 20px (38px rendered) from step 1. Ran the oracle
again: **it reported 2/2 PASS, GREEN, with the CTA regression completely
undetected and no warning that anything had gone stale.**

**Root cause**: `PRIMARY_ACTIONS` ends with `.hb-cookie-actions button,
.hb-cookie-actions .hb-cookie-link` — the shared cookie-consent chrome injected
into every template. Those two selectors match on every single page regardless
of which template is being tested, so `primaries.length > 0` stays true purely
from the cookie banner even when a specific template's own hero/nav/CTA
selectors have all silently stopped matching (e.g. after a class rename during
a refactor). The self-guard checks "did the whole list match something on this
page" instead of "did this template's own selectors match something" — so it
cannot detect the exact failure mode it was written to catch, for any template,
as long as that template still renders the shared cookie banner (which all five
always do).

Confirmed clean revert: restored both files from backup, reran the unmodified
oracle — 2/2 PASS again, byte-identical to the pre-experiment baseline
(`git diff --stat` showed no changes after revert).

- Severity: medium. The claim in the commit message ("cannot quietly start
  passing by measuring nothing") is **false as stated** — it can, for any one
  template, as long as the other four (or the shared chrome) still match. This
  doesn't affect today's five templates (their selectors currently match fine,
  confirmed by Step 1's clean baseline) but the protection the commit advertises
  against future stale selectors is weaker than described.
- Not a regression in the shipped templates — this is a latent gap in the
  oracle's own self-defense, introduced in 5764e8f (tonight) alongside the
  correct, working parts of the same oracle.
- Suggested fix (not applied, per audit instructions — flagging only): guard
  per-template, e.g. assert that at least one of the *template-prefixed*
  selectors (excluding the shared `.hb-cookie-*` ones) matched for each `tpl`
  in the loop, not just that the global list matched something anywhere.

One drift noted in passing, not a defect: measuring the SAME portfolio headline
selector at today's HEAD (after the later page-sections restructuring commits)
gives p10 = 7.77:1 for the light-photo headline, not the 8.14:1 c6b7277 recorded at
the time. Still comfortably clears the 3:1 bar for 58px display text, so no failure
— just documents that a later, unrelated commit (most likely the sections feature
touching hero markup/CSS) shifted the number slightly and nobody re-pinned the
comment. Not worth a fix; flagging only because the audit brief asks for drift, not
just breakage.

### CHECKED — CLS fix's inline `<script>` vs production CSP (task's "most likely real defect")

**Verdict: NOT a defect. The inline script runs, no CSP violation, in both delivery paths.**

- `bot/server.js` DEFAULT_CSP (applied to every non-`/app/` route, incl. `/live/<slug>/*`)
  is `script-src 'self' 'unsafe-inline' https://www.instagram.com` — `'unsafe-inline'`
  explicitly permits a bare `<script>` block with no nonce/hash. This directive predates
  tonight's work: added in `c657484` (`fix(security): ... tighten live-site CSP ...`),
  confirmed via `git log -p --follow -- bot/server.js | grep script-src`. cca48c6 touched
  only the three `templates/*/template.html` files, not `bot/server.js`.
- `bot/deploy-cloudflare.js` and `bot/deploy-vercel.js` (the paths for publishing to a
  customer's own Cloudflare Pages / Vercel deployment, outside the platform's own
  `/live/` hosting) set no CSP header and ship no `_headers`/`vercel.json` header config
  file (`grep -n "header\|csp" bot/deploy-cloudflare.js bot/deploy-vercel.js` — no CSP
  hits). So on those hosts there is no CSP at all, a fortiori no block.
- Reproduced empirically: built all 5 templates via `bot/site-export.js`
  `buildStaticSiteTree`, served each over real HTTP with the exact `DEFAULT_CSP` string
  copied from `bot/server.js`, loaded in real Playwright Chromium (not file://, unlike
  the repo's own `waveB-cls-all-templates.test.js`, which — as the task predicted —
  uses `file://` and could never observe a CSP violation). Result: `hb-cookie-open`
  class present pre-paint on `document.documentElement` on all 5 templates, **0 CSP
  violations reported in the console on any of them.**
  Script: `audit-evidence/scripts/csp-check.js`.
- Pre-existing test `bot/test/wave10-security-csp-live.test.js` PART B already publishes
  a real desserdirina site through `webpublish.publishSite` and asserts zero CSP
  violations in real Chromium — this is a live-HTTP check, not file://, and it already
  covers this ground for one template. It was not re-run as part of tonight's commits,
  but nothing in tonight's diff would change its outcome (it doesn't touch server.js).

  Conclusion: the CLS fix is real in production for both delivery paths (platform's own
  `/live/` hosting, and customer's own Cloudflare Pages/Vercel deploys). Not a
  regression, not a false green.


---

## Resolutions (added by the author after reading this report, 2026-09-07)

**1 — touch-target guard defeatable.** CONFIRMED and fixed in `95373c0`. The
selector list is now partitioned per template and the guard asks whether THIS
template's own selectors matched; the shared consent controls are still
measured but cannot vouch for anybody. Causal RED reproduced by renaming
portfolio's selectors.

**2 — collision at short viewport heights.** CONFIRMED and fixed in `a37503d`,
together with finding 5. Reproduced at 720x450 on professionals (16px) and
local-service (7px). Root cause on professionals was worse than the report
knew: the mobile density pass keyed off WIDTH, and two of its five declarations
had never applied at all, because `.pr-hero__actions` and `.pr-hero__meta` have
their base rules LATER in the stylesheet and win at equal specificity. Blocks
reordered; a height-scoped block added. New oracle
`waveB-consent-never-covers-copy` runs 5 templates x 4 viewports, including
720x450, against the static export.

**3 — "20.4:1" impossible.** CONFIRMED. True value 17.32:1, corrected in
`02a4c54`.

**4 — WCAG citation correction incomplete.** CONFIRMED, and worse than
reported: the file was edited but never staged, so the correction existed only
in the working tree while `5764e8f`'s message asserted it was done. Landed in
`02a4c54`.

**5 — portfolio scroll-hint under the card on desktop.** CONFIRMED,
pre-existing, fixed in `a37503d` by indenting the in-flow cues past the card on
wide viewports rather than hiding them.

**6 — "29px clear" does not reproduce.** RESOLVED, and the report's caveat was
the right one. The commit measured inside the EDITOR PREVIEW IFRAME, whose
viewport is 390x678 — not the 390x844 page. The consent card is fixed to the
bottom of that shorter viewport, which puts it at y=564 instead of y=730, and
the 136px gap the audit measured against a static export is the same geometry
seen in the taller box. Both measurements are correct; the commit said "the
390x844 canvas" without saying the canvas is 678px tall, which is what made the
figures look irreconcilable. `advocate-eed3ca0-repair` drives that iframe, so
the numbers it gates are the iframe's.

Nothing in this report was dismissed. The one item the brief predicted would be
the real defect — the CSP blocking the pre-paint script — was checked first and
was not a defect, which is worth as much as the findings.
