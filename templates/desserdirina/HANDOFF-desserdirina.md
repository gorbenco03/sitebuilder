# HANDOFF — Wave5 desserdirina audit remediation

Scope of this wave: `templates/desserdirina/` (excluding `images/**`, owned by
another agent re-encoding photos in parallel). This file records everything
that needs a change **outside** that scope, plus the investigation notes for
one finding I could not cleanly reproduce.

## 1. Action needed by whoever owns `bot/webpublish.js` / `bot/site-export.js`

**The new `templates/desserdirina/fonts/` directory is not copied to a
published or exported site.**

Both files copy a template directory into the live siteDir/export dir with
the same loop:

```js
for (const entry of fs.readdirSync(templateDir)) {
    if (TEMPLATE_EXCLUDES.test(entry)) continue;
    const src = path.join(templateDir, entry);
    const st = fs.statSync(src);
    if (st.isFile()) {
        fs.copyFileSync(src, path.join(siteDir, entry));
    } else if (st.isDirectory() && entry === 'images') {
        // ...images/* copied here...
    }
}
```

Any top-level **file** in a template directory is copied automatically, but
subdirectories are only ever copied when `entry === 'images'`. Since the
self-hosted font binaries live in `templates/desserdirina/fonts/*.woff2` (a
new subdirectory — the task that produced this wave explicitly named that
path), they are silently skipped: a live/exported desserdirina site would 404
on every `@font-face src`, and the browser would silently fall back to
Georgia/sans-serif (still zero third-party requests — the primary GDPR fix
holds — but the typography would regress from what was intended).

**Fix**: add one more `else if` branch mirroring the `images` case, in both
files:

- `bot/webpublish.js`, in `publishSite()`, right after the `images` branch
  (around line 601-609 as of this wave's base commit).
- `bot/site-export.js`, in the equivalent template-copy loop (around line
  145-156).

```js
} else if (st.isDirectory() && entry === 'images') {
    // ...existing...
} else if (st.isDirectory() && entry === 'fonts') {
    const fontsDir = path.join(siteDir, 'fonts');
    fs.mkdirSync(fontsDir, { recursive: true });
    for (const f of fs.readdirSync(src)) {
        const from = path.join(src, f);
        if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(fontsDir, f));
    }
}
```

I did not make this change myself — `bot/**` is out of scope for this wave
per the task brief. Until it lands, desserdirina's self-hosted fonts only
work in this wave's own test harness (`bot/test/wave5-desserdirina-helpers.js`
copies `fonts/` itself, independent of webpublish/export, specifically to be
able to prove the fix works once the copy gap above is closed) and in local
dev via `node build.js templates/desserdirina` (which only renders
`index.html`, and doesn't move any static assets at all — same caveat
applies there for a first-time checkout, though in-place `template.html`/
`fonts/` obviously exist as siblings on disk).

## 2. Other templates and Google Fonts — checked, not affected

`grep -rl "fonts.googleapis.com\|fonts.gstatic.com" templates/*/*.{html,css,js}`
returns nothing outside desserdirina. `product-menu`, `portfolio`,
`professionals`, and `local-service` do not load any Google Fonts — no
follow-up needed there.

## 3. `templates/desserdirina/schema.json`: itemSchema -> itemShape — done, verified

Normalised in this wave (`categories` field). `builder/app.js`'s `onListAdd`
reads `f.itemShape` — confirmed by running the REAL `onListAdd`/
`onListRemove` (extracted from `builder/app.js`, not modified) against both
the old (`itemSchema`) and new (`itemShape`) schema.json in
`bot/test/wave5-desserdirina-itemshape-schema.test.js`. Verified red-before/
green-after, including the exact "add category, add another, remove the
original" sequence from the audit's critical #6 finding. No change to
`builder/app.js` or `build.js` was needed — the schema key was the only
divergence.

## 4. Horizontal scroll at 200% zoom (audit medium #30) — hardened, root cause not fully confirmed

