# HANDOFF — phone editing (Wave 11)

## The question

Can a customer build and publish a site from their phone? Nobody had checked
before this wave — every prior audit measured the *published* site at 390px;
nobody had opened the *editor* itself on a real 390×844 touch-emulated
viewport and tried to do the whole job with real taps. This wave did that,
before changing a single line, and wrote down what happened.

Investigation and regression driver:
`bot/test/wave11-mobile-investigate.mjs` (walks the whole job, screenshots
every step, writes `findings.json`). Committed regression tests:
`bot/test/wave11-mobile-editor-touch.test.js`. Evidence:
`04-QA-Evidence/Wave11-mobile/before/` and `.../after/`.

## What phone editing was actually like before this wave

Bad, and bad in a specific, measurable way — not just "cramped," but
**partially non-functional**. Driving the real editor at 390×844 with touch
emulation, before touching any CSS:

- **The topbar overlapped itself and ate taps.** `.editor-topbar-right` is
  `flex:1 1 auto; justify-content:flex-end; overflow:visible`. At 390px its
  seven-plus buttons need far more width than flexbox gives that box.
  Because the box is right-aligned and never clips, the overflow bled
  **backward past its own left edge**. Measured: the Instagram/color/
  gallery/etc. buttons rendered starting around x=70px — directly on top of
  the back button, account menu, undo/redo, and the desktop/mobile preview
  toggle (which live at x 63–232px). Later-DOM elements win hit-testing on
  overlap, so several topbar controls simply didn't respond to a real tap.
  Proof: a scripted Playwright `tap()` on `#btn-preview-mobile` timed out
  after 30s with `<svg> from .editor-topbar-right intercepts pointer
  events`. On a real phone this is a customer tapping a button and nothing
  happening, with no visual sign of why.
- **12 of 17 topbar buttons, the drawer's close button, and the cookie
  consent accept button were all under the 44×44px touch-target floor**
  (many were 28–38px).
- **The color popover rendered up to 92px off the left edge of the
  screen.** `openColorPopover()` in app.js positions it from
  `getBoundingClientRect()` of the (mis-positioned, overlapping) color
  button; combined with a `min-width:240px` popover, the accent/background
  color inputs were partly or fully unreachable.
- Cookie banner, template picker, the details drawer, inline text editing,
  and the publish modal itself were all already fine at 390px — the drawer
  in particular already used `width:min(400px,94vw)`, which is a sound
  mobile pattern.

## What was fixed (CSS/HTML only, as scoped)

Everything below lives in `builder/app.css` and `builder/index.html`.
`builder/app.js` was not touched, per this wave's rules.

1. **Topbar restructure** (`builder/index.html` + `builder/app.css`,
   `.editor-topbar-scroll`). Everything in `.editor-topbar-right` except
   `#btn-publish` now lives inside a new wrapper. Above 640px it is
   `display:contents` — a pure layout no-op, byte-identical to the old
   markup, so desktop/tablet (tested at 1000/1200/1280/1400/1440px
   elsewhere in the suite) is unaffected. Below 640px it becomes its own
   horizontally-scrollable flex row: content that doesn't fit scrolls
   *within its own box* instead of bleeding backward onto siblings.
   `#btn-publish` stays outside the rail, so the one action that must never
   require scrolling or hunting never does.
