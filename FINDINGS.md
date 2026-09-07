# FINDINGS — scroll jump on "+ Adaugă" (list add)

Owner report (RO): "Când adaugi un element nou, pe tine te duce iarăși la
începutul paginii, de parcă se face un refresh."

## Reproduction — measured, not assumed

Drove the real editor (`/app/`) with Playwright (Chromium, from this repo's
own `node_modules/playwright`), for every template that ships a repeatable
list (`templates/*/schema.json`, `type: "list"`): professionals, local-service,
product-menu, portfolio, desserdirina. For each: opened the template, closed
the details drawer, scrolled the canvas iframe to ~55% of its scroll height
(then let the add button's own `scrollIntoViewIfNeeded()` settle the final
pre-click position, same as a real click), clicked the "+ Adaugă" control,
and read `window.scrollY` inside the iframe before/after. Also recorded the
outer `/app/` page's own scroll and the (closed) drawer's `scrollTop` as a
sanity check.

Script: `04-QA-Evidence/scroll-jump-fix/measure-scroll-jump.js`
Raw data: `04-QA-Evidence/scroll-jump-fix/before.json` / `after.json`

### BEFORE the fix (against `main`, commit `5f14883`)

| Template | Viewport | scrollY before click | scrollY after add | Outer page / drawer scroll |
|---|---|---:|---:|---|
| professionals | 1440x900 | 1202 | **0** | unaffected (0/0 both times) |
| professionals | 390x844 | 1693 | **0** | unaffected |
| local-service | 1440x900 | 2198 | **0** | unaffected |
| local-service | 390x844 | 2553 | **0** | unaffected |
| product-menu | 1440x900 | 1094 | **0** | unaffected |
| product-menu | 390x844 | 1668 | **0** | unaffected |
| portfolio | 1440x900 | 3010 | **0** | unaffected |
| portfolio | 390x844 | 2042 | **0** | unaffected |
| desserdirina | 1440x900 | 2442 | **0** | unaffected |
| desserdirina | 390x844 | 4552 | **0** | unaffected |

**10/10 combinations reproduce the bug exactly**: canvas scroll always lands
at `0` after the add, regardless of template or viewport. The outer `/app/`
page and the details drawer's own `scrollTop` are both `0` before AND after
in every case — confirming the drawer itself is never rebuilt or scrolled by
this flow (repeatable-list fields are never drawer fields — see
`isDrawerField()`/`DRAWER_TYPES` in `builder/app.js`, which only covers
`phone/url/color/background` plus a short key allowlist; `type: 'list'` is
never in it). So the bug is canvas-only, not a drawer issue — matching the
owner's own description ("de parcă se face un refresh" — a page refresh
resets the one document that's actually being replaced).

### Root cause — confirmed exactly as suspected

`onListAdd()` (`builder/app.js`, was line ~2530) does:
```js
saveDraft();
fullRerender();
```
`fullRerender()` (`builder/app.js`, was line ~2132) builds a brand-new HTML
document via `buildSrcdoc()` and assigns it wholesale to
`iframe.srcdoc`. That is a real navigation — the iframe's `Window`/`Document`
objects are replaced outright, so `scrollY` starts at `0` by construction,
exactly as a full page refresh would. There is no code anywhere in the old
`fullRerender()` that reads or restores scroll position.

**Precedent for scroll preservation that was NOT reused here**: the codebase
already has `sendFocusFieldToIframe()` / `sendHighlightToIframe()`
(`builder/app.js`), used by the checklist "what's missing" menu
(`goToChecklistField()`) to scroll a field into view and focus it — but that
mechanism works by `postMessage`-ing into an **already-rendered** document
(no `srcdoc` rewrite involved), so it never had to solve "the document itself
just changed under me." `focusDrawerField()` (drawer-body scroll) is the same
story — it operates on a DOM that persists across the operation. Neither
precedent was reachable from `onListAdd()`'s path because that path uniquely
goes through a full document replacement.

**Not universal-but-inconsistent** — worth noting for completeness: every
other `fullRerender()` call site (`onListRemove()`, `movePageSection()`,
`togglePageSectionRemoved()`, image change, color change, business-name
cascade, etc.) has **exactly the same defect** — none of them preserved
scroll either, they just aren't the specific complaint on file because list
ADD is the action an owner repeats dozens of times building out a long
list (services, menu, gallery, team), where losing your place is felt
immediately and repeatedly. Section reorder/remove is a much rarer action so
the same jump-to-top was presumably never reported. The fix below is applied
at the `fullRerender()` level, so it fixes the reported bug **and** removes
the same latent defect from every other full-rerender path for free — see
"Nothing regresses" below.

## Fix

