# HANDOFF — Wave 11 (first-run: honest checklist, provisional demo content, quick-start)

No changes were needed in `templates/**`, `build.js`, or `bot/**` (other than the new
`bot/test/wave11-firstrun-*.test.js` files this wave owns). Everything fit inside
`builder/**`. This file exists for one FYI finding from that wave's own development,
in case whoever next touches the editor's render pipeline or
`bot/test/fullpass-63230d2.mjs` runs into the same thing.

## FYI: `bot/test/fullpass-63230d2.mjs`'s professionals Cal.com-booking-link check is
## timing-fragile, and got measurably more so during this wave's development

**Not a change request** — `bot/test/fullpass-63230d2.mjs` and `templates/professionals/`
are not this wave's files, so nothing was changed there. Recording what was found in
case it saves someone else the same investigation.

### What was found

Adding `builder/edit-overlay.js` code that runs during a full re-render's `mount()` —
even code that does nothing more expensive than `classList.add()` on a couple of
elements — measurably raised the flake rate of one specific existing check: fullpass's
professionals-template flow that fills `appointment.bookingUrl` with a Cal.com URL,
confirms the booking `<a>` renders, clears the field, and confirms the `<a>` is
removed again (`04-QA-Evidence/FullPass-63230d2/15-professionals-calcom-cleared.png`'s
check, "Cleared Cal.com still leaks in preview").

Isolated reproduction (fill → wait 1.5s → close drawer → wait 0.8s → check link present;
open → clear → wait 0.8s → close drawer → wait 0.8s → check link gone), run 25 times per
variant against a real `bot/server.js` + Playwright Chromium:

| builder/edit-overlay.js state | fail rate |
|---|---|
| unmodified (this wave's `builder/app.js`/`index.html` changes only) | ~5–10% |
| this wave's photo-badge feature added (various optimization attempts) | ~20–30% |
| same, after moving all cosmetic DOM work off the ready-handshake critical path | still ~20–30% |

None of the specific optimizations tried (CSS class instead of an appended DOM node,
dropping a redundant per-keystroke postMessage, deferring the cosmetic work a tick past
`{hb:'ready'}`) fully closed the gap back to the ~0% baseline measured against the
unmodified pre-wave commit (`bab4709`) — 0 failures in 30 combined runs there. Whatever
the exact mechanism, it did not respond cleanly to shrinking or deferring the added
work, which suggests it is not really about *how much* code runs but something more
binary (a GC-pause-timing sensitivity was the best remaining explanation reached, but
it was not conclusively confirmed) in an already-tight timing budget.

### What WAS fixed (in `builder/app.js`, in scope, kept)

`closeDrawer()`'s "does this drawer field edit still need a full re-render once the
drawer closes" signal (`drawerNeedsRerenderOnClose`, formerly `drawerSaveTimer`) used to
be a **self-expiring 2-second timer** rather than a plain flag. That is a latent
correctness bug independent of any test flakiness: a field whose visible effect can only
come from a full re-render (exactly `appointment.bookingUrl` — clearing it must remove
the Cal.com `<a>` and restore the local request `<form>`, a structural change no
surgical text update can make) would silently never reflect the edit if the owner took
more than two seconds to close the drawer afterward. Replaced with a plain boolean that
never expires on its own — correct regardless of how long the drawer stays open or how
fast any given render happens to be. This did not eliminate the flake (see above) but
is a real improvement on its own footing and was kept.

### Suggested next step, for whoever picks this up

The render-settle signal `bot/test/fullpass-63230d2.mjs`'s fixed `waitForTimeout()`
calls implicitly depend on is `builder/app.js`'s `fullRerender()` /
`waitForInteractivePreview()` — specifically the injected ready-script's poll of
`document.documentElement.getAttribute('data-hb-forcer-done')` (set by the
`data-hidook-forcer` script `scripts/build-builder.js` injects, which does a
`document.querySelectorAll('*')` + `getComputedStyle()` sweep of the ENTIRE rendered
page on every single full re-render). A render-settle path this ready-time-sensitive,
paired with a test using fixed real-time waits instead of polling on an explicit signal,
seems likely to keep being marginal for the next change that touches the editor's
render pipeline, not just this one. Two independent, not-mutually-exclusive directions
worth considering: making the fixed-wait assertions in
`bot/test/fullpass-63230d2.mjs` poll instead of sleep-then-check, and/or profiling
whether the forcer's whole-page sweep is the actual bottleneck (it runs on every
render regardless of what changed) rather than anything editor-overlay-specific.
