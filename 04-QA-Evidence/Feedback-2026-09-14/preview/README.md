# Suite D — landing "Previzualizare" modal, cross-engine/cross-condition

PLAN-FEEDBACK-2026-09-14.md, Suite D. Owner report: clicking "Previzualizare"
on a template in the landing "Designuri" gallery opens `#modal-preview` with
the design in `#preview-modal-iframe`; works on the owner's Mac (Safari), not
on Windows, no error text given.

Test: `bot/test/suite12-template-preview-cross-env.test.js`. Run with
`node --experimental-sqlite --test bot/test/suite12-template-preview-cross-env.test.js`.

## Engines actually run

**Only Chromium.** Firefox and WebKit are not installed for Playwright in
this environment:

```
browserType.launch: Executable doesn't exist at
  /Users/Work/Library/Caches/ms-playwright/firefox-1538/firefox/Nightly.app/...
browserType.launch: Executable doesn't exist at
  /Users/Work/Library/Caches/ms-playwright/webkit-2336/pw_run.sh
```

The suite detects this at startup with a real launch attempt (not an
assumption) and skips those engines with an explicit printed reason. It does
not download browsers — no network calls beyond localhost, per the task
rules. No Firefox/WebKit results are claimed anywhere in this report.

## Condition matrix (Chromium; 5 templates × 7 conditions = 35 runs, plus one
dedicated regression test — 36 assertions total, all currently green)

| Condition | What it emulates | Result |
|---|---|---|
| baseline | Desktop viewport, DPR 1, no motion/contrast prefs | Pass — all 5 templates render, no stuck opacity, no console errors |
| dpr125 | Windows 125% display scaling (`deviceScaleFactor: 1.25`) | Pass |
| dpr150 | Windows 150% display scaling (`deviceScaleFactor: 1.5`) | Pass |
| reducedMotion | `prefers-reduced-motion: reduce` (Windows "Animation effects" off) | Pass |
| forcedColors | `forced-colors: active` (Windows High Contrast) | **Failed before the fix below; passes after it.** |
| shortViewport | 1024×620 — a Windows-laptop-class screen after taskbar + scaling, standing in for the "classic, width/height-consuming scrollbars and chrome" the plan asked about (Chromium already renders classic, non-overlay scrollbars in headless mode on every OS this suite runs on — there is no macOS-overlay-scrollbar mode to compare against locally) | Pass |
| windowsUA | Windows Chrome/Edge User-Agent + platform string, to catch any (undiscovered) `navigator.platform`/`userAgentData` branch | Pass |