`builder/app.js`:

1. **`fullRerender(focusPath)`** now takes an optional `focusPath` argument.
   Before assigning the new `srcdoc`, it captures the OUTGOING document's
   `scrollX`/`scrollY` from the still-live `iframe.contentWindow`. Once the
   new document is interactive (existing `settleRender()` callback — already
   gated on the animation-forcer + double-rAF handshake), it restores that
   scroll position on the new document. This is the fallback every
   full-rerender caller gets automatically, with zero call-site changes.
2. If `focusPath` was given (currently only `onListAdd()`), `settleRender()`
   additionally calls the existing `sendFocusFieldToIframe(focusPath)` right
   after restoring scroll — its `scrollIntoView({block:'center'})` +
   keyboard-focus (for genuine text fields) immediately supersedes the plain
   restore with something more specific: the new item itself. When no field
   matches `focusPath` (e.g. a photos-only item shape), the postMessage
   handler no-ops harmlessly and the plain scroll-restore is what the owner
   is left with — never a jump to the top.
3. A render requested while another is still in flight
   (`renderInFlight`/`pendingRender`, PORT-05's existing debounce guard) now
   also carries its `focusPath` forward via `pendingRenderFocusPath`, so a
   list-add that lands mid-render still ends up focused on its new item
   after the queued replay, not silently downgraded to a plain scroll
   restore.
4. **`onListAdd()`** computes `newItemFocusPath = listPath + '.' + (arr.length
   - 1)` — the new item's own root path — and passes it to
   `fullRerender(newItemFocusPath)`. This reuses
   `sendFocusFieldToIframe()`/`edit-overlay.js`'s existing `'highlight'`
   handler unchanged: it already falls back from an exact `data-hb-edit`
   match to that item's first field (`itemFieldSelector()`) when the root
   path itself isn't a field — the same fallback `goToChecklistField()`
   already relies on for the "what's missing" menu. No changes needed in
   `builder/edit-overlay.js` at all.

Total diff: one function (`fullRerender`) gains an optional parameter, scroll
capture, and scroll/focus restore; `onListAdd()` gains a two-line focus-path
computation and passes it through. Nothing else touched.

### AFTER the fix

| Template | Viewport | scrollY before click | scrollY after add |
|---|---|---:|---:|
| professionals | 1440x900 | 1202 | 1252 |
| professionals | 390x844 | 1693 | 1742 |
| local-service | 1440x900 | 2198 | 2190 |
| local-service | 390x844 | 2553 | 2545 |
| product-menu | 1440x900 | 1094 | 1088 |
| product-menu | 390x844 | 1668 | 1662 |
| portfolio | 1440x900 | 3010 | 1370 |
| portfolio | 390x844 | 2042 | 1199 |
| desserdirina | 1440x900 | 2442 | 2585 |
| desserdirina | 390x844 | 4552 | 4461 |

10/10 combinations: scroll stays deep in the page — never anywhere near `0`.
Most templates land within ~50px of where the owner was (the new item
rendered essentially where the add button was). Portfolio shows a larger
shift (the gallery categories list reflows more between items — its cards
carry a `photos` sub-field placeholder), but still lands solidly mid-page on
the new item itself, scrolled into view and focused — which is the actual
win condition ("land ON the new item"), not pixel-exact position retention.

## Proof

- **Causal oracle**: `bot/test/audit-scroll-preserved-on-list-add.test.js` —
  all 5 templates × both viewports (10 checks). Verified RED against
  unpatched `main` (`git show main:builder/app.js`, temporarily swapped in,
  rebuilt, ran — all 10 failed with `after=0`, restored immediately after),
  GREEN with the fix in place (all 10 pass). No `git stash` used anywhere —
  the original file was restored from a `git show main:... > /tmp/...`
  copy, per the "no git stash" ground rule (the ref is shared between
  worktrees).
- **Full bot test suite**: `node --experimental-sqlite --test bot/test/*.test.js`
  — run after this fix; see commit log for the result.
- **Full pass QA harness**: `node --experimental-sqlite bot/test/fullpass-63230d2.mjs`
  — re-run after the fix to confirm `defects=0 steps=46` still holds.

## Nothing regresses (by construction)

- **Undo/redo**: `saveDraft()` — the single choke point both read — is
  untouched. `pushHistory()`/`historyState` logic is unaffected; the fix
  lives entirely inside `fullRerender()`'s rendering/scroll bookkeeping,
  which undo/redo's own `applyHistoryEntry()` → `fullRerender()` call (no
  `focusPath`) exercises as ordinary scroll-preserving re-renders, same as
  everything else that doesn't pass a `focusPath`.
