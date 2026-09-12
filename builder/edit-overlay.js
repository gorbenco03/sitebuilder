/**
 * edit-overlay.js — runs INSIDE the sandboxed srcdoc iframe (no allow-same-origin).
 *
 * Security posture:
 *  - All inbound postMessages are validated: event.source === window.parent only.
 *  - No eval(), no Function(), no dynamic script creation.
 *  - No access to cookie, localStorage, sessionStorage (blocked by sandbox anyway).
 *  - Paste is sanitised to plain text only (no HTML injection via clipboard).
 *  - contenteditable fields do not execute scripts (textContent used, not innerHTML).
 *
 * Communication protocol (see PROTOCOL postMessage in task brief):
 *
 *   iframe → parent:
 *     {hb:'ready'}                           — overlay mounted
 *     {hb:'text', path, value}               — text edited (debounced 300ms + blur)
 *     {hb:'text-live', path, value}          — SAME edit, sent on every keystroke
 *                                              (undebounced). Wave 9 (save-state audit):
 *                                              the parent mirrors this into an in-memory
 *                                              "not yet committed" map so a reload/close
 *                                              inside the 300ms debounce window never loses
 *                                              the keystroke — see flushPendingLiveEdits()
 *                                              in app.js. Cheap by design (no persistence,
 *                                              no history push) so it is safe to send on
 *                                              every keystroke without the cost the 300ms
 *                                              debounce on {hb:'text'} exists to avoid.
 *     {hb:'image', path}                     — user wants to change an image
 *     {hb:'list-add', listPath}              — add new list item
 *     {hb:'list-remove', path}               — remove list item at path
 *     {hb:'focus', path}                     — a field received focus
 *     {hb:'undo'} / {hb:'redo'}              — Ctrl+Z / Ctrl+Shift+Z pressed on the canvas
 *     {hb:'connect-instagram'}                — Instagram teaser's CTA clicked (see
 *                                              section 5c below) — app.js opens the
 *                                              existing Instagram modal in response.
 *
 *   parent → iframe:
 *     {hb:'set', path, value}               — surgical text update (no re-render)
 *     {hb:'highlight', path}                — flash outline on element
 *     {hb:'imgmap', map}                    — {src→path} reverse-lookup map
 *     {hb:'demoText', paths}                — identity-field paths still at
 *                                              the demo preset's own value —
 *                                              paints the provisional marker
 *                                              (see "Provisional demo content"
 *                                              below). Never present on a
 *                                              published site or export: this
 *                                              whole overlay script only ever
 *                                              runs inside the builder's own
 *                                              editMode srcdoc (see
 *                                              renderHtml()'s editMode flag in
 *                                              build.js — export calls it with
 *                                              no opts at all).
 *
 * Provisional demo content (Wave 11):
 *   A fresh draft is seeded from the template's own demo preset — a
 *   plausible name, phone, address and photos that read as a finished real
 *   site (see builder/app.js's IDENTITY_FIELD_KEYS doc comment). Nothing on
 *   the rendered canvas said "this is still the template's" — this overlay
 *   paints two purely-visual, purely-in-editor markers so a glance at the
 *   canvas answers that at once:
 *     - .hb-demo-text on an identity [data-hb-edit] span still at its demo
 *       value (parent-driven, see {hb:'demoText'} above) — a soft highlight,
 *       not an error state. Dropped the instant the field is edited (see
 *       setupTextFields()'s input handler) — no round trip needed, since
 *       touching it is definitionally "no longer the demo's".
 *     - .hb-demo-photo (a CSS-only ::after corner badge) on any photo
 *       (<img> or CSS background) whose src is
 *       not a data: URI — an owner's own upload is always inlined as one
 *       (see the resize/upload pipeline in app.js), so anything else is
 *       still the template's bundled asset. Detected locally, no message
 *       needed: a photo only ever changes via a full re-render (new srcdoc,
 *       this script re-runs from scratch), so there is nothing to keep in
 *       sync between renders.
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
     0. Guard: only mount once
  ───────────────────────────────────────────────────────────────────────── */
  if (window.__hidookOverlayMounted) return;
  window.__hidookOverlayMounted = true;

  /* ─────────────────────────────────────────────────────────────────────────
     1. State
  ───────────────────────────────────────────────────────────────────────── */

  /** src → config dot-path reverse-lookup map. Populated via {hb:'imgmap'} */
  var imgMap = {};

  /** debounce timers per path */
  var debounceTimers = {};

  /**
   * Schema-derived list metadata — { lists: {key: {min,max}}, nested:
   * [{parent,key}] } — read synchronously from the
   * <script type="application/json" id="hb-list-schema"> tag builder/app.js
   * embeds into every rendered srcdoc (see buildSrcdoc()/injectListSchema
   * there). This replaces the old hardcoded SAFE_LIST_PATHS name allowlist
   * (['services','menu','pricing','packages','steps','reviews'] plus a
   * couple of regex special-cases), which silently starved every list
   * whose schema key didn't happen to match one of those six guessed words
   * — faq.items, credentials.items and (while it still existed;
   * professionals' instagram.gallery was removed as a dead field in S9B,
   * see build.js's normalizeInstagramForPublic()) instagram.gallery (all
   * ended in ".items"/".gallery", not one of the six) never got add/remove
   * controls no matter how many items schema.json's `min`/`max` allowed. The one
   * fix here is: a list is safe to add/remove from iff schema.json says so.
   *
   * Read once at module load — this script itself is only ever a fresh
   * inline injection per full re-render (a new srcdoc document), so there
   * is exactly one schema payload per instance of this script, no matter
   * how many times mount() itself might be re-entered.
   */
  function readListSchema() {
    try {
      var el = document.getElementById('hb-list-schema');
      if (!el) return { lists: {}, nested: [] };
      var parsed = JSON.parse(el.textContent || '{}') || {};
      return {
        lists: parsed.lists && typeof parsed.lists === 'object' ? parsed.lists : {},
        nested: Array.isArray(parsed.nested) ? parsed.nested : []
      };
    } catch (e) {
      return { lists: {}, nested: [] };
    }
  }
  // NOT read eagerly here: this whole script runs as an inline <script> that
  // builder/app.js inserts BEFORE the later <script id="hb-list-schema">
  // JSON tag in the same document (see buildSrcdoc()/injectListSchema). A
  // classic <script>'s top-level statements execute the instant the parser
  // reaches them — mid-parse, well before a later sibling tag exists in the
  // DOM — so reading it here would always see an empty document and quietly
  // disable every list's add/remove controls (which is exactly what happened
  // the first time this was written eagerly: every list broke, not just the
  // three this fix targets). mount() below IS correctly deferred to
  // DOMContentLoaded (or run only once the document is already interactive),
  // by which point the entire document — including a JSON tag that comes
  // later in the HTML — is guaranteed parsed. So the read happens there.
  var listSchema = { lists: {}, nested: [] };

  function escapeRegExpLiteral(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * S1-6 (m3/m21): {path: maxLen} / {listPath: max}, computed by
   * builder/app.js's computeSchemaLimits() from the template's schema.json
   * and injected as plain globals by scripts/build-builder.js's
   * renderPreview() (see its "S1-6" comment). Defensive reads: a page that
   * somehow runs this overlay without that injection (e.g. an older cached
   * srcdoc) must not throw, just skip the limit.
   */
  function getFieldLimits() {
    try { return (window.__hbFieldLimits && typeof window.__hbFieldLimits === 'object') ? window.__hbFieldLimits : {}; }
    catch (e) { return {}; }
  }
  function getListLimits() {
    try { return (window.__hbListLimits && typeof window.__hbListLimits === 'object') ? window.__hbListLimits : {}; }
    catch (e) { return {}; }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     2. Inject overlay CSS
  ───────────────────────────────────────────────────────────────────────── */

  (function injectCss() {
    var style = document.createElement('style');
    style.setAttribute('data-hb-overlay', '');
    style.textContent = [
      /* editable text fields */
      '[data-hb-edit][data-hb-kind="text"] {',
      '  outline: none;',
      '  border-radius: 2px;',
      '  cursor: text;',
      '}',
      '[data-hb-edit][data-hb-kind="text"]:hover {',
      '  outline: 2px dashed rgba(59,130,246,0.55);',
      '  outline-offset: 2px;',
      '}',
      '[data-hb-edit][data-hb-kind="text"]:focus {',
      '  outline: 2px solid rgba(59,130,246,0.9);',
      '  outline-offset: 2px;',
      '}',

      /* PLAN-QA-2026-09-12 §3 Suite 1 (B2 + M1): a genuinely empty
       * contenteditable span has no box to click on at all — a title
       * emptied via Ctrl+A/Delete collapses to 0×0 and is unrecoverable
       * without Undo, and a freshly-added list item's optional field (price,
       * description, …) is invisible even once build.js's editMode @if fix
       * makes the span exist. `:empty` (real DOM emptiness, not merely
       * "no visible text") gets a floor box plus a muted placeholder drawn
       * from data-hb-placeholder (set by build.js's replaceTokens() on every
       * such span, see placeholderLabelForToken()). `content: attr(...)` is
       * a generated box, never a real text node, so it can never leak into
       * el.textContent / the committed edit, and it only exists on THIS
       * editor-only style tag — the exported/published HTML never has it. */
      '[data-hb-edit][data-hb-kind="text"]:empty {',
      '  display: inline-block;',
      '  min-width: 44px;',
      /* max(): a small nav-brand copy of business.name can sit at ~16px
       * font-size, where 1.4em alone rounds to ~22-24px — too close to the
       * 24px floor this fix promises. The absolute 24px guarantees the
       * floor regardless of the surrounding font-size; 1.4em still grows it
       * on a large hero h1. */
      '  min-height: max(1.4em, 24px);',
      '  outline: 2px dashed rgba(59,130,246,0.55);',
      '  outline-offset: 2px;',
      '}',
      '[data-hb-edit][data-hb-kind="text"]:empty::before {',
      '  content: attr(data-hb-placeholder);',
      '  color: rgba(71,85,105,0.6);',
      '  font-style: italic;',
      '  pointer-events: none;',
      '  white-space: nowrap;',
      '}',

      /* S1-6 (m3): the discreet "48/60" counter shown once a field is >= 80%
       * of its schema maxLen. Small and muted on purpose — it is a nudge,
       * not a warning banner. */
      '.hb-charcount {',
      '  font-size: 0.7em;',
      '  color: rgba(100,116,139,0.8);',
      '  font-family: system-ui, sans-serif;',
      '  user-select: none;',
      '  pointer-events: none;',
      '  vertical-align: middle;',
      '}',

      /* image change button wrapper */
      '.hb-img-wrap {',
      '  position: relative;',
      '  display: inline-block;',
      '}',
      '.hb-img-wrap > img {',
      '  position: relative;',
      '  z-index: 0;',
      '  pointer-events: none;',
      '}',
      '.hb-img-btn {',
      '  position: absolute;',
      '  top: 50%;',
      '  left: 50%;',
      '  transform: translate(-50%,-50%);',
      '  background: rgba(0,0,0,0.65);',
      '  color: #fff;',
      '  border: none;',
      '  border-radius: 6px;',
      '  padding: 6px 10px;',
      '  font-size: 12px;',
      '  font-family: system-ui, sans-serif;',
      '  cursor: pointer;',
      '  opacity: 0;',
      '  transition: opacity 0.15s;',
      '  pointer-events: auto;',
      '  white-space: nowrap;',
      '  z-index: 2147483647;',
      '}',
      '.hb-img-wrap:hover > .hb-img-btn {',
      '  opacity: 1;',
      '  pointer-events: auto;',
      '}',

      /* background-image change overlay
         Suite 4 QA (m16): measured 219x31px on a phone — under the 44px
         touch floor (this button is always visible when there is no photo
         behind it yet — see .hb-demo-bg below — so it is a real touch
         target, not a hover-only affordance). */
      '.hb-bg-btn {',
      '  position: absolute;',
      '  top: 12px;',
      '  right: 12px;',
      '  min-height: 44px;',
      '  display: flex;',
      '  align-items: center;',
      '  background: rgba(0,0,0,0.65);',
      '  color: #fff;',
      '  border: none;',
      '  border-radius: 6px;',
      '  padding: 6px 10px;',
      '  font-size: 12px;',
      '  font-family: system-ui, sans-serif;',
      '  cursor: pointer;',
      '  transition: opacity 0.15s;',
      '  z-index: 2147483647;',
      '  pointer-events: auto;',
      '}',
      '.hb-bg-wrap:hover > .hb-bg-btn {',
      '  opacity: 1;',
      '  pointer-events: auto;',
      '}',

      /* list controls */
      '.hb-list-item {',
      '  position: relative;',
      '}',
      '.hb-remove-btn {',
      '  position: absolute;',
      '  top: 4px;',
      '  right: 4px;',
      '  background: rgba(220,38,38,0.85);',
      '  color: #fff;',
      '  border: none;',
      '  border-radius: 50%;',
      '  width: 20px;',
      '  height: 20px;',
      '  font-size: 14px;',
      '  line-height: 1;',
      '  cursor: pointer;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  opacity: 0;',
      '  transition: opacity 0.15s;',
      '  z-index: 9999;',
      '  pointer-events: none;',
      '}',
      '.hb-list-item:hover .hb-remove-btn {',
      '  opacity: 1;',
      '  pointer-events: auto;',
      '}',
      /* Suite 4 QA (m16): measured 91x34px on a phone — under the 44px
         touch floor. min-height (not just bigger padding) so it hits 44px
         regardless of font metrics in whichever browser renders it. */
      '.hb-add-btn {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  min-height: 44px;',
      '  margin: 6px auto 0;',
      '  background: rgba(59,130,246,0.1);',
      '  color: rgba(59,130,246,0.95);',
      '  border: 1px dashed rgba(59,130,246,0.5);',
      '  border-radius: 6px;',
      '  padding: 6px 16px;',
      '  font-size: 13px;',
      '  font-family: system-ui, sans-serif;',
      '  cursor: pointer;',
      '  z-index: 9999;',
      '}',
      '.hb-add-btn:hover {',
      '  background: rgba(59,130,246,0.2);',
      '}',
      /* S1-6 (m21): list at its schema max. */
      '.hb-add-btn:disabled {',
      '  cursor: not-allowed;',
      '  opacity: 0.55;',
      '  background: rgba(100,116,139,0.1);',
      '  border-color: rgba(100,116,139,0.4);',
      '  color: rgba(71,85,105,0.85);',
      '}',
      '.hb-add-btn:disabled:hover {',
      '  background: rgba(100,116,139,0.1);',
      '}',

      /* highlight flash */
      '@keyframes hb-flash {',
      '  0%   { outline: 3px solid rgba(251,191,36,0.9); outline-offset: 3px; }',
      '  60%  { outline: 3px solid rgba(251,191,36,0.9); outline-offset: 3px; }',
      '  100% { outline: none; outline-offset: 0; }',
      '}',
      '.hb-highlight {',
      '  animation: hb-flash 0.9s ease-out forwards;',
      '}',

      /* Provisional demo content (Wave 11) — editor-only, see file header.
         Deliberately a different colour (warm amber) from the blue
         hover/focus cue above: blue means "you can edit this", amber means
         "this is still the template's, not yours yet". A soft highlighter
         wash + dashed underline reads as "draft", not as an error. */
      '[data-hb-edit].hb-demo-text {',
      '  background-image: linear-gradient(rgba(217,119,6,0.16), rgba(217,119,6,0.16));',
      '  background-repeat: no-repeat;',
      '  background-size: 100% 100%;',
      '  box-shadow: inset 0 -2px 0 0 rgba(217,119,6,0.55);',
      '  border-radius: 2px;',
      '}',
      /* A CSS-only ::after badge, not an appended DOM node: setupImages()
         already alternates DOM writes with forced-synchronous-layout reads
         (getComputedStyle()) over every image/background element on the
         page, and adding a real appendChild() (plus, in an earlier version
         of this fix, a querySelector() guard) to that same hot loop
         measurably slowed every full re-render — reproduced as a real
         regression in bot/test/fullpass-63230d2.mjs's professionals
         Cal.com-booking-link timing check during this wave's own
         development (a slower render pipeline made it more likely to still
         be in flight when the next scheduled re-render came due — see
         fullRerender()\'s renderInFlight guard in app.js). Toggling one class
         (see addDemoBadge() below) costs nothing comparable. */
      /* No position rule on .hb-demo-photo itself: both call sites below
         only ever add it to a host that setupImages() has already made (or
         confirmed) non-static — forcing position:relative here too could
         fight an inline position:absolute/fixed a template sets for a
         parallax hero, since a stylesheet rule injected after the page's
         own <style> can out-order an equal-specificity class selector. */
      '.hb-demo-photo::after {',
      '  content: "demo";',
      '  position: absolute;',
      '  top: 6px;',
      '  left: 6px;',
      '  background: rgba(180,83,9,0.92);',
      '  color: #fff;',
      '  font: 700 10px/1 system-ui, sans-serif;',
      '  letter-spacing: 0.04em;',
      '  text-transform: uppercase;',
      '  padding: 3px 7px;',
      '  border-radius: 4px;',
      '  pointer-events: none;',
      '  z-index: 2147483646;',
      '}',

      /* Wave 12: a hero/background photo's "still demo" flag and its
         "Înlocuiește fotografia" fix used to sit in different corners of the
         same image (this ::after tag top-left, the button top-right) —
         two signals for one fact, competing for attention instead of
         reinforcing each other. Fix: fold the flag directly into the
         button (see applyPendingDemoBadges() below, the 'bg' branch) —
         same amber as the .hb-demo-text cue above, so every provisional-
         content signal in the editor reads as one visual language. The
         corner ::after tag above is kept for the OTHER photo shape
         (plain <img>, e.g. a gallery photo or logo): its replace button
         only appears on hover, so a persistent glanceable marker is still
         needed there — this rule only ever applies to a background host,
         which always carries the always-visible .hb-bg-btn instead. */
      '.hb-demo-bg > .hb-bg-btn {',
      '  background: rgba(180,83,9,0.92);',
      '  box-shadow: 0 0 0 1px rgba(255,255,255,0.35) inset;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }());

  /* ─────────────────────────────────────────────────────────────────────────
     3. Helpers
  ───────────────────────────────────────────────────────────────────────── */

  /** Send a message to the parent safely. */
  function toParent(msg) {
    try { window.parent.postMessage(msg, '*'); } catch (_) {}
  }

  /**
   * Open inside the iframe while the click still owns a browser user gesture.
   * The parent also receives the ordinary image request and attempts its shared
   * chooser; sandboxed postMessage delivery may lose activation in Chromium, so
   * this direct chooser returns the selected File for the same parent pipeline.
   */
  function requestImageChange(path, src, alt) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (file) toParent({ hb: 'image-file', path: path || null, src: src || '', alt: alt || '', file: file });
      if (file && input.parentNode) input.parentNode.removeChild(input);
    });
    document.body.appendChild(input);
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  }

  /** Find a single element by exact data-hb-edit path value. */
  function findByPath(path) {
    return document.querySelector('[data-hb-edit="' + CSS.escape(path) + '"]');
  }

  /** Find all elements by data-hb-edit path value. */
  function findAllByPath(path) {
    return Array.prototype.slice.call(
      document.querySelectorAll('[data-hb-edit="' + CSS.escape(path) + '"]')
    );
  }

  /**
   * Paint (or repaint) the provisional "still demo" marker on exactly the
   * given identity-field paths. Called on every {hb:'demoText'} — i.e. after
   * every render and after every committed edit anywhere in draft.config
   * (see sendDemoTextMarks()'s doc comment in app.js) — so this always
   * clears the previous set first rather than only adding: a field that just
   * stopped matching the demo default (edited via the DRAWER, not this
   * field's own contenteditable — so nothing local already dropped its
   * class) must lose the marker too.
   */
  function markDemoTextPaths(paths) {
    var wanted = {};
    paths.forEach(function (p) { wanted[p] = true; });
    var all = Array.prototype.slice.call(document.querySelectorAll('[data-hb-edit][data-hb-kind="text"]'));
    all.forEach(function (el) {
      var path = el.getAttribute('data-hb-edit');
      el.classList.toggle('hb-demo-text', !!wanted[path]);
    });
  }

  /** Debounce helper — resets per-path timer. */
  function debounce(path, fn, delay) {
    if (debounceTimers[path]) clearTimeout(debounceTimers[path]);
    debounceTimers[path] = setTimeout(function () {
      delete debounceTimers[path];
      fn();
    }, delay || 300);
  }

  /** Extract the numeric index from the last segment of a dot-path, e.g. "services.2" → 2 */
  function lastIndex(path) {
    var parts = path.split('.');
    var last = parts[parts.length - 1];
    var n = parseInt(last, 10);
    return isNaN(n) ? -1 : n;
  }

  /** Extract the list root from an item path, e.g. "services.2" → "services" */
  function listRoot(path) {
    var parts = path.split('.');
    // Find the last numeric segment; everything before it is the list path.
    for (var i = parts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(parts[i])) {
        return parts.slice(0, i).join('.');
      }
    }
    return null;
  }

  /**
   * Is `rootPath` a schema-declared editable list? A top-level match is an
   * exact lookup in listSchema.lists (schema.json's own key, e.g.
   * "faq.items", "credentials.items", "menu.en"). A
   * nested match (an itemShape sub-field of type "list" living inside
   * another list's items — e.g. product-menu's `menu.en.<N>.items` dish
   * array nested inside the `menu.en` section list) has no schema key of
   * its own, so it is matched by the parent+key pattern instead.
   */
  function isSafeList(rootPath) {
    if (!rootPath) return false;
    if (Object.prototype.hasOwnProperty.call(listSchema.lists, rootPath)) return true;
    for (var i = 0; i < listSchema.nested.length; i++) {
      var n = listSchema.nested[i];
      if (!n || !n.parent || !n.key) continue;
      var re = new RegExp('^' + escapeRegExpLiteral(n.parent) + '\\.\\d+\\.' + escapeRegExpLiteral(n.key) + '$');
      if (re.test(rootPath)) return true;
    }
    return false;
  }

  /** min/max for a schema-declared list root, defaulting to "no limit". */
  function listLimits(rootPath) {
    var l = listSchema.lists[rootPath];
    return {
      min: l && typeof l.min === 'number' ? l.min : 0,
      max: l && typeof l.max === 'number' ? l.max : null
    };
  }

  /**
   * Detect list structure from data-hb-edit paths.
   * Returns {[listRoot]: [itemIndex, ...]} for all roots that appear more than once
   * with numeric segments, and that are in the safe list.
   */
  function detectListGroups() {
    var all = Array.prototype.slice.call(document.querySelectorAll('[data-hb-edit]'));
    var counts = {}; // listRoot → Set of indices seen
    all.forEach(function (el) {
      var path = el.getAttribute('data-hb-edit');
      var root = listRoot(path);
      if (!root) return;
      if (!isSafeList(root)) return;
      if (!counts[root]) counts[root] = {};
      // Find the direct child index in this root.
      var afterRoot = path.slice(root.length + 1); // e.g. "2.label"
      var firstSeg = afterRoot.split('.')[0];
      if (/^\d+$/.test(firstSeg)) {
        counts[root][firstSeg] = true;
      }
    });
    return counts;
  }

  /**
   * Romanian, vertical-appropriate default text for a freshly added (still empty)
   * list-item text field. Never a generic factory placeholder ("Element nou" /
   * "New item") — the product oracle rejects those. Returns null when we don't
   * recognise the field, so the caller leaves it untouched rather than guessing.
   *
   * `root` is the list root as produced by listRoot() (e.g. "services",
   * "categories", "pricing"). `fieldKey` is the path segment(s) after the item
   * index (e.g. "label"). `contextEl` is the empty field's own element, used to
   * sniff nearby template-specific class names when the same root name is
   * reused by different verticals with different wording needs.
   */
  function defaultItemText(root, fieldKey, contextEl) {
    function hasAncestorClass(re) {
      var el = contextEl;
      var depth = 0;
      while (el && depth < 12) {
        if (typeof el.className === 'string' && re.test(el.className)) return true;
        el = el.parentElement;
        depth++;
      }
      return false;
    }

    if (root === 'services' || /(^|\.)services$/.test(root)) {
      if (fieldKey === 'label') {
        if (hasAncestorClass(/\bpm-ticket\b/)) return 'Specialitate nouă';
        return 'Serviciu nou';
      }
    }
    if (root === 'pricing' || /(^|\.)pricing$/.test(root)) {
      if (fieldKey === 'name') return 'Pachet nou';
    }
    if (root === 'packages' || /(^|\.)packages$/.test(root)) {
      if (fieldKey === 'name' || fieldKey === 'label' || fieldKey === 'title') return 'Pachet nou';
    }
    if (root === 'categories' || /(^|\.)categories$/.test(root)) {
      if (fieldKey === 'title') {
        if (hasAncestorClass(/\bpm-catblock\b/)) return 'Categorie foto nouă';
        if (hasAncestorClass(/\bpf-series\b/)) return 'Categorie de lucrări nouă';
        return 'Categorie nouă';
      }
    }
    if (root === 'steps' || /(^|\.)steps$/.test(root)) {
      if (fieldKey === 'label' || fieldKey === 'title') return 'Pas nou';
    }
    if (root === 'reviews' || /(^|\.)reviews$/.test(root)) {
      if (fieldKey === 'author' || fieldKey === 'name') return 'Client nou';
      if (fieldKey === 'text' || fieldKey === 'quote' || fieldKey === 'body') return 'Recenzie nouă';
    }
    return null;
  }

  /**
   * Root-cause fix for "+ Adaugă" producing invisible/empty cards (PM-02, prof-01):
   * app.js's onListAdd seeds a brand-new repeatable item with empty strings for
   * every itemShape field, so the freshly rendered card has literally no text.
   * We cannot change onListAdd (out of scope here), so instead — right after the
   * fresh render lands in the iframe and before wiring up list controls — we
   * detect any list item in a safe list whose text fields are ALL still empty
   * (i.e. it looks exactly like a just-created, never-touched item) and give it
   * sensible Romanian text. We both paint it in locally (so it's visible at
   * once) and echo it back to the parent via the existing {hb:'text'} protocol
   * so draft.config — and therefore exports/publishes — carry the same value.
   *
   * Only items where *every* discovered text field is empty are touched, so a
   * user who deliberately clears one field on an otherwise-filled item is left
   * alone.
   */
  function fillEmptyListItemDefaults(groups) {
    Object.keys(groups).forEach(function (root) {
      Object.keys(groups[root]).forEach(function (idxKey) {
        var idx = Number(idxKey);
        var itemPath = root + '.' + idx;
        var fields = Array.prototype.slice.call(
          document.querySelectorAll(
            '[data-hb-edit^="' + CSS.escape(itemPath + '.') + '"][data-hb-kind="text"], ' +
            '[data-hb-edit="' + CSS.escape(itemPath) + '"][data-hb-kind="text"]'
          )
        );
        if (fields.length === 0) return;
        var allEmpty = fields.every(function (el) {
          return el.textContent.replace(/\s+/g, '') === '';
        });
        if (!allEmpty) return;

        fields.forEach(function (el) {
          var path = el.getAttribute('data-hb-edit');
          var fieldKey = path.length > itemPath.length ? path.slice(itemPath.length + 1) : '';
          var text = defaultItemText(root, fieldKey, el);
          if (!text) return;
          el.textContent = text;
          toParent({ hb: 'text', path: path, value: text });
        });
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     4. Make text fields editable
  ───────────────────────────────────────────────────────────────────────── */

  function setupTextFields() {
    var fields = Array.prototype.slice.call(
      document.querySelectorAll('[data-hb-edit][data-hb-kind="text"]')
    );

    var fieldLimits = getFieldLimits();

    fields.forEach(function (el) {
      var path = el.getAttribute('data-hb-edit');

      // Determine if this is a single-line field (no \n in original text).
      var isSingleLine = el.textContent.indexOf('\n') === -1;

      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'true');

      // S1-6 (m3): maxLen from schema.json, enforced at typing time. Only
      // top-level fields carry a declared maxLen today (itemShape entries
      // don't — see computeSchemaLimits() in app.js), so most list-item
      // fields simply have no entry here and are left unlimited.
      var maxLen = fieldLimits[path];
      var counterEl = null;
      function updateCounter() {
        if (!maxLen) return;
        var len = el.textContent.length;
        if (len >= Math.floor(maxLen * 0.8)) {
          if (!counterEl || !counterEl.isConnected) {
            counterEl = document.createElement('span');
            counterEl.className = 'hb-charcount';
            counterEl.setAttribute('contenteditable', 'false');
            counterEl.setAttribute('aria-hidden', 'true');
            if (el.parentNode) el.parentNode.insertBefore(counterEl, el.nextSibling);
          }
          counterEl.textContent = ' ' + len + '/' + maxLen;
        } else if (counterEl) {
          counterEl.remove();
          counterEl = null;
        }
      }

      /* Prevent paste as HTML — always insert plain text */
      el.addEventListener('paste', function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text/plain');
        // Insert at current cursor position
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        var range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        // Fire synthetic input so debounce triggers
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });

      /* Editing a label must not fire the control that label sits in.
       *
       * Most editable text in these templates is a <span data-hb-edit> INSIDE
       * an <a> or a <button> -- the nav links, and the appointment CTA
       * (`<a href="#appointment"><span data-hb-edit="labels.navBook">`). Making
       * the span contenteditable does not stop the anchor: clicking the word
       * to place a caret also followed the link, so trying to rename
       * "Programare" scrolled the canvas down to the booking section and the
       * owner lost their place.
       *
       * preventDefault on `click` (not mousedown) is deliberate: the caret is
       * placed on mousedown, so suppressing that would make the text
       * unselectable, while navigation happens on click. stopPropagation
       * additionally keeps the template's own smooth-scroll and menu handlers
       * from running -- they listen on ancestors.
       *
       * This applies only in the editor overlay, which never runs on a
       * published site, so a real visitor's links behave normally.
       */
      el.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });

      /* Same for the keyboard: Enter inside a link activates it. */
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && el.closest && el.closest('a, button')) {
          e.preventDefault();
        }
      }, true);

      /* Single-line: prevent Enter from inserting a line break */
      if (isSingleLine) {
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            el.blur();
          }
        });
      }

      /* On input: debounced postMessage (the "committed" edit — applies to
       * draft.config, persists, records an undo step) PLUS an immediate,
       * undebounced mirror (Wave 9 — closes the 300ms reload-loses-the-edit
       * window: the parent keeps the live value in memory so a reload/close
       * inside the debounce window can still recover it without waiting on
       * this timer). The mirror is intentionally cheap — no draft.config
       * write, no localStorage, no history — so sending it every keystroke
       * costs nothing the 300ms debounce below still exists to avoid. */
      el.addEventListener('input', function () {
        var value = el.textContent;
        // S1-6 (m3): block typing past the schema's maxLen. Truncating AFTER
        // the browser already inserted the character (rather than trying to
        // preventDefault a contenteditable keystroke, which does not
        // reliably cover paste/IME/composition) and re-placing the caret at
        // the end is the same trade-off every plain-text-length limiter on a
        // contenteditable makes — the caret lands at the end rather than
        // exactly where typing stopped, which only matters when the owner
        // types past the limit in the middle of existing text (rare: the
        // limit is usually hit typing forward).
        if (maxLen && value.length > maxLen) {
          value = value.slice(0, maxLen);
          el.textContent = value;
          var range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        updateCounter();
        // The moment the owner touches a "still demo" field it stops being
        // the demo's — drop the marker immediately rather than waiting for
        // the debounced commit + a round trip back from the parent (see
        // markDemoTextPaths()'s doc comment; the parent will confirm/repaint
        // the full set once the debounced {hb:'text'} below lands anyway).
        el.classList.remove('hb-demo-text');
        toParent({ hb: 'text-live', path: path, value: value });
        debounce(path, function () {
          toParent({ hb: 'text', path: path, value: value });
        }, 300);
      });

      /* On blur: send immediately (cancel any pending debounce), and drop
       * the discreet char-counter — it is only useful while actively typing. */
      el.addEventListener('blur', function () {
        if (debounceTimers[path]) {
          clearTimeout(debounceTimers[path]);
          delete debounceTimers[path];
        }
        if (counterEl) { counterEl.remove(); counterEl = null; }
        toParent({ hb: 'text', path: path, value: el.textContent });
      });

      /* On focus: notify parent */
      el.addEventListener('focus', function () {
        toParent({ hb: 'focus', path: path });
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     5. Make images interactive — <img> tags + background-image elements
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Resolve the config path for a given image src via the imgMap.
   * Limit: if two images share the same src URL, only the first match is returned.
   * Preview inlines images/* → data: URLs; parent should also map those data URLs.
   */
  function resolveImgPath(src) {
    if (!src) return null;
    // Exact match.
    if (imgMap[src]) return imgMap[src];
    // Try without query string — never split data: URLs (base64 may contain '?').
    var base = src.indexOf('data:') === 0 ? src : src.split('?')[0];
    if (imgMap[base]) return imgMap[base];
    // Fallback: search by suffix for relative paths that may have been resolved.
    var keys = Object.keys(imgMap);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] && src.indexOf(keys[i]) !== -1) return imgMap[keys[i]];
      if (keys[i] && keys[i].indexOf(src) !== -1) return imgMap[keys[i]];
    }
    return null;
  }

  /**
   * When preview has inlined images/* as data URLs but imgMap only has file paths,
   * pick the best *.background config path so «Înlocuiește fotografia» still opens the chooser.
   */
  function resolveBackgroundPathFallback() {
    var keys = Object.keys(imgMap);
    var bgPaths = [];
    var seen = {};
    for (var i = 0; i < keys.length; i++) {
      var p = imgMap[keys[i]];
      if (!p || seen[p]) continue;
      if (/\.background$|background/i.test(p)) {
        seen[p] = true;
        bgPaths.push(p);
      }
    }
    if (bgPaths.indexOf('hero.background') >= 0) return 'hero.background';
    for (var j = 0; j < bgPaths.length; j++) {
      if (/^hero\./.test(bgPaths[j])) return bgPaths[j];
    }
    if (bgPaths.length === 1) return bgPaths[0];
    return bgPaths[0] || null;
  }

  /** Is `src` still the template's own bundled asset (not an owner upload)?
   * Owner uploads are always inlined as data: URIs by the resize/upload
   * pipeline in app.js — anything else (a bare "images/x.jpg", or that same
   * path wrapped in a CSS url(...)) is still the demo photo. Mirrors
   * isDemoPhotoValue() in app.js; kept as its own copy here since this
   * script runs in a separate sandboxed document with no shared scope. */
  function isDemoSrcValue(src) {
    return typeof src === 'string' && src.length > 0 && src.indexOf('data:image/') === -1;
  }

  /** Hosts queued for the "demo" marker — populated during setupImages(),
   * applied afterward (see applyPendingDemoBadges()). Each entry also
   * carries which photo shape it is ('img' or 'bg' — see addDemoBadge()). */
  var pendingDemoBadgeHosts = [];

  /** Queue a wrapper element for the "still demo" marker, applied only once
   * the {hb:'ready'} handshake has already been sent (see mount()).
   *
   * `kind` is 'img' (a plain <img>'s wrap — the default) or 'bg' (a CSS
   * background's host): they get different treatment in
   * applyPendingDemoBadges() below — see that function's doc comment for
   * why — but both queue the same cheap way.
   *
   * Not applied inline here on purpose: this is called from inside
   * setupImages()'s per-element loop, which the parent's fullRerender() /
   * waitForInteractivePreview() treats as part of the CRITICAL, synchronous
   * path that gates when the render is considered "settled" (the injected
   * ready-script's readiness poll runs its first check immediately after
   * this same DOMContentLoaded dispatch finishes — see
   * prepareInteractivePreviewDocument() in app.js). Any extra synchronous
   * work added to that path — even a cheap classList.add() — measurably
   * raised the odds of the parent's render-serialization guard
   * (fullRerender()'s renderInFlight) still being busy when the next
   * scheduled re-render came due, reproduced as a real regression in
   * bot/test/fullpass-63230d2.mjs's professionals Cal.com-booking-link
   * timing check during this wave's own development. The marker is purely
   * cosmetic (unlike text/image editability, nothing depends on it being
   * present at "ready" time), so it is deferred one tick past the ready
   * handshake instead — imperceptible to a human, off the critical path
   * entirely. */
  function addDemoBadge(host, kind) {
    if (!host) return;
    pendingDemoBadgeHosts.push({ host: host, kind: kind === 'bg' ? 'bg' : 'img' });
  }

  /** Paint every queued "still demo" marker — called once, shortly after
   * {hb:'ready'} (see addDemoBadge()'s doc comment).
   *
   * Wave 12: the flag and the "Înlocuiește fotografia" fix used to sit in
   * different corners of the same image — a separate ::after corner tag
   * (top-left) and the replace button (top-right), two signals for one
   * fact. For a background photo (`kind === 'bg'`) the button is ALWAYS
   * visible (see .hb-bg-btn — no hover-only opacity rule), so the flag now
   * folds directly into it: same element, same corner, same click. A plain
   * <img>'s replace button (`kind === 'img'`) only appears on hover, so it
   * still gets the old persistent corner ::after (.hb-demo-photo) — dropping
   * it there would mean the demo flag is invisible until the owner happens
   * to hover the exact photo, defeating Wave 11's whole point (glance at
   * the canvas, see what's still the template's). */
  function applyPendingDemoBadges() {
    var items = pendingDemoBadgeHosts;
    pendingDemoBadgeHosts = [];
    for (var i = 0; i < items.length; i++) {
      var host = items[i].host;
      if (items[i].kind === 'bg') {
        host.classList.add('hb-demo-bg');
        var bgBtn = host.querySelector(':scope > .hb-bg-btn');
        if (bgBtn) bgBtn.textContent = 'Poză demo — Înlocuiește fotografia';
      } else {
        host.classList.add('hb-demo-photo');
      }
    }
  }

  /** Create an "Înlocuiește fotografia" button and attach it to a wrapper element. */
  function makeChangeBtn(path) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hb-img-btn';
    btn.textContent = 'Înlocuiește fotografia';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      toParent({ hb: 'image', path: path || null });
      requestImageChange(path, '', '');
    });
    return btn;
  }

  function setupImages() {
    /* ── 5a. <img> elements ── */
    var imgs = Array.prototype.slice.call(document.querySelectorAll('img'));
    imgs.forEach(function (img) {
      // Skip images that are already inside a [data-hb-edit] image container
      // or that are the logo (handled separately via data-hb-edit if present).
      // Also skip the Instagram teaser's example tiles (see section 5c below)
      // — they are fixture photography, not an owner's content, and must
      // never grow a "Înlocuiește fotografia" control.
      if (img.closest('[data-hb-ig-teaser]')) return;
      var src = img.getAttribute('src') || '';
      // Do not wrap tiny icons (data: SVG icons used inline as service icons).
      if (src.startsWith('data:image/svg') || src.startsWith('data:image/svg+xml')) return;

      var path = resolveImgPath(src);
      // Even if we can't resolve the path yet (imgMap not arrived), still wrap the
      // image so we can re-resolve on click. The btn click will re-check imgMap.
      var wrap = document.createElement('span');
      wrap.className = 'hb-img-wrap';
      // Preserve display style of the parent context.
      var parentDisplay = window.getComputedStyle(img.parentNode || document.body).display;
      wrap.style.display = (parentDisplay === 'flex' || parentDisplay === 'grid') ? 'contents' : 'inline-block';

      img.parentNode.insertBefore(wrap, img);
      wrap.appendChild(img);
      if (isDemoSrcValue(src)) addDemoBadge(wrap, 'img');

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hb-img-btn';
      btn.textContent = 'Înlocuiește fotografia';
      var pointerHandled = false;
      function chooseImage(e) {
        e.stopPropagation();
        e.preventDefault();
        if (e.type === 'click' && pointerHandled) {
          pointerHandled = false;
          return;
        }
        if (e.type === 'pointerdown') {
          pointerHandled = true;
          setTimeout(function () { pointerHandled = false; }, 500);
        }
        // Re-resolve on click in case imgMap arrived after mount.
        var resolvedPath = resolveImgPath(img.getAttribute('src') || '');
        if (!resolvedPath && /^data:image\//i.test(img.getAttribute('src') || '')) {
          // Preview inlined images/* → data:; try any single matching images/ path by type
          var keys2 = Object.keys(imgMap);
          for (var ki = 0; ki < keys2.length; ki++) {
            if (/^images\//i.test(keys2[ki]) && imgMap[keys2[ki]]) {
              // Prefer non-background (img tags) paths first
              if (!/background/i.test(imgMap[keys2[ki]])) {
                resolvedPath = imgMap[keys2[ki]];
                break;
              }
            }
          }
        }
        toParent({
          hb: 'image',
          path: resolvedPath,
          src: img.getAttribute('src') || '',
          alt: img.getAttribute('alt') || ''
        });
        requestImageChange(
          resolvedPath,
          img.getAttribute('src') || '',
          img.getAttribute('alt') || ''
        );
      }
      btn.addEventListener('pointerdown', chooseImage);
      btn.addEventListener('click', chooseImage);
      wrap.appendChild(btn);
    });

    /* ── 5b. Elements with inline background / background-image (e.g. hero) ── */
    /* Templates often use style="background: linear-gradient(...), url(...)" — not only background-image:url.
       Must NOT split the declaration on ';' — data:image/jpeg;base64,... embeds semicolons. */
    function extractBackgroundUrls(styleAttr) {
      var style = String(styleAttr || '');
      if (!/(?:^|;)\s*(?:background(?:-image)?)\s*:/i.test(style)) return [];
      var urls = [];
      var re = /url\s*\(\s*/gi;
      var m;
      while ((m = re.exec(style))) {
        var i = m.index + m[0].length;
        if (i >= style.length) break;
        var ch = style.charAt(i);
        var raw;
        if (ch === '"' || ch === "'") {
          var endQ = style.indexOf(ch, i + 1);
          if (endQ < 0) break;
          raw = style.slice(i + 1, endQ);
          re.lastIndex = endQ + 1;
        } else {
          var endP = style.indexOf(')', i);
          if (endP < 0) break;
          raw = style.slice(i, endP).replace(/^\s+|\s+$/g, '');
          re.lastIndex = endP + 1;
        }
        if (raw) urls.push(raw);
      }
      return urls;
    }

    var allEls = Array.prototype.slice.call(document.querySelectorAll('[style]'));
    allEls.forEach(function (el) {
      if (el.closest('[data-hb-ig-teaser]')) return;
      var style = el.getAttribute('style') || '';
      var bgUrls = extractBackgroundUrls(style);
      if (!bgUrls.length) return;
      // Prefer a photographic/data/file URL over gradient-only layers
      var bgUrl = null;
      for (var ui = 0; ui < bgUrls.length; ui++) {
        var cand = bgUrls[ui];
        if (/^data:image\//i.test(cand) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(cand) ||
            /^images\//i.test(cand) || /^https?:\/\//i.test(cand)) {
          bgUrl = cand;
          break;
        }
      }
      if (!bgUrl) bgUrl = bgUrls[bgUrls.length - 1];

      el.classList.add('hb-bg-wrap');
      // Preserve template positioning (salon hero photography is absolute).
      // Only static backgrounds need a containing block for the overlay button.
      if (window.getComputedStyle(el).position === 'static') el.style.position = 'relative';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hb-bg-btn';
      btn.textContent = 'Înlocuiește fotografia';
      var backgroundPointerHandled = false;
      function chooseBackgroundImage(e) {
        e.stopPropagation();
        e.preventDefault();
        if (e.type === 'click' && backgroundPointerHandled) {
          backgroundPointerHandled = false;
          return;
        }
        if (e.type === 'pointerdown') {
          backgroundPointerHandled = true;
          setTimeout(function () { backgroundPointerHandled = false; }, 500);
        }
        var resolvedPath = resolveImgPath(bgUrl);
        // Prefer explicit hero.background when CSS multi-layer maps through imgMap
        if (!resolvedPath && imgMap[bgUrl]) resolvedPath = imgMap[bgUrl];
        // Preview inlines images/* → data:; map may still be path-only
        if (!resolvedPath) resolvedPath = resolveBackgroundPathFallback();
        // Hero frames are the five systems' shared background editing seam. Keep
        // the visible control functional even if imgmap arrives after the click.
        if (!resolvedPath && /(^|[-_])hero($|[-_])/.test(el.className || '')) {
          resolvedPath = 'hero.background';
        }
        toParent({ hb: 'image', path: resolvedPath, src: bgUrl, alt: '' });
        requestImageChange(resolvedPath, bgUrl, '');
      }
      btn.addEventListener('pointerdown', chooseBackgroundImage);
      btn.addEventListener('click', chooseBackgroundImage);
      // A child cannot out-rank an ancestor's negative stacking context. Keep
      // fixed/parallax hero photography behind the page while hosting its
      // editor control on the positioned hero frame above it.
      var buttonHost = el;
      var stackLevel = parseInt(window.getComputedStyle(el).zIndex, 10);
      if (!isNaN(stackLevel) && stackLevel < 0 && el.parentElement) {
        buttonHost = el.parentElement;
        if (window.getComputedStyle(buttonHost).position === 'static') {
          buttonHost.style.position = 'relative';
        }
      }
      buttonHost.appendChild(btn);
      if (isDemoSrcValue(bgUrl)) addDemoBadge(buttonHost, 'bg');
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     5c. Instagram teaser (edit-mode-only example section)
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * A parallel effort owns the `[data-hb-ig-teaser]` markup and all its CSS
   * (including the blurred/veiled look, keyed off `.is-revealed` — see the
   * task's own section for the fixed shape: a badge, a 6-tile grid, and a
   * `.hb-ig-teaser__veil` holding the `[data-hb-ig-connect]` CTA). This is
   * the behaviour half only:
   *
   *   - click anywhere in the section reveals it once (`.is-revealed` +
   *     un-hide the veil via `hidden = false`, never an inline `display` —
   *     that stays the other side's CSS to decide). One-way per render:
   *     once shown, further clicks elsewhere in the section do nothing —
   *     there is no un-reveal.
   *   - click on the CTA posts {hb:'connect-instagram'} to the parent
   *     instead (app.js opens the existing Instagram modal from there —
   *     see its postMessage switch).
   *   - it is not part of the inline-edit surface: the section carries no
   *     [data-hb-edit] fields, so setupTextFields()/setupListControls()
   *     already ignore it, and setupImages() above explicitly skips its six
   *     tiles. Nothing here ever posts {hb:'text'|'image'|'list-add'|...},
   *     so a click here never marks the draft dirty.
   *   - keyboard: the CTA is a real <button>, so Enter/Space and a focus
   *     ring come for free. The section itself has no visible affordance in
   *     its fixed markup for the click-to-reveal action, so setupIgTeaser()
   *     below gives any not-yet-revealed section a tabindex + role so Tab
   *     reaches it and Enter/Space reveal it exactly like a click. Once
   *     revealed, that affordance is removed — the CTA is the only control
   *     left worth stopping on.
   *
   * Click/keydown are handled via document-level delegation (not a
   * per-element listener bound at mount) so this works the same whether the
   * section was present in the srcdoc from the start or arrives from a
   * later mutation — mirroring the Ctrl+Z listener's own delegation a few
   * sections below.
   */
  function igTeaserVeil(section) {
    return section.querySelector('.hb-ig-teaser__veil');
  }

  function revealIgTeaser(section) {
    if (section.classList.contains('is-revealed')) return;
    section.classList.add('is-revealed');
    var veil = igTeaserVeil(section);
    if (veil) veil.hidden = false;
    // The reveal affordance's job is done — retire it so Tab doesn't stop
    // on a section that no longer does anything on Enter/Space (the CTA
    // inside the now-visible veil is the real control from here on).
    section.removeAttribute('tabindex');
    section.removeAttribute('role');
    section.removeAttribute('aria-label');
  }

  /** Give every not-yet-revealed teaser section a keyboard path in. */
  function setupIgTeaser() {
    var sections = Array.prototype.slice.call(document.querySelectorAll('[data-hb-ig-teaser]'));
    sections.forEach(function (section) {
      if (section.classList.contains('is-revealed')) return;
      section.setAttribute('tabindex', '0');
      section.setAttribute('role', 'button');
      section.setAttribute('aria-label', 'Vezi un exemplu de flux Instagram');
    });
  }

  document.addEventListener('click', function (e) {
    var section = e.target && e.target.closest ? e.target.closest('[data-hb-ig-teaser]') : null;
    if (!section) return;
    var connectBtn = e.target.closest('[data-hb-ig-connect]');
    if (connectBtn) {
      e.preventDefault();
      e.stopPropagation();
      toParent({ hb: 'connect-instagram' });
      return;
    }
    revealIgTeaser(section);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var section = e.target && e.target.closest ? e.target.closest('[data-hb-ig-teaser]') : null;
    // Only the section itself, focused directly (not a child control like
    // the CTA button, which already handles Enter/Space natively).
    if (!section || e.target !== section) return;
    if (section.classList.contains('is-revealed')) return;
    e.preventDefault();
    revealIgTeaser(section);
  });

  /* ─────────────────────────────────────────────────────────────────────────
     6. List add / remove controls
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Build a `[data-hb-edit^="…"]` selector that matches only the fields that
   * belong to exactly this list item — never a sibling whose numeric index
   * happens to start with the same digits.
   *
   * `document.querySelectorAll('[data-hb-edit^="pricing.1"]')` is a plain
   * string prefix match: once a list holds a 10th+ item, "pricing.1" is also
   * a string-prefix of "pricing.10", so this call for item 1 pulls in item
   * 10's fields too. findListItemContainer() then has to find one DOM node
   * containing fields from BOTH non-adjacent items, climbs all the way up to
   * the shared list container, and wrongly tags THAT as the "item" — which
   * is exactly what corrupted the portfolio pricing list (WAVE8-01): item 1
   * silently lost its own `.hb-list-item` class and delete button while the
   * whole `.pf-price` wrapper was mistagged instead. Any list on any
   * template reaching a double-digit index (10+ original items, or 10+
   * after some "+ Adaugă" clicks) hits the same collision — this is not
   * specific to one template's markup, so the fix belongs here rather than
   * in a single template's CSS/HTML.
   *
   * Matching itemPath exactly OR itemPath + "." (a real child field) can
   * only narrow the previous (buggy) match — it can never miss a field the
   * old selector used to find correctly for single-digit indices — so this
   * is safe for every existing list on every template.
   */
  function itemFieldSelector(itemPath) {
    var esc = CSS.escape(itemPath);
    return '[data-hb-edit="' + esc + '"], [data-hb-edit^="' + esc + '."]';
  }

  function setupListControls() {
    var groups = detectListGroups();

    // Fix newly-added items that rendered with no text (see PM-02 / prof-01)
    // before wiring up remove/add controls, so container sizing below is
    // computed against the final, visible content.
    fillEmptyListItemDefaults(groups);

    Object.keys(groups).forEach(function (root) {
      var indices = Object.keys(groups[root]).map(Number).sort(function (a, b) { return a - b; });
      // Schema min/max (S1-4 step 4): a nested list (e.g. product-menu's
      // menu.en.<N>.items) has no schema key of its own, so listLimits()
      // returns the "no limit" default {min:0, max:null} for it — same as
      // before this fix, since nothing enforced limits on it previously.
      var limits = listLimits(root);
      var count = indices.length;
      var canRemove = count > limits.min;
      var canAdd = limits.max === null || count < limits.max;

      /* Wrap each unique list item with the remove control */
      indices.forEach(function (idx) {
        var itemPath = root + '.' + idx;
        // Find the topmost element belonging to this item index.
        // Strategy: find all [data-hb-edit] elements whose path starts with itemPath
        // then find their lowest common ancestor (or we just attach to the first one
        // that has a meaningful parent).
        var itemEls = Array.prototype.slice.call(
          document.querySelectorAll(itemFieldSelector(itemPath))
        );
        if (itemEls.length === 0) return;

        // Find the most-ancestral DOM node shared by all item fields.
        // Simple approach: walk up from the first field until we find a container
        // that also contains all the other fields.
        var container = findListItemContainer(itemEls, root, idx);
        if (!container) return;

        // Avoid double-wrapping.
        if (container.classList.contains('hb-list-item')) return;
        container.classList.add('hb-list-item');

        // Ensure container can host absolute children — done regardless of
        // canRemove so the container's own layout never shifts depending on
        // whether the remove button happens to be present.
        var pos = window.getComputedStyle(container).position;
        if (pos === 'static') container.style.position = 'relative';

        if (!canRemove) return; // at schema min — no "×" on any item (S1-4 step 4)

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'hb-remove-btn';
        removeBtn.setAttribute('aria-label', 'Șterge elementul ' + (idx + 1));
        removeBtn.textContent = '×'; // ×
        removeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          toParent({ hb: 'list-remove', path: itemPath });
        });

        container.appendChild(removeBtn);
      });

      // At schema max the button STAYS, disabled, and says why (see the
      // listMax block below). Removing it outright — the first thing S1-4
      // did — leaves the owner hunting for a control that silently vanished.

      /* Add "+" button after the last item container */
      // Find the last item container and insert the add button after it.
      var lastIdx = indices[indices.length - 1];
      var lastItemPath = root + '.' + lastIdx;
      var lastItemEls = Array.prototype.slice.call(
        document.querySelectorAll(itemFieldSelector(lastItemPath))
      );
      if (lastItemEls.length === 0) return;

      var lastContainer = findListItemContainer(lastItemEls, root, lastIdx);
      if (!lastContainer) return;

      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'hb-add-btn';
      // Restaurant menu structure gets its own wording
      if (/^menu\.(en|ro)$/.test(root)) {
        addBtn.textContent = '+ Adaugă secțiune';
      } else if (/^menu\.(en|ro)\.\d+\.items$/.test(root)) {
        addBtn.textContent = '+ Adaugă articol';
      } else {
        addBtn.textContent = '+ Adaugă';
      }
      addBtn.addEventListener('click', function () {
        toParent({ hb: 'list-add', listPath: root });
      });

      // S1-6 (m21): schema `max` on the list, disable "+ Adaugă" once hit
      // instead of letting the count grow unbounded with no feedback (the
      // QA report reproduced 34 services added to an 8-item list). The
      // count here (indices.length) already reflects the CURRENT render, so
      // this re-evaluates correctly on every fullRerender — including right
      // after the item that hits the cap was added.
      var listMax = getListLimits()[root];
      if (typeof listMax === 'number' && indices.length >= listMax) {
        addBtn.disabled = true;
        addBtn.textContent += ' — limită atinsă (' + listMax + ')';
        addBtn.setAttribute('aria-disabled', 'true');
      }

      if (lastContainer.parentNode) {
        lastContainer.parentNode.insertBefore(addBtn, lastContainer.nextSibling);
      }
    });
  }

  /**
   * Does `node` contain a data-hb-edit element belonging to a DIFFERENT index
   * of the same list `root`? Used to find how far up the DOM an item's
   * container can grow without spilling into a sibling item's markup.
   */
  function containsOtherListIndex(node, root, idx) {
    if (!root) return false;
    var others = node.querySelectorAll('[data-hb-edit^="' + CSS.escape(root + '.') + '"]');
    for (var i = 0; i < others.length; i++) {
      var p = others[i].getAttribute('data-hb-edit');
      var rest = p.slice(root.length + 1);
      var seg = rest.split('.')[0];
      if (/^\d+$/.test(seg) && Number(seg) !== idx) return true;
    }
    return false;
  }

  /**
   * Does `node` contain a data-hb-edit element that does NOT belong to the
   * item at `itemPath` (its path is neither itemPath itself nor a sub-path
   * of it, e.g. "itemPath.label")? General boundary test for climbing up
   * from an item's own fields to its true repeated-item root.
   *
   * containsOtherListIndex (above) only catches a SIBLING item's field, and
   * a list root with exactly one surviving index has no sibling to find --
   * it always returns false, so the climb in findListItemContainer never
   * found a reason to stop. On a single-level list (services, pricing, ...)
   * that is harmless in practice, because the loop is capped at 4 levels and
   * a lone item's <li>/<ul>/list-wrapper/section chain rarely has 4 more
   * ancestors worth annexing before hitting the section/body guard.
   *
   * desserdirina's menu is the one list in this product that nests two
   * levels deep (a bilingual `menu.ro`/`menu.en` array of categories, each
   * holding its own `items` array) — so climbing from a category's LAST
   * remaining dish (root "menu.ro.N.items", one surviving index) walks
   * <li> -> <ul> -> the category's own <details> (which owns an unrelated
   * "menu.ro.N.category" field) -> the shared <div class="menu-groups"> ->
   * the whole <div class="menu-panel"> in just 4 hops, ballooning the
   * "container" — and therefore the remove control — from one dish up to
   * the ENTIRE RO or EN menu (DSD-03: an owner who clears a category down to
   * its last dish gets a stray, misplaced remove button spanning every
   * category, instead of one scoped to the dish or its category).
   *
   * This check is a strict superset of containsOtherListIndex: any sibling
   * item's field is, by construction, also "not under itemPath". So OR-ing
   * it into the existing check changes nothing for a list that already has
   * 2+ items anywhere in this product (the old check already stops the
   * climb at the same point) — it only makes single-remaining-item (and, on
   * desserdirina's nested items, deeper) lists stop where they always should
   * have.
   */
  function containsForeignField(node, itemPath) {
    var all = node.querySelectorAll('[data-hb-edit]');
    for (var i = 0; i < all.length; i++) {
      var p = all[i].getAttribute('data-hb-edit');
      if (p !== itemPath && p.indexOf(itemPath + '.') !== 0) return true;
    }
    return false;
  }

  /**
   * Find the most appropriate container element for a group of list-item elements
   * (root cause of PM-02 / prof-02: PM-02, prof-01, prof-02).
   *
   * The old version returned the FIRST ancestor that happened to contain every
   * field of the item — for an item with a single text field (e.g. a
   * <span data-hb-edit="services.N.label"> nested one level inside its visual
   * wrapper), that is the field's immediate parent, not the repeated "card"
   * element the list is actually built from. Two visible bugs followed:
   *  - When the field is empty, that immediate parent can be an empty inline
   *    element with a 0x0 boundingClientRect, so the remove "×" button placed
   *    inside it is unreachable by click (PM-02).
   *  - The "+ Adaugă" button is inserted as `container.nextSibling` — if
   *    `container` is that inner wrapper instead of the card, the button ends
   *    up nested INSIDE the card/li instead of after it in the list (prof-02).
   *
   * Fix: after finding the lowest common ancestor of the item's own fields
   * (unchanged first pass), keep climbing upward as long as the next ancestor
   * still belongs EXCLUSIVELY to this item — i.e. it contains no data-hb-edit
   * field from a different index of the same list root. That naturally stops
   * right at the true repeated item root (e.g. the <li>), because its parent
   * (the <ul>/<ol>/list wrapper) is the first ancestor shared with sibling
   * items. This also fixes the 0x0-rect problem as a side effect: a real card
   * root almost always has non-zero size even when its text is briefly empty.
   */
  function findListItemContainer(els, root, idx) {
    if (!els || els.length === 0) return null;
    var candidate = els[0].parentElement;
    if (!candidate) return els[0];

    // Pass 1 (unchanged): find the lowest ancestor containing every field.
    for (var depth = 0; depth < 8; depth++) {
      var allInside = els.every(function (el) {
        return candidate.contains(el);
      });
      if (allInside) break;
      if (!candidate.parentElement) return els[0].parentElement || els[0];
      candidate = candidate.parentElement;
    }

    // Pass 2 (the fix): climb further while the ancestor is still exclusive
    // to this item, so we land on the actual repeated item root rather than
    // an inner field wrapper. Bounded to a handful of levels — and stopped
    // hard at body/html — so a list that currently has only one item (no
    // sibling to bump into) can never balloon the "container" up to the
    // whole page.
    var itemPath = root + '.' + idx;
    var best = candidate;
    var climb = candidate;
    for (var depth2 = 0; depth2 < 4; depth2++) {
      if (!climb.parentElement) break;
      var up = climb.parentElement;
      if (up === document.body || up === document.documentElement) break;
      if (up.tagName === 'SECTION' || up.tagName === 'MAIN') break;
      // See containsForeignField's doc comment (DSD-03): containsOtherListIndex
      // alone misses the case where this item is the ONLY surviving index of
      // `root`, letting the climb balloon into unrelated ancestors. OR-ing in
      // the general "any foreign field" check closes that gap without moving
      // the stopping point for any list that already has 2+ items.
      if (containsOtherListIndex(up, root, idx) || containsForeignField(up, itemPath)) break;
      climb = up;
      best = climb;
    }
    return best;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     6b. Undo / redo — forward Ctrl+Z / Ctrl+Shift+Z to the parent
  ───────────────────────────────────────────────────────────────────────── */

  /*
   * A keydown fired inside this document (the sandboxed srcdoc iframe) never
   * bubbles out to the parent window — each document has its own event loop —
   * so the parent's own Ctrl+Z listener (builder/app.js) never sees it while
   * focus is on a canvas contenteditable field. Left alone, the browser would
   * instead run ITS native per-field undo on the contenteditable, which only
   * rewinds DOM text and never touches draft.config — one Ctrl+Z would desync
   * the canvas from the document model.
   *
   * So: intercept it here. If the focused field has a debounced {hb:'text'}
   * send still pending (the user is mid-keystroke, blur hasn't fired), FLUSH
   * it — attach its current value to the SAME undo/redo message as `flush`,
   * so the parent applies it and pushes the history step BEFORE calling
   * undo()/redo(), all inside one synchronous message handler. (An earlier
   * version sent the flush as its own {hb:'text'} message immediately before
   * {hb:'undo'} — postMessage delivery order is spec-guaranteed, but tying
   * both to one message removes any doubt and is simpler to reason about.)
   * Without this, Ctrl+Z pressed right after typing a character would either
   * discard that keystroke unrecorded and undo the PREVIOUS edit instead
   * (jumping back two steps from the user's perspective), or race a separate
   * flush message. Any OTHER field's leftover debounce timer (not the
   * focused one) is simply cleared — its real value was already sent on blur
   * when focus moved away from it.
   */
  document.addEventListener('keydown', function (e) {
    var key = (e.key || '').toLowerCase();
    if (key !== 'z' || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();

    var active = document.activeElement;
    var activePath = active && active.getAttribute ? active.getAttribute('data-hb-edit') : null;
    var flush = null;
    if (activePath && active.getAttribute('data-hb-kind') === 'text') {
      flush = { path: activePath, value: active.textContent };
    }
    Object.keys(debounceTimers).forEach(function (p) {
      clearTimeout(debounceTimers[p]);
      delete debounceTimers[p];
    });
    toParent({ hb: e.shiftKey ? 'redo' : 'undo', flush: flush });
  }, true);

  /* ─────────────────────────────────────────────────────────────────────────
     7. Handle inbound messages from parent
  ───────────────────────────────────────────────────────────────────────── */

  window.addEventListener('message', function (event) {
    // Security: only accept messages from the parent frame.
    if (event.source !== window.parent) return;

    var msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.hb === undefined) return;

    switch (msg.hb) {

      case 'set': {
        /* Surgical text update — set textContent without re-rendering. */
        var path = msg.path;
        var value = msg.value != null ? String(msg.value) : '';
        var els = findAllByPath(path);
        els.forEach(function (el) {
          // Only update if this element is NOT currently focused
          // (user is actively editing — don't clobber the cursor).
          if (document.activeElement !== el) {
            el.textContent = value;
          }
        });
        break;
      }

      case 'highlight': {
        // Exact field first; for a list's own root path (e.g. "services" —
        // only its items carry data-hb-edit, as "services.0.label" etc.)
        // fall back to that list's first field rather than silently
        // no-op-ing (see itemFieldSelector()'s own doc comment, section 6).
        var el = findByPath(msg.path) || document.querySelector(itemFieldSelector(msg.path));
        if (!el) return;
        el.classList.remove('hb-highlight');
        // Force reflow to restart the animation.
        void el.offsetWidth;
        el.classList.add('hb-highlight');
        el.addEventListener('animationend', function () {
          el.classList.remove('hb-highlight');
        }, { once: true });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Wave 12: the checklist "what's missing" menu (builder/app.js)
        // sends this same message with `focus: true` to land the owner one
        // click from "this isn't done" to "here is where you fix it" — for
        // a genuine contenteditable text field that means keyboard focus
        // too, not just a visual flash. A non-text fallback target (e.g. the
        // first field of an otherwise-empty list) still gets scrolled and
        // highlighted even though it cannot usefully take focus itself.
        if (msg.focus && el.getAttribute('data-hb-kind') === 'text') {
          try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (__) {} }
        }
        break;
      }

      case 'imgmap': {
        /* Store the src→path reverse-lookup map provided by the parent. */
        if (msg.map && typeof msg.map === 'object') {
          imgMap = msg.map;
        }
        break;
      }

      case 'demoText': {
        markDemoTextPaths(Array.isArray(msg.paths) ? msg.paths : []);
        break;
      }

      default:
        /* Unknown messages are silently ignored. */
        break;
    }
  });

  /* ─────────────────────────────────────────────────────────────────────────
     8. Mount: run setup when DOM is ready, then announce readiness
  ───────────────────────────────────────────────────────────────────────── */

  function mount() {
    listSchema = readListSchema();
    try { setupTextFields(); }    catch (e) { console.warn('[hb-overlay] setupTextFields:', e); }
    try { setupImages(); }        catch (e) { console.warn('[hb-overlay] setupImages:', e); }
    try { setupListControls(); }  catch (e) { console.warn('[hb-overlay] setupListControls:', e); }
    try { setupIgTeaser(); }      catch (e) { console.warn('[hb-overlay] setupIgTeaser:', e); }

    // Announce readiness to parent.
    toParent({ hb: 'ready' });

    // Cosmetic-only work that must never delay the ready handshake above —
    // see addDemoBadge()'s doc comment.
    setTimeout(function () {
      try { applyPendingDemoBadges(); } catch (e) { console.warn('[hb-overlay] applyPendingDemoBadges:', e); }
    }, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

}());
