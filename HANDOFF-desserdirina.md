# HANDOFF — Wave8 desserdirina re-audit remediation (2026-09-06)

Scope note: my owned files for this wave are `templates/desserdirina/**`
(excluding `images/`) and `bot/test/wave8-desserdirina-*`. One fix below
touches `builder/edit-overlay.js`, which is outside that scope. Per this
wave's brief, a shared-file fix is allowed "ONLY if the change is narrow and
you explain the blast radius" — this document is that explanation. I judged
the change safe enough to apply directly (see below), but recording it here
in case a reviewer wants to weigh in on a file outside this wave's normal
ownership.

## What changed and why

### 1. `builder/edit-overlay.js` — `findListItemContainer` / a new `containsForeignField`

**Bug (DSD-03):** `findListItemContainer()` climbs from a repeatable list
item's own DOM field up to the nearest ancestor that still belongs
exclusively to that item, using `containsOtherListIndex(node, root, idx)` —
"does this ancestor contain a SIBLING item's field?" — as the stop
condition. That check is vacuously false the instant a list is down to its
**last surviving item**: there is no sibling left to find, so the climb
never finds a reason to stop.

This is invisible on every list in this product except one: desserdirina's
bilingual menu (`menu.ro` / `menu.en`, an array of categories, each holding
its own `items` array) is the only list nested two levels deep. Climbing
from a category's last remaining dish walks
`<li> → <ul> → <details>(the category itself) → <div class="menu-groups"> → <div class="menu-panel">`
in exactly the 4 hops the climb loop allows — landing the dish's remove
control (and the `hb-list-item` positioning class) on the **entire RO or EN
menu panel**, not the dish or even its own category. Confirmed empirically
in a real browser (see `bot/test/wave8-desserdirina-menu-list-boundary.test.js`,
"MECHANISM" checks) — clicking to remove a category's 4th-and-last dish left
a stray, misplaced "×" spanning all three RO categories, with the correct
category-scoped remove control gone from view entirely.

**Fix:** added `containsForeignField(node, itemPath)` — a general boundary
test: does `node` contain ANY `data-hb-edit` field that is not part of this
item's own subtree (neither `itemPath` itself nor a `itemPath.*` sub-path)?
This is a **strict superset** of `containsOtherListIndex`: any sibling
item's field is, by construction, also "not under itemPath". The climb loop
now stops on `containsOtherListIndex(...) || containsForeignField(...)`.

**Blast radius on the other four templates (product-menu, local-service,
portfolio, professionals):** none of them has a list nested more than one
level deep, so for every list in those templates with 2+ items,
`containsOtherListIndex` was already firing at the correct point — and
`containsForeignField` is a superset that fires at the *same or earlier*
point, never later. It cannot make a currently-correct multi-item list climb
further than before; it can only stop an edge case (a list reduced to
exactly one item, which none of the other four templates' fixed-purpose
lists realistically reach in normal use, but which is now handled correctly
regardless) earlier than the old check alone would have. Verified: full
suite `node --experimental-sqlite --test bot/test/*.test.js` — 319 pass → 322
pass (3 new wave8 tests), same one known pre-existing failure
(`flow3-legal-export.test.js`, documented Brave-only oracle), before and
after this change.

### 2. `templates/desserdirina/template.html` — category heading no longer gated on `items`

**Bug:** each rendered menu category was `<!-- @if items --><details>...
<summary>{{category}}</summary>...</details><!-- @endif -->`, with an
`<!-- @if empty -->` fallback keyed on an `empty` boolean that **no code
anywhere in this product** (`app.js`, `build.js`, `edit-overlay.js`) ever
sets — grep confirms zero references outside static preset JSON. The moment
a category's `items` array reaches length 0 (reachable via bug #1's
misplaced button, or by any other means of clearing a category), *neither*
`@if` branch renders: the category — heading included — vanishes completely
from the page, live, with no trace. This reproduces, verbatim, "the
category's own items are gone from the entire page" from the original
critical finding.

**Fix:** the heading now renders unconditionally per category; only the
`<ul>` of dishes is gated on `items` being non-empty. An emptied category
now shows its own name with no dishes underneath, instead of disappearing.