- **Section reorder / show-hide** (`movePageSection()`,
  `togglePageSectionRemoved()`): both call `fullRerender()` with no
  `focusPath` — they now ALSO get scroll preserved (previously they had the
  identical latent bug, just never reported), which is a strict improvement,
  not a behavior change any test could reasonably have depended on (no
  existing test asserts a specific post-rerender scroll position — checked
  `wave5-builder-undo-redo.test.js`, `wave7-sections-builder-e2e.test.js`,
  `wave11-mobile-editor-touch.test.js`; the only scroll-related call in any
  of them is Playwright's own `scrollIntoViewIfNeeded()` test-setup helper,
  unrelated to app scroll state).
- **`onListRemove()`**: unchanged call site (`fullRerender()`, no
  `focusPath`) — same scroll-preserving fallback as reorder, no jump to the
  new (shorter) list's top either.

## Second-order regression found and fixed while proving "nothing regresses"

Running the full proof battery surfaced two real problems the scroll/focus fix
itself introduced — both fixed before this work was considered done. Neither
was hypothetical: both were caught by the SAME test-and-verify discipline
this task asked for (build the oracle, run the wide net, don't declare victory
on the narrow oracle alone).

### 2a. Undo immediately after add could resurrect the just-removed item

`node --experimental-sqlite --test bot/test/wave5-builder-undo-redo.test.js
bot/test/wave7-sections-builder-e2e.test.js bot/test/wave11-mobile-editor-touch.test.js`
run together (concurrent Chromium load) reliably failed on
`wave5-builder-undo-redo.test.js`: after Undo-ing a list-add, the Redo button
stayed **disabled** instead of enabling. Root cause: giving the new item real
keyboard focus (`sendFocusFieldToIframe`) means clicking "Undo" right after
"+ Adaugă" blurs that field — and edit-overlay.js's blur handler
asynchronously `postMessage`s `{hb:'text', path, value}` to commit whatever
text is in it. If that message is processed by the parent AFTER Undo has
already shortened the array, `onInlineTextEdit()`'s unconditional `setPath()`
auto-vivifies the missing array slot right back into existence — silently
resurrecting the item Undo just removed, and (via `pushHistory()`'s standard
"a new step discards the redo branch" rule) destroying the very redo step
that would have brought it back on purpose. Verified this does NOT happen on
unpatched `main` under the identical concurrent-load run (0/2 failures there
vs 2/2 with the scroll fix, before this second fix).

Fix: `builder/app.js` — added `isListItemPathStillValid(path)`, called at the
top of `onInlineTextEdit()`. It checks whether `path`'s nearest list-item
index is still within that list's current bounds; a stale blur-commit for an
index that no longer exists is silently dropped instead of resurrecting it.
Ordinary (non-list, or in-bounds) edits are completely unaffected.

Verified: the same 3-file concurrent run passes cleanly 3 times in a row
after this fix (was reproducing 2/2 before it).

### 2b. Portfolio: scrolling to the new gallery item could park it under the WhatsApp button

The full-pass QA harness (`bot/test/fullpass-63230d2.mjs`) went from
`defects=0` (confirmed 3x on unpatched `main`) to a reproducible
`defects=1`: "WhatsApp QR panel did not open on portfolio". Root cause,
confirmed with a throwaway Playwright diagnostic (not committed): portfolio's
`templates/portfolio/collage.js` assigns each gallery photo an **inline**
`z-index` up to 50 (`base[i].z`, unrelated to page chrome — it is that
template's own "which scattered photo overlaps which" stacking), while
`.whatsapp-float` (the persistent floating button) and `.wa-qr` (its QR
modal) used the same `z-index: 30` / `z-index: 50` every other template uses
for that same chrome. `30 < 50`, so a gallery photo could always, in
principle, render on top of and intercept clicks on the fixed WhatsApp
button — a latent bug in portfolio's own CSS that predates this session
entirely. It was never exercised before because every prior full re-render
reset scroll to the top, so the gallery grid essentially never ended up
coinciding with the WhatsApp button's fixed screen corner at the moment of a
subsequent click. This session's scroll-to-new-item behavior is what first
made that latent overlap reachable — clicking "+ Adaugă" on a gallery
category and landing on it (working as designed) can place a photo cell
right where the button sits.

Fix: `templates/portfolio/styles.css` — `.whatsapp-float` raised from
`z-index: 30` to `55`, `.wa-qr` raised from `50` to `60` (both scoped to
portfolio only — the other four templates never run this scatter animation,
so their shared `30`/`50` convention is untouched and still correct there).

Verified: `bot/test/fullpass-63230d2.mjs` back to `defects=0 steps=46`,
confirmed twice in a row.
