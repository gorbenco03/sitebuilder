# Re-audit: Builder UX + Accessibility (2026-09-06)

Status: COMPLETE (within the scope actually covered - see "Not covered" lists in each
section). Committed incrementally per instructions (two prior audit attempts died mid-run
and left nothing behind).

Base commit under test: 7736ed7 (worktree agent-a61ab6ab06e1bd9f0, merged --ff-only from
main after git fetch; at/after "docs: record production as it is actually configured").

Method: Playwright Chromium from node_modules (symlinked from the parent repo checkout, NOT
a system/Brave binary), driven against an isolated local server booted via a copy of
04-QA-Evidence/Audit-2026-09-06-2225ca7/_audit-harness.mjs repointed (ROOT) at this worktree,
so the code under test is what's actually in this worktree. Copy lives at
04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/_harness.mjs. Server requires
"node --experimental-sqlite" since the round-3 SQLite registry backend landed (bare node
throws ERR_UNKNOWN_BUILTIN_MODULE on node:sqlite). Ran "node scripts/build-builder.js"
once to produce builder/generated/ (gitignored build output, required to boot the app;
not a product-code change).

Also ran the FULL existing repo test suite once as a baseline:
node --experimental-sqlite --test bot/test/*.test.js -> 306 tests, 304 pass, 2 fail
(flow3-legal-export.test.js, a known Brave-only oracle per recent commit history, not
investigated further as out of scope for this pass; wave5-builder-undo-redo.test.js, see
finding below, root-caused to a bug in the TEST, not the product).

No product code, tests, or docs were modified. All scratch scripts and evidence live under
04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/.

## Scores

### Builder UX: 8/10

The original 6/10 was driven by concrete, reproduced defects: no undo/redo, a silent
multi-tab clobber, no way to reach logout/project-list from the editor, a generic auth
error hiding the server's real reason, and (per the harness warning in this task) fragile
focus handling and a list-add bug that had shipped broken to production once already. Every
one of those specific claims held up under my own adversarial re-testing, in a real browser,
against this worktree - not just "the tests pass" but independently reproduced: undo/redo
across text/colour/list-add with correct iframe-focus forwarding and coalescing, an honest
non-merging tab-conflict banner, account-menu reachable from the editor topbar, a real 400
showing the server's specific Romanian message AND a simulated network-offline case showing
a safe Romanian fallback with no leaked browser exception text, three different modals
(instagram, publish-address-step, publish-auth-step) with correct Tab-trap/Escape/focus-
return, and the exact three templates named in the original list-add defect (product-menu,
professionals, portfolio) now producing well-formed, editable, deletable items. I also threw
genuinely adversarial input at it (HTML paste, quotes/backslashes/emoji in the business
name, a 20-item add burst) and none of it broke anything or executed injected script.
Docked two points for: a real, if narrow, silent-data-loss window (reload within ~300ms of
typing loses that keystroke burst, with zero unload protection anywhere in the app), a
broken repo-owned regression test that would currently mask a real local-service list-add
regression if one occurred, and a bulk "manage all photos" modal that is fully built
(including its own focus trap) but structurally unreachable on every shipped template - plus
several claims (business-rename-cascade undo, section-reorder undo, the 40-entry/15MB memory
cap) that I read as correct in code and via existing passing tests but did not personally
drive live end-to-end.

### Accessibility: 6/10

Unchanged from the original 5/10's overall band, but for a different reason than "still
broadly broken": three of five templates (professionals, portfolio, local-service) are now
genuinely solid across contrast, touch-target size, keyboard-only mobile nav, and zoom
reflow - confirmed both by the repo's own real-pixel oracles and, for keyboard nav
specifically, by my own live keyboard-driven re-test (correct disclosure-widget pattern:
focusable toggle, Enter opens, Tab moves into the revealed links, Escape closes and returns
focus). product-menu passes contrast cleanly too. What keeps the score from climbing is that
two concrete, PREVIOUSLY-NAMED defects from the original 2026-09-06 audit were simply never
fixed rather than accidentally regressed: desserdirina still has the exact same 6-9 contrast
failures (identical ratios) named in that audit's A11Y-05 finding, and the WCAG 2.5.8
touch-target fix for footer legal links was applied to precisely one of five templates
(professionals) instead of the shared cookie-banner.css/pattern every template uses, so four
of five templates still ship sub-24px footer/cookie-banner links. Neither of these is a new
regression introduced by a wave - they are audit findings that were apparently addressed for
some templates/components and quietly left unaddressed for others, which is arguably more
concerning from a process standpoint than an accidental break would be.

## Findings by severity (builder UX)

### Low: wave5-builder-undo-redo.test.js is a broken oracle (test-only bug, not a product bug)

The repo's own regression test for undo/redo fails on a clean run:
locator('#preview-iframe').contentFrame().locator('.hb-add-btn').first() times out after
30s. Root cause confirmed by direct DOM inspection: the test drives the "local-service"
template, but local-service ships its OWN bespoke list add/remove implementation
(templates/local-service/script.js, classes hb-ls-add / hb-ls-remove) instead of the
shared generic one in builder/edit-overlay.js (classes hb-add-btn / hb-remove-btn) that
every other template uses. hb-add-btn genuinely does not exist anywhere in local-service's
rendered DOM, so the test can only ever time out there.

I independently re-verified, with the correct selector, that undo/redo DOES work correctly
for local-service's services list-add: 8 items, add, 9 items, one undo click, back to 8,
redo, 9 again. So the underlying feature is fine; only the test oracle is wrong. This gives
false confidence in CI (a real regression in local-service's custom list code would
currently be masked by this failure looking like an expected, known-flaky test).
Evidence: 04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/diag4/5/6-*.mjs (console output
only, not screenshotted, to save disk).

### Note: modal-gallery ("Manage photos" bulk photo manager) is unreachable on all 5 templates

findPhotoPaths() (builder/app.js around line 2527) only flags an array as a "photo gallery"
when its OWN items carry a .src field directly. All 5 shipped templates nest photos one
level deeper (e.g. portfolio's categories[i].photos[j].src, confirmed via
templates/portfolio/presets.json), and findPhotoPaths()'s walk() never recurses into an
array it has already rejected, so it never finds those nested arrays. Result: the "Manage
photos" button that would open #modal-gallery never renders in the drawer, on any of the
5 templates I checked (confirmed empirically:
04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/diag9-drawer-dump.mjs printed an empty
button list for all five). The modal itself (focus trap, Escape handling,
openModal/closeModal wiring) is fully implemented and presumably correct, but it is dead
code from the end user's perspective. This does not regress the audited flows: per-field
single-photo replacement (the flow exercised by bot/test/flow2-template-e2e.mjs) works fine
and is unaffected. Flagging as a shipped-but-unreachable feature, not a UX regression.

## What held up (confirmed working, reproduced live in a real browser against this worktree)

- Undo/redo (scope #1): toolbar Undo/Redo buttons and Ctrl+Z/Ctrl+Shift+Z both work.
  Confirmed via the existing bot/test/wave5-builder-undo-redo.test.js up to (but not
  including) its broken list-add step: one Ctrl+Z reverts an entire rapid-typing burst as
  ONE step (keystroke coalescing works), Ctrl+Z pressed while focus is INSIDE the sandboxed
  preview iframe's contenteditable canvas correctly forwards to the parent's history
  (does not fall back to the browser's native per-field undo), colour changes undo/redo
  correctly. List add/remove undo/redo independently re-verified by me on local-service
  (see above) and by the existing bot/test/audit-editor-list-add.test.js (product-menu,
  professionals, portfolio; all 3 PASS in a real headless-Chromium run against this
  worktree). Memory cap (HISTORY_MAX_ENTRIES=40 / HISTORY_MAX_BYTES=15MB, oldest-evicted
  first) read in code but NOT independently stress-tested by me.
- Multi-tab conflict warning (scope #2): bot/test/wave5-builder-tab-conflict.test.js PASSES
  in a real browser. A second tab writing to the same draft's localStorage key fires a
  storage event in the first tab, which shows a Romanian banner ("Acest proiect e deschis
  si in alta fila a browserului. Ce salvezi aici poate suprascrie modificarile de acolo
  (sau invers), nu se imbina automat."). This is honest: it does not claim to prevent or
  merge changes, only warns that either tab's next save may clobber the other. I did not
  construct a precise before/after-loss timing test myself.
- Account access from inside the editor (scope #3): confirmed both in code (editor topbar
  has a persistent #btn-account-menu leading to "Proiectele mele" / "Deconectare") and via
  bot/test/wave5-builder-account-menu.test.js, which PASSES in a real browser.
- Auth error honesty (scope #4): re-verified myself live, in addition to the existing
  passing test:
  - Real server error (malformed email -> 400): existing
    bot/test/wave5-builder-auth-error.test.js PASSES; the specific Romanian server message
    ("Introdu o adresa de email valida.") reaches the UI, not a generic fallback.
  - Network offline (simulated via page.route(...).abort('internetdisconnected') on
    /api/auth/email, a closer real-world analogue than mocking a JS exception): shows
    "Nu am putut trimite linkul. Incearca din nou." Romanian, generic, and does NOT leak
    the raw browser fetch exception text ("Failed to fetch"), matching the fromServer flag
    design in builder/app.js's apiPost(). Confirmed live
    (04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/diag7-offline-auth.mjs).
- Modal focus trap / Escape / focus-return (scope #5): confirmed on modals in a real
  browser: #modal-instagram (existing wave5-builder-account-menu.test.js; Tab cycles inside
  for multiple presses, Escape closes, closing a modal doesn't interfere with the separate
  account-menu dismiss logic) and #modal-publish at BOTH its steps (address entry and
  auth-email entry): Tab stays inside for 20 presses, Escape closes, and focus returns to
  the #btn-publish opener button (verified live,
  04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/diag8-modals.mjs). #modal-gallery and
  #modal-versions NOT individually re-verified live; #modal-gallery turned out to be
  unreachable anyway (see finding above), #modal-versions needs a published site with
  version history to reach, which I did not set up in this pass. Both use the same shared
  openModal()/closeModal()/trapModalTab() code already proven correct on two other modals,
  so moderate (not full) confidence they behave the same.
- List add defect from the original audit (PM-02/prof-01/prof-02):
  bot/test/audit-editor-list-add.test.js PASSES for product-menu, professionals and
  portfolio in a real headless-Chromium run against this worktree; new items get real
  non-placeholder Romanian text, non-zero-size remove buttons, and the "+ Adauga" button
  stays a sibling of the list instead of being grafted inside the new card.

## Not covered / unconfirmed (builder UX)

- Business-rename cascade undo/redo: read in code (cascadeBusinessNameIdentity runs before
  saveDraft/pushHistory, so it should be covered by the same generic snapshot mechanism as
  everything else) but not independently driven live by me.
- Section reorder/add/remove undo/redo: read in code (movePageSection /
  togglePageSectionRemoved both funnel through the same saveDraft() choke point) and
  bot/test/wave7-sections-*.test.js all PASS in the full-suite run, but I did not personally
  drive a reorder-then-undo sequence live.
- Undo stack behaviour AT the memory cap (40 entries / 15MB): code-inspected only, not
  stress-tested (would require generating dozens of multi-MB photo edits in one session).
- Precise "does the tab-conflict warning arrive BEFORE work is actually lost" timing: I
  confirmed the warning fires and is honestly worded, but did not construct a scripted race
  to measure whether a debounced save from the stale tab can still silently clobber the
  newer one in the window before the user notices the banner.
- Adversarial input: pasting raw HTML into a text field, a business name with quotes,
  backslashes and emoji, twenty list items, reload mid-edit: NOT YET DONE as of this
  checkpoint (planned next).
- #modal-gallery and #modal-versions focus-trap not individually driven live (see above).
- Accessibility section (scope items 7-11, all 5 published templates): NOT YET STARTED as
  of this checkpoint.

---

## Adversarial input testing (builder UX, scope item #6): DONE

All done live against a real Chromium session, professionals template:

- Business name with quotes, backslashes, and emoji (a string mixing single
  quotes, double quotes, backslash characters, an emoji, and a literal HTML
  tag as text): typed via keyboard into the canvas contenteditable field.
  Landed byte-for-byte identical to what was typed; zero accidental child
  elements were created; the literal HTML-looking substring rendered as
  visible text, not parsed markup. SAFE.
- Pasting raw HTML (an img with an onerror handler, plus an inline script
  tag) into the same field via a real ClipboardEvent carrying text/html data:
  the payload's JavaScript did NOT execute (verified via a window flag the
  payload would have set), and no img or script element was created inside
  the edited field itself; the contenteditable treated the paste as literal
  text, visible on screen as the raw markup string. SAFE.
- Twenty "+ Adauga" clicks in a row on the professionals services list: went
  from 4 to 24 items with no errors and no dropped clicks.
- Reload mid-edit: typing into a field and reloading the page almost
  immediately (about 100ms later, well inside the 300ms debounce window, no
  blur) DOES lose that keystroke burst; confirmed live, see the Medium
  finding below. Reloading about 500ms after the same typing (past the
  300ms debounce, still without ever blurring the field) DOES persist
  correctly across reload.

Evidence: 04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/diag10-adversarial.mjs,
diag11-20items-reload.mjs, diag12-reload-after-debounce.mjs.

### Medium (new): no unload protection - a fast reload right after typing silently loses that keystroke burst

There is no beforeunload, pagehide, or visibilitychange handler anywhere in
builder/app.js or builder/edit-overlay.js. Text edits in the preview canvas
are debounced 300ms before being sent from the iframe to the parent (and
only sent immediately on blur). Reproduced live: typed a new business name,
reloaded the tab about 100ms later without blurring the field first, the
name reverted to the original preset value; the typed text never reached
draft.config or localStorage. Reloading about 500ms after typing (still
without blurring) persists correctly, so the loss window is specifically
"reload/navigate away within about 300ms of the last keystroke, and never
tab or click off the field first." This is a real, reproducible, narrow
data-loss window with no warning of any kind to the user (no "unsaved
changes" prompt on unload at all, for this or any other reason). Severity
Medium: the window is short and requires a fairly deliberate action
(reload immediately after typing without blurring), but it is a genuine
silent-data-loss bug and there is zero mitigation for it today.

---

## Accessibility (scope items 7-11, all 5 published templates)

Method: for professionals, portfolio and local-service, the repo already
ships a dedicated real-pixel oracle (bot/test/wave5-{professionals,portfolio,
local-service}-a11y.test.js) which PASSED in the full-suite run: WCAG AA
contrast on every distinct text style (computed from real composited
getComputedStyle colours, not CSS source), 24x24 minimum interactive target
size on desktop AND mobile-with-menu-open, and no horizontal scroll at
640px/320px (200%-zoom-equivalent and the WCAG 1.4.10 reference width).
desserdirina and product-menu have NO dedicated a11y oracle in this repo, so
I built and ran the equivalent checks myself against REAL PUBLISHED sites
(went through the actual test-pay publish pipeline, same as
bot/test/flow2-template-e2e.mjs, so cookie-banner.css and the legal footer
are present exactly as a real visitor would see them - a bare
template.html+styles.css static export, which I tried first, was missing
that shared stylesheet and gave misleading results).

Gradient backgrounds: my contrast checker explicitly detects a
background-image containing "gradient" on the element or any ancestor and
reports those separately as "needs visual check" rather than silently
computing a wrong ratio against a fallback white background (which is
exactly the false-positive trap the task warned about). All gradient-flagged
elements on desserdirina (the pink-gradient contact card and its links) were
inspected by reading the CSS directly: white text (#fff) on a
pink-to-dark-pink gradient - genuinely fine, correctly excluded.

### Medium (confirmed, matches the original 2026-09-06 audit's A11Y-05 finding exactly): desserdirina still ships 9 real WCAG AA contrast failures on solid backgrounds

Measured on a live-published desserdirina site (qa-a11y-desserdirina), real
composited colours, real fonts/sizes:

- .section-eyebrow "Torturi, prajituri si paine artizanala": 3.38:1 (needs 4.5:1)
- .section-eyebrow "Fotografii": 3.2:1 (needs 4.5:1)
- .menu-lang-btn "EN": 4.37:1 (needs 4.5:1)
- .menu-lang-btn "RO" (inactive state): 3.38:1 (needs 4.5:1)
- .menu-cat "Torturi" (x2), "Placinte", "La comanda", "Servicii si Evenimente": 4.37:1 each (needs 4.5:1)

These ratios are IDENTICAL to the ones cited in the original audit's A11Y-05
finding (04-QA-Evidence/Audit-2026-09-06-2225ca7/a11y/findings.json), which
already named this exact brand-pink-on-white pattern on desserdirina's
eyebrow, language toggle, and menu category titles. This means these
specific defects were never fixed by any of the waves since the original
audit, despite other desserdirina issues (hero background, CLS, fonts,
gallery heading, itemShape schema) getting their own dedicated wave5 test
files. product-menu, by contrast, had ZERO contrast failures on the
equivalent elements I could locate (its own class names differ:
.pm-kicker, .pm-title, .pm-catblock__t/__b, .pm-contact, .hb-built-by - all
pass). Evidence:
04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/a11y-live-publish.mjs output
(not re-saved as a separate file to save disk; rerunning it reproduces the
same numbers deterministically since it renders from the same presets.json).

### Medium (confirmed, cross-template): the WCAG 2.5.8 touch-target fix for footer legal links landed on only 1 of 5 templates

templates/professionals/styles.css has an explicit override (with a comment
citing "Previously unstyled: default inline <a> sizing left these links
under the 24px WCAG 2.5.8 target-size minimum") giving .hb-legal-links a a
min-height of 24px. This override does NOT exist in portfolio,
local-service, product-menu, or desserdirina's styles.css - grepped all
five directly to confirm. The shared cookie-banner.css that ships the
Confidentialitate/Termeni/Cookie-uri footer links and the cookie banner's
"Afla mai mult" link on every template has no such min-height either.
Confirmed LIVE on the two published sites I checked:

- desserdirina: "Confidentialitate" 113x22, "Termeni" 56x22, "Cookie-uri"
  70x22, "Afla mai mult" 95x19/95x18 (desktop/mobile) - all under 24px tall.
- product-menu: "Confidentialitate" 102x21, "Termeni" 49x21, "Cookie-uri"
  65x21, "Afla mai mult" 84x19/84x18 - same pattern, plus its own top nav
  links ("La masa", "Meniu", "Rezervari") also render at 17px tall on
  desktop (these are hidden behind the mobile hamburger below the
  breakpoint, so the 24x24 check on the ACTUAL mobile interactive surface
  passes there - only the desktop-width nav row is short, and it is not the
  primary way a phone visitor would tap them).

portfolio and local-service were not live-republished a second time in this
pass to save disk/time, but since they share the identical unmodified
cookie-banner.css and have no equivalent override in their own styles.css
(confirmed by direct grep), the same footer/cookie-banner defect almost
certainly affects them too - flagging as confirmed-by-code-inspection,
not independently re-measured live, for those two.

### What held up (accessibility, confirmed live)

- professionals, portfolio, local-service: full WCAG AA contrast pass on
  every distinct text style tested, 24x24 minimum target size on desktop
  and mobile (menu open), no horizontal scroll at 640px/320px - all via the
  repo's own existing real-pixel oracles, which PASSED in a real headless
  Chromium run against this worktree.
- product-menu: WCAG AA contrast pass on every text style I could identify
  and test (kicker, titles, category headings, contact block, built-by
  credit) - 0 failures, measured on a live-published site.
- Keyboard-only mobile navigation (scope #9), all 3 templates that have a
  real nav menu (professionals, portfolio, product-menu): the hamburger
  toggle is reachable and focusable by keyboard, Enter opens it and sets
  aria-expanded=true, Tab correctly moves focus into the now-visible nav
  links (not skipped, not trapped elsewhere), Escape closes it, resets
  aria-expanded=false, AND returns focus to the toggle button - the full
  correct disclosure-widget pattern, confirmed live on all three via direct
  DOM/keyboard driving (not a source-code read). local-service and
  desserdirina have no navigation menu at all by design (a single-scroll
  landing page with just a phone/WhatsApp CTA in the header, no section
  links) - confirmed by reading their header markup - so there is nothing
  to keyboard-trap there; this is a legitimate design choice, not a gap.
- Zoom reflow (scope #10): no horizontal scrolling at 640px or 320px on any
  of the 5 templates (3 via the existing oracles, desserdirina and
  product-menu independently re-verified live by me).
- Landmarks and heading order (scope #11), quick structural check on all 5
  templates' source: each has exactly one <header>, one <main>, one
  <footer>, and a sensible one-or-more <nav> (skipped entirely, by design,
  on local-service/desserdirina - see above); heading levels read in a
  sane h1 -> h2 -> h3 order with no skipped levels on all 5. NOTE: 4 of 5
  templates (portfolio, local-service, product-menu, desserdirina) render
  TWO <h1> elements - one visually-hidden (class sr-only) carrying the
  business name, and a second visible one (a wordmark/logo heading) - which
  I did NOT get to fully evaluate (see below).

### Not covered / unconfirmed (accessibility)

- Alt text and form labels (part of scope #11): not systematically checked
  across all 5 templates in this pass - spot checks only during other work
  (e.g. hero logo images do carry alt={{business.name}} where present).
- Accessibility TREE sanity (scope #11's "does the accessibility tree make
  sense") - not run through an automated tool (axe-core is not a project
  dependency; adding it was out of scope for a no-product-changes audit).
  My contrast/target/heading checks are hand-rolled against the same WCAG
  formulas, not a full axe ruleset, so rule categories axe would catch
  (duplicate IDs, redundant ARIA, list-item context, etc.) were not swept.
- The double-<h1> pattern on 4 of 5 templates (see above): not evaluated for
  real-world screen-reader impact (whether it's actually confusing in
  practice, e.g. because one is always empty/hidden text vs. audible
  duplication) - flagging as a low-confidence observation, not a scored
  finding.
- portfolio and local-service's footer-legal-link touch-target sizes: not
  independently re-measured live in THIS pass (confirmed by code inspection
  only - see above).
- Screen-reader-specific behaviour (actual VoiceOver/NVDA output) was not
  tested - all "accessibility tree" claims here are DOM/ARIA-attribute-level
  (getComputedStyle, getBoundingClientRect, aria-* attributes), not verified
  against a real assistive-technology reading.
- Builder-editor-chrome (not published-site) accessibility - e.g. whether
  the drawer, colour popover, and toolbar themselves are fully
  screen-reader-usable - was not in this pass's scope per the task
  (accessibility scope was explicitly "on published sites of all five
  templates").