2. **A second, related overflow-bleed** appeared once touch targets grew
   (see #3): `.editor-topbar-left` has `flex-shrink:1; min-width:0` and
   default `overflow:visible`, so once the back+account buttons needed more
   room than the shrunk box gave them, the same backward-bleed pattern
   started stacking the account button on top of undo/redo. Fixed by
   pinning `.editor-topbar-left` to `flex-shrink:0` and capping
   `.editor-tpl-name` at 84px below 640px, so left never gets squeezed
   below its real content width — the scrollable rail absorbs 100% of the
   squeeze instead, exactly as designed in #1.
3. **44×44 touch targets** below 640px: every topbar button
   (`.btn-icon-back`, `.btn-icon-account`, `.btn-icon-history`,
   `.device-btn`, `.btn-topbar`), the drawer close button
   (`.drawer-close`), the color preset swatches, and the cookie-consent
   accept button (`.hb-cookie-banner button`, in index.html's inline
   style). These need `!important` because every one of the unguarded base
   rules they override is declared later in `app.css` than this new
   section — documented inline at each spot.
4. **Color popover on-screen clamp.** `openColorPopover()` in app.js
   (frozen this wave) sets inline `left`/`right`/`top` from a bounding
   rect we can't change. Added a `!important` override below 640px that
   docks the popover at a fixed 0.75rem from both edges regardless of what
   JS computed — a real fix would live in app.js (see below), this is a
   robust CSS safety net that happens to also fix today's measured bug,
   because the underlying rect calculation becomes sane again once the
   topbar overlap (root cause of the bad rect) is gone.
5. **Publish stays icon-only at phone width, on purpose.** The existing
   rule shows the "Publică site-ul" label at ≥420px. Tried lowering that
   threshold so 390px phones would get the label too; measured that the
   label's ~140px width, next to the now-pinned left/center sections,
   reintroduced the exact overflow-bleed this fix removes (Publish itself
   started intercepting taps meant for the device toggle again). Reverted.
   The accent-colored icon button is reachable and 44×44+; that is worth
   more than a label that breaks the layout it sits in.

All of the above is exercised by real Playwright taps at 390×844 with touch
emulation in `bot/test/wave11-mobile-editor-touch.test.js` — not just
CSS-shape assertions. That test **fails on the pre-fix code** (verified by
temporarily reverting `builder/app.css`/`builder/index.html` to `HEAD` and
re-running it: 3 of 4 sub-tests failed with the exact measurements above),
so it is a real regression guard, not a vacuous one.

## What still needs a bigger change than this task allowed

Say this plainly, as asked: **the topbar fix is a genuine repair, not a
redesign, and the phone editor is still a workaround, not a good phone
experience.**

- **The color popover fix is a band-aid.** The actual position math lives
  in `openColorPopover()` in `builder/app.js` (frozen this wave). The right
  fix is either to have that function clamp its own computed `left`/`right`
  against `window.innerWidth`, or — better on a phone — replace the
  popover with a bottom-sheet pattern below some width threshold. Both need
  `app.js` changes.
- **The desktop/mobile preview toggle is close to pointless on an actual
  phone**, and this wave did not remove it (removing UI is a product
  decision, not a CSS fix, and it's still functionally correct — just not
  useful). `.editor-canvas-wrap.mode-mobile .preview-iframe--edit` sets
  `width:390px; max-width:calc(100vw - 24px)`. On a real 390px device that
  evaluates to 366px — the "mobile preview" mode actually makes the editing
  canvas *narrower* than the plain desktop mode already renders it (which
  simply fills 100% of whatever width it's given, i.e. the real device
  width, un-bezeled). Recommend: in a wave that can touch `app.js`, hide
  `.preview-device-toggle` below ~640px and default to the desktop
  (unbezeled) mode there, since the toggle's whole reason to exist — "see
  what mobile looks like" — is moot when the browser already *is* mobile.
- **17 interactive controls in a 52px topbar is fundamentally a lot for
  touch**, even once none of them overlap and none are undersized. The
  scroll-rail makes every one of them *reachable*, but reaching Instagram,
  Gallery, or Download-ZIP now costs a horizontal swipe a mouse user never
  needs. A better phone layout would probably move Instagram/Gallery/
  Downloads into the details drawer (already a good, spacious, `min(400px,
  94vw)`-wide mobile surface) rather than keeping them in the topbar at
  all — that is an information-architecture change spanning `app.js` and
  `index.html` together, out of scope for a CSS/HTML-only wave.
- **Only 390×844 was verified with real touch taps.** The fix should hold
  down to smaller phones (the rail just scrolls further), but that was not
  independently confirmed at, say, 320×568 (iPhone SE 1st-gen class).
- **Not this wave's scope, but noticed in passing:** the *published*
  site's own cookie-consent banner (rendered inside the preview iframe,
  separate from the builder-chrome one fixed here) sits at the bottom of
  the viewport on top of the WhatsApp floating action button and hero copy
  on at least one template at 390px. That is template content
  (`templates/**`), frozen/out-of-scope for this wave, and a pre-existing
  baseline test (`bot/test/advocate-eed3ca0-repair.test.js`) already fails
  on exactly this — professionals template, mobile cookie banner over
  `.pr-hero__meta`. Confirmed this is pre-existing (fails identically on a
  clean `HEAD` checkout, unrelated to any change in this wave) and left
  alone since fixing it would mean editing `templates/professionals/`.

## Honest verdict

**Today, after this wave's fix: yes, a customer can genuinely finish the
core job on a phone.** Verified end-to-end with a real 390×844
touch-emulated Playwright run: accept cookies → pick a template → close the
auto-opened details drawer → tap and edit the business name inline → reopen
details → replace the hero photo from a file chooser (camera-roll
equivalent) → open the color popover, set both colors, close it → toggle
mobile preview → open Publish → fill the address → send the magic link →
open it → complete the (test) card add → reach the live-site success
screen. Every control involved is reachable, tappable, and ≥44×44px.

**Before this wave's fix, the honest answer was no** — a customer landing
on the editor from their phone would have found roughly a third of the
topbar unresponsive to touch (overlapping controls silently eating their
taps, with zero visual indication anything was wrong), and the color tool
partly invisible off the left edge of the screen. That is not a rough edge;
that is a dead end for a first-time phone user.

The remaining gaps above (popover architecture, the moot mobile-preview
toggle, topbar control count, the template-side cookie banner) are real,
but none of them stop a determined customer from finishing today. They are
worth a follow-up wave that can touch `app.js` and `templates/**`.
