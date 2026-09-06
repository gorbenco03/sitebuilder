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
 *     {hb:'image', path}                     — user wants to change an image
 *     {hb:'list-add', listPath}              — add new list item
 *     {hb:'list-remove', path}               — remove list item at path
 *     {hb:'focus', path}                     — a field received focus
 *     {hb:'undo'} / {hb:'redo'}              — Ctrl+Z / Ctrl+Shift+Z pressed on the canvas
 *
 *   parent → iframe:
 *     {hb:'set', path, value}               — surgical text update (no re-render)
 *     {hb:'highlight', path}                — flash outline on element
 *     {hb:'imgmap', map}                    — {src→path} reverse-lookup map
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

  /** safe lists that support add/remove (conservative — only confirmed text lists) */
  var SAFE_LIST_PATHS = ['services', 'menu', 'pricing', 'packages', 'steps', 'reviews'];

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

      /* background-image change overlay */
      '.hb-bg-btn {',
      '  position: absolute;',
      '  top: 12px;',
      '  right: 12px;',
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
      '.hb-add-btn {',
      '  display: block;',
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

      /* highlight flash */
      '@keyframes hb-flash {',
      '  0%   { outline: 3px solid rgba(251,191,36,0.9); outline-offset: 3px; }',
      '  60%  { outline: 3px solid rgba(251,191,36,0.9); outline-offset: 3px; }',
      '  100% { outline: none; outline-offset: 0; }',
      '}',
      '.hb-highlight {',
      '  animation: hb-flash 0.9s ease-out forwards;',
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

  /** Is `path` a known "safe" list for add/remove? */
  function isSafeList(rootPath) {
    if (!rootPath) return false;
    for (var i = 0; i < SAFE_LIST_PATHS.length; i++) {
      if (rootPath === SAFE_LIST_PATHS[i] || rootPath.endsWith('.' + SAFE_LIST_PATHS[i])) {
        return true;
      }
    }
    // Restaurant menu: bilingual section lists + nested dish arrays
    // e.g. menu.en, menu.ro, menu.en.0.items
    if (/^menu\.(en|ro)$/.test(rootPath)) return true;
    if (/^menu\.(en|ro)\.\d+\.items$/.test(rootPath)) return true;
    // Gallery photo category blocks (restaurant)
    if (rootPath === 'categories' || /\.categories$/.test(rootPath)) return true;
    return false;
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

    fields.forEach(function (el) {
      var path = el.getAttribute('data-hb-edit');

      // Determine if this is a single-line field (no \n in original text).
      var isSingleLine = el.textContent.indexOf('\n') === -1;

      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'true');

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

      /* Single-line: prevent Enter from inserting a line break */
      if (isSingleLine) {
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            el.blur();
          }
        });
      }

      /* On input: debounced postMessage */
      el.addEventListener('input', function () {
        var value = el.textContent;
        debounce(path, function () {
          toParent({ hb: 'text', path: path, value: value });
        }, 300);
      });

      /* On blur: send immediately (cancel any pending debounce) */
      el.addEventListener('blur', function () {
        if (debounceTimers[path]) {
          clearTimeout(debounceTimers[path]);
          delete debounceTimers[path];
        }
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
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     6. List add / remove controls
  ───────────────────────────────────────────────────────────────────────── */

  function setupListControls() {
    var groups = detectListGroups();

    // Fix newly-added items that rendered with no text (see PM-02 / prof-01)
    // before wiring up remove/add controls, so container sizing below is
    // computed against the final, visible content.
    fillEmptyListItemDefaults(groups);

    Object.keys(groups).forEach(function (root) {
      var indices = Object.keys(groups[root]).map(Number).sort(function (a, b) { return a - b; });

      /* Wrap each unique list item with the remove control */
      indices.forEach(function (idx) {
        var itemPath = root + '.' + idx;
        // Find the topmost element belonging to this item index.
        // Strategy: find all [data-hb-edit] elements whose path starts with itemPath
        // then find their lowest common ancestor (or we just attach to the first one
        // that has a meaningful parent).
        var itemEls = Array.prototype.slice.call(
          document.querySelectorAll('[data-hb-edit^="' + CSS.escape(itemPath) + '"]')
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

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'hb-remove-btn';
        removeBtn.setAttribute('aria-label', 'Șterge elementul ' + (idx + 1));
        removeBtn.textContent = '×'; // ×
        removeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          toParent({ hb: 'list-remove', path: itemPath });
        });

        // Ensure container can host absolute children.
        var pos = window.getComputedStyle(container).position;
        if (pos === 'static') container.style.position = 'relative';

        container.appendChild(removeBtn);
      });

      /* Add "+" button after the last item container */
      // Find the last item container and insert the add button after it.
      var lastIdx = indices[indices.length - 1];
      var lastItemPath = root + '.' + lastIdx;
      var lastItemEls = Array.prototype.slice.call(
        document.querySelectorAll('[data-hb-edit^="' + CSS.escape(lastItemPath) + '"]')
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
    var best = candidate;
    var climb = candidate;
    for (var depth2 = 0; depth2 < 4; depth2++) {
      if (!climb.parentElement) break;
      var up = climb.parentElement;
      if (up === document.body || up === document.documentElement) break;
      if (up.tagName === 'SECTION' || up.tagName === 'MAIN') break;
      if (containsOtherListIndex(up, root, idx)) break;
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
        var el = findByPath(msg.path);
        if (!el) return;
        el.classList.remove('hb-highlight');
        // Force reflow to restart the animation.
        void el.offsetWidth;
        el.classList.add('hb-highlight');
        el.addEventListener('animationend', function () {
          el.classList.remove('hb-highlight');
        }, { once: true });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }

      case 'imgmap': {
        /* Store the src→path reverse-lookup map provided by the parent. */
        if (msg.map && typeof msg.map === 'object') {
          imgMap = msg.map;
        }
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
    try { setupTextFields(); }    catch (e) { console.warn('[hb-overlay] setupTextFields:', e); }
    try { setupImages(); }        catch (e) { console.warn('[hb-overlay] setupImages:', e); }
    try { setupListControls(); }  catch (e) { console.warn('[hb-overlay] setupListControls:', e); }

    // Announce readiness to parent.
    toParent({ hb: 'ready' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

}());