Each cell asserts, against the REAL landing modal (not a source-code check):
visible rendered text (not a blank iframe), zero elements with a non-zero
rendered box left at computed `opacity: 0` once the preview reports itself
ready (`#preview-modal-iframe[data-preview-ready="true"]`, the same contract
`builder/app.js`'s own `waitForInteractivePreview` waits on), and zero
console/page errors (with one documented, pre-existing, unrelated exception —
see "Other defect found" below).

Screenshots: `chromium/<condition>/<templateId>.png` (36 in this run).
Machine-readable counts: `run-summary.json`.

## Root cause found and fixed (Suite D's actual answer)

**Windows High Contrast mode (`forced-colors: active`) makes desserdirina's
floating WhatsApp button unrecognizable and its scroll-cue line disappear.**

This is real, Windows-specific (forced-colors is essentially a Windows/Edge/
Chromium-on-Windows condition — there is no equivalent way to trigger it on
macOS Safari), and reproducible with zero platform sniffing:

1. `.whatsapp-float`'s `#25D366` green background and its `<svg>` icon's
   `fill: currentColor` (→ white) are *independently* remapped by the
   browser's forced-colors palette — both ended up computing to the exact
   same white, so the WhatsApp glyph vanished into its own button (the one
   recognisable conversion CTA on the page). Confirmed via computed style
   before the fix: `background-color: rgb(255,255,255)`,
   `svg { fill: rgb(255,255,255) }` — identical.
2. `.scroll-line`'s `background: linear-gradient(...)` has no solid-colour
   fallback. Forced-colors mode strips *generated* CSS gradients outright
   (an actual image resource, e.g. a `background-image: url(data:image/svg+xml,…)`
   like the OTHER four templates use for their identical WhatsApp icon, is
   left alone — only `<gradient>` values are stripped). With no fallback,
   the line was fully transparent: confirmed `background-image: none`,
   `background-color: rgba(255,255,255,0)`.

Screenshots: compare
`chromium/forcedColors/desserdirina.png` (after the fix — button and line
visible) against the pre-fix capture described below; the other four
templates' `forcedColors/*.png` already showed correctly-visible WhatsApp
icons throughout (they draw the icon as a `background-image` data URI, which
forced-colors does not touch), confirming this is specific to desserdirina's
inline-`<svg>`-plus-gradient approach, not a universal template problem.

**Fix**: `templates/desserdirina/styles.css` — `forced-color-adjust: none;`
added to `.whatsapp-float`, `.whatsapp-float svg`, and `.scroll-line`. This
opts those three brand-colour/decorative elements out of the forced-colors
remap (the standard, spec-sanctioned technique for a logo-like graphic that
must stay legible/recognisable regardless of contrast mode), without
weakening forced-colors support anywhere else on the page — no other element
in any of the five templates matched the "explicit opacity/gradient +
solid-background-plus-icon" combination that broke here (checked: the other
four templates' identical WhatsApp buttons all use a `background-image` data
URI icon, immune to this by construction).

**Failing-first evidence**: reverting the CSS fix and re-running the suite
reproduces exactly this, and only this, failure:

```
✖ chromium / forcedColors / desserdirina
  AssertionError: DEFECT (forced-colors): .whatsapp-float lost
  forced-color-adjust:none — its green background and white icon would be
  remapped to the same colour again
  'auto' !== 'none'
ℹ tests 36 / pass 34 / fail 2
```

(2 fail = the parent test wrapper plus the one real subtest — Node's test
runner counts both.) With the fix restored: 36/36 (37/37 once the second
regression test below is included) pass.

## Second, real robustness defect found along the way (not Suite D's answer,
but fixed anyway)