**Known residual limitation (not fixed, judged out of scope for this wave):**
once a category's `items` array is empty, the generic list-editing engine
(`detectListGroups()` in `edit-overlay.js`) finds no indexed `data-hb-edit`
element to key off, so it registers no group for that list root and renders
no "+ Adaugă articol" button — an owner cannot add items back into an
emptied category through the UI; they can still delete the empty category
(`menu.ro`'s own remove control, unaffected) and add a fresh one via
"+ Adaugă secțiune". This is a pre-existing, product-wide limitation of the
list-detection engine (any list with 0 items has this same gap on every
template), not something introduced or fixable narrowly by this wave without
touching the shared engine's index-detection strategy more deeply.

### 3. `templates/desserdirina/collage.js` — photos scatter into place immediately

**Bug (DSD-04, HIGH finding — tiny/broken gallery):** the scatter deck only
set each photo's real `--x`/`--y` offset from an `IntersectionObserver`
callback firing after ~20% of the deck scrolled into view (plus a 150ms
`setTimeout`). Until then every photo in a category rendered stacked exactly
on top of the others (custom properties default to 0), a single
~200-280px-wide pile instead of a normal-width grid. Confirmed this is not
only a slow-scroll race: a `page.screenshot({ fullPage: true })` — the exact
technique the re-audit used — never fires a real scroll event in Chromium
either, so the observer had not run by capture time (see
`bot/test/wave8-desserdirina-gallery-collapse.test.js`, "GREEN (live site...,
no scroll ever performed)").

**Fix:** photos scatter into position immediately and unconditionally
(`apply(true)` right after `compute()`), for every visitor, matching what
the reduced-motion path already did. The "spring into place as you scroll
down" flourish is lost in exchange for the gallery never rendering
collapsed/unclickable.

### 4. `templates/desserdirina/collage.js` + `styles.css` — 200% zoom overflow

**Bug (DSD-05, MEDIUM finding — 42% overflow, far worse than the other four
templates' "a few percent"):** `.gallery-section` sized itself with
`width: min(1320px, 94vw)` / `max-width: 100vw`. `vw` does not shrink under
the CSS `zoom` property (the standard headless-browser stand-in for real
pinch/ctrl-zoom), so at `zoom: 2` the section kept computing ~94% of the
FULL, un-zoomed viewport and rendered that at 2x — nearly doubling its
effective on-screen width. Measured before/after: 41.7% → 0% overflow at
1440px, 44.1% → 0% at 390px (`document.documentElement.style.zoom`
methodology, matching how the re-audit measured it — see
`bot/test/wave8-desserdirina-zoom-overflow.test.js`).

**Fix:** switched `.gallery-section`'s width/max-width from `vw` to `%`
(`min(1320px, 94%)` / `max-width: 100%`), sized against its parent
`.main-content` (a plain, unconstrained block that already reflows correctly
under zoom). Also added a `ResizeObserver` on the scatter deck in
`collage.js` (belt-and-suspenders alongside the existing `window.resize`
listener) so the photo-spacing computation reacts to any box-size change,
not only a real window resize — this alone did not fix the reported 42%
(the deck's own box was already oversized before any photo-offset math ran),
but is a correctness improvement worth keeping.

**Methodology note:** this repo's existing `wave5-desserdirina-zoom-reflow.test.js`
emulates 200% zoom by halving the real viewport width (the more accurate
WCAG 1.4.10 technique) and does NOT reproduce this bug, because shrinking
the viewport correctly recomputes `vw` too — this bug is specific to the CSS
`zoom`-property emulation technique. It is still a real fix worth having:
the underlying `vw` usage was fragile regardless of which measurement
technique happens to expose it, and matches what the original audit actually
measured.

## What did NOT reproduce, and why

The original critical finding's other half — "Torturi displays a DIFFERENT
category's items" (not just "own items missing") — did not reproduce under
any single, correctly re-derived user action across a realistic multi-step
edit sequence (add item, add category, remove a whole category, remove an
item, add item — each waited out to a fully settled render, each button
re-located fresh by heading text rather than a remembered position). See
this wave's session report for the full trace, including a hand-worked
reconstruction of the original re-audit's own `probe.mjs`: it computed every
removable list's *position* once, up front, across both the hidden EN tab
and the visible RO tab, then re-indexed into a freshly-recomputed list by
that same stale position on each iteration — and a whole-category deletion
removes one MORE structural list from the page than a single-dish deletion
does, permanently shifting every position recorded after it. That is a
plausible, self-inflicted test-harness bug, not a defect in this product's
UI: every real remove button carries its own correct path in a closure at
render time, never a recomputed position. Worth a second, independent look
if it resurfaces, but I could not confirm it as a live product defect this
wave.

## Test counts

- Baseline before this wave's changes: 319 pass / 1 fail (known Brave-only
  `flow3-legal-export.test.js`).
- After (3 new `bot/test/wave8-desserdirina-*.test.js` files, 7 checks each
  file's own red/before + mechanism + green/after style, per the existing
  `wave5-desserdirina-*` convention in this repo): 322 pass / 1 fail (same
  known failure).