I found and fixed one concrete, real bug: `collage.js`'s photo-spacing
formula had `Math.max(40, Math.min(maxSpacing, fitSpacing))` — a hard 40px
floor that, given enough photos in one category on a narrow-enough deck,
forces the scattered row wider than its container regardless of viewport
size. Changed the floor to `Math.max(0, ...)` (photos may overlap more
tightly, but the row can never exceed the deck's width) and added a
defensive `overflow-x: clip` on `.gallery-section`.

**What I could not do**: reproduce the literal "horizontal scroll at 200%
zoom" via headless Chromium, on either the pre-Wave5 or current code, using
either (a) resizing the viewport to half-width (the standard, spec-aligned
way to automate WCAG 1.4.10 — Chromium's real page zoom shrinks the
effective CSS viewport, so 200% zoom of a W-px window ≈ a W/2 viewport at
100%), including a synthetic 40-photo category engineered to trigger the old
spacing-floor bug, or (b) the `document.body.style.zoom` CSS property (which
I initially tried and rejected — it does NOT recompute `vw`/`vh` against a
smaller viewport the way real browser zoom does, so it flags essentially any
page using viewport-relative units as "overflowing," a false positive
unrelated to the actual bug).

`body { overflow-x: hidden }` has been present in this template's styles.css
since its very first commit (`275e534`), predating the audit — this
means `overflow-x: hidden` already inherited the from body onto the viewport
scroll box for the whole time the audit's finding was open, and would have
suppressed a page-level scrollbar for anything I could construct. My working
theory is the audit's manual repro hit either a subpixel/rounding artifact
specific to a real (non-headless) browser's zoom implementation, or a
transient state during collage.js's resize-triggered repositioning that a
static/headless check does not catch. The fixes above are real, verifiable
hardening against the exact overflow mechanism I could identify in the code
(see `bot/test/wave5-desserdirina-zoom-reflow.test.js`), and I verified zero
overflow across 1920/1440/1024/390px viewports at both 100% and 200%-zoom-
equivalent widths — but I want the gap between "hardened" and "root-caused"
on record rather than implied to be fully closed.

## 5. CLS — mechanism fixed and proven; production-scale numbers not reproduced locally

The shipped photos are genuinely oversized: `torturi-1.jpg` is a real
1280x1280px file rendered at a ~200-280px gallery tile — about a 4.6-6.4x
oversize, in the audit's reported 3.7-7.5x range. Fix: `.collage-photo` now
reserves a fixed `width`+`height` box (desktop) / `aspect-ratio` box (mobile)
in CSS alone, so the browser has real dimensions before any photo byte
arrives — same principle applied to fonts (self-hosted, no cross-origin
render-blocking request before `@font-face` is even known).

Verified two ways (`bot/test/wave5-desserdirina-cls.test.js`):

- **Isolated mechanism proof (hard-gated, passing)**: a minimal fixture
  serving the *real* torturi-1.jpg through a deliberately-delayed response,
  with just the old vs. new `.collage-photo`/`.collage-photo img` CSS rules.
  Old rule: box measured 0×320 before the photo arrived, 320×320 after (a
  real, unreserved shift). New rule: box measured identically before and
  after (200×260 both times) — fully reserved.
- **Full-page, throttled (reported, not gated)**: real
  `PerformanceObserver({type:'layout-shift'})` CLS on the actual built pages,
  over a CDP-throttled ~1.6Mbps/100ms-latency session:

  | | before | after |
  |---|---|---|
  | desktop 1440 | 0.0056 | 0.0059 |
  | mobile 390 | 0.0038 | 0.0039 |

  These are near-zero and essentially flat in **both** directions — nowhere
  near the audit's reported 0.20/0.17 production numbers, in either the old
  or new code. I do not believe this template has no CLS problem in
  production; I believe this sandbox can't reproduce the audit's measurement
  conditions: everything here is same-origin localhost with no real DNS/TCP/
  TLS to a third party, Google's font edge was fast and nearby when I did
  confirm the old code's real external request succeeds quickly, and
  Chromium determines a JPEG's dimensions from its header very early in the
  download (often before first paint), which defeats a naive
  "does the visible box resize" test unless the response is artificially
  delayed (which the isolated fixture does, and the full page does not).
  I'm reporting both sets of numbers rather than picking the one that looks
  better.

## 6. Hero background fix — was NOT already applied on this branch

The task brief said an earlier wave fixed the hero-background-vanishes bug.
That fix (`background-image:` → `background:` shorthand) exists on git
history as commit `cf1db7f` ("fix: preserve Desserdirina hero background
after edits"), but that commit is **not an ancestor of the commit this wave
started from** — it lives on a separate, not-yet-merged branch/worktree
(`wt/audit-06-desserdirina-hero-bg`). `templates/desserdirina/template.html`
on this wave's starting commit still had the bug. I applied the one-line fix
myself (it's squarely inside my ownership) and added a fresh regression test,
`bot/test/wave5-desserdirina-hero-background.test.js`, verified red against
git HEAD and green against the current file. Whoever merges these two
branches should expect this exact one-line hunk to already be identical
(same fix, same line) and not conflict meaningfully.

## 7. Gallery add/remove category corruption (audit critical #6)

Per the brief, verified this is fixed as a direct consequence of the
itemShape normalisation in §3 above — the corruption traced to `onListAdd`
falling through to a bare-string default (instead of `{title, blurb,
photos: []}`) whenever it couldn't find `itemShape` on the field definition.
With the key fixed, `onListAdd`/`onListRemove` now behave identically to the
other four templates. No separate `build.js`/`builder/app.js` change was
needed for this one.