`templates/desserdirina/styles.css`'s `.fade-in-section .service-card` (the
"specialties" grid inside `#about`) starts at `opacity: 0` with a plain CSS
`transition`, raised to `opacity: 1` only once an `IntersectionObserver`
adds `.visible` to its ancestor section — no CSS `animation` involved. The
preview's "universal forcer" (`scripts/build-builder.js`, `data-hidook-
forcer`) used to only rescue elements whose stuck `opacity: 0` came from a
CSS `animation`; this transition-driven pattern slipped through. Desserdirina
was also the only one of the five templates missing the `<noscript><style>…
opacity:1!important…</style></noscript>` "visible without JS" fallback block
every sibling template carries — which the preview's own "belt-and-
suspenders" step (in the same file) re-activates unconditionally inside
every srcdoc preview specifically to catch exactly this kind of gap.

**Not reachable through the landing gallery** as reported (desserdirina's
own preset ships `services: []`, so `.service-card` never renders there —
confirmed via `run-summary.json`: `stuckCount: 0` for every desserdirina row
above, honestly). It IS reachable the moment a real customer's edited config
populates `services` and opens the preview in the editor canvas — same
`srcdoc`/forcer/noscript mechanism as the landing modal. Also a genuine,
independent accessibility bug: a real visitor with JavaScript disabled would
never see that grid at all.

Whether it bites is a pure layout-geometry accident, worth recording:
desserdirina's `<header class="hero">` is exactly `100vh` tall, so the very
next section sits with its top AT `window.innerHeight` — the same boundary
the plan's "fractional DPR breaks IntersectionObserver thresholds and
sub-pixel math" hint describes.

**Fix**: (1) `templates/desserdirina/template.html` gained the missing
noscript block; (2) `scripts/build-builder.js`'s forcer now also rescues
`opacity: 0` elements with an explicit, non-`"all"`, `opacity`-listing
`transition-property` — audited against every current template's CSS (see
that file's comment) to confirm no permanently-hidden UI (closed mobile
nav, lightbox, cookie banner, visually-hidden native form controls) matches
that condition; those all gate on `max-height`/`visibility`/`display`, never
an explicit opacity transition list.

**Failing-first evidence**: `bot/test/suite12-template-preview-cross-env.test.js`'s
second test (`desserdirina: below-the-fold .service-card is not stuck at
opacity 0 once populated`) populates `services`, renders at a 1024×620
viewport (confirmed via the test's own assertion that `.about-card` sits
below the fold), and asserts none of the three cards is stuck at
`opacity: 0`. Reverting either half of the fix independently reproduces the
failure (checked manually — see the session's commit history / this suite's
own comments for the exact assertion).

## A pre-existing, engine/OS-agnostic issue found but explicitly NOT fixed
here (out of scope for Suite D — not a Mac-vs-Windows difference)

Every desserdirina preview (`baseline` condition included) logs ~20 console
errors: its self-hosted `@font-face` fonts fail to load —

```
Access to font at 'http://127.0.0.1:PORT/app/fonts/montserrat-400-normal-latin.woff2'
from origin 'null' has been blocked by CORS policy: No 'Access-Control-Allow-Origin'
header is present on the requested resource.
```

Cause: desserdirina's `styles.css` is inlined as a `<style>` block for every
srcdoc preview, so its `@font-face { src: url('fonts/…') }` declarations
resolve relative to the PARENT builder page's URL (a `srcdoc` document with
no `allow-same-origin` has no independent base) instead of any real font
route — `/app/fonts/…` does not exist; the files live under
`templates/desserdirina/fonts/`. Already flagged, without a fix, in
`bot/test/suite9-preview-sandbox.test.js`'s file comment. This is identical
on every engine and every condition — it is not what Suite D investigates.
The real fix (inlining ~870KB of font files as `data:` URIs in preview mode,
the same technique already used for images) is a bigger, separately-scoped
change that would add real weight to every editor re-render, not just the
landing modal, and does not belong in this diagnosis. `suite12`'s console-
error assertion filters exactly these font-CORS messages for desserdirina
(and only for desserdirina), counts them separately
(`run-summary.json`'s `knownFontIssueCount`, consistently 20 per
desserdirina run here), and would still fail on any OTHER unexpected
console error for any template.

## What was tested and found clean

- No element anywhere (any of the 5 templates × 7 conditions) was left with
  a non-zero rendered box at `opacity: 0` after the preview reported ready,
  other than the two defects above (both fixed).
- No unexpected console/page errors anywhere, other than the documented
  desserdirina font-CORS noise.
- Visible rendered body text well above the "looks blank" threshold in
  every cell (`run-summary.json`'s `bodyChars`, all > 1000 except
  `product-menu`'s ~1400 and a couple in the 1300s — still far above the
  100-char floor used to catch an actually-blank iframe).
- No `navigator.platform`/`userAgentData`/User-Agent branching anywhere in
  `builder/app.js` or `templates/*` (grepped) — the `windowsUA` condition
  ran clean, as expected for code with no such branch.

## If the owner can send anything from the Windows machine that showed the
problem

Since the forced-colors defect above is a strong, concrete, Windows-specific
candidate but was found by systematic condition emulation rather than a
direct report of "colors look washed out" — worth confirming this is what
they saw. Useful next details: was Windows High Contrast / a Windows theme
with "Apply color filters" or similar accessibility setting active? Which
browser + version? A screenshot of the modal as it appeared, and the
DevTools Console tab's output (F12 → Console) while it was open.
