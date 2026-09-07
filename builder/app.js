'use strict';
/* ============================================================
   Hidook Builder — app.js  (v2: inline editing on site)
   Vanilla JS, zero framework/CDN, CommonJS-free (browser)
   All user-facing strings in Romanian.
   ============================================================ */

// ---------------------------------------------------------------------------
// 1. State
// ---------------------------------------------------------------------------

const DRAFT_KEY = 'hb.draft.v1';
// Where a draft goes when starting a different design replaces it. Switching
// design is one of the first things a new visitor does, and that visitor is
// usually not signed in yet, so the account backup cannot catch them. Keeping
// the replaced draft here means the recovery banner can still offer it back.
const REPLACED_DRAFT_KEY = 'hb.draft.replaced.v1';
const PUBLISH_SLUG_COLLISION_MESSAGE = 'Această adresă este deja folosită. Încearcă alta.';

const draft = { templateId: null, config: null };

let currentUser    = null;
let currentSiteId  = null;
let currentSitePaid = false;
let currentSiteSlug = '';
let currentTemplate = null;

// Runtime config from /api/config
let appConfig = { amount: null, currency: 'usd', renewal: null, priceEur: null, brandDomain: null, contactUrl: null };

// Preview/iframe state
let previewTimer       = null;
let previewSpinTimer   = null;
let previewFirstRender = false;
let iframeReady        = false;   // did overlay send {hb:'ready'}?
let pendingRender      = false;   // is a srcdoc re-render queued?
// Has the visitor already dismissed the template's own cookie banner inside
// THIS editing session? The srcdoc iframe has no allow-same-origin, so its
// localStorage/document.cookie calls silently no-op — the template's normal
// persisted-consent check can never survive a full re-render (F1: color,
// image, and list edits all replace the iframe's srcdoc from scratch). We
// track the "already accepted" state here, outside the iframe, and replay it
// into every subsequent render instead.
let previewCookieAccepted = false;

// Pending image replacement request
let pendingImagePath = null;

// Slug check debounce
let slugCheckTimer = null;
let slugValid      = false;
let slugNormalized = '';

let sitePaymentUrl = null;
let publishedSiteId = null;
let publishedSiteUrl = null;

// Color popover state
let colorPopoverOpen = false;

// Fresh-demo-content banner state (first sixty seconds): true only right
// after starting a template from the catalog with no matching saved draft —
// i.e. draft.config is still the untouched preset (real-looking fake business
// name, phone, testimonials…). Resuming any existing draft/site must never
// set this — that content is the owner's own, not a demo.
let isFreshDemoDraft = false;
let demoBannerDismissed = false;
// Wave 11: the same bar now hosts the name/phone/town quick-start form, so it
// must also open on demand — from the checklist pill — for a draft that is
// no longer "fresh" (isFreshDemoDraft went false on the very first edit) but
// still hasn't had its identity fields filled in. Session-only: reopening it
// is a deliberate action, never persisted across a reload.
let quickstartForceOpen = false;
function syncDemoBanner() {
  const el = $('demo-content-banner');
  if (el) el.style.display = ((isFreshDemoDraft && !demoBannerDismissed) || quickstartForceOpen) ? '' : 'none';
}

// Drawer state
let drawerOpen = false;
/** localStorage key for Details drawer open/closed preference (VISION Flow 2). */
const DRAWER_PREF_KEY = 'hb-details-drawer-pref';
// Wave 11: was a drawer field edited since the drawer was last opened, in a
// way that still needs a full re-render (not just the surgical {hb:'set'}
// every drawer keystroke already sends) once the drawer closes? Used to be a
// self-expiring 2-second timer (drawerSaveTimer) instead of a plain flag —
// which meant an edit whose visible effect can ONLY come from a full
// re-render (e.g. appointment.bookingUrl: emptying it must remove the
// Cal.com <a> and bring back the local request <form>, a structural change
// no surgical text-content update can make) silently never reappeared if the
// owner took more than two seconds to close the drawer after editing. A
// plain flag has no such window — correct regardless of how long the drawer
// stays open, and regardless of how fast any given render happens to be.
let drawerNeedsRerenderOnClose = false;

// Device mode
let deviceMode = 'desktop'; // 'desktop' | 'mobile'

// Per-tab identity, used to tell OUR OWN writes to the draft apart from a
// second tab editing the same draft (audit medium #8 — two tabs silently
// overwrite the same draft with no warning).
const TAB_ID = (function () {
  try { if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (_) {}
  return 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}());
let tabConflictActive = false;

// Account menu (editor topbar) state
let accountMenuOpen = false;

// Checklist "what's missing" menu (editor topbar) state — see section 7c.
let checklistMenuOpen = false;

// ---------------------------------------------------------------------------
// 2. Helpers — DOM
// ---------------------------------------------------------------------------

function $(id) { return document.getElementById(id); }
function show(el) { if (el) el.style.display = ''; }
function hide(el) { if (el) el.style.display = 'none'; }
function showId(id) { const el = $(id); if (el) show(el); }
function hideId(id) { const el = $(id); if (el) hide(el); }

function setLoading(visible, msg) {
  const overlay = $('loading-overlay');
  if (!overlay) return;
  const msgEl = $('loading-msg');
  if (visible) {
    if (msgEl && msg) msgEl.textContent = msg;
    overlay.classList.remove('hidden');
    overlay.style.display = '';
    overlay.setAttribute('aria-busy', 'true');
  } else {
    // Clear immediately so success/error dialogs never sit under "Se confirmă plata…"
    if (msgEl) msgEl.textContent = '';
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
    overlay.setAttribute('aria-busy', 'false');
  }
}

let toastTimer = null;
function showToast(msg, type, durationMs) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (type ? ' toast-' + type : '');
  t.style.display = '';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, durationMs || 3500);
}

function hideToast() {
  const t = $('toast');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  if (t) t.style.display = 'none';
}

// Focus trap: keep Tab/Shift+Tab cycling inside the open modal instead of
// leaking into the editor topbar/iframe hidden behind the overlay. ARIA APG
// "Modal Dialog" pattern, no library. One handler + one "opener" element is
// tracked per modal id so repeated open/close cycles stay clean.
const modalFocusState = Object.create(null);

function getFocusableEls(container) {
  if (!container) return [];
  const nodes = container.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])'
  );
  return Array.prototype.filter.call(nodes, (el) => {
    // Skip anything hidden (display:none ancestor, e.g. an inactive publish step).
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  });
}

function trapModalTab(e, container) {
  if (e.key !== 'Tab') return;
  const focusable = getFocusableEls(container);
  if (!focusable.length) { e.preventDefault(); return; }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !container.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }
}

function openModal(id) {
  const el = $(id);
  if (!el) return;
  el.style.display = '';
  const state = modalFocusState[id] || (modalFocusState[id] = {});
  state.opener = document.activeElement;
  if (!state.handler) {
    state.handler = (e) => trapModalTab(e, el);
    el.addEventListener('keydown', state.handler);
  }
  // Move focus into the modal synchronously (not via requestAnimationFrame):
  // el.style.display was already cleared above, so the modal is already
  // focusable — deferring one more frame just leaves a window, between
  // "modal visible" and "focus actually inside it", where a Tab keypress
  // starts from whatever had focus BEFORE the modal opened (outside its
  // subtree). trapModalTab()'s keydown listener is bound to the modal
  // element, so it never even fires for that keypress (the event bubbles
  // from the still-focused outside element, not through the modal) and the
  // browser's native tab order — which depends on the rest of the page's
  // DOM — decides where focus goes instead. Focusing immediately closes
  // that window instead of relying on timing.
  const first = el.querySelector('button,input,a,[tabindex]:not([tabindex="-1"])');
  if (first) first.focus();
}
function closeModal(id) {
  const el = $(id);
  if (el) el.style.display = 'none';
  if (id === 'modal-preview') document.body.classList.remove('preview-cookie-isolated');
  const state = modalFocusState[id];
  if (state && state.opener && typeof state.opener.focus === 'function' && document.contains(state.opener)) {
    state.opener.focus();
  }
  if (state) state.opener = null;
}

function setBtnLoading(btn, loading, originalText) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn._origText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-loading-text"><span class="spinner spinner--xs"></span>' + (originalText || 'Processing…') + '</span>';
  } else {
    btn.disabled = false;
    if (btn._origText !== undefined) {
      btn.innerHTML = btn._origText;
      delete btn._origText;
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Helpers — data
// ---------------------------------------------------------------------------

function getPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, k) => {
    if (acc == null) return undefined;
    const m = k.match(/^([^\[]+)\[(\d+)\]$/);
    if (m) return (acc[m[1]] || [])[Number(m[2])];
    return acc[k];
  }, obj);
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const m = k.match(/^([^\[]+)\[(\d+)\]$/);
    if (m) {
      const arrKey = m[1]; const idx = Number(m[2]);
      if (!Array.isArray(cur[arrKey])) cur[arrKey] = [];
      while (cur[arrKey].length <= idx) cur[arrKey].push({});
      cur = cur[arrKey][idx];
    } else {
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
  }
  const last = parts[parts.length - 1];
  const m = last.match(/^([^\[]+)\[(\d+)\]$/);
  if (m) {
    const arrKey = m[1]; const idx = Number(m[2]);
    if (!Array.isArray(cur[arrKey])) cur[arrKey] = [];
    while (cur[arrKey].length <= idx) cur[arrKey].push({});
    cur[arrKey][idx] = value;
  } else {
    cur[last] = value;
  }
}

/**
 * Mirrors bot/calendar-native/cutover.js#isNativeBookingEnabled — kept as a
 * small standalone copy because the builder is a browser bundle that cannot
 * require() server modules. appointment.nativeBooking is a schema type:"text"
 * field (like appointment.enabled), not a real boolean, so both sides must
 * agree on the same truthy/falsy string rules or a toggle here could silently
 * disagree with what publish actually turns on.
 */
function isNativeBookingOn(value) {
  if (value === true || value === 1) return true;
  if (value == null) return false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (!s || /^(false|0|no|nu|off|n)$/i.test(s)) return false;
    return /^(true|1|yes|da|on|y)$/i.test(s) || s === 'enabled';
  }
  return Boolean(value);
}

/**
 * When a stranger changes business.name, keep live identity fields in sync if they
 * still mirror the previous name or its slug tokens (casa-nord / casa.nord / casanord,
 * cabinet-marin, …): title, about, facebook label/url, instagram handle/urls/labels,
 * and contact.email. No second SEO panel — only leftover factory identity.
 */
function cascadeBusinessNameIdentity(config, oldName, newName) {
  if (!config || oldName == null || newName == null) return;
  const oldN = String(oldName);
  const newN = String(newName);
  if (!oldN || !newN || oldN === newN) return;

  // Local slugify so cascade is self-contained (tests extract this fn alone).
  function slugify(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[ăâ]/g, 'a').replace(/[îì]/g, 'i')
      .replace(/[șş]/g, 's').replace(/[țţ]/g, 't').replace(/[é]/g, 'e')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40);
  }

  function slugTokens(name) {
    const base = slugify(name);
    if (!base) return [];
    const compact = base.replace(/-/g, '');
    const dotted = base.replace(/-/g, '.');
    const out = [];
    // Longest first so casa.nord beats casa when both match
    [base, dotted, compact].forEach((t) => {
      if (t && t.length >= 3 && out.indexOf(t) === -1) out.push(t);
    });
    out.sort((a, b) => b.length - a.length);
    return out;
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function rewriteIdentityString(val) {
    if (typeof val !== 'string' || !val) return val;
    let out = val;
    if (out.indexOf(oldN) !== -1) {
      out = out.split(oldN).join(newN);
    }
    const oldToks = slugTokens(oldN);
    const newBase = slugify(newN) || 'site';
    const newCompact = newBase.replace(/-/g, '');
    const newDotted = newBase.replace(/-/g, '.');
    const map = {};
    oldToks.forEach((t) => {
      if (t.indexOf('-') !== -1) map[t] = newBase;
      else if (t.indexOf('.') !== -1) map[t] = newDotted;
      else map[t] = newCompact;
    });
    oldToks.forEach((t) => {
      const repl = map[t];
      if (!repl || t === repl) return;
      out = out.replace(new RegExp(escapeRegExp(t), 'gi'), repl);
    });
    return out;
  }

  function cascadeStringPath(path) {
    const cur = getPath(config, path);
    if (typeof cur !== 'string' || !cur) return;
    const next = rewriteIdentityString(cur);
    if (next !== cur) setPath(config, path, next);
  }

  // seo.jsonLd holds serialized JSON, not plain text: a raw split/join over the
  // string (like cascadeStringPath does) can corrupt the JSON when newN carries a
  // quote or backslash, silently zeroing out the site's structured data at publish
  // time. Parse it, rewrite string values as an object, then re-serialize. If it
  // doesn't parse as JSON, leave it untouched rather than risk breaking it further.
  function cascadeJsonLdPath(path) {
    const cur = getPath(config, path);
    if (typeof cur !== 'string' || !cur) return;
    let parsed;
    try {
      parsed = JSON.parse(cur);
    } catch (_) {
      return;
    }
    function walk(node) {
      if (typeof node === 'string') return rewriteIdentityString(node);
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === 'object') {
        const out = {};
        Object.keys(node).forEach((k) => { out[k] = walk(node[k]); });
        return out;
      }
      return node;
    }
    let nextStr;
    try {
      nextStr = JSON.stringify(walk(parsed));
    } catch (_) {
      return;
    }
    if (nextStr !== cur) setPath(config, path, nextStr);
  }

  const title = getPath(config, 'business.title');
  if (typeof title === 'string' && title.length) {
    if (title === oldN) {
      setPath(config, 'business.title', newN);
    } else if (title.startsWith(oldN + ' |') || title.startsWith(oldN + '|') || title.startsWith(oldN)) {
      setPath(config, 'business.title', newN + title.slice(oldN.length));
    } else {
      cascadeStringPath('business.title');
    }
  }

  const about = getPath(config, 'business.about');
  if (typeof about === 'string' && about.length) {
    if (about.startsWith(oldN)) {
      setPath(config, 'business.about', newN + about.slice(oldN.length));
    } else if (about.indexOf(oldN) !== -1) {
      setPath(config, 'business.about', about.split(oldN).join(newN));
    }
  }

  const fbLabel = getPath(config, 'contact.facebook.label');
  if (typeof fbLabel === 'string' && fbLabel.length) {
    if (fbLabel === oldN || fbLabel.indexOf(oldN) !== -1) {
      setPath(config, 'contact.facebook.label', rewriteIdentityString(fbLabel));
    }
  }

  // Social / contact identity that still encodes the old name or slug
  [
    'contact.facebook.url',
    'contact.instagram.url',
    'contact.instagram.label',
    'instagram.handle',
    'instagram.url',
    'instagram.embedUrl',
    'contact.email',
    'business.metaDescription',
    'business.tagline',
    'team.title',
  ].forEach(cascadeStringPath);

  // seo.jsonLd is serialized JSON — cascade it structurally, not as plain text.
  cascadeJsonLdPath('seo.jsonLd');
}

/**
 * Wave 11 quick-start — the demo town (every shipped preset places it as the
 * last word of business.title: "Name | Description | Town", or, for
 * local-service's single-"|" title, the last word of the description tail).
 * Derived rather than hardcoded so this keeps working if a future template's
 * preset uses a different demo town than "București".
 */
function deriveDemoTown(config) {
  const title = config && config.business && typeof config.business.title === 'string'
    ? config.business.title : '';
  const tail = title.split('|').pop().trim();
  const words = tail.split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words[words.length - 1].replace(/[.,;:]+$/, '');
}

/**
 * Same idea as cascadeBusinessNameIdentity, but for the town: rewrite every
 * identity field that still carries the OLD town literal (title, meta
 * description, the story, the served zone, both addresses, and inside
 * seo.jsonLd's structured address/description) to the new one. A plain
 * split/join is enough here (same approach cascadeBusinessNameIdentity's own
 * rewriteIdentityString uses for the business name) — town names in this
 * product's presets are short proper nouns, not substrings that plausibly
 * collide with unrelated words in Romanian business copy.
 */
function cascadeTownIdentity(config, oldTown, newTown) {
  if (!config || !oldTown || !newTown || oldTown === newTown) return;

  function rewrite(val) {
    if (typeof val !== 'string' || !val || val.indexOf(oldTown) === -1) return val;
    return val.split(oldTown).join(newTown);
  }

  ['business.title', 'business.metaDescription', 'business.about', 'business.zone',
   'contact.address', 'footer.address'].forEach((path) => {
    const cur = getPath(config, path);
    const next = rewrite(cur);
    if (next !== cur) setPath(config, path, next);
  });

  const jsonLd = getPath(config, 'seo.jsonLd');
  if (typeof jsonLd === 'string' && jsonLd) {
    try {
      const parsed = JSON.parse(jsonLd);
      const walk = (node) => {
        if (typeof node === 'string') return rewrite(node);
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') {
          const out = {};
          Object.keys(node).forEach((k) => { out[k] = walk(node[k]); });
          return out;
        }
        return node;
      };
      const nextStr = JSON.stringify(walk(parsed));
      if (nextStr !== jsonLd) setPath(config, 'seo.jsonLd', nextStr);
    } catch (_) { /* not parseable JSON — leave untouched rather than risk corrupting it */ }
  }
}

/**
 * Wave 11 quick-start phone: this product's every shipped demo phone is a
 * +40 (Romania) mobile number, so a bare local-style entry ("07XX XXX XXX")
 * is normalized to +40 the same way — matching what the owner would already
 * see if they never touched the field. An entry that already carries a
 * country code (leading "+" or "00") is respected as-is.
 */
function normalizePhoneForConfig(raw) {
  const display = String(raw || '').trim();
  let e164 = display.replace(/[^\d+]/g, '');
  if (e164.indexOf('00') === 0) e164 = '+' + e164.slice(2);
  if (e164 && e164[0] !== '+') {
    e164 = '+40' + (e164[0] === '0' ? e164.slice(1) : e164);
  }
  const waDigits = e164.replace(/\D/g, '');
  return { e164, waDigits, display };
}

/**
 * The demo phone also lives inside seo.jsonLd's "telephone" field — a place
 * nobody thinks to check, and exactly the kind of leftover-demo-data this
 * wave exists to close. contact.phone/whatsapp/phoneDisplay/waHref are
 * ordinary config paths the drawer already owns directly (set in
 * applyQuickstart()); jsonLd is serialized JSON, so it needs the same
 * structural rewrite cascadeTownIdentity() uses for the town.
 */
function cascadePhoneIdentity(config, oldE164, newE164) {
  if (!config || !oldE164 || !newE164 || oldE164 === newE164) return;
  const jsonLd = getPath(config, 'seo.jsonLd');
  if (typeof jsonLd !== 'string' || !jsonLd) return;
  try {
    const parsed = JSON.parse(jsonLd);
    const walk = (node) => {
      if (typeof node === 'string') return node.indexOf(oldE164) === -1 ? node : node.split(oldE164).join(newE164);
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === 'object') {
        const out = {};
        Object.keys(node).forEach((k) => { out[k] = walk(node[k]); });
        return out;
      }
      return node;
    };
    const nextStr = JSON.stringify(walk(parsed));
    if (nextStr !== jsonLd) setPath(config, 'seo.jsonLd', nextStr);
  } catch (_) { /* not parseable JSON — leave untouched rather than risk corrupting it */ }
}

function isPlausibleHttpUrl(value) {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!/^https?:\/\//i.test(str)) return false;
  try {
    const parsed = new URL(str);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
  } catch (_) {
    return false;
  }
}

function isSiteLocalAssetField(key) {
  return /(?:^|\.)(?:ogImage|image|imageUrl|photo|logo|src)$/i.test(String(key || ''));
}

function isPlausibleSiteAssetPath(value) {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str || /[\\\s:]/.test(str) || str.includes('//')) return false;
  const pathname = str.split(/[?#]/, 1)[0];
  if (pathname.split('/').includes('..')) return false;
  return /^(?:\.\/|\/)?(?:images|assets)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(pathname);
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) {
    if (e.name === 'QuotaExceededError' || (e.code && e.code === 22)) {
      showToast('Proiectul are imagini mari — nu s-a putut salva ca ciornă. Publică înainte să închizi pagina.', 'error', 7000);
    }
    return false;
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function toSlug(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[ăâ]/g,'a').replace(/[îì]/g,'i').replace(/[șş]/g,'s').replace(/[țţ]/g,'t').replace(/[é]/g,'e')
    .replace(/[^a-z0-9\s-]/g,'')
    .trim()
    .replace(/[\s_]+/g,'-')
    .replace(/-+/g,'-')
    .slice(0, 40);
}

function fmtTimeRemaining(ms) {
  if (ms <= 0) return 'expired';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const parts = [];
  if (d > 0) parts.push(d + 'd');
  if (h > 0) parts.push(h + 'h');
  if (d === 0) parts.push(m + 'm');
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// 4. Color helpers
// ---------------------------------------------------------------------------

function hexToHsl(hex) {
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.slice(0,2),16)/255;
  const g = parseInt(hex.slice(2,4),16)/255;
  const b = parseInt(hex.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0, l = (max+min)/2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6; break;
      case b: h = ((r-g)/d + 4)/6; break;
    }
  }
  return { h: Math.round(h*360), s: Math.round(s*100), l: Math.round(l*100) };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h/30) % 12;
  const a = s * Math.min(l, 1-l);
  const f = n => l - a*Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n),1)));
  const toH = x => Math.round(x*255).toString(16).padStart(2,'0');
  return '#' + toH(f(0)) + toH(f(8)) + toH(f(4));
}

function deriveColors(primaryHex) {
  const hsl = hexToHsl(primaryHex);
  return {
    primaryLight: hslToHex(hsl.h, Math.min(hsl.s+5,100), Math.min(hsl.l+12,95)),
    primaryDark:  hslToHex(hsl.h, Math.min(hsl.s+5,100), Math.max(hsl.l-12,5)),
  };
}

// ---------------------------------------------------------------------------
// 5. Template data access (light registry + on-demand heavy payload)
// ---------------------------------------------------------------------------

/** In-flight heavy fetches: id → Promise<data> */
const _heavyLoads = Object.create(null);

function getTemplateList() {
  const d = window.HIDOOK_TEMPLATES;
  if (!d) return [];
  if (Array.isArray(d.registry)) return d.registry;
  if (d.registry && Array.isArray(d.registry.templates)) return d.registry.templates;
  return [];
}

function getTemplateById(id) {
  const d = window.HIDOOK_TEMPLATES;
  if (!d || !d.templates) return null;
  return d.templates[id] || null;
}

/**
 * Ensure heavy payload (schema/presets/files) is loaded for template id.
 * Light boot registry has empty templates{}; Start/Preview/editor fetch here.
 */
function ensureTemplateLoaded(id) {
  if (!id) return Promise.resolve(null);
  const existing = getTemplateById(id);
  if (existing && existing.files && existing.schema) return Promise.resolve(existing);

  if (_heavyLoads[id]) return _heavyLoads[id];

  const d = window.HIDOOK_TEMPLATES || {};
  const prefix = d.heavyPathPrefix || '/app/generated/templates/';
  const url = prefix + encodeURIComponent(id) + '.js';

  _heavyLoads[id] = fetch(url, { credentials: 'same-origin' })
    .then((res) => {
      if (!res.ok) throw new Error('Heavy template ' + id + ' HTTP ' + res.status);
      return res.text();
    })
    .then((src) => {
      // Evaluate payload: assigns window.HIDOOK_TEMPLATE_HEAVY[id]
      const runner = new Function(src);
      runner();
      const heavy = (window.HIDOOK_TEMPLATE_HEAVY && window.HIDOOK_TEMPLATE_HEAVY[id]) || null;
      if (!heavy || !heavy.files) throw new Error('Heavy template ' + id + ' missing payload');
      d.templates = d.templates || {};
      d.templates[id] = {
        schema: heavy.schema,
        presets: heavy.presets,
        files: heavy.files,
      };
      return d.templates[id];
    })
    .catch((err) => {
      delete _heavyLoads[id];
      throw err;
    });

  return _heavyLoads[id];
}

/** Human catalog badge — Romanian product surface; never show raw API ids. */
const DESIGN_BADGE_BY_ID = {
  'product-menu': 'Restaurant',
  'local-service': 'Meserii',
  'portfolio': 'Salon',
  'professionals': 'Servicii profesionale',
  'desserdirina': 'Cofetărie',
};

function designBadgeLabel(tpl) {
  if (!tpl) return 'Design';
  const fromMap = DESIGN_BADGE_BY_ID[tpl.id] || DESIGN_BADGE_BY_ID[tpl.vertical];
  if (fromMap) return fromMap;
  const name = (tpl.name && String(tpl.name).trim()) || '';
  if (name && name !== tpl.id && name !== tpl.vertical) return name;
  return 'Design';
}

// ---------------------------------------------------------------------------
// 6. Schema helpers — identify inline vs drawer fields
// ---------------------------------------------------------------------------

// Field types that go in the drawer (not editable inline on the canvas)
const DRAWER_TYPES = new Set(['phone', 'url', 'color', 'background']);
const DRAWER_KEYS_PARTIAL = ['whatsapp', 'waMessage', 'instagram.url', 'facebook.url', 'addressHref', 'seo.', 'jsonLd', 'canonical', 'lang', 'ogImage'];
// Factory/SEO machinery — keep in config for publish, never show in Detalii
const HIDDEN_DRAWER_KEYS = ['seo.ogImage', 'seo.jsonLd', 'seo.canonical', 'contact.waHref'];

/** Default prefilled WhatsApp inquiry (browser builder; RO product surface; do not edit flow.js). */
const WA_DEFAULT_MSG = 'Bună ziua, aș dori mai multe informații despre serviciile dumneavoastră.';

/** Derive contact.waHref from digits + plain waMessage. Empty when no number. */
function deriveWaHref(config) {
  if (!config || typeof config !== 'object') return;
  if (!config.contact || typeof config.contact !== 'object') config.contact = {};
  const raw = config.contact.whatsapp;
  const digits = raw == null ? '' : String(raw).replace(/\D/g, '');
  if (!digits) {
    config.contact.waHref = '';
    return;
  }
  const msgRaw = config.contact.waMessage;
  const msg = (msgRaw != null && String(msgRaw).trim() !== '') ? String(msgRaw) : WA_DEFAULT_MSG;
  config.contact.waHref = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msg);
}

function isHiddenDrawerField(field) {
  const k = field && field.key ? String(field.key) : '';
  if (HIDDEN_DRAWER_KEYS.includes(k)) return true;
  if (k === 'waHref' || k.endsWith('.waHref')) return true;
  if (k === 'jsonLd' || k.endsWith('.jsonLd')) return true;
  if (k === 'canonical' || k.endsWith('.canonical')) return true;
  return false;
}

function isDrawerField(field) {
  if (isHiddenDrawerField(field)) return false;
  if (DRAWER_TYPES.has(field.type)) return true;
  const k = field.key || '';
  return DRAWER_KEYS_PARTIAL.some(p => k.includes(p));
}

function getAllSchemaFields(schema) {
  if (!schema || !schema.sections) return [];
  const fields = [];
  schema.sections.forEach(section => {
    (section.fields || []).forEach(f => fields.push({ ...f, _section: section.title }));
  });
  return fields;
}

function getRequiredFields(schema) {
  return getAllSchemaFields(schema).filter(f => f.required !== false);
}

// ---------------------------------------------------------------------------
// 6b. Honest completion — "done" means the OWNER made it theirs, not that a
// fresh demo preset happened to fill the field in already.
// ---------------------------------------------------------------------------
//
// A brand-new draft is seeded from currentTemplate.data.presets[0].config (see
// startTemplate() / chooseDesign()) — a plausible business name, phone,
// address and photos that read as a finished, real site. The old checklist
// only asked "is this field non-empty?", so that demo content counted as
// 22/22 done before the owner had touched anything — the exact failure this
// wave exists to fix (see task brief).
//
// Fix: for the handful of fields that actually carry the OWNER's identity —
// name, tagline, page title, meta description, the story, phone/address, the
// footer — "done" additionally requires the current value to differ from
// that same preset's starting value. Every other required field (button
// labels, section titles, the language picker…) keeps the old non-empty
// check: their demo default is a perfectly fine, finished value for a real
// owner too, so flagging them would just make the checklist impossible to
// satisfy honestly.
//
// Same idea for photos: a template asset path ("images/hero.jpg", or a CSS
// background wrapping one) is still the demo's photo. An owner's own upload
// is always inlined as a data: URI (see isDemoPhotoSrc / the upload pipeline
// above) — that is the one reliable signal that a real photo replaced it.

/** Keys whose preset default reads as a real (fake) business — must be
 * genuinely changed, not merely present, to count as "done". Shared verbatim
 * across all five templates' schemas. */
const IDENTITY_FIELD_KEYS = new Set([
  'business.name',
  'business.tagline',
  'business.title',
  'business.metaDescription',
  'business.about',
  'business.zone',
  'business.profession',
  'contact.phoneDisplay',
  'contact.address',
  'footer.address',
]);

/** Schema field types that render a photo — logo/hero (single image or CSS
 * background) and photo galleries. */
const PHOTO_FIELD_TYPES = new Set(['image', 'background', 'photos']);

/** The demo baseline a fresh draft started from — currentTemplate.data's
 * first preset config, the same object startTemplate() seeds draft.config
 * from. Returns null when unavailable (isolated tests, template not loaded
 * yet) so callers can fall back to the old non-empty check. */
function getDemoPresetConfig() {
  const tpl = typeof currentTemplate !== 'undefined' ? currentTemplate : null;
  const data = tpl && tpl.data;
  const presets = data && Array.isArray(data.presets) ? data.presets : null;
  return (presets && presets[0] && presets[0].config) || null;
}

/** Does `val` (a single photo-bearing config value — <img> src, or a CSS
 * background string that may wrap one) still point at the template's own
 * bundled asset rather than an owner upload? Owner uploads are always
 * inlined as data: URIs (see the resize/upload pipeline); a bare or
 * url()-wrapped "images/xxx.jpg" is the untouched demo photo. */
function isDemoPhotoValue(val) {
  if (typeof val !== 'string' || !val) return true;
  return val.indexOf('data:image/') === -1;
}

/** Completion check for a 'photos' gallery array: at least one item's photo
 * must be a genuine owner upload. An empty gallery (required:false in every
 * shipped schema today) is handled by the generic empty-array check before
 * this is ever called. */
function galleryHasRealPhoto(list) {
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.some((item) => {
    const src = typeof item === 'string' ? item : (item && (item.src || item.url));
    return !isDemoPhotoValue(src);
  });
}

/**
 * The ORIGINAL, structural completeness check: does this required field have
 * ANY value at all? Used only to gate publishing (openPublishModal) — a hard
 * rule that exists to stop a site going live with e.g. a blank business name
 * breaking the page <title>, not a judgement about whose content it is. Left
 * unchanged on purpose: whether to let a demo-content draft publish is a
 * separate, much bigger product decision than "does the checklist lie about
 * it", and this wave was not asked to make that call — see
 * isFieldGenuinelyMade() below for the honest "did the OWNER do this" check
 * the checklist pill now uses instead.
 */
function isFieldComplete(field) {
  const val = getPath(draft.config, field.key);
  if (val == null || val === '') return false;
  if (Array.isArray(val) && val.length === 0) return false;
  return true;
}

/**
 * The HONEST completeness check the checklist pill uses (see the "Honest
 * completion" doc comment above IDENTITY_FIELD_KEYS): on top of
 * isFieldComplete()'s structural check, an identity field must also differ
 * from the demo preset's own value, and a photo field must be a genuine
 * owner upload. Never used to gate publishing — see isFieldComplete().
 */
function isFieldGenuinelyMade(field) {
  if (!isFieldComplete(field)) return false;
  const val = getPath(draft.config, field.key);

  if (PHOTO_FIELD_TYPES.has(field.type)) {
    if (field.type === 'photos') return galleryHasRealPhoto(val);
    return !isDemoPhotoValue(val);
  }

  if (IDENTITY_FIELD_KEYS.has(field.key)) {
    const preset = getDemoPresetConfig();
    if (preset) {
      const demoVal = getPath(preset, field.key);
      if (typeof val === 'string' && typeof demoVal === 'string' && val.trim() === demoVal.trim()) {
        return false; // still exactly the demo's own value
      }
    }
  }

  return true;
}

/** Identity-key paths whose current value is STILL the demo preset's own
 * value — used to mark provisional/untouched content on the canvas (see
 * edit-overlay.js's {hb:'demoText'} handler). Unlike isFieldGenuinelyMade()
 * this ignores field.required — a not-required identity field left at its
 * demo value (e.g. business.zone) should still read as provisional on
 * canvas. */
function computeDemoTextPaths() {
  const schema = currentTemplate && currentTemplate.data && currentTemplate.data.schema;
  const preset = getDemoPresetConfig();
  if (!schema || !preset || !draft.config) return [];
  const out = [];
  getAllSchemaFields(schema).forEach((f) => {
    if (!IDENTITY_FIELD_KEYS.has(f.key)) return;
    const val = getPath(draft.config, f.key);
    const demoVal = getPath(preset, f.key);
    if (typeof val === 'string' && typeof demoVal === 'string' &&
        val.trim() !== '' && val.trim() === demoVal.trim()) {
      out.push(f.key);
    }
  });
  return out;
}

/** Push the current provisional-content set into the preview iframe. */
function sendDemoTextMarks() {
  const iframe = typeof getPreviewIframe === 'function' ? getPreviewIframe() : null;
  if (!iframe || !iframe.contentWindow || !iframeReady) return;
  try {
    iframe.contentWindow.postMessage({ hb: 'demoText', paths: computeDemoTextPaths() }, '*');
  } catch (_) { /* best-effort visual cue only */ }
}

let demoTextMarksTimer = null;
/** Debounced entry point for sendDemoTextMarks(), called only from
 * onIframeReady() — i.e. once per full re-render, which every identity-field
 * change already triggers or will trigger once the drawer closes (see the
 * drawer field handler's own deferred-rerender-on-close, drawerNeedsRerenderOnClose). A
 * canvas text edit's own mark drop is instant regardless of any of this —
 * edit-overlay.js clears it locally the moment the field is touched.
 *
 * Earlier versions of this fix also called this (undebounced) from
 * updateChecklist(), which fires on every keystroke in ANY drawer field —
 * including ones with nothing to do with identity text (e.g.
 * appointment.bookingUrl). Sending a postMessage into the preview iframe
 * from that same hot path measurably raised the odds of fullRerender()'s
 * renderInFlight guard still being busy when the next scheduled re-render
 * came due, coalescing it later than a fixed-wait caller expected —
 * reproduced as a real regression in bot/test/fullpass-63230d2.mjs's
 * professionals Cal.com-booking-link timing check during this wave's own
 * development. Debounced and kept to the single onIframeReady() call site
 * so this can never happen again. */
function scheduleDemoTextMarks() {
  if (demoTextMarksTimer) clearTimeout(demoTextMarksTimer);
  demoTextMarksTimer = setTimeout(() => {
    demoTextMarksTimer = null;
    sendDemoTextMarks();
  }, 200);
}

// ---------------------------------------------------------------------------
// 7b. Quick-start — name/phone/town, everywhere, in one sitting
// ---------------------------------------------------------------------------
//
// Not a tour with arrows and tooltips: three fields, on the same bar that
// already told the owner "this is demo content", any subset of which gets
// stamped across every place that content actually appears — including the
// places a person would never think to check (browser tab title, Google's
// snippet, the structured data search engines read, the WhatsApp message a
// customer's tap opens, the footer). Skippable ("Nu acum" — same dismissal
// as before), and repeatable any time via the checklist pill in the topbar.

/** Open the quick-start bar on demand (checklist pill), independent of
 * isFreshDemoDraft — a resumed draft that still hasn't had its identity
 * fields filled in deserves the same one-minute fix. */
function openQuickstart() {
  quickstartForceOpen = true;
  syncDemoBanner();
  const nameEl = $('quickstart-name');
  if (nameEl) nameEl.focus();
}

/** Close the bar. Marks it dismissed so an auto-shown fresh-draft bar does
 * not immediately reappear on the next render — same persisted semantics the
 * plain-text banner already had. */
function closeQuickstart() {
  quickstartForceOpen = false;
  demoBannerDismissed = true;
  syncDemoBanner();
  saveDraft();
}

/** Apply whichever of the three fields the owner actually filled in. Empty
 * fields are left alone — this is a quick stamp, not a form that must be
 * fully completed to submit. */
function applyQuickstart() {
  if (!draft.config) return;
  const nameEl = $('quickstart-name');
  const phoneEl = $('quickstart-phone');
  const townEl = $('quickstart-town');
  const name = nameEl ? nameEl.value.trim() : '';
  const phone = phoneEl ? phoneEl.value.trim() : '';
  const town = townEl ? townEl.value.trim() : '';

  if (!name && !phone && !town) {
    closeQuickstart();
    return;
  }

  // Read the demo town BEFORE any mutation — cascadeBusinessNameIdentity's
  // own title rewrite only ever touches the name prefix of business.title,
  // never the town tail, but reading it first removes any doubt either way.
  const prevTown = town ? deriveDemoTown(draft.config) : '';

  if (name) {
    const prevName = getPath(draft.config, 'business.name');
    setPath(draft.config, 'business.name', name);
    if (prevName != null && prevName !== name) {
      cascadeBusinessNameIdentity(draft.config, prevName, name);
    }
  }

  if (town && prevTown && prevTown !== town) {
    cascadeTownIdentity(draft.config, prevTown, town);
  }

  if (phone) {
    const prevPhoneE164 = getPath(draft.config, 'contact.phone');
    const norm = normalizePhoneForConfig(phone);
    setPath(draft.config, 'contact.whatsapp', norm.waDigits);
    setPath(draft.config, 'contact.phone', norm.e164);
    setPath(draft.config, 'contact.phoneDisplay', norm.display);
    deriveWaHref(draft.config);
    if (prevPhoneE164) cascadePhoneIdentity(draft.config, prevPhoneE164, norm.e164);
  }

  // A deliberate, discrete action — its own undo step, never coalesced with
  // an unrelated in-flight text edit.
  pendingHistoryCoalesceKey = null;
  saveDraft();
  updateChecklist();
  scheduleRerender(true);
  if (typeof showToast === 'function') {
    showToast('Site-ul tău are acum datele tale — verifică pe canvas.', 'success', 4000);
  }
  if (nameEl) nameEl.value = '';
  if (phoneEl) phoneEl.value = '';
  if (townEl) townEl.value = '';
  closeQuickstart();
}

// ---------------------------------------------------------------------------
// 7. Checklist indicator
// ---------------------------------------------------------------------------

function updateChecklist() {
  if (!currentTemplate || !currentTemplate.data || !currentTemplate.data.schema) return;
  const required = getRequiredFields(currentTemplate.data.schema);
  const done = required.filter(isFieldGenuinelyMade).length;
  const total = required.length;
  const el = $('checklist-text');
  const ind = $('checklist-indicator');
  if (el) el.textContent = done + '/' + total;
  if (ind) {
    ind.classList.toggle('checklist-ok', done === total);
    ind.classList.toggle('checklist-warn', done < total);
  }
  // NOT wired to sendDemoTextMarks()/scheduleDemoTextMarks() here on purpose,
  // even though updateChecklist() already runs on every identity-field
  // change: this function is also called from the general DRAWER field
  // handler on every keystroke in ANY field, including ones with nothing to
  // do with identity text (e.g. appointment.bookingUrl) — sending a message
  // into the preview iframe from that same hot path added real, measurable
  // main-thread contention (the iframe processing the message right as the
  // parent's own closeDrawer()-triggered fullRerender() needs the thread)
  // and raised the odds of fullRerender()'s renderInFlight guard still being
  // busy when the next scheduled re-render came due — reproduced as a real
  // regression in bot/test/fullpass-63230d2.mjs's professionals
  // Cal.com-booking-link timing check during this wave's own development.
  // onIframeReady() (below) already repaints the provisional-content marks
  // on every full re-render, which every identity-field change already
  // triggers or will trigger once the drawer closes (see the drawer field
  // handler's own deferred-rerender-on-close, drawerNeedsRerenderOnClose) — a canvas
  // text edit's own mark drop is instant regardless (edit-overlay.js clears
  // it locally the moment the field is touched, no round trip needed).
}

// ---------------------------------------------------------------------------
// 7-menu. Checklist "what's missing" menu — WHICH fields, and one click there
// ---------------------------------------------------------------------------
//
// updateChecklist() above already knows exactly which required fields the
// owner hasn't genuinely made theirs — isFieldGenuinelyMade() is the same
// honest check either way (see its doc comment). The pill only ever showed
// the COUNT ("10/15"); this menu spends that same computation on something
// actionable: each missing field's own Romanian label — straight from
// schema.json (sections[].fields[].label), never invented — and a click that
// lands the owner exactly on it: the details drawer, scrolled to that
// field's row and focused, for a drawer field (phone/url/color/background
// and the handful of key-matched fields — see isDrawerField()); the canvas
// itself, scrolled and highlighted (and given keyboard focus when it is a
// genuine contenteditable text field), for everything else — the large
// majority of required fields, which are edited inline on the page, not in
// the drawer.
//
// Built lazily, only when the menu is opened (openChecklistMenu(), from the
// pill's click handler) — never from updateChecklist()'s own per-keystroke
// call sites. That matters for the same reason the pill's own count logic
// stays a plain textContent/classList update on that hot path (see the doc
// comment closing updateChecklist(), above): a real regression was measured
// this project sending anything into the preview iframe from every drawer
// keystroke. This menu never touches the iframe until a specific missing
// field is actually clicked, so the "reuse the existing count path, don't
// add a new per-keystroke one" requirement holds by construction.

/** Land the owner on `field`: the details drawer (scrolled to its row and
 * focused) for a drawer field, the canvas itself (scrolled, highlighted, and
 * focused when it is a real text field) for everything else. */
function goToChecklistField(field) {
  if (!field || !field.key) return;
  if (isDrawerField(field)) {
    openDrawer(field.key);
  } else {
    if (drawerOpen) closeDrawer();
    sendFocusFieldToIframe(field.key);
  }
}

/** (Re)build the menu's contents — called once, each time it opens. */
function buildChecklistMenu() {
  const menu = $('checklist-menu');
  if (!menu) return;
  menu.innerHTML = '';

  const quickBtn = document.createElement('button');
  quickBtn.type = 'button';
  quickBtn.className = 'account-menu-item';
  quickBtn.setAttribute('role', 'menuitem');
  quickBtn.textContent = 'Completare rapidă (nume, telefon, localitate)';
  quickBtn.addEventListener('click', () => {
    closeChecklistMenu();
    openQuickstart();
  });
  menu.appendChild(quickBtn);

  if (!currentTemplate || !currentTemplate.data || !currentTemplate.data.schema) return;
  const required = getRequiredFields(currentTemplate.data.schema);
  const missing = required.filter((f) => !isFieldGenuinelyMade(f));

  const divider = document.createElement('div');
  divider.className = 'checklist-menu-divider';
  divider.setAttribute('role', 'separator');
  menu.appendChild(divider);

  if (missing.length === 0) {
    const done = document.createElement('p');
    done.className = 'checklist-menu-empty';
    done.textContent = 'Toate câmpurile esențiale sunt completate cu datele tale.';
    menu.appendChild(done);
    return;
  }

  const heading = document.createElement('p');
  heading.className = 'checklist-menu-heading';
  heading.textContent = 'Mai lipsesc (' + missing.length + '):';
  menu.appendChild(heading);

  missing.forEach((field) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'account-menu-item checklist-menu-field';
    item.setAttribute('role', 'menuitem');
    item.textContent = field.label || field.key;
    item.addEventListener('click', () => {
      closeChecklistMenu();
      goToChecklistField(field);
    });
    menu.appendChild(item);
  });
}

function toggleChecklistMenu() {
  if (checklistMenuOpen) { closeChecklistMenu(); return; }
  openChecklistMenu();
}

function openChecklistMenu() {
  const menu = $('checklist-menu');
  const btn = $('checklist-indicator');
  if (!menu || !btn) return;
  buildChecklistMenu();

  const rect = btn.getBoundingClientRect();
  // On a genuinely fresh draft the quick-start banner (#demo-content-banner)
  // sits right below the topbar too, in normal document flow — anchoring
  // purely off the pill would let this fixed-position menu overlap it
  // (both would occupy the same first ~90px of the screen). Anchor below
  // whichever is lower.
  const banner = $('demo-content-banner');
  let anchorBottom = rect.bottom;
  if (banner && banner.style.display !== 'none') {
    const bannerRect = banner.getBoundingClientRect();
    if (bannerRect.bottom > anchorBottom) anchorBottom = bannerRect.bottom;
  }
  menu.style.top = (anchorBottom + 6) + 'px';
  menu.style.left = rect.left + 'px';
  menu.style.right = 'auto';
  menu.style.display = '';
  checklistMenuOpen = true;
  btn.setAttribute('aria-expanded', 'true');

  // Focus the first item at once — no need to wait a frame for this part,
  // and a keyboard user (Enter/Space on the pill) should not see any lag
  // before focus visibly lands inside the menu.
  const first = menu.querySelector('button');
  if (first) first.focus();

  // Clamp on-screen at narrow widths — the same reasoning as the color
  // popover's own on-screen clamp (see HANDOFF-mobile.md): an inline `left`
  // computed from the button's own position can still push a wide-enough
  // menu off the right edge on a 390px phone. This DOES need a layout pass
  // (getBoundingClientRect), so it stays deferred a frame.
  requestAnimationFrame(() => {
    const mrect = menu.getBoundingClientRect();
    if (mrect.right > window.innerWidth - 8) {
      menu.style.left = 'auto';
      menu.style.right = '8px';
    }
  });
}

function closeChecklistMenu() {
  const menu = $('checklist-menu');
  const btn = $('checklist-indicator');
  if (menu) menu.style.display = 'none';
  checklistMenuOpen = false;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

// ---------------------------------------------------------------------------
// 7b. Undo / redo history (audit finding #45 — builder had no undo/redo at all)
// ---------------------------------------------------------------------------
//
// A linear history of full snapshots of draft.config (JSON strings). This is
// the same "document model" the rest of the editor already reads and writes
// (draft.config — see 04-QA-Evidence/Audit-2026-09-06-2225ca7/CORECTII.md,
// PS-01: it is a real structured document, not regex-over-HTML), so a plain
// snapshot stack covers EVERY mutation for free — inline text edits, colour
// changes, photo replacement, list add/remove and the business-name cascade
// all end up as ordinary writes to draft.config, funnelled through the single
// saveDraft() choke point below.
//
// Memory cap: a template config can carry several photos as base64 data: URIs
// (each several hundred KB to a few MB once base64-inflated), so an
// undo stack bounded ONLY by entry count could hold many megabytes per entry
// after a photo-heavy editing session and blow past what a phone browser tab
// tolerates. We bound on BOTH axes, whichever is hit first:
//   • HISTORY_MAX_ENTRIES = 40 steps — generous for "I made a mistake, back up
//     a few actions" (real editing sessions rarely chain more than a handful
//     of undoable actions before moving on); and
//   • HISTORY_MAX_BYTES = 15MB combined — keeps worst-case stack memory in the
//     tens-of-MB range even for a template stuffed with several multi-MB
//     photos, instead of scaling unboundedly with session length. 15MB was
//     picked as roughly "a handful of full-size photo configs" — enough steps
//     back to matter, small enough that mobile Safari/Chrome tabs (which start
//     evicting well before ~300-400MB of JS heap) never notice it.
// Oldest entries are evicted first when a cap is exceeded; the pointer never
// drops below the oldest surviving entry.
const HISTORY_MAX_ENTRIES = 40;
const HISTORY_MAX_BYTES   = 15 * 1024 * 1024; // 15MB combined serialized snapshot budget
const HISTORY_COALESCE_MS = 800; // rapid keystrokes/drags within this gap merge into one undo step

const historyState = {
  stack: [],          // [{ json: string, size: number }], oldest first
  index: -1,          // pointer into stack — the CURRENT state
  coalesceKey: null,  // last coalescing key used (e.g. 'text:business.name')
  coalesceAt: 0,       // Date.now() of the last coalesced push
};

/** Set right before a saveDraft() call whose resulting push should try to
 * coalesce with the previous one (rapid keystrokes/drags). Consumed (reset to
 * null) by pushHistory() on every call, discrete mutations simply never set it. */
let pendingHistoryCoalesceKey = null;

function historySnapshotBytes() {
  let total = 0;
  for (let i = 0; i < historyState.stack.length; i++) total += historyState.stack[i].size;
  return total;
}

function historyTrim() {
  while (
    historyState.stack.length > 1 &&
    (historyState.stack.length > HISTORY_MAX_ENTRIES || historySnapshotBytes() > HISTORY_MAX_BYTES)
  ) {
    historyState.stack.shift();
    historyState.index--;
  }
  if (historyState.index < 0) historyState.index = 0;
}

function updateHistoryButtons() {
  const undoBtn = $('btn-undo');
  const redoBtn = $('btn-redo');
  if (undoBtn) undoBtn.disabled = historyState.index <= 0;
  if (redoBtn) redoBtn.disabled = historyState.index < 0 || historyState.index >= historyState.stack.length - 1;
}

/**
 * Record the CURRENT draft.config as a history entry — called from the single
 * saveDraft() choke point so no mutation site has to remember to call it.
 *
 * `coalesceKey` (optional): when non-null and equal to the key used by the
 * previous push, AND that previous push is still the top of the stack, AND it
 * happened within HISTORY_COALESCE_MS, the top entry is replaced in place
 * instead of pushing a new one. This is how a burst of debounced keystrokes in
 * one contenteditable field, or a dragged color-picker gesture, becomes ONE
 * undo step rather than one per keystroke/pixel.
 *
 * No-op (does not push, does not disturb coalescing) when the serialized
 * config is byte-identical to the current top-of-stack entry — this makes it
 * safe for saveDraft() to call pushHistory() unconditionally even from call
 * sites that persist bookkeeping (siteId binding, slug) without actually
 * changing draft.config, and is also what makes undo/redo's own saveDraft()
 * call (see applyHistoryEntry) a no-op instead of re-recording the state it
 * just restored.
 */
function pushHistory(coalesceKey) {
  if (!draft.config) return;
  const json = JSON.stringify(draft.config);
  if (historyState.index >= 0 && historyState.stack[historyState.index] &&
      historyState.stack[historyState.index].json === json) {
    return; // nothing actually changed — do not record a redundant step
  }
  const size = json.length;
  const now = Date.now();
  const canCoalesce = coalesceKey != null &&
    historyState.coalesceKey === coalesceKey &&
    historyState.index === historyState.stack.length - 1 &&
    (now - historyState.coalesceAt) < HISTORY_COALESCE_MS;

  if (canCoalesce) {
    historyState.stack[historyState.index] = { json, size };
  } else {
    // A new step discards any redo branch — standard undo/redo semantics.
    historyState.stack = historyState.stack.slice(0, historyState.index + 1);
    historyState.stack.push({ json, size });
    historyState.index = historyState.stack.length - 1;
  }
  historyState.coalesceKey = coalesceKey || null;
  historyState.coalesceAt = now;
  historyTrim();
  updateHistoryButtons();
}

/** Start a brand-new undo/redo session — called whenever a fresh draft.config
 * is loaded (new design chosen, dashboard "Editează", resumed local draft,
 * paid-site bind). The freshly loaded state becomes the undoable baseline. */
function resetHistory() {
  // Normalize BEFORE snapshotting the baseline: saveDraft() always runs
  // deriveWaHref() first, which can ADD a contact.waHref field the very
  // first time it runs on a freshly chosen preset. If the baseline snapshot
  // were taken before that normalization, the next ordinary saveDraft() call
  // would look like a real edit (the json would differ), spuriously pushing
  // a second history entry and leaving Undo enabled on a draft nobody has
  // touched yet. deriveWaHref is idempotent, so calling it again here is
  // always safe even when saveDraft() already normalized this exact config.
  if (draft.config && typeof deriveWaHref === 'function') {
    try { deriveWaHref(draft.config); } catch (_) { /* ignore */ }
  }
  historyState.stack = [];
  historyState.index = -1;
  historyState.coalesceKey = null;
  historyState.coalesceAt = 0;
  pendingHistoryCoalesceKey = null;
  if (draft.config) pushHistory(null);
  updateHistoryButtons();
  hideTabConflictBanner();
  // Wave 9: a freshly loaded draft (new design, resumed local draft, paid
  // bind) starts its own save-state session — never carry over a stale
  // "Salvat"/error pill (or a live-edit mirror) from whatever was open
  // before. Guarded like pushHistory/TAB_ID above for isolated-extraction
  // tests that eval resetHistory() without these declared.
  if (typeof pendingLiveEdits === 'object' && pendingLiveEdits) pendingLiveEdits = {};
  if (typeof pendingOpCount === 'number') pendingOpCount = 0;
  if (typeof localSaveOk !== 'undefined') localSaveOk = true;
  if (typeof serverSaveTimer !== 'undefined' && serverSaveTimer) { clearTimeout(serverSaveTimer); serverSaveTimer = null; }
  if (typeof serverSaveInFlight !== 'undefined') serverSaveInFlight = false;
  if (typeof serverSaveQueuedAgain !== 'undefined') serverSaveQueuedAgain = false;
  if (typeof hasEverEdited !== 'undefined') hasEverEdited = false;
  if (typeof setSaveState === 'function') setSaveState('idle');
}

/** Re-sync every piece of editor UI that caches a copy of draft.config values
 * after undo/redo jumps the whole document to a different snapshot. */
function refreshEditorUIFromConfig() {
  updateChecklist();
  fullRerender();
  if (drawerOpen) buildDrawer();
  const galleryModal = $('modal-gallery');
  if (galleryModal && galleryModal.style.display !== 'none') buildGalleryModal();
  if (colorPopoverOpen) {
    const curColor = (draft.config && getPath(draft.config, 'theme.primary')) || '#5B5BD6';
    const curBg = (draft.config && getPath(draft.config, 'theme.cream')) || '#F3EFE8';
    const sw = $('color-custom-swatch'); const ti = $('color-custom-text');
    if (sw) sw.value = curColor;
    if (ti) ti.value = curColor;
    const bgSw = $('color-bg-swatch'); const bgTi = $('color-bg-text');
    if (bgSw && /^#[0-9a-fA-F]{6}$/.test(curBg)) bgSw.value = curBg;
    if (bgTi && /^#[0-9a-fA-F]{6}$/.test(curBg)) bgTi.value = curBg;
  }
}

function applyHistoryEntry() {
  const entry = historyState.stack[historyState.index];
  if (!entry) return;
  try { draft.config = JSON.parse(entry.json); }
  catch (_) { return; }
  historyState.coalesceKey = null; // undo/redo never coalesces with what follows
  saveDraft(); // persists to localStorage; its pushHistory() call is a no-op here (json === pointer)
  refreshEditorUIFromConfig();
  updateHistoryButtons();
}

function undo() {
  if (historyState.index <= 0) return;
  historyState.index--;
  applyHistoryEntry();
}

function redo() {
  if (historyState.index < 0 || historyState.index >= historyState.stack.length - 1) return;
  historyState.index++;
  applyHistoryEntry();
}

// ---------------------------------------------------------------------------
// 7c. Multi-tab draft conflict warning (audit medium #8)
// ---------------------------------------------------------------------------
//
// Two tabs editing the same draft both write to the same localStorage key —
// the second save silently clobbers the first with no warning. We cannot
// merge (there's no server-side draft yet to reconcile against, and silently
// picking a "winner" would just move the surprise elsewhere per the task's
// explicit instruction), so instead we detect it honestly: the `storage`
// event fires in every OTHER tab of this origin whenever one tab writes to
// localStorage, which is exactly "another tab just changed this draft".

function showTabConflictBanner() {
  tabConflictActive = true;
  const banner = $('tab-conflict-banner');
  if (banner) { banner.style.display = ''; banner.setAttribute('aria-hidden', 'false'); }
}

function hideTabConflictBanner() {
  tabConflictActive = false;
  const banner = $('tab-conflict-banner');
  if (banner) { banner.style.display = 'none'; banner.setAttribute('aria-hidden', 'true'); }
}

function initTabConflictWatcher() {
  window.addEventListener('storage', (e) => {
    if (e.key !== DRAFT_KEY || !e.newValue) return;
    if (!draft.templateId) return; // nothing open in this tab yet
    let incoming;
    try { incoming = JSON.parse(e.newValue); } catch (_) { return; }
    if (!incoming || incoming.tabId === TAB_ID) return; // our own write (storage never fires for it, but be safe)
    const sameDraft = incoming.templateId === draft.templateId &&
      (!currentSiteId || !incoming.siteId || incoming.siteId === currentSiteId);
    if (!sameDraft) return;
    showTabConflictBanner();
  });
}

// ---------------------------------------------------------------------------
// 7d. Save state — visible saving/saved/failed + exit guard (Wave 9)
// ---------------------------------------------------------------------------
//
// The most basic promise a site builder makes — "the customer never loses their work,
// and always knows whether it is saved" — was previously unmet twice over:
// (1) there was no beforeunload guard at all, so closing/reloading mid-edit
// silently dropped anything not yet in localStorage, and (2) canvas text
// edits sat debounced 300ms before even reaching draft.config, a window a
// reload could land inside and lose silently.
//
// Local persistence (saveDraft() → localStorage) is the safety net every
// edit already runs through; it is synchronous and effectively instant, so
// it is treated as the *true* save for anonymous editing. Signed-in users
// additionally get a debounced server-side autosave (POST /api/draft, the
// same endpoint already used before HTML/ZIP export) — that round-trip is
// the one that can genuinely fail (offline, 500, a revoked session) and
// needs a visible, retryable failure state.
//
// States: 'idle' (nothing edited yet — indicator stays hidden, per the task
// brief note that a builder shouting SAVING on every keystroke is worse
// than one that says nothing), 'saving', 'saved', 'error'.

let saveState = 'idle';
let saveErrorMessage = '';
let hasEverEdited = false;

/** path → value for a canvas text edit sent live (every keystroke) but not
 * yet confirmed by its debounced/blur {hb:'text'} commit. Cheap mirror only
 * — never written to draft.config directly. See edit-overlay.js and the
 * 'text-live' case in initPostMessageListener(). */
let pendingLiveEdits = {};

/** Count of in-flight async operations that must finish before the canvas
 * is fully "safe" (currently: image resize between file-pick and the
 * saveDraft() that follows it — picking a photo and closing the tab before
 * the resize finishes would otherwise drop the change with no warning). */
let pendingOpCount = 0;

/** False after localStorage.setItem throws (quota exceeded — a template
 * stuffed with several full-size photos) until the next successful write. */
let localSaveOk = true;

const SERVER_AUTOSAVE_DEBOUNCE_MS = 1200;
let serverSaveTimer = null;
let serverSaveInFlight = false;
let serverSaveQueuedAgain = false;

function setSaveState(state, message) {
  saveState = state;
  saveErrorMessage = message || '';
  renderSaveIndicator();
}

function renderSaveIndicator() {
  const el = $('save-status');
  const textEl = $('save-status-text');
  const retryBtn = $('btn-save-retry');
  if (!el || !textEl) return;
  if (saveState === 'idle') { hide(el); return; }
  show(el);
  el.dataset.state = saveState;
  el.title = saveState === 'error' ? saveErrorMessage : '';
  if (saveState === 'saving') textEl.textContent = 'Se salvează…';
  else if (saveState === 'saved') textEl.textContent = 'Salvat';
  else if (saveState === 'error') textEl.textContent = 'Nu s-a salvat';
  if (retryBtn) retryBtn.style.display = saveState === 'error' ? '' : 'none';
}

/** Called on every "live" keystroke mirror — cheap, only flips the visible
 * state to "saving" the first time (no flicker on every character). */
function noteEditingInProgress() {
  hasEverEdited = true;
  if (saveState !== 'saving') setSaveState('saving');
}

/**
 * Single settle point, called after ANY local persist attempt (saveDraft())
 * and after any pending async op (image resize) finishes. Idempotent and
 * safe to call redundantly — it just resolves the visible state from
 * whatever is currently true.
 */
function settleAfterLocalSave() {
  if (!localSaveOk) {
    setSaveState('error', saveErrorMessage ||
      'Proiectul are imagini mari — nu s-a putut salva ca ciornă. Publică înainte să închizi pagina.');
    return;
  }
  if (Object.keys(pendingLiveEdits).length > 0 || pendingOpCount > 0) {
    setSaveState('saving');
    return;
  }
  if (currentUser) {
    scheduleServerAutosave();
  } else {
    setSaveState('saved');
  }
}

/**
 * Start/end markers for an async operation that must complete before the
 * canvas is "safe" (image resize, FileReader) — see applySelectedImageFile
 * and openImagePickerForPath. Kept as their own functions (rather than
 * inlining pendingOpCount++/-- at each call site) so every call site only
 * needs ONE typeof-guarded reference instead of three, matching the
 * isolated-extraction test compatibility used throughout this file.
 */
function noteAsyncSaveOpStart() {
  pendingOpCount++;
  hasEverEdited = true;
  setSaveState('saving');
}
function noteAsyncSaveOpEnd() {
  pendingOpCount = Math.max(0, pendingOpCount - 1);
  settleAfterLocalSave();
}

/** Called from saveDraft() right after lsSet() — see its typeof-guarded call
 * site for why this indirection exists (isolated-extraction tests eval just
 * the saveDraft() source text without this function declared). */
function noteLocalSaveResult(ok) {
  hasEverEdited = true;
  localSaveOk = ok;
  settleAfterLocalSave();
}

/** Apply any canvas keystroke(s) still sitting in the live mirror straight
 * into draft.config + localStorage, synchronously. Called from the
 * beforeunload guard and from a page-hide fallback (mobile Safari/Chrome
 * often skip beforeunload on tab-close/backgrounding) so the debounce
 * window can never cost more than what is already safely in memory. */
function flushPendingLiveEdits() {
  const paths = Object.keys(pendingLiveEdits);
  if (!paths.length) return false;
  paths.forEach((path) => {
    const value = pendingLiveEdits[path];
    delete pendingLiveEdits[path];
    onInlineTextEdit(path, value);
  });
  return true;
}

/** True whenever leaving right now would cost the owner something they
 * cannot get back — the ONLY condition the beforeunload guard fires on, so
 * it never trains people to dismiss it (see task brief). */
function hasUnsavedChanges() {
  if (!draft.templateId || !draft.config) return false;
  if (Object.keys(pendingLiveEdits).length > 0) return true;
  if (pendingOpCount > 0) return true;
  if (!localSaveOk) return true;
  return saveState === 'error';
}

/**
 * Debounced server-side autosave for signed-in users (POST /api/draft — the
 * same endpoint already used before HTML/ZIP export, see downloadDraftHtml/
 * downloadDraftZip). Anonymous editing never reaches this: /api/draft
 * requires auth, and localStorage is already the anonymous safety net.
 */
function scheduleServerAutosave() {
  setSaveState('saving');
  if (serverSaveTimer) clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(runServerAutosave, SERVER_AUTOSAVE_DEBOUNCE_MS);
}

async function runServerAutosave() {
  serverSaveTimer = null;
  if (!currentUser || !draft.templateId || !draft.config) { setSaveState('saved'); return; }
  if (serverSaveInFlight) { serverSaveQueuedAgain = true; return; }
  serverSaveInFlight = true;
  const snapshotTemplateId = draft.templateId;
  const snapshotConfig = deepClone(draft.config);
  try {
    const saved = await apiPost('/api/draft', {
      siteId: currentSiteId || undefined,
      templateId: snapshotTemplateId,
      config: snapshotConfig,
    });
    serverSaveInFlight = false;
    if (saved && saved.site && saved.site.id) {
      currentSiteId = saved.site.id;
      currentSitePaid = !!saved.site.paid;
      if (saved.site.slug) currentSiteSlug = saved.site.slug;
    }
    if (serverSaveQueuedAgain || Object.keys(pendingLiveEdits).length > 0 || pendingOpCount > 0) {
      serverSaveQueuedAgain = false;
      scheduleServerAutosave();
    } else {
      setSaveState('saved');
    }
  } catch (e) {
    serverSaveInFlight = false;
    serverSaveQueuedAgain = false;
    let msg;
    if (e && e.status === 401) {
      msg = 'Sesiunea a expirat — reconectează-te ca să salvezi în cont. Proiectul rămâne aici, pe acest calculator.';
    } else if (e && e.fromServer && e.message) {
      msg = 'Nu s-a putut salva în cont: ' + e.message;
    } else {
      msg = 'Nu s-a putut salva în cont — verifică conexiunea la internet.';
    }
    setSaveState('error', msg);
  }
}

/** Wired to the retry button that appears next to the "Nu s-a salvat" state. */
function retrySave() {
  if (saveState !== 'error') return;
  if (!localSaveOk) {
    // Local (quota) failure — re-attempt the local write first; a real fix
    // (freeing space, publishing) is outside what this page can do alone.
    saveDraft();
    return;
  }
  runServerAutosave();
}

function initSaveGuard() {
  window.addEventListener('beforeunload', (e) => {
    flushPendingLiveEdits();
    if (!hasUnsavedChanges()) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });
  // Belt-and-suspenders: mobile Safari/Chrome frequently back-ground or kill
  // a tab without ever firing beforeunload. visibilitychange → 'hidden'
  // fires reliably in both cases, so flush there too (no dialog — just the
  // same synchronous local persist beforeunload above would have done).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingLiveEdits();
  });
  const retryBtn = $('btn-save-retry');
  if (retryBtn) retryBtn.addEventListener('click', retrySave);
}

// ---------------------------------------------------------------------------
// 7e. Recovery banner — offer an interrupted local draft back (Wave 9)
// ---------------------------------------------------------------------------
//
// #edit already auto-resumes the local draft the instant it opens
// (resumeLocalDraft, wired into handleRoute) — a plain reload of #edit was
// never the problem. The gap was returning some OTHER way after a crash or
// an accidental close: templates screen, dashboard, a fresh tab. This banner
// only ever shows there, and only when the localStorage draft is NOT the one
// already loaded in this tab (i.e. genuinely left over from before), so it
// can never appear alongside — or contradict — the multi-tab conflict
// banner, which is #edit-only.

let recoveryBannerDismissedThisSession = false;

function showRecoveryBanner() {
  const banner = $('recovery-banner');
  if (banner) { banner.style.display = ''; banner.setAttribute('aria-hidden', 'false'); }
}

function hideRecoveryBanner() {
  const banner = $('recovery-banner');
  if (banner) { banner.style.display = 'none'; banner.setAttribute('aria-hidden', 'true'); }
}

/** The draft a design switch replaced, if it is still worth offering back. */
function loadReplacedDraft() {
  const r = lsGet(REPLACED_DRAFT_KEY);
  if (!r || !r.templateId || !r.config) return null;
  // A week is long enough to cover "I'll come back to it tomorrow" and short
  // enough that we are not offering someone a draft they have forgotten.
  if (r.replacedAt && (Date.now() - r.replacedAt) > 7 * 24 * 60 * 60 * 1000) return null;
  return r;
}

function maybeShowRecoveryBanner() {
  if (recoveryBannerDismissedThisSession) { hideRecoveryBanner(); return; }
  // An interrupted draft comes first; a design the owner deliberately moved on
  // from is the weaker claim on their attention, so it is only offered when
  // there is nothing more recent to resume.
  const saved = loadDraft() || loadReplacedDraft();
  if (!saved || !saved.templateId || !saved.config) { hideRecoveryBanner(); return; }
  // Already the draft loaded in this tab — not "interrupted", just navigation.
  if (draft.templateId && draft.templateId === saved.templateId) { hideRecoveryBanner(); return; }
  const nameEl = $('recovery-banner-name');
  if (nameEl) {
    const registry = (typeof getTemplateList === 'function' && getTemplateList()) || [];
    const meta = registry.find(t => t.id === saved.templateId);
    nameEl.textContent = meta && meta.name ? (': ' + meta.name) : '';
  }
  showRecoveryBanner();
}

/** "Renunță" — the owner explicitly does not want the leftover draft back.
 * Only clears the local scratch copy; a paid/created site (siteId bound) is
 * never touched here and stays reachable from "Proiectele mele". */
function discardLocalDraft() {
  recoveryBannerDismissedThisSession = true;
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* ignore */ }
  try { localStorage.removeItem(REPLACED_DRAFT_KEY); } catch (_) { /* ignore */ }
  hideRecoveryBanner();
}

function initRecoveryBanner() {
  const resumeBtn = $('btn-recovery-resume');
  const discardBtn = $('btn-recovery-discard');
  if (resumeBtn) resumeBtn.addEventListener('click', () => {
    // #edit resumes from DRAFT_KEY. When the banner is offering a draft that a
    // design switch replaced, that slot holds the NEWER draft, so it has to be
    // promoted first -- otherwise the button offers one thing and delivers
    // another, which is worse than not offering it at all.
    if (!loadDraft()) {
      const replaced = loadReplacedDraft();
      if (replaced) {
        lsSet(DRAFT_KEY, {
          templateId: replaced.templateId,
          config: replaced.config,
          siteId: replaced.siteId || null,
        });
        try { localStorage.removeItem(REPLACED_DRAFT_KEY); } catch (_) { /* ignore */ }
      }
    }
    window.location.hash = '#edit';
  });
  if (discardBtn) discardBtn.addEventListener('click', discardLocalDraft);
}

// ---------------------------------------------------------------------------
// 8. Iframe / preview rendering
// ---------------------------------------------------------------------------

function getPreviewIframe() { return $('preview-iframe'); }

// Edit overlay script injected into srcdoc for inline editing.
// Runs INSIDE the sandboxed iframe. Communication only via postMessage('*').
// Uses data-hb attributes when present.
// IMPORTANT: this string must be valid JS when injected into a <script> tag.
var EDIT_OVERLAY_SCRIPT = [
  '(function(){',
  '"use strict";',
  'var _config=null;',
  'function send(msg){window.parent.postMessage(msg,"*");}',
  'function debounce(fn,ms){var t;return function(){clearTimeout(t);t=setTimeout(function(){fn.apply(null,[].slice.call(arguments));},ms,[].slice.call(arguments)[0]);};}',
  'window.addEventListener("message",function(e){',
  '  if(e.source!==window.parent)return;',
  '  var msg=e.data;if(!msg||typeof msg!=="object")return;',
  '  if(msg.hb==="set"&&msg.path){',
  '    document.querySelectorAll("[data-hb]").forEach(function(el){',
  '      if(el.dataset.hb!==msg.path)return;',
  '      if(document.activeElement===el)return;',
  '      if(el.tagName.toLowerCase()!=="img")el.textContent=msg.value||"";',
  '    });',
  '  }',
  '  if(msg.hb==="highlight"&&msg.path){',
  '    document.querySelectorAll("[data-hb]").forEach(function(el){',
  '      if(el.dataset.hb!==msg.path)return;',
  '      el.style.outline="3px solid #1E3A32";',
  '      el.style.outlineOffset="3px";',
  '      el.scrollIntoView({behavior:"smooth",block:"center"});',
  '      setTimeout(function(){el.style.outline="";el.style.outlineOffset="";},2500);',
  '    });',
  '  }',
  '  if(msg.hb==="config-sync"){_config=msg.config;}',
  '});',
  'function makeEditable(el,path){',
  '  if(el.dataset.hbInit)return;el.dataset.hbInit="1";',
  '  el.contentEditable="true";',
  '  el.setAttribute("spellcheck","false");',
  '  el.style.cursor="text";el.style.outline="none";el.style.minWidth="1em";',
  '  el.addEventListener("keydown",function(e){if(e.key==="Enter")e.preventDefault();});',
  '  el.addEventListener("focus",function(){',
  '    el.style.boxShadow="0 0 0 2px #1E3A32,0 0 0 5px rgba(30,58,50,.16)";',
  '    el.style.borderRadius="3px";el.style.zIndex="10";',
  '    send({hb:"focus",path:path});',
  '  });',
  '  el.addEventListener("blur",function(){',
  '    el.style.boxShadow="";el.style.borderRadius="";el.style.zIndex="";',
  '    send({hb:"text",path:path,value:el.textContent.trim()});',
  '  });',
  '  el.addEventListener("input",debounce(function(ev){',
  '    send({hb:"text",path:path,value:el.textContent.trim()});',
  '  },300));',
  '}',
  'function makeImageClickable(el,path){',
  '  if(el.dataset.hbInit)return;el.dataset.hbInit="1";',
  '  el.style.cursor="pointer";',
  '  el.title="Click to replace the image";',
  '  var par=el.parentElement;',
  '  if(par&&window.getComputedStyle(par).position==="static")par.style.position="relative";',
  '  var ov=document.createElement("div");',
  '  ov.style.position="absolute";ov.style.top="0";ov.style.left="0";',
  '  ov.style.width="100%";ov.style.height="100%";ov.style.display="none";',
  '  ov.style.alignItems="center";ov.style.justifyContent="center";',
  '  ov.style.background="rgba(0,0,0,.42)";ov.style.color="#fff";',
  '  ov.style.fontSize="13px";ov.style.fontWeight="600";ov.style.fontFamily="system-ui";',
  '  ov.style.cursor="pointer";ov.style.borderRadius="inherit";',
  '  ov.style.pointerEvents="auto";ov.style.zIndex="5";',
  '  var sp=document.createElement("span");',
  '  sp.textContent="Înlocuiește fotografia";',
  '  sp.style.background="rgba(0,0,0,.5)";sp.style.padding="4px 10px";sp.style.borderRadius="6px";',
  '  ov.appendChild(sp);',
  '  par&&par.appendChild(ov);',
  '  function showOv(){ov.style.display="flex";}',
  '  function hideOv(){ov.style.display="none";}',
  '  el.addEventListener("mouseenter",showOv);el.addEventListener("mouseleave",hideOv);',
  '  ov.addEventListener("mouseenter",showOv);ov.addEventListener("mouseleave",hideOv);',
  '  function doClick(e){e.preventDefault();e.stopPropagation();send({hb:"image",path:path});}',
  '  el.addEventListener("click",doClick);ov.addEventListener("click",doClick);',
  '}',
  'function initListControls(){',
  '  document.querySelectorAll("[data-hb-list]").forEach(function(el){',
  '    if(el.dataset.hbListInit)return;el.dataset.hbListInit="1";',
  '    var lp=el.dataset.hbList;',
  '    var btn=document.createElement("button");',
  '    btn.type="button";btn.textContent="+ Adaugă articol";',
  '    btn.style.marginTop="8px";btn.style.padding="5px 10px";btn.style.fontSize="12px";',
  '    btn.style.fontFamily="system-ui";btn.style.background="#14120F";btn.style.color="#FFFcf7";',
  '    btn.style.border="none";btn.style.borderRadius="8px";btn.style.cursor="pointer";btn.style.display="block";',
  '    btn.addEventListener("click",function(){send({hb:"list-add",listPath:lp});});',
  '    el.after(btn);',
  '  });',
  '  document.querySelectorAll("[data-hb-remove]").forEach(function(el){',
  '    if(el.dataset.hbRemoveInit)return;el.dataset.hbRemoveInit="1";',
  '    var ip=el.dataset.hbRemove;el.style.cursor="pointer";',
  '    el.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();send({hb:"list-remove",path:ip});});',
  '  });',
  '}',
  'function init(){',
  '  document.querySelectorAll("[data-hb]").forEach(function(el){',
  '    var path=el.dataset.hb;if(!path)return;',
  '    if(el.tagName.toLowerCase()==="img")makeImageClickable(el,path);',
  '    else makeEditable(el,path);',
  '  });',
  '  initListControls();',
  '  send({hb:"ready"});',
  '}',
  'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",init);}',
  'else{init();}',
  '})();'
].join('\n');

// Inject data-hb attributes into rendered HTML by matching config values.
// For each TEXT config value, we wrap the first occurrence in an inline element
// with data-hb="path" so the overlay can make it contenteditable.
// For image src values, we inject data-hb on the <img> tag.
function injectDataHb(html, config) {
  // Build a flat map of path → value for all string/number values
  const pathMap = []; // [{path, value}]
  function walk(obj, prefix) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, prefix + '.' + i));
      return;
    }
    Object.entries(obj).forEach(([k, v]) => {
      const full = prefix ? prefix + '.' + k : k;
      if (typeof v === 'string' && v.length > 0) {
        pathMap.push({ path: full, value: v });
      } else if (typeof v === 'object' && v !== null) {
        walk(v, full);
      }
    });
  }
  walk(config, '');

  // Sort by value length descending (replace longer matches first to avoid partial overlaps)
  pathMap.sort((a, b) => b.value.length - a.value.length);

  let result = html;
  const processed = new Set(); // avoid double-processing same path

  for (const { path, value } of pathMap) {
    if (processed.has(path)) continue;
    // Skip data URIs, URLs, SVG paths, and short values that cause false matches
    if (value.startsWith('data:') || value.startsWith('http') || value.startsWith('#') ||
        value.startsWith('<') || value.includes(';base64') || value.length < 3 ||
        /^\d+$/.test(value) || value.startsWith('images/') || path.includes('jsonLd') ||
        path.includes('seo.') || path.includes('background') || path.includes('gradient')) {
      // For image src values: inject data-hb on img
      if (value.startsWith('data:image') || value.startsWith('images/')) {
        const imgRe = new RegExp('<img([^>]*?)\\ssrc=["\']' + escapeRegex(value) + '["\']', 'i');
        if (!result.match(imgRe)) continue;
        result = result.replace(imgRe, (m, attrs) => {
          if (attrs.includes('data-hb=')) return m;
          return '<img' + attrs + ' src="' + value + '" data-hb="' + path + '"';
        });
        processed.add(path);
      }
      continue;
    }
    // For text values: find the exact text in an element and wrap it with a span if not already tagged
    // Strategy: look for >EXACTVALUE< or >...EXACTVALUE...< patterns in non-script/style contexts
    const esc = escHtmlForAttr(value);
    // Try to find in text content
    const pattern = new RegExp('(>[^<]*?)(' + escapeRegex(esc) + ')([^<]*?<)', 'g');
    let injected = false;
    result = result.replace(pattern, (full, pre, match, post) => {
      if (injected) return full; // only first occurrence
      injected = true;
      // Check if we're in a script or style tag — we'll skip those
      return pre + '<span data-hb="' + path + '">' + match + '</span>' + post;
    });
    if (injected) processed.add(path);
  }

  return result;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escHtmlForAttr(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function buildSrcdoc() {
  if (!draft.config || !draft.templateId) return '';
  deriveWaHref(draft.config);
  let tpl = null;
  if (currentTemplate && currentTemplate.data && currentTemplate.meta &&
      currentTemplate.meta.id === draft.templateId) {
    tpl = currentTemplate.data;
  }
  if (!tpl) tpl = getTemplateById(draft.templateId);
  if (!tpl || !tpl.files || typeof window.HidookEngine === 'undefined') return '';
  try {
    // Pass editMode:true so renderHtml emits data-hb-edit attributes and
    // renderPreview injects the modern edit-overlay.js (bundled in engine.js).
    let html = window.HidookEngine.renderPreview(tpl.files, draft.config, { editMode: true });
    return html;
  } catch (e) {
    console.warn('buildSrcdoc error:', e);
    return '<body style="font-family:system-ui;padding:2rem;color:#9CA3AF">Render error: ' + escHtml(e.message) + '</body>';
  }
}

function showPreviewSpinner(vis) {
  const el = $('preview-spinner-overlay');
  if (el) el.style.display = vis ? '' : 'none';
}

let editorPreviewGeneration = 0;
let clearEditorPreviewReadyListener = null;

// Is a srcdoc navigation currently loading in the preview iframe? Full
// re-renders are serialized against this instead of firing srcdoc a second
// time before the previous navigation settles (PORT-05: a re-render started
// while another is still loading — e.g. a color change fired right after an
// image change whose base64 embed makes buildSrcdoc() slower — can abandon
// the in-flight navigation mid-flight and leave the iframe visually stuck on
// stale pixels even though the newer document's computed styles are already
// correct). A render requested while one is in flight is queued via
// `pendingRender` and replayed — reading draft.config fresh at that point,
// so no edit is ever lost — once the current one settles.
let renderInFlight = false;
let renderInFlightSafetyTimer = null;

function prepareInteractivePreviewDocument(documentHtml, readyToken, cookieAccepted) {
  // The preview is only ready once generated consent is bound and the first
  // animation-forcer pass has completed. This applies equally to catalog and
  // editor srcdoc documents.
  //
  // `cookieAccepted` (optional): when true, the visitor already dismissed the
  // cookie banner earlier in this session (see previewCookieAccepted). The
  // sandboxed srcdoc iframe has no allow-same-origin, so the template's own
  // localStorage/cookie persistence silently no-ops on every fresh document —
  // without this replay the banner would flash back on every full re-render
  // (F1). We also forward the accept click to the parent (independent of the
  // template's own window.__hbCookieAccept binding) so the NEXT re-render
  // knows to keep it hidden.
  const readyScript = '<script data-hb-preview-ready>(function(){var token=' +
    JSON.stringify(readyToken) +
    ';var accepted=' + JSON.stringify(!!cookieAccepted) + ';' +
    'var sent=false;var send=function(){if(sent)return;sent=true;try{parent.postMessage({type:"hb-preview-ready",token:token},"*");}catch(e){}};' +
    'document.addEventListener("click",function(e){var t=e.target;var target=t&&t.closest?t.closest("#hb-cookie-accept"):null;if(target){try{parent.postMessage({hb:"cookie-accept"},"*");}catch(e2){}}},true);' +
    'var ensureConsent=function(){var el=document.getElementById("hb-cookie-banner");var btn=document.getElementById("hb-cookie-accept");' +
    'if(!el||!btn)return true;' +
    'if(accepted){try{el.hidden=true;el.setAttribute("hidden","");el.setAttribute("data-hb-consent-dismissed","true");el.setAttribute("data-hb-consent-ready","true");}catch(e){}return true;}' +
    'if(typeof window.__hbCookieAccept==="function"){try{if(btn.getAttribute("data-hb-bound")!=="1"){btn.setAttribute("data-hb-bound","1");btn._hbBound=true;btn.addEventListener("pointerdown",window.__hbCookieAccept);btn.addEventListener("click",window.__hbCookieAccept);btn.onclick=window.__hbCookieAccept;}if(el.hidden){el.hidden=false;try{el.removeAttribute("hidden");}catch(e){}}el.setAttribute("data-hb-consent-ready","true");}catch(e){}return true;}' +
    'return el.getAttribute("data-hb-consent-ready")==="true";};' +
    'var readyToSend=function(){return ensureConsent()&&document.documentElement.getAttribute("data-hb-forcer-done")==="1";};' +
    'var finish=function(){if(readyToSend()){requestAnimationFrame(function(){requestAnimationFrame(send);});return true;}return false;};' +
    'var arm=function(){if(finish())return;var n=0;var t=setInterval(function(){n++;if(finish()||n>80){clearInterval(t);if(!sent)requestAnimationFrame(function(){requestAnimationFrame(send);});}},25);};' +
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",arm,{once:true});else arm();})();</script>';
  const closeBodyAt = documentHtml.toLowerCase().lastIndexOf('</body>');
  if (closeBodyAt === -1) return documentHtml + readyScript;
  return documentHtml.slice(0, closeBodyAt) + readyScript + documentHtml.slice(closeBodyAt);
}

function waitForInteractivePreview(target, readyToken, onSettled) {
  target.setAttribute('aria-busy', 'true');
  target.dataset.previewReady = 'false';
  target.classList.add('preview-iframe--loading');
  let cancelled = false;
  const onReady = (event) => {
    if (event.source !== target.contentWindow || !event.data ||
        event.data.type !== 'hb-preview-ready' || event.data.token !== readyToken) return;
    window.removeEventListener('message', onReady);
    // Commit hit testing before exposing the ready contract. Otherwise a
    // trusted first click can still land while pointer-events is provisional.
    target.classList.remove('preview-iframe--loading');
    try { void target.offsetWidth; } catch (e) { /* ignore */ }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled || target.getAttribute('aria-busy') !== 'true') return;
        target.setAttribute('aria-busy', 'false');
        target.dataset.previewReady = 'true';
        if (typeof onSettled === 'function') onSettled();
      });
    });
  };
  const clear = () => {
    cancelled = true;
    window.removeEventListener('message', onReady);
  };
  window.addEventListener('message', onReady);
  return clear;
}

// Full re-render: new srcdoc. Called for: initial load, image change, list add/remove, color change.
function fullRerender() {
  if (!draft.config || !draft.templateId) return;
  if (renderInFlight) {
    pendingRender = true;
    return;
  }
  renderInFlight = true;
  pendingRender = false;
  iframeReady = false;

  if (previewSpinTimer) clearTimeout(previewSpinTimer);
  previewSpinTimer = setTimeout(() => showPreviewSpinner(true), 200);

  const readyToken = 'hb-editor-preview-ready-' + (++editorPreviewGeneration);
  const html = prepareInteractivePreviewDocument(buildSrcdoc(), readyToken, previewCookieAccepted);
  const iframe = getPreviewIframe();
  if (!iframe) { renderInFlight = false; return; }

  let settled = false;
  const settleRender = () => {
    if (settled) return;
    settled = true;
    if (renderInFlightSafetyTimer) { clearTimeout(renderInFlightSafetyTimer); renderInFlightSafetyTimer = null; }
    renderInFlight = false;
    if (pendingRender) { pendingRender = false; fullRerender(); }
  };
  // Safety net: a missing/late ready message (render error, etc.) must never
  // permanently wedge future edits behind a render that will never settle.
  renderInFlightSafetyTimer = setTimeout(settleRender, 4000);

  if (clearEditorPreviewReadyListener) clearEditorPreviewReadyListener();
  clearEditorPreviewReadyListener = waitForInteractivePreview(iframe, readyToken, settleRender);
  iframe.srcdoc = html;

  if (!previewFirstRender) {
    previewFirstRender = true;
    const skel = $('preview-skeleton');
    if (skel) skel.classList.add('hidden');
  }
}

// Debounce re-render (used after initial load)
function scheduleRerender(immediate) {
  if (previewTimer) clearTimeout(previewTimer);
  if (immediate) { fullRerender(); return; }
  previewTimer = setTimeout(fullRerender, 280);
}

// Send a chirurgical set to the iframe without re-rendering
function sendSetToIframe(path, value) {
  const iframe = getPreviewIframe();
  if (!iframe || !iframeReady) return;
  iframe.contentWindow.postMessage({ hb: 'set', path, value }, '*');
}

// Send highlight message to iframe
function sendHighlightToIframe(path) {
  const iframe = getPreviewIframe();
  if (!iframe || !iframeReady) return;
  iframe.contentWindow.postMessage({ hb: 'highlight', path }, '*');
}

/** Same flash-and-scroll as sendHighlightToIframe(), plus a request to take
 * keyboard focus when the target is a real editable text field (a canvas
 * field the checklist "what's missing" menu points at — see
 * goToChecklistField() below). A plain highlight-only caller (e.g.
 * openPublishModal()'s missing-field nudge) keeps the old behaviour. */
function sendFocusFieldToIframe(path) {
  const iframe = getPreviewIframe();
  if (!iframe || !iframeReady) return;
  iframe.contentWindow.postMessage({ hb: 'highlight', path, focus: true }, '*');
}

// Send imgmap after re-render (to inject images into srcdoc)
function sendImgMap() {
  // Not needed here since images are embedded as dataURLs in config
  // but we keep the protocol slot for future use
}

// ---------------------------------------------------------------------------
// 9. postMessage listener — parent listens to overlay messages
// ---------------------------------------------------------------------------

function initPostMessageListener() {
  window.addEventListener('message', (event) => {
    const iframe = getPreviewIframe();
    // Security: only accept from our iframe (origin is "null" for sandboxed srcdoc)
    if (!iframe || event.source !== iframe.contentWindow) return;

    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.hb == null) return;

    switch (msg.hb) {
      case 'ready':
        onIframeReady();
        break;
      case 'text':
        // The committed edit is about to land — clear the in-memory safety
        // net FIRST (see 'text-live' below and flushPendingLiveEdits()), so
        // that onInlineTextEdit()'s own saveDraft() call sees an accurate
        // "nothing left pending" state when it settles the save indicator —
        // otherwise it would see this exact edit still marked pending and
        // stay on "saving" forever after the very edit it was waiting for.
        // Guarded: a newer keystroke may have arrived after this debounced
        // message was queued but before it was processed — leave that one
        // in place for the next flush instead of dropping it.
        if (msg.path && pendingLiveEdits[msg.path] === msg.value) delete pendingLiveEdits[msg.path];
        onInlineTextEdit(msg.path, msg.value);
        break;
      case 'text-live':
        // Wave 9 (save-state audit): undebounced mirror of an in-progress
        // canvas text edit. Never applied to draft.config directly — that
        // stays the job of the debounced/blur {hb:'text'} commit below —
        // just kept in memory so a reload/close DURING the 300ms debounce
        // window can still recover the latest keystroke via
        // flushPendingLiveEdits() instead of silently losing it.
        if (msg.path) {
          pendingLiveEdits[msg.path] = msg.value;
          noteEditingInProgress();
        }
        break;
      case 'image':
        onImageChangeRequest(msg.path, msg.src, msg.alt);
        break;
      case 'image-file':
        applySelectedImageFile(msg.file, msg.path, msg.src, msg.alt);
        break;
      case 'list-add':
        onListAdd(msg.listPath);
        break;
      case 'list-remove':
        onListRemove(msg.path);
        break;
      case 'focus':
        // Could highlight field in drawer — skip for now
        break;
      case 'cookie-accept':
        // F1: remember consent across full re-renders (see previewCookieAccepted).
        previewCookieAccepted = true;
        break;
      case 'undo':
      case 'redo':
        // Ctrl+Z/Ctrl+Shift+Z pressed while focus is inside a contenteditable
        // canvas field — the iframe forwards it here instead of letting the
        // browser's native per-field text undo run (see edit-overlay.js), so
        // it hits the same app-level history as every other mutation.
        // `msg.flush` (optional) carries a still-in-flight debounced edit for
        // the focused field — apply it (and let it push its own history step)
        // BEFORE undo()/redo(), all within this one synchronous handler, so
        // there is no separate message whose delivery order could be in doubt.
        if (msg.flush && msg.flush.path) onInlineTextEdit(msg.flush.path, msg.flush.value);
        if (msg.hb === 'undo') undo(); else redo();
        break;
    }
  });
}

function buildImgMap(config) {
  // Build a src→path reverse-lookup map for all image values in config.
  // Used by the modern edit-overlay.js to resolve {hb:'image', path} on img clicks.
  // Also maps url(...) fragments inside CSS backgrounds (hero.background).
  // Must not split data:image/jpeg;base64,... on ';' or ')' incorrectly.
  const map = {};
  function indexUrl(full, u) {
    if (!u || typeof u !== 'string') return;
    const t = u.trim();
    if (!t) return;
    if (t.startsWith('data:image') || t.startsWith('images/') || t.startsWith('http') || t.startsWith('/')) {
      map[t] = full;
    }
  }
  function extractCssUrls(styleVal) {
    const style = String(styleVal || '');
    const urls = [];
    const re = /url\s*\(\s*/gi;
    let m;
    while ((m = re.exec(style))) {
      let i = m.index + m[0].length;
      if (i >= style.length) break;
      const ch = style.charAt(i);
      let raw;
      if (ch === '"' || ch === "'") {
        const endQ = style.indexOf(ch, i + 1);
        if (endQ < 0) break;
        raw = style.slice(i + 1, endQ);
        re.lastIndex = endQ + 1;
      } else {
        const endP = style.indexOf(')', i);
        if (endP < 0) break;
        raw = style.slice(i, endP).replace(/^\s+|\s+$/g, '');
        re.lastIndex = endP + 1;
      }
      if (raw) urls.push(raw);
    }
    return urls;
  }
  function walk(obj, prefix) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, prefix + '.' + i));
      return;
    }
    Object.entries(obj).forEach(([k, v]) => {
      const full = prefix ? prefix + '.' + k : k;
      if (typeof v === 'string' && v.length > 0) {
        indexUrl(full, v);
        // CSS multi-layer backgrounds: linear-gradient(...), url('images/hero.jpg')
        // and url('data:image/jpeg;base64,...') — full data URL, no semicolon split
        if (/url\s*\(/i.test(v)) {
          extractCssUrls(v).forEach((u) => indexUrl(full, u));
        }
      } else if (typeof v === 'object' && v !== null) {
        walk(v, full);
      }
    });
  }
  walk(config, '');
  return map;
}

/**
 * Preview renderPreview inlines images/* → data: URLs in srcdoc.
 * Merge those data URLs onto the same config paths so overlay resolveImgPath works.
 */
function mergePreviewImageMap(map, imageMap) {
  const out = map && typeof map === 'object' ? Object.assign({}, map) : {};
  if (!imageMap || typeof imageMap !== 'object') return out;
  Object.keys(imageMap).forEach((rel) => {
    const dataUrl = imageMap[rel];
    if (!rel || !dataUrl) return;
    const path = out[rel] || out['images/' + rel.replace(/^images\//, '')];
    if (path) {
      out[dataUrl] = path;
      // Also key without images/ prefix variants
      if (rel.indexOf('images/') === 0 && out[rel]) out[dataUrl] = out[rel];
    } else if (out[rel]) {
      out[dataUrl] = out[rel];
    }
    // If config mapped images/foo.jpg, reverse-map the inlined data URL
    const withPrefix = rel.indexOf('images/') === 0 ? rel : 'images/' + rel;
    if (out[withPrefix]) out[dataUrl] = out[withPrefix];
    if (out[rel]) out[dataUrl] = out[rel];
  });
  return out;
}

function onIframeReady() {
  iframeReady = true;
  clearTimeout(previewSpinTimer);
  showPreviewSpinner(false);
  // Send imgmap to modern overlay so image src→config-path resolution works.
  const iframe = getPreviewIframe();
  if (iframe && draft.config) {
    let map = buildImgMap(draft.config);
    const tpl = draft.templateId ? getTemplateById(draft.templateId) : null;
    const imageMap = tpl && tpl.files && tpl.files.imageMap;
    if (imageMap) map = mergePreviewImageMap(map, imageMap);
    iframe.contentWindow.postMessage({ hb: 'imgmap', map }, '*');
  }
  // Fresh srcdoc = fresh DOM = the overlay's own demo-photo scan already ran
  // during mount(), but the identity-text marks need this explicit push
  // (see scheduleDemoTextMarks()'s doc comment for why this is debounced off
  // the 'ready' handler's own synchronous call stack).
  scheduleDemoTextMarks();
}

function onInlineTextEdit(path, value) {
  if (!path) return;
  let prevName = null;
  if (path === 'business.name' && draft.config) {
    prevName = getPath(draft.config, 'business.name');
  }
  setPath(draft.config, path, value);
  // Coalesce a burst of debounced keystrokes into ONE undo step (see saveDraft/pushHistory).
  pendingHistoryCoalesceKey = 'text:' + path;
  if (path === 'business.name' && prevName != null) {
    cascadeBusinessNameIdentity(draft.config, prevName, value);
    // Re-render so about + social chips pick up cascaded identity immediately
    scheduleRerender(true);
    // Keep drawer fields for cascaded identity in sync when open
    [
      'business.title',
      'business.about',
      'contact.facebook.label',
      'contact.facebook.url',
      'contact.instagram.url',
      'contact.instagram.label',
      'instagram.handle',
      'instagram.url',
      'instagram.embedUrl',
      'contact.email',
    ].forEach((p) => syncDrawerField(p, getPath(draft.config, p)));
  }
  saveDraft();
  updateChecklist();
  // Update drawer field if open
  syncDrawerField(path, value);
  // No re-render for ordinary text — already visible in contenteditable
}

function resolveImagePathFromSrc(src) {
  const value = String(src || '').trim();
  if (!value || !draft.config) return '';
  let map = buildImgMap(draft.config);
  const tpl = draft.templateId ? getTemplateById(draft.templateId) : null;
  const imageMap = tpl && tpl.files && tpl.files.imageMap;
  if (imageMap) map = mergePreviewImageMap(map, imageMap);
  if (map[value]) return map[value];
  const keys = Object.keys(map);
  for (const key of keys) {
    if (key && (value.endsWith(key) || key.endsWith(value))) return map[key];
  }
  return '';
}

function resolveImagePathFromAlt(alt) {
  const value = String(alt || '').trim();
  if (!value || !draft.config) return '';
  const matches = [];
  function walk(item, prefix) {
    if (!item || typeof item !== 'object') return;
    if (!Array.isArray(item) && String(item.alt || '').trim() === value && typeof item.src === 'string') {
      matches.push(prefix ? prefix + '.src' : 'src');
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => walk(child, prefix ? prefix + '.' + index : String(index)));
      return;
    }
    Object.entries(item).forEach(([key, child]) => {
      if (child && typeof child === 'object') walk(child, prefix ? prefix + '.' + key : key);
    });
  }
  walk(draft.config, '');
  return matches.length === 1 ? matches[0] : '';
}

function onImageChangeRequest(path, src, alt) {
  if (!path) path = resolveImagePathFromSrc(src);
  if (!path) path = resolveImagePathFromAlt(alt);
  pendingImagePath = path;
  const fileInput = $('img-file-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

/**
 * Romanian, vertical-aware default text for the primary field of a newly added
 * list item. A new item seeded with '' renders as a blank card the customer can
 * neither read nor (on some templates) delete, and templates that guard fields
 * with `<!-- @if title -->` render no editable node at all, so the inline editor
 * has nothing to attach to. Seeding the primary field keeps every new item
 * visible, editable and deletable, and carries the text into draft.config so it
 * survives preview, publish and export.
 */
function defaultListItemLabel(listPath) {
  const p = String(listPath || '');
  if (/^menu\.en/.test(p)) return 'New category';
  if (/^menu\.ro/.test(p)) return 'Categorie nouă';
  if (/categories$/.test(p)) {
    // Vertical-specific wording, mirroring the labels edit-overlay.js already
    // picks from DOM context (pm-catblock / pf-series). Both paths can seed the
    // same list -- the shared overlay and a template's own controls -- so they
    // have to agree, or the text a customer sees depends on which one ran.
    const catId = (currentTemplate && currentTemplate.meta && currentTemplate.meta.id)
      || (draft && draft.templateId);
    if (catId === 'product-menu') return 'Categorie foto nouă';
    if (catId === 'portfolio' || catId === 'local-service') return 'Categorie de lucrări nouă';
    return 'Categorie nouă';
  }
  if (/^services$/.test(p)) {
    const id = (currentTemplate && currentTemplate.meta && currentTemplate.meta.id)
      || (currentTemplate && currentTemplate.data && currentTemplate.data.schema
          && currentTemplate.data.schema.templateId)
      || (draft && draft.templateId);
    return id === 'product-menu' ? 'Specialitate nouă' : 'Serviciu nou';
  }
  if (/^pricing$/.test(p)) return 'Serviciu nou';
  if (/^trust$/.test(p)) return 'Punct forte nou';
  if (/^certifications$/.test(p)) return 'Certificare nouă';
  if (/^schedule\.rows$/.test(p)) return 'Zi nouă';
  if (/^team\.members$/.test(p)) return 'Nume și prenume';
  if (/^process\.steps$/.test(p)) return 'Pas nou';
  if (/^credentials\.items$/.test(p)) return 'Calificare nouă';
  if (/^faq\.items$/.test(p)) return 'Întrebare nouă';
  return 'Titlu nou';
}

/** Pick the field of an itemShape that renders as the item's visible headline. */
function primaryItemShapeKey(itemShape) {
  const keys = Object.keys(itemShape || {}).filter(k => itemShape[k] === 'text');
  if (!keys.length) return null;
  const preferred = ['label', 'title', 'name', 'category', 'q', 'day', 'weekday'];
  for (const want of preferred) if (keys.includes(want)) return want;
  return keys[0];
}

function onListAdd(listPath) {
  if (!listPath) return;
  const tpl = currentTemplate && currentTemplate.data;
  const schema = tpl && tpl.schema;
  // Find field definition for itemShape.
  // Most templates' schema.json declare this as "itemShape", but at least one
  // (desserdirina) spells it "itemSchema" — accept either key so the item
  // built below always matches the field's real sub-shape (e.g. {title,
  // blurb, photos:[]}) instead of silently falling through to a bare ''
  // placeholder that desyncs the list from the edit-overlay's DOM tracking
  // (DSD-02: an add+remove on such a list corrupts/removes the WRONG item).
  let itemShape = null;
  if (schema) {
    getAllSchemaFields(schema).forEach(f => {
      if (f.key === listPath && f.type === 'list') {
        itemShape = f.itemShape !== undefined ? f.itemShape : f.itemSchema;
      }
    });
  }
  const arr = Array.isArray(getPath(draft.config, listPath))
    ? getPath(draft.config, listPath).slice()
    : [];
  let newItem;
  // Restaurant menu: menu.en / menu.ro are section lists; *.items are string dishes
  if (/^menu\.(en|ro)$/.test(listPath)) {
    if (!draft.config.menu || typeof draft.config.menu !== 'object') {
      draft.config.menu = { title: 'Menu', en: [], ro: [] };
    }
    if (!Array.isArray(draft.config.menu.en)) draft.config.menu.en = [];
    if (!Array.isArray(draft.config.menu.ro)) draft.config.menu.ro = [];
    // menu.en is the English half of a bilingual menu, so English defaults are
    // correct there; only the Romanian half gets Romanian seeds.
    newItem = /^menu\.en$/.test(listPath)
      ? { category: 'New section', items: ['New item'] }
      : { category: 'Categorie nouă', items: ['Preparat nou'] };
  } else if (/^menu\.(en|ro)\.\d+\.items$/.test(listPath)) {
    newItem = /^menu\.en\./.test(listPath) ? 'New item' : 'Preparat nou';
  } else if (typeof itemShape === 'string') {
    newItem = itemShape === 'photos' ? [] : defaultListItemLabel(listPath);
  } else if (typeof itemShape === 'object' && itemShape !== null) {
    newItem = {};
    const primaryKey = primaryItemShapeKey(itemShape);
    Object.keys(itemShape).forEach(k => {
      if (itemShape[k] === 'photos') newItem[k] = [];
      else if (itemShape[k] === 'list' || k === 'items') newItem[k] = [''];
      else if (k === primaryKey) newItem[k] = defaultListItemLabel(listPath);
      else newItem[k] = '';
    });
  } else {
    newItem = '';
  }
  arr.push(newItem);
  setPath(draft.config, listPath, arr);
  // Keep bilingual restaurant menus in sync when adding a section on one language
  const mLang = /^menu\.(en|ro)$/.exec(listPath);
  if (mLang && draft.config && draft.config.menu) {
    const other = mLang[1] === 'en' ? 'ro' : 'en';
    const otherPath = 'menu.' + other;
    const otherArr = Array.isArray(getPath(draft.config, otherPath))
      ? getPath(draft.config, otherPath).slice()
      : [];
    if (otherArr.length === arr.length - 1) {
      otherArr.push(JSON.parse(JSON.stringify(newItem)));
      setPath(draft.config, otherPath, otherArr);
    }
  }
  saveDraft();
  fullRerender();
}

function onListRemove(path) {
  // path like 'services.2'
  const parts = path.split('.');
  const idx = parseInt(parts.pop(), 10);
  const parentPath = parts.join('.');
  if (isNaN(idx)) return;
  const arr = getPath(draft.config, parentPath);
  if (!Array.isArray(arr)) return;
  arr.splice(idx, 1);
  setPath(draft.config, parentPath, arr);
  saveDraft();
  fullRerender();
}

// ---------------------------------------------------------------------------
// 10. Image file input handler
// ---------------------------------------------------------------------------

/** Apply a replaced photo onto a config path (logo/src = bare data URL; CSS backgrounds keep url()). */
function applyImageDataUrl(configPath, dataUrl) {
  const prev = getPath(draft.config, configPath);
  const isBgPath = /background|gradient/i.test(configPath || '');
  if (isBgPath && typeof prev === 'string' && /url\s*\(/i.test(prev)) {
    setPath(
      draft.config,
      configPath,
      prev.replace(/url\(\s*['"]?[^'")]+['"]?\s*\)/i, "url('" + dataUrl + "')")
    );
    return;
  }
  if (isBgPath) {
    setPath(draft.config, configPath, "url('" + dataUrl + "')");
    return;
  }
  setPath(draft.config, configPath, dataUrl);
}

function initImageFileInput() {
  const fileInput = $('img-file-input');
  if (!fileInput) return;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file || !pendingImagePath) { fileInput.value = ''; return; }
    const path = pendingImagePath;
    pendingImagePath = null;
    await applySelectedImageFile(file, path, '', '');
    fileInput.value = '';
  });
}

async function applySelectedImageFile(file, path, src, alt) {
  if (!path) path = resolveImagePathFromSrc(src);
  if (!path) path = resolveImagePathFromAlt(alt);
  if (!file || !path) return;
  // Wave 9 (save-state audit): resizing runs async with nothing in
  // draft.config yet — closing the tab mid-resize used to drop the photo
  // with no warning. Count it as a pending op so the exit guard fires.
  // typeof-guarded like the pushHistory/TAB_ID checks inside saveDraft() —
  // isolated-extraction tests eval this function without Wave 9 state.
  if (typeof noteAsyncSaveOpStart === 'function') noteAsyncSaveOpStart();
  try {
    showPreviewSpinner(true);
    const dataUrl = await resizeImageToDataUrl(file, 1600, 0.82);
    // Logo/src: bare data URL then full preview rebuild. Backgrounds: url() rewrite.
    if (/background|gradient/i.test(path || '')) {
      applyImageDataUrl(path, dataUrl);
    } else {
      setPath(draft.config, path, dataUrl);
    }
    saveDraft();
    fullRerender();
  } catch (e) {
    showToast('Nu am putut procesa fotografia: ' + e.message, 'error');
    showPreviewSpinner(false);
  } finally {
    if (typeof noteAsyncSaveOpEnd === 'function') noteAsyncSaveOpEnd();
  }
}

// ---------------------------------------------------------------------------
// 11. Image resize
// ---------------------------------------------------------------------------

function resizeImageToDataUrl(file, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxPx || h > maxPx) {
        const ratio = Math.min(maxPx/w, maxPx/h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Error reading the image')); };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// 12. Color Picker Popover
// ---------------------------------------------------------------------------

const COLOR_PRESETS = [
  { label: 'Indigo',   hex: '#5B5BD6' },
  { label: 'Turcoaz',  hex: '#0D9488' },
  { label: 'Violet',   hex: '#7C3AED' },
  { label: 'Portocaliu', hex: '#EA580C' },
  { label: 'Roz',      hex: '#DB2777' },
  { label: 'Verde',    hex: '#16A34A' },
];

function initColorPicker() {
  const btn = $('btn-color-picker');
  const popover = $('color-popover');
  const presetsWrap = $('color-presets');
  const swatch = $('color-custom-swatch');
  const textInp = $('color-custom-text');

  if (!btn || !popover) return;

  // Build presets
  COLOR_PRESETS.forEach(p => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'color-preset-dot';
    dot.style.background = p.hex;
    dot.title = p.label;
    dot.setAttribute('aria-label', p.label);
    dot.addEventListener('click', () => {
      applyThemeColor(p.hex);
      if (swatch) swatch.value = p.hex;
      if (textInp) textInp.value = p.hex;
      dot.closest('.color-presets') && dot.closest('.color-presets').querySelectorAll('.color-preset-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
    });
    if (presetsWrap) presetsWrap.appendChild(dot);
  });

  if (swatch) {
    swatch.addEventListener('input', () => {
      const v = swatch.value;
      if (textInp) textInp.value = v;
      applyThemeColor(v);
    });
  }
  if (textInp) {
    textInp.addEventListener('input', () => {
      const v = textInp.value;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        if (swatch) swatch.value = v;
        applyThemeColor(v);
      }
    });
  }

  const bgSwatch = $('color-bg-swatch');
  const bgText = $('color-bg-text');
  if (bgSwatch) {
    bgSwatch.addEventListener('input', () => {
      const v = bgSwatch.value;
      if (bgText) bgText.value = v;
      applyThemeBackground(v);
    });
  }
  if (bgText) {
    bgText.addEventListener('input', () => {
      const v = bgText.value;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        if (bgSwatch) bgSwatch.value = v;
        applyThemeBackground(v);
      }
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleColorPopover();
  });

  document.addEventListener('click', (e) => {
    if (colorPopoverOpen && !popover.contains(e.target) && e.target !== btn) {
      closeColorPopover();
    }
  });
}

function toggleColorPopover() {
  if (colorPopoverOpen) { closeColorPopover(); return; }
  openColorPopover();
}

function openColorPopover() {
  const popover = $('color-popover');
  const btn = $('btn-color-picker');
  if (!popover || !btn) return;

  // Sync current accent + page background (theme.cream)
  const curColor = (draft.config && getPath(draft.config, 'theme.primary')) || '#5B5BD6';
  const curBg = (draft.config && getPath(draft.config, 'theme.cream')) || '#F3EFE8';
  const sw = $('color-custom-swatch');
  const ti = $('color-custom-text');
  if (sw) sw.value = curColor;
  if (ti) ti.value = curColor;
  const bgSw = $('color-bg-swatch');
  const bgTi = $('color-bg-text');
  if (bgSw) bgSw.value = /^#[0-9a-fA-F]{6}$/.test(curBg) ? curBg : '#F3EFE8';
  if (bgTi) bgTi.value = /^#[0-9a-fA-F]{6}$/.test(curBg) ? curBg : '#F3EFE8';

  // Mark active preset
  $('color-presets') && $('color-presets').querySelectorAll('.color-preset-dot').forEach(dot => {
    dot.classList.toggle('active', dot.style.background === curColor || dot.style.backgroundColor === curColor);
  });

  // Position below button
  const rect = btn.getBoundingClientRect();
  popover.style.top = (rect.bottom + 6) + 'px';
  popover.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
  popover.style.left = 'auto';

  show(popover);
  colorPopoverOpen = true;
  btn.setAttribute('aria-expanded', 'true');
}

function closeColorPopover() {
  const popover = $('color-popover');
  const btn = $('btn-color-picker');
  if (popover) hide(popover);
  colorPopoverOpen = false;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function applyThemeColor(hex) {
  if (!draft.config) return;
  const derived = deriveColors(hex);
  setPath(draft.config, 'theme.primary', hex);
  setPath(draft.config, 'theme.primaryLight', derived.primaryLight);
  setPath(draft.config, 'theme.primaryDark', derived.primaryDark);
  // A dragged color-picker gesture fires many times a second — coalesce into one undo step.
  pendingHistoryCoalesceKey = 'color:primary';
  saveDraft();
  // Re-render needed for color changes
  fullRerender();
}

/** Page / paper background — theme.cream drives --color-cream → --paper in all templates. */
function applyThemeBackground(hex) {
  if (!draft.config) return;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  setPath(draft.config, 'theme.cream', hex);
  pendingHistoryCoalesceKey = 'color:bg';
  saveDraft();
  fullRerender();
}

// ---------------------------------------------------------------------------
// 13. Drawer — details panel
// ---------------------------------------------------------------------------

/** Remember the current design's closed/open state across reload. */
function getDrawerPref() {
  try {
    return localStorage.getItem(DRAWER_PREF_KEY);
  } catch (_) {
    return null;
  }
}

function setDrawerPref(value) {
  try {
    localStorage.setItem(DRAWER_PREF_KEY, value);
  } catch (_) { /* ignore quota / private mode */ }
}

/** A catalog selection starts a fresh design context, so Details gets a fresh open state. */
function prepareDrawerForNewDesign() {
  setDrawerPref('open');
}

/** True when Details should auto-open (first visit or last preference was open). */
function shouldAutoOpenDrawer() {
  const pref = getDrawerPref();
  if (pref === 'closed') return false;
  return true; // null (first entry) or 'open'
}

/** Scroll `key`'s field group into view inside the (already built, already
 * open) drawer and focus its control. Returns whether a matching field was
 * found — callers fall back to focusing the first field when it wasn't
 * (e.g. a stale key from a template that changed shape since). Used by
 * openDrawer(focusKey) below and, on its own, by the checklist "what's
 * missing" menu (see goToChecklistField() — section 7c) when the drawer is
 * already open and just needs to jump to a different field. */
function focusDrawerField(key) {
  const body = $('drawer-body');
  if (!body || !key) return false;
  const wrap = body.querySelector('[data-field-key="' + key + '"]');
  if (!wrap) return false;
  wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const field = wrap.querySelector('input,textarea,select');
  if (field) field.focus({ preventScroll: true });
  return true;
}

/** `focusKey`, when given, is a schema field key to land on instead of the
 * drawer's first field — see the checklist "what's missing" menu (section
 * 7c), which needs one click to go from "this is unfinished" to "here is
 * where you fix it" rather than just opening Details at the top. */
function openDrawer(focusKey) {
  const overlay = $('drawer-overlay');
  const drawer = $('details-drawer');
  if (!drawer) return;
  buildDrawer();
  show(overlay);
  show(drawer);
  drawerOpen = true;
  setDrawerPref('open');
  document.body.classList.add('details-drawer-open');
  const btn = $('btn-open-drawer');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  // Focus the requested field if there is one, else the first field.
  requestAnimationFrame(() => {
    if (focusKey && focusDrawerField(focusKey)) return;
    const first = drawer.querySelector('input,textarea,select');
    if (first) first.focus();
  });
}

function closeDrawer() {
  hide($('drawer-overlay'));
  hide($('details-drawer'));
  drawerOpen = false;
  setDrawerPref('closed');
  document.body.classList.remove('details-drawer-open');
  const btn = $('btn-open-drawer');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  // Re-render if any drawer field was edited (deferred) — see
  // drawerNeedsRerenderOnClose's doc comment for why this is a plain flag,
  // not a self-expiring timer.
  if (drawerNeedsRerenderOnClose) {
    drawerNeedsRerenderOnClose = false;
    fullRerender();
  }
}

// ---------------------------------------------------------------------------
// 14b. Page sections — add / remove / reorder (Wave 7, audit finding #44)
// ---------------------------------------------------------------------------
//
// `schema.pageSections` (templates/<id>/schema.json) is the CANONICAL list of
// page sections this template offers: [{ id, label, removable }]. It never
// changes at runtime.
//
// `draft.config.sections` is the PER-SITE override: an ordered array of
// [{ id, removed }] mirroring build.js's reorderSections(). Its array order
// IS the display order. A config saved before this feature has no `sections`
// key at all — build.js only reorders when that key is a non-empty array, so
// an untouched site keeps rendering in the template's original order forever
// (see bot/test/wave7-sections-backward-compat.test.js).
//
// Every mutation here goes through the ordinary draft.config write +
// saveDraft() choke point, exactly like a text edit or a list add/remove —
// so undo/redo (7b above) covers section add/remove/reorder for free, with
// no special-casing.

/** Lazily seed draft.config.sections from the template's canonical list, in
 * memory only (does not call saveDraft()) — so merely opening the drawer
 * never fabricates a history step. Also appends any canonical id the config
 * predates (template gained a section since this site was last saved). */
function ensurePageSectionsInitialized(schema) {
  if (!schema || !Array.isArray(schema.pageSections) || schema.pageSections.length === 0) return null;
  if (!draft.config) return null;
  if (!Array.isArray(draft.config.sections)) {
    draft.config.sections = schema.pageSections.map(s => ({ id: s.id, removed: false }));
  } else {
    const known = new Set(draft.config.sections.filter(e => e && e.id).map(e => e.id));
    schema.pageSections.forEach(s => {
      if (!known.has(s.id)) draft.config.sections.push({ id: s.id, removed: false });
    });
  }
  return draft.config.sections;
}

function pageSectionDef(schema, id) {
  return (schema.pageSections || []).find(s => s.id === id) || null;
}

/** Move the section with `id` one slot up (dir=-1) or down (dir=+1) in the
 * order array. Keyboard-operable: called from plain <button> click handlers,
 * never requires a drag gesture. */
function movePageSection(schema, id, dir) {
  const order = ensurePageSectionsInitialized(schema);
  if (!order) return;
  const idx = order.findIndex(e => e && e.id === id);
  const swapWith = idx + dir;
  if (idx < 0 || swapWith < 0 || swapWith >= order.length) return;
  const tmp = order[idx];
  order[idx] = order[swapWith];
  order[swapWith] = tmp;
  saveDraft();
  fullRerender();
  buildDrawer();
}

/** Toggle a section's visibility. `removable === false` sections ignore an
 * attempt to remove them here (button is not even rendered for them — see
 * buildPageSectionsPanel — but this is a second guard in case of stale DOM),
 * and build.js enforces the same rule server-side regardless of this UI. */
function togglePageSectionRemoved(schema, id, removed) {
  const order = ensurePageSectionsInitialized(schema);
  if (!order) return;
  const def = pageSectionDef(schema, id);
  if (removed && def && def.removable === false) return;
  const entry = order.find(e => e && e.id === id);
  if (!entry) return;
  entry.removed = !!removed;
  saveDraft();
  fullRerender();
  buildDrawer();
}

function buildPageSectionsPanel(body, schema) {
  if (!schema || !Array.isArray(schema.pageSections) || schema.pageSections.length === 0) return;
  const order = ensurePageSectionsInitialized(schema);
  if (!order || order.length === 0) return;

  const group = document.createElement('div');
  group.className = 'drawer-section';

  const title = document.createElement('div');
  title.className = 'drawer-section-title';
  title.textContent = 'Secțiuni pagină';
  group.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = 'Alege ordinea secțiunilor de pe site și ascunde-le pe cele pe care nu le folosești.';
  group.appendChild(hint);

  const list = document.createElement('div');
  list.className = 'hb-sections-list';
  list.setAttribute('role', 'list');

  order.forEach((entry, idx) => {
    if (!entry || !entry.id) return;
    const def = pageSectionDef(schema, entry.id);
    if (!def) return; // id not part of this template's canonical set — nothing to show
    const removable = def.removable !== false;
    const removed = !!entry.removed;
    const label = def.label || entry.id;

    const row = document.createElement('div');
    row.className = 'hb-secrow' + (removed ? ' hb-secrow--removed' : '');
    row.setAttribute('role', 'listitem');

    const labelEl = document.createElement('span');
    labelEl.className = 'hb-secrow__label';
    labelEl.textContent = label;
    row.appendChild(labelEl);

    if (!removable) {
      const lock = document.createElement('span');
      lock.className = 'hb-secrow__lock';
      lock.textContent = 'Obligatorie';
      lock.title = 'Această secțiune nu poate fi eliminată';
      row.appendChild(lock);
    } else if (removed) {
      const tag = document.createElement('span');
      tag.className = 'hb-secrow__tag';
      tag.textContent = 'Ascunsă';
      row.appendChild(tag);
    }

    const actions = document.createElement('div');
    actions.className = 'hb-secrow__actions';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'hb-secrow__btn';
    upBtn.setAttribute('aria-label', 'Mută secțiunea „' + label + '” mai sus');
    upBtn.textContent = '↑';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => movePageSection(schema, entry.id, -1));
    actions.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'hb-secrow__btn';
    downBtn.setAttribute('aria-label', 'Mută secțiunea „' + label + '” mai jos');
    downBtn.textContent = '↓';
    downBtn.disabled = idx === order.length - 1;
    downBtn.addEventListener('click', () => movePageSection(schema, entry.id, 1));
    actions.appendChild(downBtn);

    if (removable) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'hb-secrow__btn hb-secrow__btn--wide';
      toggleBtn.textContent = removed ? 'Adaugă' : 'Elimină';
      toggleBtn.setAttribute(
        'aria-label',
        (removed ? 'Adaugă înapoi secțiunea „' : 'Elimină secțiunea „') + label + '”'
      );
      toggleBtn.addEventListener('click', () => togglePageSectionRemoved(schema, entry.id, !removed));
      actions.appendChild(toggleBtn);
    }

    row.appendChild(actions);
    list.appendChild(row);
  });

  group.appendChild(list);
  body.appendChild(group);
}

/**
 * Native Hidook booking calendar opt-in (VISION §8 e / Wave 8 reachability fix).
 *
 * appointment.nativeBooking exists on the professionals schema but is a plain
 * type:"text" field ("da"/"nu"), so the generic drawer field loop skips it
 * (isDrawerField only auto-renders phone/url/color/background + a short
 * partial-key list) and it is never interpolated as visible text in the
 * template, so there is also no inline-editable spot for it in the preview.
 * Without this dedicated panel nothing in the builder can ever set it, and a
 * paying owner has no way to turn on the calendar they are paying for.
 *
 * Only rendered when the current template's schema actually declares the
 * field (only templates/professionals does today) — templates without an
 * appointment section (e.g. local-service) get no panel at all.
 *
 * Writes straight through draft.config + saveDraft(), so undo/redo, the
 * autosave, and the paid-site publish payload all cover this exactly like
 * every other field.
 */
function buildNativeBookingPanel(body, schema) {
  const hasField = getAllSchemaFields(schema).some(f => f && f.key === 'appointment.nativeBooking');
  if (!hasField) return;

  const on = isNativeBookingOn(getPath(draft.config, 'appointment.nativeBooking'));

  const group = document.createElement('div');
  group.className = 'drawer-section';

  const title = document.createElement('div');
  title.className = 'drawer-section-title';
  title.textContent = 'Programări native Hidook';
  group.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = on
    ? 'Activ: pe site-ul public, formularul local de cerere e înlocuit de calendarul nativ Hidook — vizitatorii văd sloturi reale, rezervă direct, primesc confirmare pe email și un memento automat (fișier .ics). La publicare se leagă automat de contul tău. Reversibil oricând — programările existente nu se șterg dacă dezactivezi.'
    : 'Dezactivat: site-ul public arată formularul local de cerere (sau linkul Cal.com, dacă ai unul). Activează ca să înlocuiești formularul cu un calendar real: sloturi live, confirmare automată pe email și memento cu fișier .ics. Reversibil oricând.';
  group.appendChild(hint);

  const row = document.createElement('div');
  row.className = 'hb-secrow';

  const label = document.createElement('span');
  label.className = 'hb-secrow__label';
  label.textContent = on ? 'Activ pe site-ul public' : 'Momentan dezactivat';
  row.appendChild(label);

  const actions = document.createElement('div');
  actions.className = 'hb-secrow__actions';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'hb-secrow__btn hb-secrow__btn--wide';
  toggleBtn.textContent = on ? 'Dezactivează' : 'Activează';
  toggleBtn.setAttribute('aria-pressed', String(on));
  toggleBtn.setAttribute(
    'aria-label',
    (on ? 'Dezactivează' : 'Activează') + ' calendarul nativ de programări Hidook'
  );
  toggleBtn.addEventListener('click', () => {
    setPath(draft.config, 'appointment.nativeBooking', on ? '' : 'da');
    saveDraft();
    updateChecklist();
    scheduleRerender(true);
    buildDrawer();
  });
  actions.appendChild(toggleBtn);
  row.appendChild(actions);
  group.appendChild(row);

  // Once active on a published, paid site, link straight to the owner's own
  // bookings dashboard — the same link the dashboard site card offers, but
  // reachable right where the owner just turned the feature on. Not shown for
  // an unpublished/unpaid draft: the publish-time cutover (bot/calendar-
  // native/cutover.js) hasn't run yet, so there is nothing tenant-seeded to see.
  if (on && currentSiteId && currentSitePaid && currentUser && currentUser.id) {
    const openBtn = document.createElement('a');
    openBtn.className = 'btn-ghost btn-sm';
    openBtn.style.marginTop = '.35rem';
    openBtn.textContent = 'Deschide programările';
    openBtn.target = '_blank';
    openBtn.rel = 'noopener noreferrer';
    const qs = new URLSearchParams({
      customerId: currentUser.id,
      siteId: currentSiteId,
      brand: (draft.config && draft.config.business && draft.config.business.name) || '',
    });
    openBtn.href = '/calendar-native/owner/?' + qs.toString();
    group.appendChild(openBtn);
  }

  body.appendChild(group);
}

function buildDrawer() {
  const body = $('drawer-body');
  if (!body) return;
  body.innerHTML = '';

  if (!currentTemplate || !currentTemplate.data || !currentTemplate.data.schema) {
    body.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:1rem 0">Alege mai întâi un design.</p>';
    return;
  }

  const schema = currentTemplate.data.schema;
  buildPageSectionsPanel(body, schema);
  buildNativeBookingPanel(body, schema);
  const allFields = getAllSchemaFields(schema);

  // Group drawer fields by section
  const sectionMap = {};
  allFields.forEach(f => {
    if (!isDrawerField(f)) return;
    if (!sectionMap[f._section]) sectionMap[f._section] = [];
    sectionMap[f._section].push(f);
  });

  // SEO section: always add as collapsible at the bottom
  const seoFields = allFields.filter(f => (f.key || '').startsWith('seo.') || (f.key || '').includes('jsonLd') || (f.key || '').includes('canonical') || (f.key || '').includes('ogImage'));

  Object.entries(sectionMap).forEach(([sectionTitle, fields]) => {
    if (fields.length === 0) return;
    const group = document.createElement('div');
    group.className = 'drawer-section';

    const title = document.createElement('div');
    title.className = 'drawer-section-title';
    title.textContent = sectionTitle;
    group.appendChild(title);

    fields.forEach(field => {
      const fg = buildDrawerField(field);
      if (fg) group.appendChild(fg);
    });

    body.appendChild(group);
  });

  // Photos live in their own dedicated modal (button "Poze" in bara de sus) —
  // it covers every image the site uses, not just the fields in this drawer,
  // so it gets a pointer here rather than a duplicate mini gallery.
  const photoSection = document.createElement('div');
  photoSection.className = 'drawer-section';
  const photoTitle = document.createElement('div');
  photoTitle.className = 'drawer-section-title';
  photoTitle.textContent = 'Poze';
  photoSection.appendChild(photoTitle);

  const photoHint = document.createElement('p');
  photoHint.className = 'field-hint';
  photoHint.style.margin = '0 0 .5rem';
  photoHint.textContent = 'Fundal, logo și galerii — toate pozele site-ului, într-un singur loc.';
  photoSection.appendChild(photoHint);

  const galleryBtn = document.createElement('button');
  galleryBtn.type = 'button';
  galleryBtn.className = 'btn-ghost btn-sm';
  galleryBtn.textContent = 'Deschide Poze';
  galleryBtn.addEventListener('click', () => openGalleryModal());
  photoSection.appendChild(galleryBtn);
  body.appendChild(photoSection);
}

function buildDrawerField(field) {
  if (isHiddenDrawerField(field)) return null;
  const wrap = document.createElement('div');
  wrap.className = 'field-group';

  const key = field.key;
  const label = field.label || key;
  const type = field.type;
  const required = field.required !== false;
  const safeId = 'dr_' + key.replace(/[^a-zA-Z0-9]/g,'_');

  const labelEl = document.createElement('label');
  labelEl.className = 'field-label';
  labelEl.setAttribute('for', safeId);
  labelEl.innerHTML = escHtml(label) + (required ? '<span class="required" aria-hidden="true">*</span>' : '');
  wrap.appendChild(labelEl);

  if (field.hint) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = field.hint;
    wrap.appendChild(hint);
  }

  // Structured hero background: color + optional image (writes CSS string to config).
  if (type === 'background' || key === 'hero.background') {
    const curRaw = getPath(draft.config, key);
    const parsed = parseHeroBackground(curRaw);

    const row = document.createElement('div');
    row.className = 'field-background-row';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-items:center;';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.id = safeId;
    colorInput.className = 'field-input field-input--color';
    colorInput.value = /^#[0-9a-fA-F]{6}$/.test(parsed.color) ? parsed.color : '#1a1a1a';
    colorInput.setAttribute('aria-label', 'Culoare fundal');

    const imgInput = document.createElement('input');
    imgInput.type = 'text';
    imgInput.className = 'field-input';
    imgInput.id = safeId + '_img';
    imgInput.placeholder = 'Nicio poză încă';
    imgInput.readOnly = true;
    // Keep real asset URL internally; never show raw images/*.jpg in the control.
    let bgImagePath = parsed.image || '';
    imgInput.value = bgImagePath ? 'Poză adăugată' : '';
    imgInput.style.flex = '1 1 160px';
    imgInput.setAttribute('aria-label', 'Poză de fundal');
    imgInput.setAttribute('aria-readonly', 'true');

    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'btn-ghost';
    pickBtn.textContent = 'Alege o poză';
    pickBtn.addEventListener('click', () => {
      openImagePickerForPath(key, (dataUrlOrPath) => {
        // Prefer keeping a relative path when the picker returns one; otherwise store data URL.
        const nextImg = dataUrlOrPath || '';
        bgImagePath = nextImg;
        imgInput.value = nextImg ? 'Poză adăugată' : '';
        const composed = composeHeroBackground({
          color: colorInput.value,
          image: nextImg,
        });
        setPath(draft.config, key, composed);
        saveDraft();
        updateChecklist();
        scheduleRerender(true);
      });
    });

    function commitBg() {
      // Image path lives in bgImagePath (not the human-facing status field).
      let image = bgImagePath;
      if (!image) {
        const prev = parseHeroBackground(getPath(draft.config, key));
        image = prev.image || '';
        bgImagePath = image;
      }
      const value = composeHeroBackground({ color: colorInput.value, image: image });
      setPath(draft.config, key, value);
      // Native <input type=color> drag fires repeatedly — coalesce into one undo step.
      pendingHistoryCoalesceKey = 'drawer-bg:' + key;
      saveDraft();
      updateChecklist();
      scheduleRerender(true);
    }

    colorInput.addEventListener('input', commitBg);
    // Status field is read-only; color changes commit the existing internal path.

    row.appendChild(colorInput);
    row.appendChild(imgInput);
    row.appendChild(pickBtn);
    wrap.appendChild(row);
    wrap.dataset.fieldKey = key;
    return wrap;
  }

  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
    input.className = 'field-textarea';
    if (field.maxLen) input.maxLength = field.maxLen;
    input.rows = 3;
  } else if (type === 'select') {
    input = document.createElement('select');
    input.className = 'field-input';
    (field.options || []).forEach((choice) => {
      const option = document.createElement('option');
      option.value = String(choice.value);
      option.textContent = choice.label || String(choice.value);
      input.appendChild(option);
    });
  } else if (type === 'color') {
    // Accent triad is owned by the color popover (primary + derived light/dark).
    // theme.cream (page background) is also in the popover — skip all four here.
    if (
      key === 'theme.primary' ||
      key === 'theme.primaryLight' ||
      key === 'theme.primaryDark' ||
      key === 'theme.cream'
    ) {
      return null;
    }
    // Any other color field still needs a real control in Detalii.
    input = document.createElement('input');
    input.className = 'field-input field-input--color';
    input.type = 'color';
  } else if (type === 'url') {
    // Wrap-capable control so long Instagram/FB URLs are fully readable in Detalii
    // (native single-line <input type=url> mid-clips the handle).
    input = document.createElement('textarea');
    input.className = 'field-textarea field-input--url field-textarea--url';
    input.rows = 2;
    input.setAttribute('inputmode', 'url');
    input.setAttribute('autocomplete', 'url');
    input.setAttribute('spellcheck', 'false');
    if (field.maxLen) input.maxLength = field.maxLen;
  } else {
    input = document.createElement('input');
    input.className = 'field-input';
    input.type = type === 'phone' ? 'tel' : (type === 'email' ? 'email' : 'text');
    if (field.maxLen) input.maxLength = field.maxLen;
  }

  input.id = safeId;
  input.name = key;
  if (required) input.required = true;
  const curVal = getPath(draft.config, key);
  if (curVal != null && typeof curVal !== 'object') input.value = String(curVal);

  let urlError = null;
  const urlErrorCopy = isSiteLocalAssetField(key)
    ? 'Introdu un link complet http(s) sau o cale locală din images/ ori assets/.'
    : 'Introdu un link complet care începe cu http:// sau https://.';
  function updateUrlValidity() {
    if (type !== 'url') return true;
    const value = input.value.trim();
    const valid = !value || isPlausibleHttpUrl(value) || (isSiteLocalAssetField(key) && isPlausibleSiteAssetPath(value));
    input.setCustomValidity(valid ? '' : urlErrorCopy);
    input.classList.toggle('invalid', !valid);
    if (valid) input.removeAttribute('aria-invalid');
    else input.setAttribute('aria-invalid', 'true');
    if (urlError) {
      urlError.textContent = valid ? '' : urlErrorCopy;
      urlError.style.display = valid ? 'none' : '';
    }
    return valid;
  }

  if (type === 'url') {
    urlError = document.createElement('p');
    urlError.id = safeId + '_error';
    urlError.className = 'field-error';
    urlError.setAttribute('role', 'alert');
    urlError.style.display = 'none';
    input.setAttribute('aria-describedby', urlError.id);
    updateUrlValidity();
  }

  // Sync to config on change
  input.addEventListener('input', () => {
    if (!updateUrlValidity()) return;
    const nextValue = type === 'url' ? input.value.trim() : input.value;
    let prevName = null;
    if (key === 'business.name') {
      prevName = getPath(draft.config, key);
    }
    setPath(draft.config, key, nextValue);
    if (field.previewRefresh === 'full') {
      scheduleRerender(true);
    }
    if (key === 'contact.whatsapp' || key === 'contact.waMessage') {
      deriveWaHref(draft.config);
      scheduleRerender(true);
    }
    if (key === 'business.name' && prevName != null) {
      cascadeBusinessNameIdentity(draft.config, prevName, input.value);
      // Immediate iframe refresh so about + chips match cascaded identity
      scheduleRerender(true);
      [
        'business.title',
        'business.about',
        'contact.facebook.label',
        'contact.facebook.url',
        'contact.instagram.url',
        'contact.instagram.label',
        'instagram.handle',
        'instagram.url',
        'instagram.embedUrl',
        'contact.email',
      ].forEach((p) => syncDrawerField(p, getPath(draft.config, p)));
    }
    // Every keystroke fires this handler — coalesce into one undo step per field.
    pendingHistoryCoalesceKey = 'drawer:' + key;
    saveDraft();
    updateChecklist();
    // Try chirurgical update if field has a visible representation
    sendSetToIframe(key, nextValue);
    // Re-render on drawer close — see drawerNeedsRerenderOnClose's doc
    // comment for why this never expires on its own. Set unconditionally,
    // even for a field that already forced an immediate scheduleRerender(true)
    // above: that immediate call can itself be coalesced away (see
    // fullRerender()'s renderInFlight guard) if another render was already
    // in flight the instant this input event fired, and this is the one
    // remaining guarantee that the drawer closing still forces a final,
    // up-to-date render.
    drawerNeedsRerenderOnClose = true;
  });

  wrap.appendChild(input);
  if (urlError) wrap.appendChild(urlError);
  wrap.dataset.fieldKey = key;
  return wrap;
}

/** Parse CSS background string → { color, image } for structured UI. */
function parseHeroBackground(css) {
  const s = String(css == null ? '' : css);
  const urlMatch = s.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  let color = '#1a1a1a';
  const hex = s.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
  if (hex) {
    let h = hex[0];
    if (h.length === 4) {
      h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    }
    color = h.slice(0, 7);
  } else {
    const rgb = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) {
      const toHex = (n) => ('0' + Math.max(0, Math.min(255, parseInt(n, 10))).toString(16)).slice(-2);
      color = '#' + toHex(rgb[1]) + toHex(rgb[2]) + toHex(rgb[3]);
    }
  }
  return { color: color, image: urlMatch ? urlMatch[1] : '' };
}

/** Compose hero.background CSS from structured color + optional image path/data URL. */
function composeHeroBackground(opts) {
  const color = (opts && opts.color) || '#1a1a1a';
  const image = (opts && opts.image) || '';
  if (image && color) {
    return (
      'linear-gradient(160deg, ' + color + 'cc 0%, ' + color + '66 55%, ' + color + '99 100%), ' +
      "url('" + image + "') center/cover no-repeat"
    );
  }
  if (image) return "url('" + image + "') center/cover no-repeat";
  return color;
}

/**
 * Open the shared image file input and deliver the chosen data URL (or path) to cb.
 * Reuses #img-file-input when present.
 */
function openImagePickerForPath(configPath, cb) {
  const input = $('img-file-input');
  if (!input) return;
  const pickerWindow = typeof window === 'undefined' ? null : window;

  if (input._hbPathImagePicker && typeof input._hbPathImagePicker.cancel === 'function') {
    input._hbPathImagePicker.cancel();
  }

  let listenersActive = true;
  const request = { cancel: release };
  input._hbPathImagePicker = request;

  function removePendingListeners() {
    if (!listenersActive) return;
    listenersActive = false;
    input.removeEventListener('change', onChange, true);
    input.removeEventListener('cancel', release, true);
    if (pickerWindow) pickerWindow.removeEventListener('focus', onWindowFocus, true);
  }

  function release() {
    removePendingListeners();
    if (input._hbPathImagePicker === request) input._hbPathImagePicker = null;
  }

  function onWindowFocus() {
    // File selection dispatches `change` after focus returns. Give it that turn;
    // if no change follows, the operating-system chooser was cancelled.
    setTimeout(() => {
      if (input._hbPathImagePicker === request && listenersActive) release();
    }, 0);
  }

  const onChange = () => {
    removePendingListeners();
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) {
      release();
      return;
    }
    // Two guards on the same path, from two different passes, both needed.
    //
    // Resize first: this control used to read the raw file straight to a data
    // URL, so a 6MB phone photo embedded its full bytes into the config -- by
    // far the heaviest single image an owner could add, and configs are what
    // get published, exported and versioned.
    //
    // And hold the save open across the read: it is asynchronous, so closing
    // the tab between picking the file and the save that follows would drop
    // the photo with no warning.
    //
    // Both are typeof-guarded, and the plain FileReader is kept as a fallback,
    // because several tests extract this function's source and eval it in a
    // sandbox that declares FileReader but not the rest -- the same
    // isolated-extraction constraint as pushHistory()/TAB_ID in saveDraft().
    if (typeof noteAsyncSaveOpStart === 'function') noteAsyncSaveOpStart();
    const settlePendingOp = () => { if (typeof noteAsyncSaveOpEnd === 'function') noteAsyncSaveOpEnd(); };
    const resizeOrRead = typeof resizeImageToDataUrl === 'function'
      ? resizeImageToDataUrl(file, 1600, 0.82)
      : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.onabort = reject;
        try { reader.readAsDataURL(file); } catch (e) { reject(e); }
      });
    resizeOrRead.then((dataUrl) => {
      if (input._hbPathImagePicker !== request) { settlePendingOp(); return; }
      release();
      if (dataUrl && typeof cb === 'function') cb(dataUrl);
      settlePendingOp();
    }).catch(() => {
      if (input._hbPathImagePicker === request) release();
      if (typeof showToast === 'function') showToast('Nu am putut procesa fotografia.', 'error');
      settlePendingOp();
    });
  };
  // Capture before the shared inline-image listener clears this input's files.
  input.addEventListener('change', onChange, true);
  input.addEventListener('cancel', release, true);
  if (pickerWindow) pickerWindow.addEventListener('focus', onWindowFocus, true);
  try {
    input.click();
  } catch (_) {
    release();
  }
}

// Sync a drawer field value when it changes via inline editing
function syncDrawerField(path, value) {
  if (!drawerOpen) return;
  const body = $('drawer-body');
  if (!body) return;
  const wrap = body.querySelector('[data-field-key="' + path + '"]');
  if (!wrap) return;
  const input = wrap.querySelector('input,textarea,select');
  if (input && input.value !== value) input.value = value;
}

// ---------------------------------------------------------------------------
// 14. Gallery Modal
// ---------------------------------------------------------------------------

function findPhotoPaths() {
  // Return list of dotted config paths that hold photo arrays — i.e. arrays
  // whose items are objects with a .src (the { src, alt } shape used by
  // category galleries and the Instagram gallery field). Recurses into BOTH
  // plain objects and arrays-of-objects: category galleries live nested as
  // categories[i].photos, so a walk that only recursed into plain objects
  // (as an earlier version of this function did) would never reach them —
  // every template's real gallery lives one level deeper than a flat scan
  // finds, which is why "Manage photos" used to render for no one.
  const paths = [];
  if (!draft.config) return paths;

  function walk(obj, path) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, path + '.' + i));
      return;
    }
    Object.entries(obj).forEach(([k, v]) => {
      const full = path ? path + '.' + k : k;
      if (Array.isArray(v) && v.length > 0 && v.some(p => p && typeof p === 'object' && p.src)) {
        paths.push(full);
      } else if (v && typeof v === 'object') {
        walk(v, full);
      }
    });
  }
  walk(draft.config, '');
  return paths;
}

/** A friendly heading for a discovered photo-array path, using the parent
 * category's own title when there is one instead of a raw config path. */
function humanizePhotoPathLabel(path) {
  const catMatch = path.match(/^categories\.(\d+)\.photos$/);
  if (catMatch) {
    const cat = getPath(draft.config, 'categories.' + catMatch[1]);
    const title = cat && typeof cat.title === 'string' ? cat.title.trim() : '';
    return title || ('Categorie ' + (Number(catMatch[1]) + 1));
  }
  if (path === 'instagram.gallery') return 'Galerie Instagram';
  return path
    .split('.')
    .filter(seg => !/^\d+$/.test(seg))
    .map(seg => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join(' — ');
}

/** Owner-uploaded photos are stored as data: URIs; anything else is still a
 * template asset path (images/xxx.jpg) — i.e. the demo photo nobody replaced yet. */
function isDemoPhotoSrc(src) {
  return typeof src === 'string' && src.length > 0 && src.slice(0, 5) !== 'data:';
}

/**
 * A config value can hold either a data: URI (owner upload) or a bare
 * template-relative path like "images/iv-hero.jpg" — the latter only resolves
 * inside the preview iframe, which serves that template's own asset folder as
 * its base. This modal renders in the top-level document, so demo photos need
 * their real bytes: the active template's files.imageMap carries exactly that
 * (the same map the preview iframe and edit-overlay picker already use).
 */
function resolvePhotoDisplaySrc(src) {
  if (typeof src !== 'string' || !src || src.slice(0, 5) === 'data:') return src;
  const tpl = draft.templateId ? getTemplateById(draft.templateId) : null;
  const imageMap = tpl && tpl.files && tpl.files.imageMap;
  if (!imageMap) return src;
  const key = src.indexOf('images/') === 0 ? src : 'images/' + src.replace(/^\.?\//, '');
  return imageMap[key] || imageMap[src] || src;
}

/** Open the file picker once, resize the chosen image the same way every other
 * upload path in the app does, and resolve with the data URL (or null if the
 * user cancelled). Kept separate from #img-file-input so the gallery modal's
 * own pickers never race the on-canvas image-click picker for that shared input. */
function pickAndResizeImage() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      try {
        resolve(await resizeImageToDataUrl(file, 1600, 0.82));
      } catch (e) {
        reject(e);
      }
    }, { once: true });
    input.click();
  });
}

function openGalleryModal() {
  buildGalleryModal();
  openModal('modal-gallery');
}

function buildGalleryModal() {
  const body = $('gallery-modal-body');
  if (!body) return;
  body.innerHTML = '';

  if (!draft.config) {
    body.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">Alege mai întâi un design.</p>';
    return;
  }

  const intro = document.createElement('p');
  intro.className = 'field-hint';
  intro.style.margin = '0 0 .9rem';
  intro.textContent = 'Toate pozele site-ului tău, într-un singur loc. Pozele marcate „demo” sunt din designul original — înlocuiește-le cu ale tale înainte de publicare.';
  body.appendChild(intro);

  // Single-image fields first — the hero background sets the first impression,
  // so it belongs at the top of "all the site's photos", not buried in a list.
  buildSingleImageSection(body, {
    label: 'Fundal principal (hero)',
    get: () => parseHeroBackground(getPath(draft.config, 'hero.background')).image || '',
    set: (dataUrl) => {
      const color = parseHeroBackground(getPath(draft.config, 'hero.background')).color;
      setPath(draft.config, 'hero.background', composeHeroBackground({ color: color, image: dataUrl }));
    },
    clear: () => {
      const color = parseHeroBackground(getPath(draft.config, 'hero.background')).color;
      setPath(draft.config, 'hero.background', composeHeroBackground({ color: color, image: '' }));
    },
  });

  if (Object.prototype.hasOwnProperty.call(draft.config, 'logo')) {
    buildSingleImageSection(body, {
      label: 'Logo',
      get: () => getPath(draft.config, 'logo') || '',
      set: (dataUrl) => setPath(draft.config, 'logo', dataUrl),
      clear: () => setPath(draft.config, 'logo', ''),
    });
  }

  const photoPaths = findPhotoPaths();
  photoPaths.forEach(path => buildGallerySection(body, path));
}

function buildSingleImageSection(body, opts) {
  const section = document.createElement('div');
  section.className = 'gallery-path-section';

  const title = document.createElement('div');
  title.className = 'field-label';
  title.textContent = opts.label;
  section.appendChild(title);

  const row = document.createElement('div');
  row.className = 'photos-thumbs photos-thumbs--single';

  function render() {
    row.innerHTML = '';
    const src = opts.get();

    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb photo-thumb--single' + (src ? '' : ' photo-thumb--empty');
    if (src) {
      const img = document.createElement('img');
      img.src = resolvePhotoDisplaySrc(src); img.alt = opts.label; img.loading = 'lazy';
      thumb.appendChild(img);
      if (isDemoPhotoSrc(src)) {
        const badge = document.createElement('span');
        badge.className = 'photo-thumb-badge';
        badge.textContent = 'demo';
        thumb.appendChild(badge);
      }
    } else {
      thumb.textContent = 'Nicio poză încă';
    }
    row.appendChild(thumb);

    const actions = document.createElement('div');
    actions.className = 'photo-thumb-actions photo-thumb-actions--inline';

    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'btn-ghost btn-sm';
    replaceBtn.textContent = src ? 'Înlocuiește' : 'Alege o poză';
    replaceBtn.addEventListener('click', () => {
      setBtnLoading(replaceBtn, true, 'Se procesează…');
      pickAndResizeImage().then((dataUrl) => {
        setBtnLoading(replaceBtn, false);
        if (!dataUrl) return;
        opts.set(dataUrl);
        saveDraft();
        fullRerender();
        render();
      }).catch((e) => {
        setBtnLoading(replaceBtn, false);
        showToast('Nu am putut procesa fotografia: ' + e.message, 'error');
      });
    });
    actions.appendChild(replaceBtn);

    if (src && opts.clear) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn-ghost btn-sm';
      clearBtn.textContent = 'Elimină';
      clearBtn.addEventListener('click', () => {
        opts.clear();
        saveDraft();
        fullRerender();
        render();
      });
      actions.appendChild(clearBtn);
    }
    row.appendChild(actions);
  }
  render();
  section.appendChild(row);
  body.appendChild(section);
}

function buildGallerySection(body, path) {
  const section = document.createElement('div');
  section.className = 'gallery-path-section';

  const title = document.createElement('div');
  title.className = 'field-label';
  title.textContent = humanizePhotoPathLabel(path);
  section.appendChild(title);

  const thumbs = document.createElement('div');
  thumbs.className = 'photos-thumbs';

  function renderThumbs() {
    thumbs.innerHTML = '';
    const photos = getPath(draft.config, path) || [];
    photos.forEach((p, idx) => {
      const src = typeof p === 'string' ? p : (p && p.src);
      if (!src) return;
      const alt = (typeof p === 'object' && p && typeof p.alt === 'string') ? p.alt : '';

      const card = document.createElement('div');
      card.className = 'photo-thumb-card';

      const div = document.createElement('div');
      div.className = 'photo-thumb';

      const img = document.createElement('img');
      img.src = resolvePhotoDisplaySrc(src); img.alt = alt || ('Poză ' + (idx + 1)); img.loading = 'lazy';
      div.appendChild(img);

      if (isDemoPhotoSrc(src)) {
        const badge = document.createElement('span');
        badge.className = 'photo-thumb-badge';
        badge.textContent = 'demo';
        div.appendChild(badge);
      }

      const del = document.createElement('button');
      del.type = 'button'; del.className = 'photo-thumb-del';
      del.setAttribute('aria-label', 'Șterge poza ' + (idx + 1));
      del.innerHTML = '&times;';
      del.addEventListener('click', () => {
        const arr = getPath(draft.config, path) || [];
        arr.splice(idx, 1);
        setPath(draft.config, path, arr);
        saveDraft();
        fullRerender();
        renderThumbs();
        showToast('Poză ștearsă — apasă Anulează din bara de sus dacă a fost o greșeală.');
      });
      div.appendChild(del);
      card.appendChild(div);

      const altInput = document.createElement('input');
      altInput.type = 'text';
      altInput.className = 'photo-thumb-alt';
      altInput.placeholder = 'Descriere poză (alt)';
      altInput.value = alt;
      altInput.maxLength = 160;
      altInput.setAttribute('aria-label', 'Descriere poză ' + (idx + 1) + ' pentru accesibilitate și SEO');
      altInput.addEventListener('input', () => {
        const arr = getPath(draft.config, path) || [];
        const cur = arr[idx];
        if (cur && typeof cur === 'object') {
          cur.alt = altInput.value;
        } else {
          arr[idx] = { src: src, alt: altInput.value };
        }
        setPath(draft.config, path, arr);
        // Every keystroke would otherwise fragment undo into one step per
        // character — coalesce them into a single step per editing session,
        // same trick the drawer's own color-drag inputs use.
        pendingHistoryCoalesceKey = 'gallery-alt:' + path + ':' + idx;
        saveDraft();
      });
      card.appendChild(altInput);

      const actions = document.createElement('div');
      actions.className = 'photo-thumb-actions';

      function makeMoveBtn(dir, label, disabled) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'photo-thumb-mini-btn';
        b.textContent = dir < 0 ? '◀' : '▶';
        b.title = label;
        b.setAttribute('aria-label', label);
        b.disabled = disabled;
        b.addEventListener('click', () => {
          const arr = getPath(draft.config, path) || [];
          const j = idx + dir;
          if (j < 0 || j >= arr.length) return;
          const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp;
          setPath(draft.config, path, arr);
          saveDraft();
          fullRerender();
          renderThumbs();
        });
        return b;
      }
      actions.appendChild(makeMoveBtn(-1, 'Mută mai devreme', idx === 0));
      actions.appendChild(makeMoveBtn(1, 'Mută mai târziu', idx === photos.length - 1));

      const replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.className = 'photo-thumb-mini-btn';
      replaceBtn.textContent = '⟳';
      replaceBtn.title = 'Înlocuiește această poză';
      replaceBtn.setAttribute('aria-label', 'Înlocuiește poza ' + (idx + 1));
      replaceBtn.addEventListener('click', () => {
        replaceBtn.disabled = true;
        pickAndResizeImage().then((dataUrl) => {
          replaceBtn.disabled = false;
          if (!dataUrl) return;
          const arr = getPath(draft.config, path) || [];
          const cur = arr[idx];
          if (cur && typeof cur === 'object') cur.src = dataUrl;
          else arr[idx] = { src: dataUrl, alt: alt };
          setPath(draft.config, path, arr);
          saveDraft();
          fullRerender();
          renderThumbs();
        }).catch((e) => {
          replaceBtn.disabled = false;
          showToast('Nu am putut procesa fotografia: ' + e.message, 'error');
        });
      });
      actions.appendChild(replaceBtn);

      card.appendChild(actions);
      thumbs.appendChild(card);
    });
  }
  renderThumbs();
  section.appendChild(thumbs);

  const addBtn = document.createElement('label');
  addBtn.className = 'photos-dropzone';
  addBtn.style.marginTop = '.5rem';
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.multiple = true; fileInput.accept = 'image/jpeg,image/png,image/webp';
  const dzIcon = document.createElement('div');
  dzIcon.className = 'photos-dropzone-icon'; dzIcon.setAttribute('aria-hidden', 'true'); dzIcon.textContent = '+';
  const dzLabel = document.createElement('div');
  dzLabel.textContent = 'Adaugă poze';
  addBtn.appendChild(dzIcon); addBtn.appendChild(dzLabel); addBtn.appendChild(fileInput);

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    dzLabel.textContent = 'Se procesează ' + files.length + ' ' + (files.length === 1 ? 'poză' : 'poze') + '…';
    addBtn.classList.add('photos-dropzone--busy');
    let added = 0;
    for (const file of files) {
      try {
        const dataUrl = await resizeImageToDataUrl(file, 1600, 0.82);
        const arr = getPath(draft.config, path) || [];
        arr.push({ src: dataUrl, alt: file.name.replace(/\.[^.]+$/, '') });
        setPath(draft.config, path, arr);
        added++;
      } catch (e) {
        showToast('Nu am putut procesa "' + file.name + '": ' + e.message, 'error');
      }
    }
    dzLabel.textContent = 'Adaugă poze';
    addBtn.classList.remove('photos-dropzone--busy');
    if (added) {
      saveDraft();
      fullRerender();
      renderThumbs();
      showToast(added === 1 ? 'Poza a fost adăugată.' : (added + ' poze au fost adăugate.'), 'success');
    }
    fileInput.value = '';
  });
  section.appendChild(addBtn);
  body.appendChild(section);
}

// ---------------------------------------------------------------------------
// 15. Draft persistence
// ---------------------------------------------------------------------------

function saveDraft() {
  if (!draft.templateId || !draft.config) return;
  deriveWaHref(draft.config);
  // Record the undo/redo step BEFORE persisting — pushHistory() itself is a
  // no-op when draft.config hasn't actually changed (see its doc comment),
  // so bookkeeping-only saves (siteId bind, slug scrub) never pollute history.
  // Guarded: several existing tests extract just this function's source text
  // and eval it in an isolated sandbox that never declares pushHistory —
  // typeof-checking (rather than calling the bare identifier) keeps that a
  // silent no-op there instead of a ReferenceError, with no effect on the
  // real app where pushHistory is always defined alongside it.
  if (typeof pushHistory === 'function') {
    pushHistory(pendingHistoryCoalesceKey);
    pendingHistoryCoalesceKey = null;
  }
  const payload = { templateId: draft.templateId, config: draft.config };
  // Same isolated-extraction test compatibility as pushHistory() above — TAB_ID
  // is a top-level const in the real app.js but absent from those sandboxes.
  if (typeof TAB_ID !== 'undefined') payload.tabId = TAB_ID;
  // Carry the "still untouched demo content" banner state across a real page
  // reload — resumeLocalDraft() runs on a fresh load with none of this
  // session's in-memory state, so without persisting it here the banner would
  // silently vanish on refresh even though nothing was actually edited.
  if (typeof isFreshDemoDraft !== 'undefined') {
    payload.isFreshDemoDraft = isFreshDemoDraft;
    payload.demoBannerDismissed = !!demoBannerDismissed;
  }
  // Persist paid-site bind so fresh #edit (no dashboard «Edit») can republish
  if (currentSiteId) {
    payload.siteId = currentSiteId;
    payload.paid = !!currentSitePaid;
    if (currentSiteSlug) payload.slug = currentSiteSlug;
  }
  const ok = lsSet(DRAFT_KEY, payload);
  // Wave 9 (save-state audit): resolve the visible saving/saved/failed
  // indicator + exit guard from the result of this write. Same
  // isolated-extraction test compatibility as pushHistory/TAB_ID above.
  if (typeof noteLocalSaveResult === 'function') noteLocalSaveResult(ok);
  return ok;
}
function loadDraft() { return lsGet(DRAFT_KEY); }

/**
 * After pay, a fresh /app/#edit (or resume without loadSiteForEdit) must bind the
 * signed-in paid site so «Publish site» republishes the same slug — never the new-address modal.
 *
 * Never attach a paid site whose templateId differs from the current draft — a second
 * design must not silently overwrite another live URL (S78/S80).
 */
async function bindSignedInPaidSiteForEdit() {
  try {
    if (!currentUser) {
      const user = await fetchCurrentUser().catch(() => null);
      if (user) updateUserUI(user);
      if (!currentUser) return;
    }

    const saved = loadDraft();
    const tpl = draft.templateId || (saved && saved.templateId) || '';

    const data = await apiGet('/api/sites');
    const sites = (data && data.sites) || [];
    if (!sites.length) {
      // No sites — drop any stale in-memory / draft bind
      if (currentSiteId || (saved && saved.siteId)) {
        currentSiteId = null;
        currentSitePaid = false;
        currentSiteSlug = '';
        saveDraft();
      }
      return;
    }

    const siteMatchesDraftTpl = (s) => {
      if (!s) return false;
      if (!tpl) return true;
      if (!s.templateId) return false;
      return s.templateId === tpl;
    };

    // Already bound: keep only if still paid + same template as draft
    if (currentSiteId && currentSitePaid && currentSiteSlug) {
      const cur = sites.find(s => s && s.id === currentSiteId) || null;
      if (cur && cur.paid && siteMatchesDraftTpl(cur)) return;
      currentSiteId = null;
      currentSitePaid = false;
      currentSiteSlug = '';
    }

    // Draft bind is only a hint — verify against /api/sites + same templateId
    if (saved && saved.siteId && saved.paid) {
      const fromDraft = sites.find(s => s && s.id === saved.siteId && s.paid) || null;
      if (fromDraft && siteMatchesDraftTpl(fromDraft)) {
        currentSiteId = fromDraft.id;
        currentSitePaid = true;
        currentSiteSlug = fromDraft.slug || fromDraft.projectName || saved.slug || '';
        publishedSiteId = fromDraft.id;
        if (fromDraft.url) publishedSiteUrl = fromDraft.url;
        if (currentSiteId && currentSitePaid && currentSiteSlug) {
          saveDraft();
          return;
        }
      }
      // Stale or cross-template draft.siteId — scrub so Publish cannot reuse it
      saveDraft();
    }

    const nameSlug = toSlug(getPath(draft.config, 'business.name') || '') || '';
    const wantSlug = String(currentSiteSlug || (saved && saved.slug) || nameSlug || '').trim();

    let match = null;
    if (currentSiteId) {
      match = sites.find(s => s && s.id === currentSiteId && siteMatchesDraftTpl(s)) || null;
    }
    if (!match && wantSlug) {
      match = sites.find(s =>
        s && s.paid && siteMatchesDraftTpl(s) && (s.slug === wantSlug || s.projectName === wantSlug)
      ) || null;
    }
    if (!match && tpl) {
      const paidTpl = sites.filter(s => s && s.paid && s.templateId === tpl);
      if (paidTpl.length === 1) match = paidTpl[0];
      else if (paidTpl.length > 1 && wantSlug) {
        match = paidTpl.find(s => s.slug === wantSlug || s.projectName === wantSlug) || paidTpl[0];
      } else if (paidTpl.length > 1) {
        match = paidTpl[0];
      }
    }
    // Do NOT fall back to "the only paid site" across templates — that overwrites
    // a live restaurant when starting professionals (S78).
    if (!match) return;

    currentSiteId = match.id;
    currentSitePaid = !!match.paid;
    currentSiteSlug = match.slug || match.projectName || currentSiteSlug || '';
    publishedSiteId = match.id;
    if (match.url) publishedSiteUrl = match.url;
    saveDraft();
  } catch (_) {
    /* unsigned / offline — leave unbound */
  }
}

// ---------------------------------------------------------------------------
// 15b. Add Instagram (feed slot) — works before payment
// ---------------------------------------------------------------------------

function siteIdForInstagram() {
  return currentSiteId || publishedSiteId;
}

function setIgStatus(msg, isError) {
  const el = $('ig-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('ig-error', !!isError);
}

function applyEmbedUrl(embedUrl) {
  if (!draft.config) draft.config = {};
  if (!draft.config.instagram || typeof draft.config.instagram !== 'object') {
    draft.config.instagram = {};
  }
  draft.config.instagram.embedUrl = embedUrl;
  saveDraft();
  fullRerender();
  syncInstagramModalPanels();
}

let instagramEditorUrl = '';
/** Pending window-focus handler from connectInstagram; disconnect must cancel it. */
let instagramConnectFocusHandler = null;
/** Bumped on disconnect / new connect so in-flight grant-after-focus cannot re-apply. */
let instagramConnectGeneration = 0;

function cancelPendingInstagramConnect() {
  if (instagramConnectFocusHandler) {
    window.removeEventListener('focus', instagramConnectFocusHandler);
    instagramConnectFocusHandler = null;
  }
  instagramConnectGeneration += 1;
}

function connectedInstagramEmbedUrl() {
  return String((((draft || {}).config || {}).instagram || {}).embedUrl || '').trim();
}

/** Show auth, connect, or persisted-connected state inside the Instagram modal. */
function syncInstagramModalPanels() {
  const authPanel = $('ig-auth-panel');
  const connectPanel = $('ig-connect-panel');
  const connectedPanel = $('ig-connected-panel');
  const title = $('modal-instagram-title');
  const lead = $('ig-state-lead');
  const hasUser = !!(currentUser && currentUser.email);
  const isConnected = hasUser && !!connectedInstagramEmbedUrl();
  if (authPanel) authPanel.style.display = hasUser ? 'none' : '';
  if (connectPanel) connectPanel.style.display = hasUser && !isConnected ? '' : 'none';
  if (connectedPanel) connectedPanel.style.display = isConnected ? '' : 'none';
  if (title) title.textContent = isConnected ? 'Instagram conectat' : 'Adaugă Instagram';
  if (lead) {
    lead.textContent = isConnected
      ? 'Feed-ul Instagram este activ pe site și poate fi administrat din editorul Instafidget.'
      : 'Conectează Instagram din editor, înainte să începi trialul. Feed-ul apare pe site — Hidook Site Builder nu vorbește direct cu Meta.';
  }
}

async function prepareInstagramEditor() {
  const btn = $('btn-ig-editor');
  const status = $('ig-editor-status');
  if (!connectedInstagramEmbedUrl()) return;
  instagramEditorUrl = '';
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Pregătim editorul Instafidget…';
  try {
    const siteId = await ensureDraftSiteForInstagram();
    const session = await apiPost('/api/sites/' + encodeURIComponent(siteId) + '/social-feed/editor-session', {});
    instagramEditorUrl = String((session && session.editorUrl) || '');
    if (btn) btn.disabled = !instagramEditorUrl;
    if (status) {
      status.textContent = instagramEditorUrl
        ? 'Editorul este pregătit și se va deschide într-un tab nou.'
        : 'Nu am putut pregăti editorul Instafidget. Încearcă din nou.';
    }
  } catch (e) {
    if (status) status.textContent = e.message || 'Nu am putut pregăti editorul Instafidget.';
  }
}

function openInstagramEditor() {
  if (!instagramEditorUrl) return;
  const editorTab = window.open(instagramEditorUrl, '_blank');
  if (editorTab) editorTab.opener = null;
}

async function disconnectInstagram() {
  // Authoritative: kill stale focus→re-grant path before clearing local state.
  cancelPendingInstagramConnect();
  instagramEditorUrl = '';
  applyEmbedUrl('');
  setIgStatus('Instagram a fost deconectat. Feed-ul nu mai este afișat pe site.');
  const siteId = siteIdForInstagram();
  if (!siteId || !currentUser || !currentUser.email) return;
  try {
    await apiPost('/api/sites/' + encodeURIComponent(siteId) + '/social-feed/disconnect', {});
  } catch (e) {
    setIgStatus(
      (e && e.message) || 'Instagram a fost deconectat local, dar serverul nu a confirmat. Reîncearcă publicarea.',
      true
    );
  }
}

/**
 * Ensure an unpaid draft site exists so Instagram APIs have a siteId.
 * Does not open the publish success UI or require payment.
 * Sets currentSiteSlug so first «Publish site» reuses the reserved address.
 */
async function ensureDraftSiteForInstagram() {
  let siteId = siteIdForInstagram();
  if (siteId) {
    // Keep reserved slug in session so first Publică does not treat it as taken
    if (!currentSiteSlug && draft.config && draft.config.business && draft.config.business.name) {
      currentSiteSlug = toSlug(draft.config.business.name) || currentSiteSlug;
    }
    return siteId;
  }
  if (!currentUser || !currentUser.email) {
    throw new Error('Autentifică-te ca să salvezi ciorna.');
  }
  if (!draft.config || !draft.templateId) {
    throw new Error('Alege mai întâi un design.');
  }
  setIgStatus('Salvăm ciorna pentru conectarea Instagram…');
  deriveWaHref(draft.config);
  const { cleanConfig, images } = extractImages(draft.config);
  const baseSlug = toSlug(
    (draft.config.business && draft.config.business.name) ||
    'site-' + String(Date.now()).slice(-6)
  ) || ('site-' + String(Date.now()).slice(-6));
  const payload = {
    templateId: draft.templateId,
    config: cleanConfig,
    images,
    slug: baseSlug,
  };
  if (currentSiteId) payload.siteId = currentSiteId;
  let data;
  try {
    data = await apiPost('/api/publish', payload);
  } catch (error) {
    if (error && error.status === 409) throw new Error(PUBLISH_SLUG_COLLISION_MESSAGE);
    throw error;
  }
  if (!data.site || !data.site.id) {
    throw new Error('Nu am putut salva ciorna. Încearcă din nou.');
  }
  currentSiteId = data.site.id;
  publishedSiteId = data.site.id;
  // First Publică must reuse this unpaid draft slug — never treat it as taken
  currentSiteSlug = (data.site.slug || baseSlug || currentSiteSlug || '').trim();
  if (data.paymentUrl) sitePaymentUrl = data.paymentUrl;
  // Keep unpaid — no live requirement for Instagram connect
  return currentSiteId;
}

function wireIgAuthForm() {
  const form = $('form-ig-auth-email');
  const sentDiv = $('ig-auth-sent');
  const errorDiv = $('ig-auth-error');
  const devLink = $('ig-dev-link');
  if (!form) return;

  if (form) form.style.display = '';
  if (sentDiv) sentDiv.style.display = 'none';
  if (errorDiv) errorDiv.style.display = 'none';
  if (devLink) { hide(devLink); devLink.removeAttribute('href'); }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const emailInput = $('input-ig-email');
    const email = emailInput ? emailInput.value.trim() : '';
    if (!email) {
      if (errorDiv) { errorDiv.textContent = 'Introdu adresa de email.'; show(errorDiv); }
      return;
    }
    const submitBtn = $('btn-ig-send-magic');
    setBtnLoading(submitBtn, true, 'Se trimite…');
    if (errorDiv) hide(errorDiv);
    try {
      const res = await apiPost('/api/auth/email', { email });
      if (form) hide(form);
      if (sentDiv) show(sentDiv);
      if (res.devLink && devLink) {
        devLink.href = res.devLink;
        devLink.textContent = 'Deschide linkul de autentificare';
        show(devLink);
        // One-shot handler: verify in-place, stay in editor, continue IG flow
        const onDev = async (ev) => {
          ev.preventDefault();
          try {
            const href = devLink.getAttribute('href') || res.devLink;
            await fetch(href, { credentials: 'include', redirect: 'follow' });
            const user = await fetchCurrentUser().catch(() => null);
            if (user) {
              updateUserUI(user);
              syncInstagramModalPanels();
              setIgStatus('Cont activ. Pregătim conectarea…');
              try {
                await ensureDraftSiteForInstagram();
                setIgStatus('Poți conecta Instagram. Bifează acordul, apoi apasă Conectează Instagram.');
              } catch (err) {
                setIgStatus(err.message || 'Nu am putut salva ciorna.', true);
              }
            } else {
              window.location.href = href;
            }
          } catch (_) {
            window.location.href = devLink.href || res.devLink;
          }
        };
        devLink.onclick = onDev;
      }
    } catch (err) {
      if (errorDiv) {
        errorDiv.textContent = err.message || 'Nu am putut trimite linkul. Încearcă din nou.';
        show(errorDiv);
      }
    } finally {
      setBtnLoading(submitBtn, false);
    }
  };
}

function openInstagramModal() {
  const check = $('ig-terms-check');
  const btn = $('btn-ig-connect');
  if (check) check.checked = false;
  if (btn) btn.disabled = true;
  setIgStatus('');

  // Always open the modal — never a dead toast-only button.
  openModal('modal-instagram');
  syncInstagramModalPanels();

  if (!currentUser || !currentUser.email) {
    wireIgAuthForm();
    return;
  }

  if (connectedInstagramEmbedUrl()) {
    prepareInstagramEditor();
    return;
  }

  // Logged in: ensure draft siteId (unpaid OK), then show connect controls.
  (async () => {
    try {
      await ensureDraftSiteForInstagram();
      setIgStatus('');
    } catch (e) {
      setIgStatus(e.message || 'Nu am putut pregăti Instagram. Încearcă din nou.', true);
    }
  })();
}

async function connectInstagram() {
  const check = $('ig-terms-check');
  const btn = $('btn-ig-connect');
  if (!currentUser || !currentUser.email) {
    setIgStatus('Autentifică-te ca să conectezi Instagram.', true);
    syncInstagramModalPanels();
    wireIgAuthForm();
    return;
  }
  if (!check || !check.checked) {
    setIgStatus('Bifează acordul pentru Termeni și Politica de confidențialitate.', true);
    return;
  }
  setBtnLoading(btn, true);
  setIgStatus('Conectăm Instagram…');
  try {
    const siteId = await ensureDraftSiteForInstagram();
    if (!siteId) {
      setIgStatus('Salvează mai întâi ciorna.', true);
      return;
    }
    const grant1 = await apiPost('/api/sites/' + encodeURIComponent(siteId) + '/social-feed/grant', {
      acceptedTerms: true,
    });
    const session = await apiPost('/api/sites/' + encodeURIComponent(siteId) + '/social-feed/editor-session', {});
    instagramEditorUrl = String((session && session.editorUrl) || '');
    if (grant1.embedUrl) applyEmbedUrl(grant1.embedUrl);
    const editorBtn = $('btn-ig-editor');
    const editorStatus = $('ig-editor-status');
    if (editorBtn) editorBtn.disabled = !instagramEditorUrl;
    if (editorStatus) {
      editorStatus.textContent = instagramEditorUrl
        ? 'Editorul este pregătit și se va deschide într-un tab nou.'
        : 'Nu am putut pregăti editorul Instafidget. Încearcă din nou.';
    }
    // Isolated/test finish: grant already stored embed; no partner editor UI required
    if (grant1.embedUrl && !(session && session.editorUrl)) {
      setIgStatus('Instagram este afișat pe site.');
      showToast('Instagram a fost conectat.', 'success', 3500);
      closeModal('modal-instagram');
      return;
    }
    if (session.editorUrl) {
      // Same-browser new tab (not a sized/named popup window), with opener isolation.
      const editorTab = window.open(session.editorUrl, '_blank');
      if (editorTab) editorTab.opener = null;
    }
    setIgStatus('După ce termini conectarea, revenim aici și actualizăm feed-ul de pe site.');
    // Drop any prior focus waiter so only this connect attempt can finish.
    cancelPendingInstagramConnect();
    const connectGen = instagramConnectGeneration;
    const onFocus = async () => {
      if (instagramConnectFocusHandler !== onFocus) return;
      window.removeEventListener('focus', onFocus);
      instagramConnectFocusHandler = null;
      // Explicit disconnect (or a newer connect) voids this return-from-editor grant.
      if (connectGen !== instagramConnectGeneration) return;
      try {
        const grant2 = await apiPost('/api/sites/' + encodeURIComponent(siteId) + '/social-feed/grant', {
          acceptedTerms: true,
        });
        if (connectGen !== instagramConnectGeneration) return;
        if (grant2.embedUrl) {
          applyEmbedUrl(grant2.embedUrl);
          setIgStatus('Instagram e pe site.');
          showToast('Instagram e conectat.', 'success', 3500);
          closeModal('modal-instagram');
        } else {
          setIgStatus('Feed-ul nu este gata încă. Redeschide Instagram după ce salvezi conectarea.');
        }
      } catch (e) {
        if (connectGen !== instagramConnectGeneration) return;
        setIgStatus(e.message || 'Nu am putut reîncărca feed-ul Instagram.', true);
      }
    };
    instagramConnectFocusHandler = onFocus;
    window.addEventListener('focus', onFocus);
  } catch (e) {
    setIgStatus(e.message || 'Nu am putut conecta Instagram.', true);
  } finally {
    setBtnLoading(btn, false);
  }
}

// ---------------------------------------------------------------------------
// 16. API
// ---------------------------------------------------------------------------

async function apiGet(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) {
    const json = await r.json().catch(() => ({}));
    throw Object.assign(new Error(json.error || 'Eroare server'), { status: r.status });
  }
  return r.json();
}

/**
 * Download the current paid/trial-active draft as a complete static HTML file.
 * Fetches GET /api/export-html (session cookie) and saves via blob + a[download].
 * Does not publish or open checkout.
 */
async function downloadDraftHtml() {
  const btn = $('btn-download-html');
  if (!currentUser) {
    showToast('Intră în cont ca să descarci HTML-ul.', 'error', 5000);
    return;
  }
  // Saving the draft + generating the export is a real network round-trip
  // (not instant) — a bare disabled button with no text change reads as a
  // dead click. setBtnLoading is the same "Se ...…" pattern every other
  // multi-step action in the editor already uses (publish, restore, etc.).
  // typeof-guarded with a plain-disable fallback: an existing test extracts
  // just this function's source and evals it in a sandbox that stubs $()
  // and fetch but never declares setBtnLoading.
  if (btn) { if (typeof setBtnLoading === 'function') setBtnLoading(btn, true, 'Se pregătește…'); else btn.disabled = true; }
  try {
    if (!draft.templateId || !draft.config) {
      showToast('Alege mai întâi un design.', 'error', 5000);
      return;
    }
    const saved = await apiPost('/api/draft', {
      siteId: currentSiteId || undefined,
      templateId: draft.templateId,
      config: draft.config,
    });
    if (!saved.site || !saved.site.id) throw new Error('Ciorna nu a fost salvată.');
    currentSiteId = saved.site.id;
    publishedSiteId = saved.site.id;
    currentSitePaid = !!saved.site.paid;
    currentSiteSlug = saved.site.slug || saved.site.projectName || currentSiteSlug || '';
    saveDraft();

    let url = '/api/export-html';
    if (currentSiteId) {
      url += '?siteId=' + encodeURIComponent(currentSiteId);
    }
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'text/html' },
    });
    if (!res.ok) {
      const msg = res.status === 401
        ? 'Intră în cont ca să descarci HTML-ul.'
        : res.status === 402
          ? 'Activează trialul de 7 zile sau abonamentul ca să descarci HTML-ul.'
          : 'Nu am putut descărca HTML-ul.';
      showToast(msg, 'error', 5000);
      return;
    }
    const blob = await res.blob();
    let filename = 'site.html';
    const cd = res.headers.get('Content-Disposition') || res.headers.get('content-disposition') || '';
    const mStar = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const mPlain = /filename="?([^";]+)"?/i.exec(cd);
    if (mStar && mStar[1]) {
      try { filename = decodeURIComponent(mStar[1].trim()); } catch (_) { filename = mStar[1].trim(); }
    } else if (mPlain && mPlain[1]) {
      filename = mPlain[1].trim();
    }
    if (!/\.html$/i.test(filename)) filename = filename + '.html';

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      try { URL.revokeObjectURL(objectUrl); } catch (_) {}
    }, 0);
    showToast('HTML descărcat.', 'success', 2500);
  } catch (err) {
    const status = err && err.status;
    const msg = status === 401
      ? 'Autentifică-te ca să descarci HTML-ul.'
      : status === 402
        ? 'Activează trialul de 7 zile sau abonamentul ca să descarci HTML-ul.'
        : 'Nu am putut descărca HTML-ul.';
    showToast(msg, 'error', 5000);
  } finally {
    if (btn) { if (typeof setBtnLoading === 'function') setBtnLoading(btn, false); else btn.disabled = false; }
  }
}

/**
 * Download the current paid/trial-active draft as a self-hostable static ZIP.
 * GET /api/export-zip — HTML/CSS/JS/images/legal pages. Not a live publish.
 */
async function downloadDraftZip() {
  const btn = $('btn-download-zip');
  if (!currentUser) {
    showToast('Autentifică-te ca să descarci ZIP-ul.', 'error', 5000);
    return;
  }
  // Same feedback fix as downloadDraftHtml() above — zipping is the slower
  // of the two exports, so a silent disabled button is even more of a dead
  // moment here. Same typeof guard too (isolated-extraction test safety).
  if (btn) { if (typeof setBtnLoading === 'function') setBtnLoading(btn, true, 'Se pregătește…'); else btn.disabled = true; }
  try {
    if (!draft.templateId || !draft.config) {
      showToast('Alege mai întâi un design.', 'error', 5000);
      return;
    }
    const saved = await apiPost('/api/draft', {
      siteId: currentSiteId || undefined,
      templateId: draft.templateId,
      config: draft.config,
    });
    if (!saved.site || !saved.site.id) throw new Error('Ciorna nu a fost salvată.');
    currentSiteId = saved.site.id;
    publishedSiteId = saved.site.id;
    currentSitePaid = !!saved.site.paid;
    currentSiteSlug = saved.site.slug || saved.site.projectName || currentSiteSlug || '';
    saveDraft();

    let url = '/api/export-zip';
    if (currentSiteId) {
      url += '?siteId=' + encodeURIComponent(currentSiteId);
    }
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/zip' },
    });
    if (!res.ok) {
      const msg = res.status === 401
        ? 'Autentifică-te ca să descarci ZIP-ul.'
        : res.status === 402
          ? 'Activează trialul de 7 zile sau abonamentul ca să descarci ZIP-ul.'
          : 'Nu am putut descărca ZIP-ul.';
      showToast(msg, 'error', 5000);
      return;
    }
    const blob = await res.blob();
    let filename = 'site.zip';
    const cd = res.headers.get('Content-Disposition') || res.headers.get('content-disposition') || '';
    const mStar = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const mPlain = /filename="?([^";]+)"?/i.exec(cd);
    if (mStar && mStar[1]) {
      try { filename = decodeURIComponent(mStar[1].trim()); } catch (_) { filename = mStar[1].trim(); }
    } else if (mPlain && mPlain[1]) {
      filename = mPlain[1].trim();
    }
    if (!/\.zip$/i.test(filename)) filename = filename + '.zip';

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      try { URL.revokeObjectURL(objectUrl); } catch (_) {}
    }, 0);
    showToast('ZIP descărcat.', 'success', 2500);
  } catch (_) {
    showToast('Nu am putut descărca ZIP-ul.', 'error', 5000);
  } finally {
    if (btn) { if (typeof setBtnLoading === 'function') setBtnLoading(btn, false); else btn.disabled = false; }
  }
}

async function apiPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  // fromServer marks an error whose text the SERVER chose and is safe to show
  // the user. A rejection from fetch() itself (offline, DNS, connection
  // refused) never reaches this line, so it never carries the flag and must
  // not be displayed -- its message is a raw browser string like
  // "Failed to fetch", in English, in a Romanian product.
  if (!r.ok) {
    throw Object.assign(new Error(json.error || 'Eroare server'), {
      status: r.status,
      code: json.code,
      fromServer: true,
    });
  }
  return json;
}

/**
 * DELETE with a JSON response, same error contract as apiPost/apiGet — used
 * by the custom-domain "Deconectează" action (DELETE /api/sites/:id/domain).
 */
async function apiDelete(url) {
  const r = await fetch(url, { method: 'DELETE', credentials: 'include' });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw Object.assign(new Error(json.error || 'Eroare server'), {
      status: r.status,
      code: json.code,
      fromServer: true,
    });
  }
  return json;
}

// ---------------------------------------------------------------------------
// 17. App config
// ---------------------------------------------------------------------------

async function fetchAppConfig() {
  try {
    const data = await apiGet('/api/config');
    appConfig = Object.assign(appConfig, data);
  } catch (_) {}
  const priceLabel = formatPriceLabel(appConfig);
  const renewalLabel = formatRenewalLabel(appConfig);
  const heroPrice = $('hero-price');
  const heroRenewal = $('hero-renewal');
  if (heroPrice) heroPrice.textContent = priceLabel;
  if (heroRenewal) heroRenewal.textContent = renewalLabel;
  const proofPrice = $('proof-price');
  const proofRenewal = $('proof-renewal');
  if (proofPrice) proofPrice.textContent = priceLabel;
  if (proofRenewal) proofRenewal.textContent = renewalLabel;
  const footerPrice = $('footer-price');
  const footerRenewal = $('footer-renewal');
  if (footerPrice) footerPrice.textContent = priceLabel;
  if (footerRenewal) footerRenewal.textContent = renewalLabel;
  const bulletPrice = $('publish-price');
  const bulletRenewal = $('publish-renewal');
  if (bulletPrice) bulletPrice.textContent = priceLabel;
  if (bulletRenewal) bulletRenewal.textContent = renewalLabel;
  // How-it-works + success modal: same commercial config (no hard-coded 99€/29€)
  const howPrice = $('how-price');
  const howRenewal = $('how-renewal');
  const howRenewalStep = $('how-renewal-step');
  if (howPrice) howPrice.textContent = priceLabel;
  if (howRenewal) howRenewal.textContent = renewalLabel;
  if (howRenewalStep) howRenewalStep.textContent = renewalLabel;
  const successRenewal = $('success-renewal');
  if (successRenewal) successRenewal.textContent = renewalLabel;
}

function formatPriceLabel(cfg) {
  const amount = cfg.amount != null ? cfg.amount : cfg.priceEur;
  const cur = String(cfg.currency || 'usd').toLowerCase();
  if (amount == null) return '—';
  if (cur === 'gbp') return '£' + amount;
  if (cur === 'eur') return amount + '€';
  return '$' + amount;
}

function formatRenewalLabel(cfg) {
  const amount = cfg.renewal != null ? cfg.renewal : 29;
  const cur = String(cfg.currency || 'usd').toLowerCase();
  if (cur === 'gbp') return '£' + amount;
  if (cur === 'eur') return amount + '€';
  return '$' + amount;
}

/** Human calendar date for hosting-until (not ISO dump, not trial countdown). Romanian chrome. */
function formatHostingUntilDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (_) {
    const day = d.getUTCDate();
    const month = d.getUTCMonth() + 1;
    const year = d.getUTCFullYear();
    return day + '.' + month + '.' + year;
  }
}


/**
 * Live trial/site URL: absolute http(s) OR same-origin isolated /live/<slug>/.
 * Relative /live/… must count as live so success chrome is not the unpaid pay CTA.
 */
function isLiveSiteUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (/^https?:\/\//i.test(u)) return true;
  // Isolated deploy without PUBLIC_URL returns /live/<slug>/
  if (/^\/live\//i.test(u)) return true;
  return false;
}

/** Clickable same-origin href: scheme+host+port + path when url is relative /live/…. */
function absoluteSiteUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.charAt(0) === '/') {
    try {
      if (typeof window !== 'undefined' && window.location && window.location.origin) {
        return window.location.origin + u;
      }
    } catch (_) {}
  }
  return u;
}

/**
 * Trial end ISO for dashboard chrome.
 * Prefer site.trialEnd / Stripe trial fields; else checkout start + 7 days;
 * else derive from paidUntil (first hosting year start + 7 days).
 */
function getTrialEndIso(site) {
  if (!site) return null;
  if (site.trialEnd) return site.trialEnd;
  if (site.trial_end) return site.trial_end;
  const start =
    site.trialStart ||
    site.paidAt ||
    site.cardCollectedAt ||
    site.checkoutAt ||
    null;
  if (start) {
    const d = new Date(start);
    if (Number.isFinite(d.getTime())) {
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString();
    }
  }
  // paidUntil ≈ checkout + 12 months on first publish → trial end ≈ paidUntil − 1y + 7d
  if (site.paidUntil) {
    const until = new Date(site.paidUntil);
    if (Number.isFinite(until.getTime())) {
      const trialEnd = new Date(until);
      trialEnd.setUTCFullYear(trialEnd.getUTCFullYear() - 1);
      trialEnd.setUTCDate(trialEnd.getUTCDate() + 7);
      return trialEnd.toISOString();
    }
  }
  if (site.createdAt) {
    const d = new Date(site.createdAt);
    if (Number.isFinite(d.getTime())) {
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString();
    }
  }
  return null;
}

/**
 * Paid + live, not yet first invoice: show 7-day trial line instead of Hosting until.
 * After first charge / non-trial paid year, Hosting until remains.
 */
function isSiteInTrial(site) {
  if (!site || !site.paid) return false;
  if (isHostingExpired(site)) return false;
  if (site.billingState === 'paid' || site.chargedAt) return false;
  if (site.trialing === true) return true;
  if (site.billingState === 'trial') return true;
  const sub = String(
    site.subscriptionStatus || site.stripeSubscriptionStatus || ''
  ).toLowerCase();
  if (sub === 'trialing') return true;
  // Renewed hosting year (paidUntil far past createdAt) is not trial.
  if (site.createdAt && site.paidUntil) {
    const created = Date.parse(site.createdAt);
    const until = Date.parse(site.paidUntil);
    if (Number.isFinite(created) && Number.isFinite(until)) {
      const eighteenMonthsMs = 18 * 30 * 24 * 60 * 60 * 1000;
      if (until - created > eighteenMonthsMs) return false;
    }
  }
  const endIso = getTrialEndIso(site);
  if (!endIso) return false;
  const t = Date.parse(endIso);
  return Number.isFinite(t) && t > Date.now();
}

/** Soft-wrap a URL only at `/` so slug tokens (incl. hyphens) stay intact. */
function fillUrlWithSlashWbr(el, url) {
  if (!el) return;
  el.textContent = '';
  const parts = String(url || '').split('/');
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      el.insertAdjacentHTML('beforeend', '/<wbr>');
    }
    const seg = document.createElement('span');
    seg.className = 'success-url-seg site-live-seg';
    seg.textContent = parts[i];
    el.appendChild(seg);
  }
}

/** Hosting expired: status expired or paidUntil in the past. */
function isHostingExpired(site) {
  if (!site) return false;
  if (site.status === 'expired') return true;
  if (site.paidUntil) {
    const t = Date.parse(site.paidUntil);
    if (Number.isFinite(t) && t < Date.now()) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 18. Auth
// ---------------------------------------------------------------------------

async function fetchCurrentUser() {
  try {
    const data = await apiGet('/api/me');
    return data.user || null;
  } catch (e) {
    if (e.status === 401) return null;
    throw e;
  }
}

function updateUserUI(user) {
  currentUser = user;
  const badge = $('user-badge');
  const logoutBtn = $('btn-logout');
  const navDash = $('nav-dashboard');
  const acctLogoutItem = $('account-menu-logout');
  const acctLogoutAllItem = $('account-menu-logout-all');
  if (user) {
    if (badge) { badge.textContent = user.email || ('ID: ' + String(user.id).slice(0,8)); show(badge); }
    if (logoutBtn) show(logoutBtn);
    if (navDash) show(navDash);
    if (acctLogoutItem) show(acctLogoutItem);
    if (acctLogoutAllItem) show(acctLogoutAllItem);
  } else {
    if (badge) hide(badge);
    if (logoutBtn) hide(logoutBtn);
    if (navDash) hide(navDash);
    if (acctLogoutItem) hide(acctLogoutItem);
    if (acctLogoutAllItem) hide(acctLogoutAllItem);
    // Signed out (or session expired mid-edit) — a queued/in-flight server
    // autosave would just 401 pointlessly. The local draft is untouched, so
    // fall back to reflecting local-only save status instead of leaving a
    // stale "Se salvează…"/error pointed at a session that no longer exists.
    if (serverSaveTimer) { clearTimeout(serverSaveTimer); serverSaveTimer = null; }
    serverSaveInFlight = false;
    serverSaveQueuedAgain = false;
    if (hasEverEdited) setSaveState(localSaveOk ? 'saved' : 'error', localSaveOk ? '' : saveErrorMessage);
  }
}

/**
 * Shared logout — used by the header "Deconectare" button (visible outside the
 * editor) AND the editor topbar account menu (audit medium #7: there was no
 * way to reach logout, or the project list, once inside the editor).
 *
 * Wave 8 (AUDIT-07 re-audit): this now also revokes the session server-side
 * (bot/server.js POST /api/auth/logout), not just clears client-side state —
 * see bot/auth.js#revokeSession.
 */
async function doLogout() {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
  updateUserUI(null);
  showToast('Te-ai deconectat.', '', 3000);
  window.location.hash = '#templates';
}

/**
 * "Deconectare de pe toate dispozitivele" — ends every session for this
 * account, not just the current browser (Wave 8 / AUDIT-07 re-audit). Meant
 * for the case where the account's magic-link email may have been read by
 * someone else: one click ends every device's access, not only this one.
 */
async function doLogoutEverywhere() {
  const confirmed = window.confirm(
    'Sigur vrei să te deconectezi de pe toate telefoanele și calculatoarele conectate la acest cont?'
  );
  if (!confirmed) return;
  try { await fetch('/api/auth/logout-everywhere', { method: 'POST', credentials: 'include' }); } catch (_) {}
  updateUserUI(null);
  showToast('Te-ai deconectat de pe toate dispozitivele.', '', 3000);
  window.location.hash = '#templates';
}

/** Editor-topbar account menu: "Proiectele mele" + "Deconectare" (audit medium #7). */
function openAccountMenu() {
  const menu = $('account-menu');
  const btn = $('btn-account-menu');
  if (!menu || !btn) return;
  const rect = btn.getBoundingClientRect();
  menu.style.top = (rect.bottom + 6) + 'px';
  menu.style.left = rect.left + 'px';
  menu.style.display = '';
  accountMenuOpen = true;
  btn.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => {
    const first = menu.querySelector('button:not([style*="display: none"])');
    if (first) first.focus();
  });
}

function closeAccountMenu() {
  const menu = $('account-menu');
  const btn = $('btn-account-menu');
  if (menu) menu.style.display = 'none';
  accountMenuOpen = false;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function tryTelegramAuth() {
  const twa = window.Telegram && window.Telegram.WebApp;
  if (!twa || !twa.initData) return;
  apiPost('/api/auth/telegram', { initData: twa.initData })
    .then(data => { if (data.ok) updateUserUI(data.user); })
    .catch(e => console.warn('Telegram auth:', e.message));
}

// ---------------------------------------------------------------------------
// 19. Device mode toggle
// ---------------------------------------------------------------------------

function setDeviceMode(mode) {
  deviceMode = mode;
  const wrap = $('editor-canvas-wrap');
  const iframe = $('preview-iframe');
  const desktopBtn = $('btn-preview-desktop');
  const mobileBtn = $('btn-preview-mobile');

  if (mode === 'mobile') {
    if (wrap) wrap.classList.add('mode-mobile');
    if (iframe) iframe.classList.add('mode-mobile');
    if (desktopBtn) { desktopBtn.classList.remove('active'); desktopBtn.setAttribute('aria-pressed','false'); }
    if (mobileBtn)  { mobileBtn.classList.add('active'); mobileBtn.setAttribute('aria-pressed','true'); }
  } else {
    if (wrap) wrap.classList.remove('mode-mobile');
    if (iframe) iframe.classList.remove('mode-mobile');
    if (desktopBtn) { desktopBtn.classList.add('active'); desktopBtn.setAttribute('aria-pressed','true'); }
    if (mobileBtn)  { mobileBtn.classList.remove('active'); mobileBtn.setAttribute('aria-pressed','false'); }
  }
}

// ---------------------------------------------------------------------------
// 20. Publish flow
// ---------------------------------------------------------------------------

function extractImages(config) {
  const images = [];
  const clean = deepClone(config);
  const DATA_URL_RE = /data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+/gi;

  function extOf(dataUrl) {
    const m = /^data:image\/(jpeg|jpg|png|webp)/i.exec(dataUrl || '');
    if (!m) return 'jpg';
    const t = m[1].toLowerCase();
    return t === 'jpeg' ? 'jpg' : t;
  }

  function isCssish(key, val) {
    return /background|style|gradient/i.test(key || '') ||
      /url\s*\(/i.test(val || '') ||
      /linear-gradient/i.test(val || '');
  }

  function allocate(key, dataUrl) {
    const ext = extOf(dataUrl);
    const k = String(key || '');
    if (k === 'logo' || /logo/i.test(k)) {
      return { name: 'logo', file: 'logo.' + ext };
    }
    if (/background/i.test(k) || /^hero$/i.test(k)) {
      const n = images.filter((x) => String(x.name).startsWith('hero')).length + 1;
      const name = n === 1 ? 'hero' : 'hero-' + n;
      return { name, file: name + '.' + ext };
    }
    const n = images.filter((x) => String(x.name).startsWith('gallery')).length + 1;
    const name = 'gallery-' + n;
    return { name, file: name + '.' + ext };
  }

  function takeDataUrl(raw) {
    return String(raw || '').replace(/\s+/g, '');
  }

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== 'string') {
        walk(v);
        continue;
      }

      // Pure data-URL field (logo, photo src, etc.)
      if (v.startsWith('data:image/')) {
        const dataUrl = takeDataUrl(v);
        const { name, file } = allocate(k, dataUrl);
        images.push({ name, dataUrl });
        const local = 'images/' + file;
        obj[k] = isCssish(k, v) ? "url('" + local + "')" : local;
        continue;
      }

      // CSS / mixed strings with url(data:image...) (hero.background)
      if (v.includes('data:image/')) {
        let next = v;
        const found = v.match(DATA_URL_RE) || [];
        for (const raw of found) {
          const dataUrl = takeDataUrl(raw);
          const { name, file } = allocate(k, dataUrl);
          images.push({ name, dataUrl });
          const local = 'images/' + file;
          next = next.split(raw).join(local);
        }
        obj[k] = next;
        continue;
      }

      walk(v);
    }
  }
  walk(clean);
  return { cleanConfig: clean, images };
}

async function openPublishModal() {
  show($('publish-step-1'));
  hide($('publish-step-2'));
  hide($('auth-sent'));
  show($('form-auth-email'));
  hideId('auth-error');
  hideId('slug-error');

  const invalidUrlInput = document.querySelector('.field-input--url[aria-invalid="true"]');
  if (invalidUrlInput) {
    showToast(invalidUrlInput.validationMessage || 'Verifică linkul introdus.', 'error', 5000);
    openDrawer();
    invalidUrlInput.focus();
    return;
  }

  // Validate required fields
  if (currentTemplate && currentTemplate.data && currentTemplate.data.schema) {
    const required = getRequiredFields(currentTemplate.data.schema);
    const missing = required.filter(f => !isFieldComplete(f));
    if (missing.length > 0) {
      const firstMissing = missing[0];
      const msgParts = missing.map(f => f.label || f.key);
      showToast('Completează mai întâi: ' + msgParts.slice(0,3).join(', '), 'error', 5000);
      // Highlight in iframe
      sendHighlightToIframe(firstMissing.key);
      // Open drawer, scrolled to and focused on the actual missing field —
      // not just Details' first row (see openDrawer()'s focusKey param).
      if (isDrawerField(firstMissing)) {
        openDrawer(firstMissing.key);
      }
      return;
    }
  }

  // Fresh #edit after pay may not have gone through loadSiteForEdit — bind first
  await bindSignedInPaidSiteForEdit();

  // Paid #edit republish: keep existing slug — never ask for a new address that collides
  if (currentSiteId && currentSitePaid) {
    doActualPublish(currentSiteSlug || undefined);
    return;
  }

  const businessName = getPath(draft.config, 'business.name') || '';
  const slugInput = $('input-slug');
  if (slugInput && currentSiteSlug) {
    // Unpaid draft already has a reserved slug — reuse it
    slugInput.value = currentSiteSlug;
    slugInput.dataset.manuallyEdited = '';
    scheduleSlugCheck(currentSiteSlug);
  } else if (slugInput && businessName) {
    const s = toSlug(businessName);
    slugInput.value = s;
    slugInput.dataset.manuallyEdited = '';
    scheduleSlugCheck(s);
  } else if (slugInput) {
    updateSlugPreview('');
  }

  openModal('modal-publish');
}

function scheduleSlugCheck(value) {
  if (slugCheckTimer) clearTimeout(slugCheckTimer);
  updateSlugPreview(value, 'checking');
  slugCheckTimer = setTimeout(() => checkSlug(value), 550);
}

function updateSlugPreview(slug, state) {
  const preview = $('slug-preview');
  const icon = $('slug-status-icon');
  const domain = appConfig.brandDomain || 'sites.hidook.agency';

  if (!slug) {
    if (preview) { preview.textContent = ''; preview.className = 'slug-preview'; }
    if (icon) icon.textContent = '';
    slugValid = false;
    return;
  }

  if (preview) {
    preview.textContent = slug + '.' + domain;
    preview.className = 'slug-preview' + (state === 'valid' ? ' valid' : '');
  }

  if (icon) {
    if (state === 'checking') icon.textContent = '...';
    else if (state === 'valid') icon.textContent = '✓';
    else if (state === 'taken') icon.textContent = '✗';
    else icon.textContent = '';
  }
}

async function checkSlug(rawSlug) {
  const slugInput = $('input-slug');
  const errorEl = $('slug-error');
  if (!rawSlug) { slugValid = false; return; }

  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(rawSlug) && rawSlug.length < 3) {
    updateSlugPreview(rawSlug, 'invalid');
    if (errorEl) { errorEl.textContent = 'Adresa trebuie să aibă cel puțin 3 caractere (litere mici, cifre, cratime).'; show(errorEl); }
    slugValid = false;
    return;
  }

  // Own site slug is always OK (republish / unpaid draft)
  const own = currentSiteSlug && String(rawSlug) === String(currentSiteSlug);
  if (own) {
    slugNormalized = rawSlug;
    updateSlugPreview(rawSlug, 'valid');
    if (errorEl) hide(errorEl);
    slugValid = true;
    if (slugInput) slugInput.value = rawSlug;
    return;
  }

  try {
    const data = await apiGet('/api/slug-check?slug=' + encodeURIComponent(rawSlug));
    slugNormalized = data.slug || rawSlug;
    if (data.available || (currentSiteSlug && slugNormalized === currentSiteSlug)) {
      updateSlugPreview(slugNormalized, 'valid');
      if (errorEl) hide(errorEl);
      slugValid = true;
      if (slugInput) slugInput.value = slugNormalized;
    } else {
      updateSlugPreview(slugNormalized, 'taken');
      if (errorEl) { errorEl.textContent = PUBLISH_SLUG_COLLISION_MESSAGE; show(errorEl); }
      slugValid = false;
    }
  } catch (_) {
    updateSlugPreview(rawSlug, 'valid');
    slugValid = true;
    slugNormalized = rawSlug;
    if (errorEl) hide(errorEl);
  }
}

async function doActualPublish(chosenSlug) {
  if (!currentUser) {
    hide($('publish-step-1'));
    show($('publish-step-2'));
    show($('form-auth-email'));
    hide($('auth-sent'));
    wireAuthForm(() => doActualPublish(chosenSlug));
    return;
  }

  const continueBtn = $('btn-publish-continue');
  setBtnLoading(continueBtn, true, 'Se publică…');
  try {
    await execPublish(chosenSlug);
  } catch (e) {
    showToast('Publicarea a eșuat. Încearcă din nou.', 'error', 5000);
  } finally {
    setBtnLoading(continueBtn, false);
  }
}

async function execPublish(slug) {
  deriveWaHref(draft.config);
  const { cleanConfig, images } = extractImages(draft.config);
  const payload = {
    templateId: draft.templateId,
    config: cleanConfig,
    images,
    slug: slug || undefined,
  };
  if (currentSiteId) payload.siteId = currentSiteId;

  const data = await apiPost('/api/publish', payload);
  if (!data.site) { showToast('Răspuns neașteptat de la server.', 'error'); return; }

  closeModal('modal-publish');

  currentSiteId = data.site.id;
  publishedSiteId = data.site.id;
  publishedSiteUrl = data.site.url;
  sitePaymentUrl = data.paymentUrl || null;
  currentSitePaid = !!data.site.paid;
  if (data.site.slug) currentSiteSlug = data.site.slug;
  saveDraft();

  showSuccessScreen(data.site.url, data.paymentUrl);
}

/** Unauth #dashboard Intră — same magic-link modal as publish (no second auth system). */
function wireDashboardAuthButton() {
  const btn = $('btn-dashboard-auth');
  if (!btn) return;
  btn.onclick = () => {
    hide($('publish-step-1'));
    show($('publish-step-2'));
    show($('form-auth-email'));
    hide($('auth-sent'));
    hideId('auth-error');
    openModal('modal-publish');
    wireAuthForm(async () => {
      closeModal('modal-publish');
      const user = await fetchCurrentUser().catch(() => null);
      updateUserUI(user);
      if (user) await loadDashboard();
    });
  };
}

function wireAuthForm(onAuthSuccess) {
  const form = $('form-auth-email');
  const sentDiv = $('auth-sent');
  const errorDiv = $('auth-error');
  const devLink = $('dev-link');

  if (form) form.style.display = '';
  if (sentDiv) sentDiv.style.display = 'none';
  if (errorDiv) errorDiv.style.display = 'none';

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const emailInput = $('input-email');
      const email = emailInput ? emailInput.value.trim() : '';
      if (!email) {
        if (errorDiv) { errorDiv.textContent = 'Introdu adresa de email.'; show(errorDiv); }
        return;
      }
      const submitBtn = $('btn-send-magic');
      setBtnLoading(submitBtn, true, 'Se trimite…');
      if (errorDiv) hide(errorDiv);
      try {
        const res = await apiPost('/api/auth/email', { email });
        if (form) hide(form);
        if (sentDiv) show(sentDiv);
        if (res.devLink && devLink) {
          devLink.href = res.devLink;
          devLink.textContent = 'Deschide site-ul';
          show(devLink);
          devLink.addEventListener('click', async (ev) => {
            // Keep SPA: verify via fetch so draft/publish resume works (S62)
            ev.preventDefault();
            try {
              const href = devLink.getAttribute('href') || res.devLink;
              await fetch(href, { credentials: 'include', redirect: 'follow' });
              const user = await fetchCurrentUser().catch(() => null);
              if (user) {
                updateUserUI(user);
                closeModal('modal-publish');
                hideToast();
                clearPreviewOverlays();
                if (onAuthSuccess) {
                  setLoading(true, 'Se publică…');
                  try { await onAuthSuccess(); } catch (_) {} finally { setLoading(false); }
                } else if (await resumeLocalDraft()) {
                  window.location.hash = '#edit';
                } else {
                  window.location.hash = '#dashboard';
                }
              } else {
                window.location.href = href;
              }
            } catch (_) {
              window.location.href = devLink.href || res.devLink;
            }
          });
        }
      } catch (err) {
        // audit medium #6: the server sends a specific reason (rate limit, invalid
        // email, service unavailable) — show it instead of masking it with a
        // generic string (apiPost() already gives us err.message from json.error).
        // Audit finding #6 asked for the server's specific reason instead of
        // one generic string. But only the server's -- a transport failure
        // still gets the Romanian fallback, never the browser's own English
        // exception text.
        const serverReason = err && err.fromServer && err.message ? err.message : '';
        if (errorDiv) { errorDiv.textContent = serverReason || 'Nu am putut trimite linkul. Încearcă din nou.'; show(errorDiv); }
      } finally {
        setBtnLoading(submitBtn, false);
      }
    };
  }
}

function clearPreviewOverlays() {
  try {
    const iframe = getPreviewIframe && getPreviewIframe();
    const doc = iframe && (iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document));
    if (!doc) return;
    const qr = doc.getElementById('wa-qr');
    if (qr) {
      qr.hidden = true;
      try { qr.setAttribute('hidden', ''); } catch (_) {}
    }
    try { doc.body.style.overflow = ''; } catch (_) {}
  } catch (_) { /* cross-origin or missing preview */ }
}

function showSuccessScreen(url, paymentUrl) {
  // One coherent chrome state: never stack pay-loading / QR / stale toasts on success.
  setLoading(false);
  hideToast();
  clearPreviewOverlays();
  closeModal('modal-publish');

  const titleEl = $('modal-success-title');
  const draftNote = $('success-draft-note');
  const urlText = $('success-url-text');
  const urlLink = $('success-url-link');
  const copyBtn = $('btn-copy-url');
  const isLive = isLiveSiteUrl(url);
  const href = isLive ? absoluteSiteUrl(url) : '';

  if (isLive) {
    if (titleEl) titleEl.textContent = 'Site-ul tău e live — trial de 7 zile început';
    if (draftNote) hide(draftNote);
    if (urlText) {
      // Soft-wrap only at `/` so long /live/<slug>/ is fully readable at 390px
      // without splitting the slug token at hyphens (S99/S107).
      // Static tests (s99/s103) require split('/') + literal '/<wbr>' in source.
      // Prefer absolute same-origin display so stranger can copy a working URL.
      fillUrlWithSlashWbr(urlText, href || url);
    }
    if (urlLink) { urlLink.href = href || url; show(urlLink); }
    if (copyBtn) show(copyBtn);
  } else {
    if (titleEl) titleEl.textContent = 'Adaugă un card ca să fii live';
    if (draftNote) show(draftNote);
    if (urlLink) hide(urlLink);
    if (copyBtn) hide(copyBtn);
  }

  const payBtn = $('btn-pay-publish');
  const successPrice = $('success-price');
  if (payBtn) {
    // Paid/live: never show first-publish pay CTA
    if (isLive) {
      hide(payBtn);
    } else if (paymentUrl) {
      show(payBtn);
      payBtn.onclick = () => { window.location.href = paymentUrl; };
      if (successPrice) successPrice.textContent = formatPriceLabel(appConfig);
    } else {
      hide(payBtn);
    }
  }

  const waBtn = $('btn-share-wa');
  if (waBtn) {
    if (isLive) {
      show(waBtn);
      const businessName = getPath(draft.config, 'business.name') || 'Site-ul nostru';
      const shareUrl = href || url;
      const waText = encodeURIComponent('Salut! Am creat site-ul pentru ' + businessName + ': ' + shareUrl);
      waBtn.onclick = () => { window.open('https://wa.me/?text=' + waText, '_blank', 'noopener'); };
    } else {
      hide(waBtn);
    }
  }

  openModal('modal-success');
}

/**
 * HIDOOK_TEST_PAY offline return: #test-checkout=cs_test_* completes the same
 * paid transition as the unsigned test webhook (POST /api/test-pay/complete).
 */
async function completeTestCheckout(sessionId) {
  const id = String(sessionId || '').trim();
  if (!/^cs_test_[A-Za-z0-9]+$/.test(id)) {
    showToast('Sesiune de plată invalidă.', 'error');
    return;
  }
  setLoading(true, 'Se confirmă plata…');
  try {
    const data = await apiPost('/api/test-pay/complete', { sessionId: id });
    const site = data && data.site;
    if (site && site.id) {
      currentSiteId = site.id;
      publishedSiteId = site.id;
      publishedSiteUrl = site.url || null;
      currentSitePaid = !!site.paid;
      if (site.slug) currentSiteSlug = site.slug;
      // Dashboard pay often has empty in-memory draft — bind template+config so
      // «Înapoi la editor» / fresh #edit open the paid site, not the catalog (S92).
      await ensureDraftBoundToPaidSite(site.id);
      saveDraft();
    }
    // Drop pay-loading before any success chrome so title and loader never contradict.
    setLoading(false);
    hideToast();
    clearPreviewOverlays();
    if (site && isLiveSiteUrl(site.url)) {
      sitePaymentUrl = null;
      showSuccessScreen(site.url, null);
      showToast('Trial început. Site-ul tău e live.', 'success', 6000);
    } else if (site && site.paid) {
      try {
        const fresh = await apiGet('/api/sites/' + encodeURIComponent(site.id));
        const s = fresh && fresh.site;
        if (s && isLiveSiteUrl(s.url)) {
          publishedSiteUrl = s.url;
          showSuccessScreen(s.url, null);
          showToast('Trial început. Site-ul tău e live.', 'success', 6000);
        } else if (s && s.url) {
          publishedSiteUrl = s.url;
          showSuccessScreen(s.url, null);
          showToast('Trial început. Site-ul tău e live.', 'success', 6000);
        } else {
          showToast('Trial început. Publicarea se finalizează în câteva momente.', 'success', 6000);
        }
      } catch (_) {
        showToast('Trial început. Publicarea se finalizează în câteva momente.', 'success', 6000);
      }
    } else {
      showToast('Plata a fost procesată.', 'success', 5000);
    }
  } catch (e) {
    setLoading(false);
    showToast('Nu am putut confirma plata. Încearcă din nou.', 'error', 6000);
  } finally {
    setLoading(false);
  }
}

/**
 * After dashboard test-pay (or bare #edit with empty local draft), load the paid
 * site's templateId+config into draft so the editor opens that site — not #templates.
 * Does not overwrite an in-progress draft that already has a templateId.
 */
async function ensureDraftBoundToPaidSite(preferredSiteId) {
  try {
    if (draft.templateId && draft.config) {
      // Keep current editor work; still refresh bind ids if preferred matches
      if (preferredSiteId && currentSiteId === preferredSiteId) saveDraft();
      return true;
    }
    const saved = loadDraft();
    if (saved && saved.templateId && saved.config) {
      return resumeLocalDraft();
    }

    let site = null;
    let config = null;
    const wantId = preferredSiteId || currentSiteId || (saved && saved.siteId) || null;

    if (wantId) {
      try {
        const data = await apiGet('/api/sites/' + encodeURIComponent(wantId));
        site = data && data.site;
        config = data && data.config;
      } catch (_) { /* fall through to list */ }
    }

    if (!site || !config) {
      const list = await apiGet('/api/sites').catch(() => null);
      const sites = (list && list.sites) || [];
      const paid = sites.filter((s) => s && s.paid);
      let pick = null;
      if (wantId) pick = paid.find((s) => s.id === wantId) || null;
      if (!pick && paid.length === 1) pick = paid[0];
      else if (!pick && paid.length > 1) {
        // Prefer product-menu restaurant if present (common dash-pay path); else first paid
        pick = paid.find((s) => s.templateId === 'product-menu') || paid[0];
      }
      if (!pick) return false;
      try {
        const data = await apiGet('/api/sites/' + encodeURIComponent(pick.id));
        site = data && data.site;
        config = data && data.config;
      } catch (_) {
        return false;
      }
    }

    if (!site || !config || !site.templateId) return false;

    currentSiteId = site.id;
    currentSitePaid = !!site.paid;
    currentSiteSlug = site.slug || site.projectName || '';
    publishedSiteId = site.id;
    if (site.url) publishedSiteUrl = site.url;
    draft.templateId = site.templateId;
    draft.config = deepClone(config);
    if (typeof resetHistory === 'function') resetHistory();

    let tplData = null;
    try {
      tplData = await ensureTemplateLoaded(site.templateId);
    } catch (_) {
      tplData = getTemplateById(site.templateId);
    }
    const registry = getTemplateList();
    const meta = (registry || []).find((t) => t.id === site.templateId) || {
      id: site.templateId,
      name: site.templateId,
      description: '',
    };
    currentTemplate = { meta, data: tplData };
    previewFirstRender = false;
    iframeReady = false;
    previewCookieAccepted = false;
    const nameEl = $('editor-template-name');
    if (nameEl) nameEl.textContent = meta.name;
    saveDraft();
    return true;
  } catch (_) {
    return false;
  }
}

/** Alias used by #edit empty-draft path (S92). */
async function loadPaidSiteForEmptyEdit() {
  return ensureDraftBoundToPaidSite(null);
}

/** Restore local draft into editor state (after magic-link / empty dashboard). */
async function resumeLocalDraft() {
  const saved = loadDraft();
  if (!saved || !saved.templateId || !saved.config) return false;
  let tplData = null;
  try {
    tplData = await ensureTemplateLoaded(saved.templateId);
  } catch (_) {
    tplData = getTemplateById(saved.templateId);
  }
  const registryList = getTemplateList();
  const meta = (registryList || []).find(t => t.id === saved.templateId);
  if (!tplData || !meta) return false;
  draft.templateId = saved.templateId;
  draft.config = deepClone(saved.config);
  isFreshDemoDraft = !!saved.isFreshDemoDraft;
  demoBannerDismissed = !!saved.demoBannerDismissed;
  if (typeof resetHistory === 'function') resetHistory();
  // Restore paid-site bind from draft (fresh #edit without loadSiteForEdit)
  if (saved.siteId) {
    currentSiteId = saved.siteId;
    currentSitePaid = !!saved.paid;
    if (saved.slug) currentSiteSlug = saved.slug;
    publishedSiteId = saved.siteId;
  }
  currentTemplate = { meta, data: tplData };
  previewFirstRender = false;
  iframeReady = false;
  previewCookieAccepted = false;
  const nameEl = $('editor-template-name');
  if (nameEl) nameEl.textContent = meta.name;
  return true;
}

// ---------------------------------------------------------------------------
// 21. Templates screen
// ---------------------------------------------------------------------------

async function reloadTemplateRegistry() {
  const button = $('btn-retry-templates');
  if (button) {
    button.disabled = true;
    button.textContent = 'Se încarcă…';
  }
  try {
    const response = await fetch('/app/generated/templates-data.js', {
      credentials: 'same-origin',
      cache: 'no-cache',
    });
    if (!response.ok) throw new Error('Template registry HTTP ' + response.status);
    const source = await response.text();
    const runRegistry = new Function(source);
    runRegistry();
    if (getTemplateList().length === 0) throw new Error('Template registry is empty');
    renderTemplatesGrid();
  } catch (_) {
    if (button) {
      button.disabled = false;
      button.textContent = 'Reîncearcă';
    }
    showToast('Designurile nu s-au încărcat. Reîncearcă.', 'error');
  }
}

function renderTemplatesGrid() {
  const grid = $('templates-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const registry = getTemplateList();
  if (!registry || registry.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">&#128200;</div><p>Designurile nu sunt disponibile momentan.</p><button type="button" class="btn-ghost" id="btn-retry-templates">Reîncearcă</button></div>';
    $('btn-retry-templates').addEventListener('click', reloadTemplateRegistry);
    return;
  }

  registry.forEach(tpl => {
    const card = document.createElement('div');
    card.className = 'template-card';
    card.setAttribute('role', 'listitem');
    card.dataset.templateId = tpl.id;
    card.dataset.vertical = tpl.vertical || tpl.id;

    const previewWrap = document.createElement('div');
    previewWrap.className = 'template-card-preview';

    const shimmer = document.createElement('div');
    shimmer.className = 'template-card-preview-shimmer';
    previewWrap.appendChild(shimmer);

    // Light-registry photo thumbs must paint on every card immediately.
    // IntersectionObserver + small rootMargin left row-2 (professionals /
    // desserdirina) as beige shimmer-only with no <img> until the stranger scrolls.
    if (tpl.thumbnail) {
      loadCardPreview(tpl.id, previewWrap, shimmer);
    } else {
      let previewLoaded = false;
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !previewLoaded) {
          previewLoaded = true;
          observer.disconnect();
          loadCardPreview(tpl.id, previewWrap, shimmer);
        }
      }, { rootMargin: '400px' });
      observer.observe(previewWrap);
    }

    const body = document.createElement('div');
    body.className = 'template-card-body';
    const badge = designBadgeLabel(tpl);
    body.innerHTML = `
      <span class="template-card-badge">${escHtml(badge)}</span>
      <div class="template-card-title">${escHtml(tpl.name)}</div>
      <div class="template-card-desc">${escHtml(tpl.description || '')}</div>
      <div class="template-card-actions">
        <button class="btn-primary btn-start-tpl" data-id="${escHtml(tpl.id)}" aria-label="Începe cu designul ${escHtml(tpl.name)}">Începe</button>
        <button class="btn-ghost btn-preview-tpl" data-id="${escHtml(tpl.id)}" aria-label="Previzualizează ${escHtml(tpl.name)}">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><ellipse cx="8" cy="8" rx="7" ry="5" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/></svg>
          Previzualizare
        </button>
      </div>`;

    body.querySelector('.btn-start-tpl').addEventListener('click', (e) => { e.stopPropagation(); startWithTemplate(tpl.id); });
    body.querySelector('.btn-preview-tpl').addEventListener('click', (e) => { e.stopPropagation(); openPreviewModal(tpl.id); });
    card.addEventListener('click', () => startWithTemplate(tpl.id));

    card.appendChild(previewWrap);
    card.appendChild(body);
    grid.appendChild(card);
  });

  applyCatalogFilter(activeCatalogFilter);
  populateHeroStage(registry);
}

let activeCatalogFilter = 'all';
let heroStagePopulated = false;

function applyCatalogFilter(filter) {
  activeCatalogFilter = filter || 'all';
  document.querySelectorAll('#catalog-chips .catalog-chip').forEach((chip) => {
    const on = chip.dataset.filter === activeCatalogFilter;
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.querySelectorAll('#templates-grid .template-card').forEach((card) => {
    const vert = card.dataset.vertical || card.dataset.templateId || '';
    const id = card.dataset.templateId || '';
    const show = activeCatalogFilter === 'all'
      || vert === activeCatalogFilter
      || id === activeCatalogFilter;
    card.hidden = !show;
  });
}

function populateHeroStage(registry) {
  const stack = $('hero-stage-stack');
  if (!stack || !registry || !registry.length) return;
  if (heroStagePopulated) return;
  const slots = stack.querySelectorAll('[data-stage-slot]');
  if (!slots.length) return;
  // Center restaurant (product proof), sides = other owned templates
  const ordered = [];
  const rest = registry.find((t) => t.id === 'product-menu' || t.vertical === 'product-menu');
  const others = registry.filter((t) => t !== rest);
  if (others[0]) ordered.push(others[0]);
  ordered.push(rest || registry[0]);
  if (others[1]) ordered.push(others[1]);
  else if (others[0] && ordered.length < 3) ordered.push(others[0]);
  while (ordered.length < slots.length) ordered.push(registry[ordered.length % registry.length]);

  slots.forEach((slot, i) => {
    const tpl = ordered[i];
    if (!tpl) return;
    // Prefer light thumbnail so hero stage paints without waiting on heavy payloads.
    if (tpl.thumbnail) {
      const img = document.createElement('img');
      img.src = tpl.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      slot.innerHTML = '';
      slot.appendChild(img);
      return;
    }
    ensureTemplateLoaded(tpl.id).then((tplData) => {
      if (!tplData || typeof window.HidookEngine === 'undefined') return;
      try {
        const presets = tplData.presets || [];
        const config = presets.length > 0 ? presets[0].config : {};
        const html = window.HidookEngine.renderPreview(tplData.files, config);
        const iframe = document.createElement('iframe');
        iframe.title = '';
        iframe.setAttribute('sandbox', 'allow-scripts');
        iframe.setAttribute('tabindex', '-1');
        iframe.srcdoc = html;
        slot.innerHTML = '';
        slot.appendChild(iframe);
      } catch (_) { /* keep empty paper card */ }
    }).catch(() => {});
  });
  heroStagePopulated = true;
}

function loadCardPreview(templateId, wrap, shimmer) {
  const registry = getTemplateList();
  const meta = (registry || []).find((t) => t.id === templateId);
  // Fast path: static thumbnail from light registry (no heavy JS, no base64).
  if (meta && meta.thumbnail) {
    const img = document.createElement('img');
    img.className = 'template-card-preview-thumb';
    img.alt = 'Previzualizare ' + (meta.name || 'design');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = meta.thumbnail;
    img.addEventListener('load', () => shimmer.classList.add('loaded'));
    img.addEventListener('error', () => shimmer.classList.add('loaded'));
    wrap.appendChild(img);
    return;
  }

  ensureTemplateLoaded(templateId).then((tplData) => {
    if (!tplData || typeof window.HidookEngine === 'undefined') {
      shimmer.classList.add('loaded');
      return;
    }
    try {
      const presets = tplData.presets || [];
      const config = presets.length > 0 ? presets[0].config : {};
      const html = window.HidookEngine.renderPreview(tplData.files, config);

      const iframe = document.createElement('iframe');
      iframe.className = 'template-card-preview-frame';
      iframe.title = 'Previzualizare design';
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.addEventListener('load', () => shimmer.classList.add('loaded'));
      iframe.srcdoc = html;
      wrap.appendChild(iframe);
    } catch (_) {
      shimmer.classList.add('loaded');
    }
  }).catch(() => shimmer.classList.add('loaded'));
}

async function startWithTemplate(templateId) {
  const registry = getTemplateList();
  const meta = registry.find(t => t.id === templateId);

  let tplData;
  try {
    tplData = await ensureTemplateLoaded(templateId);
  } catch (e) {
    showToast('Nu am putut încărca designul. Încearcă din nou.', 'error');
    return;
  }

  if (!tplData || !meta) {
    showToast('Nu am putut încărca designul. Încearcă din nou.', 'error');
    return;
  }

  hideToast();

  // Wave 9 (save-state audit): the local draft slot below is a SINGLE global
  // key — starting a different template overwrites it outright. This
  // switch is never blocked on a confirmation (it must stay a plain,
  // synchronous UI action — existing walkthroughs, including the frozen
  // fullpass oracle, click straight through it with no dialog to answer),
  // but it must never be a SILENT loss either: best-effort back the old
  // draft up to the account when possible (recoverable afterwards from
  // "Proiectele mele"), and always say plainly what happened.
  const existingDraftForSwitch = loadDraft();
  if (existingDraftForSwitch && existingDraftForSwitch.templateId &&
      existingDraftForSwitch.templateId !== templateId && existingDraftForSwitch.config) {
    const existingMeta = registry.find(t => t.id === existingDraftForSwitch.templateId);
    const existingName = (existingMeta && existingMeta.name) || existingDraftForSwitch.templateId;
    // typeof-guarded like the pushHistory/TAB_ID checks inside saveDraft() —
    // the isolated-extraction sandbox (s80-s78-qa-fail.test.js) evals this
    // function without currentUser/apiPost declared.
    if (typeof currentUser !== 'undefined' && currentUser && typeof apiPost === 'function' && !existingDraftForSwitch.paid) {
      apiPost('/api/draft', {
        siteId: existingDraftForSwitch.siteId || undefined,
        templateId: existingDraftForSwitch.templateId,
        config: existingDraftForSwitch.config,
      }).catch(() => { /* best-effort only — the toast below already tells the owner what happened */ });
    }
    // Keep the replaced draft recoverable. The account backup above only runs
    // for a signed-in owner; an anonymous first-time visitor trying a second
    // design would otherwise lose their work outright, and trying designs is
    // exactly what a first-time visitor does.
    try {
      lsSet(REPLACED_DRAFT_KEY, {
        templateId: existingDraftForSwitch.templateId,
        config: existingDraftForSwitch.config,
        siteId: existingDraftForSwitch.siteId || null,
        replacedAt: Date.now(),
      });
    } catch (_) { /* storage full: the toast below still tells them */ }

    const switchNoticeSignedIn = typeof currentUser !== 'undefined' && !!currentUser;
    showToast(
      'Proiectul pe designul „' + existingName + '” a fost înlocuit aici' +
        (switchNoticeSignedIn ? ' — îl găsești în Proiectele mele.' : '.'),
      '',
      6000
    );
  }

  // Always drop paid-site bind when starting a design from the catalog.
  // Same-template republish re-binds via bindSignedInPaidSiteForEdit (template match).
  // Different template must never keep the previous paid siteId in draft (S78/S80).
  currentSiteId = null;
  currentSitePaid = false;
  currentSiteSlug = '';
  publishedSiteId = null;
  draft.templateId = templateId;

  const saved = loadDraft();
  if (saved && saved.templateId === templateId && saved.config) {
    draft.config = saved.config;
    isFreshDemoDraft = false;
  } else {
    const presets = tplData.presets || [];
    draft.config = presets.length > 0 ? deepClone(presets[0].config) : {};
    isFreshDemoDraft = true;
  }
  demoBannerDismissed = false;
  if (typeof resetHistory === 'function') resetHistory();
  // Persist cleared bind so localStorage cannot re-attach a foreign paid siteId.
  saveDraft();
  // Wave 9: this saveDraft() call is bookkeeping (clearing the paid-site
  // bind / seeding the preset), not a user edit — resetHistory() already put
  // the save-state pill at 'idle' above, but saveDraft() (the single choke
  // point) always flips it to 'saved' on success. Flatten it back so the
  // owner does not see "Salvat" before touching anything on a freshly
  // chosen design. Guarded like every other Wave 9 reference in this file.
  if (typeof hasEverEdited !== 'undefined') hasEverEdited = false;
  if (typeof setSaveState === 'function') setSaveState('idle');

  currentTemplate = { meta, data: tplData };
  previewFirstRender = false;
  iframeReady = false;
  previewCookieAccepted = false;

  const nameEl = $('editor-template-name');
  if (nameEl) nameEl.textContent = meta.name;

  prepareDrawerForNewDesign();
  window.location.hash = '#edit';
}

let previewModalGeneration = 0;

async function openPreviewModal(templateId) {
  const previewGeneration = ++previewModalGeneration;
  // The generated site owns consent inside its preview. Keep the builder-origin
  // notice out of this modal so it cannot cover or intercept iframe controls.
  document.body.classList.add('preview-cookie-isolated');
  const registry = getTemplateList();
  const meta = (registry || []).find(t => t.id === templateId) || {};

  const title = $('modal-preview-title');
  if (title) title.textContent = 'Previzualizare: ' + (meta.name || templateId);

  let iframe = $('preview-modal-iframe');
  let previewDocumentGeneration = 0;
  let clearPreviewReadyListener = null;

  function replacePreviewDocument(html, readyOnLoad) {
    if (!iframe) return;
    const readyToken = 'hb-preview-ready-' + previewGeneration + '-' + (++previewDocumentGeneration);
    if (clearPreviewReadyListener) clearPreviewReadyListener();

    function markPreviewLoading(target) {
      target.setAttribute('aria-busy', 'true');
      target.dataset.previewReady = 'false';
      target.classList.remove('preview-iframe--loading');
    }

    const interactiveHtml = readyOnLoad
      ? prepareInteractivePreviewDocument(String(html || ''), readyToken)
      : String(html || '');
    if (typeof iframe.cloneNode !== 'function' || typeof iframe.replaceWith !== 'function') {
      if (readyOnLoad) clearPreviewReadyListener = waitForInteractivePreview(iframe, readyToken);
      else markPreviewLoading(iframe);
      iframe.srcdoc = interactiveHtml;
      return;
    }
    const replacement = iframe.cloneNode(false);
    iframe.replaceWith(replacement);
    iframe = replacement;
    if (readyOnLoad) clearPreviewReadyListener = waitForInteractivePreview(replacement, readyToken);
    else markPreviewLoading(replacement);
    // Assign srcdoc only after the clone is connected. With the large
    // Desserdirina payload, assigning it while detached could expose a
    // provisional document and then navigate again after insertion.
    replacement.srcdoc = interactiveHtml;
  }

  // Make the iframe paintable before loading its heavy payload. Assigning
  // srcdoc while the wide modal is hidden can leave Chromium with a blank
  // sandboxed document when template entry animations are throttled.
  const body = $('modal-preview-body');
  const desktopBtn = $('modal-preview-desktop');
  const mobileBtn = $('modal-preview-mobile');
  if (body) body.classList.remove('mode-mobile');
  if (desktopBtn) { desktopBtn.classList.add('active'); desktopBtn.setAttribute('aria-pressed','true'); }
  if (mobileBtn)  { mobileBtn.classList.remove('active'); mobileBtn.setAttribute('aria-pressed','false'); }
  replacePreviewDocument('<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#6B7280;margin:0;font-size:.95rem">Se încarcă previzualizarea…</body>', false);
  openModal('modal-preview');

  let tplData = null;
  try {
    tplData = await ensureTemplateLoaded(templateId);
  } catch (_) {
    tplData = null;
  }

  if (previewGeneration !== previewModalGeneration) return;

  if (!tplData || !tplData.files || !window.HidookEngine || typeof window.HidookEngine.renderPreview !== 'function') {
    replacePreviewDocument('<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#9CA3AF;margin:0;font-size:.95rem">Nu am putut încărca previzualizarea. Încearcă din nou.</body>', true);
    return;
  }

  try {
    const config = (tplData.presets || []).length > 0 ? tplData.presets[0].config : {};
    const html = window.HidookEngine.renderPreview(tplData.files, config);
    replacePreviewDocument(html, true);
  } catch (e) {
    replacePreviewDocument('<body style="font-family:system-ui;padding:2rem;color:#9CA3AF">Nu am putut încărca previzualizarea: ' + escHtml(e.message) + '</body>', true);
  }

}

// ---------------------------------------------------------------------------
// 22. Dashboard
// ---------------------------------------------------------------------------

async function loadDashboard() {
  const list = $('sites-list');
  if (!list) return;
  list.innerHTML = '<p style="color:var(--text-muted);padding:1rem 0;font-size:.9rem">Se încarcă proiectele…</p>';

  try {
    const data = await apiGet('/api/sites');
    const sites = data.sites || [];

    if (sites.length === 0) {
      // Magic-link / verify landed on empty dashboard — resume in-progress local draft
      const saved = loadDraft();
      if (saved && saved.templateId && saved.config && (await resumeLocalDraft())) {
        window.location.hash = '#edit';
        return;
      }
      list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">&#128203;</div><p>Nu ai creat încă niciun site.</p><a href="#templates" class="btn-primary">Creează primul site</a></div>`;
      return;
    }

    list.innerHTML = '';
    sites.forEach(site => { list.appendChild(buildSiteCard(site)); });
  } catch (e) {
    if (e.status === 401) {
      list.innerHTML = '<div class="empty-state"><p>Autentifică-te ca să vezi proiectele.</p><button type="button" class="btn-primary" id="btn-dashboard-auth">Autentificare</button></div>';
      wireDashboardAuthButton();
    } else {
      list.innerHTML = '<div class="empty-state"><p>Eroare la încărcare: ' + escHtml(e.message) + '</p></div>';
    }
  }
}

function buildSiteCard(site) {
  const card = document.createElement('div');
  card.className = 'site-card';

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'site-card-preview-thumb';
  const regMeta = site.templateId
    ? (getTemplateList() || []).find((t) => t.id === site.templateId)
    : null;
  if (regMeta && regMeta.thumbnail) {
    const img = document.createElement('img');
    img.src = regMeta.thumbnail;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    thumbWrap.appendChild(img);
  } else if (site.templateId) {
    ensureTemplateLoaded(site.templateId).then((tplData) => {
      if (!tplData || typeof window.HidookEngine === 'undefined') return;
      try {
        const config = site.config || (tplData.presets && tplData.presets[0] && tplData.presets[0].config) || {};
        const html = window.HidookEngine.renderPreview(tplData.files, config);
        const iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox','allow-scripts');
        iframe.setAttribute('aria-hidden','true');
        iframe.title = 'Previzualizare ' + (site.projectName || site.slug || 'site');
        iframe.srcdoc = html;
        thumbWrap.appendChild(iframe);
      } catch (_) {}
    }).catch(() => {});
  }

  const hostingExpired = isHostingExpired(site);
  // Wave8 audit finding #2: bot/server.js#withDunningState now attaches
  // webpublish.getDunningState(site) verbatim to every site GET /api/sites
  // and GET /api/sites/:id return — read it here so the badge can never lie
  // about a real Stripe billing problem the owner needs to act on.
  const dunning = site.dunning || null;
  let badgeClass = 'status-draft', badgeLabel = 'Ciornă';

  if (site.paid && hostingExpired) {
    badgeClass = 'status-expired'; badgeLabel = 'Expirat';
  } else if (site.status === 'unpublished') {
    // Wave8 audit: unpublishSite() (customer cancel, or Stripe exhausting
    // every dunning retry) flips status to 'unpublished' while leaving
    // site.paid true (payment history is kept on purpose) — no earlier
    // branch here recognised that, so it fell through all the way to the
    // generic 'Ciornă' draft badge even though this is neither an unfinished
    // draft nor a healthy paid site. dunning.severity === 'critical' is the
    // one path a card decline actually took the site down; anything else
    // reaching 'unpublished' here is an owner-initiated cancel.
    badgeClass = 'status-expired';
    badgeLabel = (dunning && dunning.severity === 'critical') ? 'Plată eșuată — site oprit' : 'Anulat';
  } else if (dunning && dunning.severity === 'warning' && site.paid && (site.status === 'live' || site.status === 'active')) {
    // Wave8 audit: Stripe is actively retrying a declined card while the
    // site stays live — must not read as a plain, healthy "Activ".
    badgeClass = 'status-unpaid'; badgeLabel = 'Activ — card refuzat';
  } else if (site.paid && (site.status === 'live' || site.status === 'active')) {
    badgeClass = 'status-live'; badgeLabel = 'Activ';
  } else if (site.status === 'live' && !site.paid) {
    // Legacy unpaid live (pre pay-before-publish)
    badgeClass = 'status-unpaid'; badgeLabel = 'Neplătit';
  } else if (site.status === 'expired') {
    badgeClass = 'status-expired'; badgeLabel = 'Expirat';
  } else if (site.status === 'needs-retry') {
    badgeClass = 'status-draft'; badgeLabel = 'Reîncearcă';
  } else if (!site.paid) {
    badgeClass = 'status-draft'; badgeLabel = 'Neplătit';
  }

  const info = document.createElement('div');
  info.className = 'site-card-info';

  const name = document.createElement('div');
  name.className = 'site-card-name';
  // Keep hyphenated slugs (qalive-w15) one unit — U+2011 is not a soft-wrap point.
  const rawName = String(site.projectName || site.slug || site.id || '');
  name.textContent = rawName.replace(/-/g, '\u2011');

  const meta = document.createElement('div');
  meta.className = 'site-card-meta';

  const badge = document.createElement('span');
  badge.className = 'status-badge ' + badgeClass;
  badge.textContent = badgeLabel;
  meta.appendChild(badge);

  if (site.url) {
    const link = document.createElement('a');
    link.className = 'site-live-link';
    const liveHref = absoluteSiteUrl(site.url);
    link.href = liveHref || site.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    // Soft-wrap only at `/` — same as success URL (W13 390 slug shred).
    // Show absolute same-origin so the stranger can open/copy a real URL.
    fillUrlWithSlashWbr(link, liveHref || site.url);
    link.addEventListener('click', e => e.stopPropagation());
    meta.appendChild(link);
  }

  info.appendChild(name);
  info.appendChild(meta);

  // During live/active trial only: trial de 7 zile · prima taxare 99 pe <day-7 date>
  // Cancelled / unpublished Draft must not promise a first charge (W15).
  // After first charge / non-trial paid year: Hosting until …
  const isLiveActive = site.status === 'live' || site.status === 'active';
  if (site.paid && !hostingExpired && isLiveActive) {
    if (isSiteInTrial(site)) {
      const trialEndIso = getTrialEndIso(site);
      const day7 = formatHostingUntilDate(trialEndIso);
      const price = formatPriceLabel(appConfig);
      const hostLine = document.createElement('div');
      hostLine.className = 'site-hosting-until site-trial-line';
      const trialLabel = 'Trial de 7 zile · prima taxare ' + price;
      hostLine.textContent = day7 ? trialLabel + ' pe ' + day7 : trialLabel;
      info.appendChild(hostLine);
    } else if (site.paidUntil) {
      const untilStr = formatHostingUntilDate(site.paidUntil);
      if (untilStr) {
        const hostLine = document.createElement('div');
        hostLine.className = 'site-hosting-until';
        hostLine.textContent = 'Hosting până pe ' + untilStr;
        info.appendChild(hostLine);
      }
    }
  }

  // The server attaches its own getDunningState() output to every site, so
  // this reads that rather than recomputing it. A hand-kept client mirror of
  // the same rules arrived with this UI; it is deleted below, because two
  // implementations of "is this customer in trouble with their card" drift,
  // and the one that drifts is the one telling a paying customer whether
  // their site is about to go dark.
  //
  // role="alert" and the "Actualizează cardul" action come from that UI and
  // are kept: a critical dunning site has already been unpublished, so none
  // of the pay/renew/cancel branches below fire and the card otherwise offers
  // no action at all.
  if (dunning && dunning.messageRo) {
    const banner = document.createElement('div');
    banner.className = 'site-dunning-line dunning-banner dunning-banner--'
      + (dunning.severity === 'critical' ? 'critical' : 'warning')
      + ' site-dunning-' + (dunning.severity === 'critical' ? 'critical' : 'warning');
    banner.setAttribute('role', 'alert');
    banner.textContent = dunning.messageRo;
    info.appendChild(banner);
  }

  const actions = document.createElement('div');
  actions.className = 'site-card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-ghost btn-sm';
  editBtn.textContent = 'Editează';
  editBtn.setAttribute('aria-label', 'Editează site-ul ' + (site.projectName || site.slug || ''));
  editBtn.addEventListener('click', () => loadSiteForEdit(site.id));
  actions.appendChild(editBtn);

  // Unpaid → add card / start trial; paid+expired → renew; paid+active → Cancel (portal)
  if (!site.paid || hostingExpired) {
    const keepBtn = document.createElement('button');
    keepBtn.className = 'btn-primary btn-sm';
    let payLabel, payAriaLabel;
    if (site.paid && hostingExpired) {
      payLabel = 'Reînnoiește hosting — ' + formatRenewalLabel(appConfig);
      payAriaLabel = 'Reînnoiește hostingul pentru acest site';
    } else {
      payLabel = 'Adaugă un card — începe trialul de 7 zile';
      payAriaLabel = 'Adaugă un card ca să începi trialul de 7 zile';
    }
    keepBtn.textContent = payLabel;
    keepBtn.setAttribute('aria-label', payAriaLabel);
    keepBtn.addEventListener('click', async () => {
      try {
        setBtnLoading(keepBtn, true, 'Se procesează…');
        const data = await apiPost('/api/sites/' + encodeURIComponent(site.id) + '/checkout', {});
        if (data.paymentUrl) window.location.href = data.paymentUrl;
      } catch (e) {
        showToast('Eroare: ' + e.message, 'error');
      } finally {
        setBtnLoading(keepBtn, false);
      }
    });
    actions.appendChild(keepBtn);
  } else if (site.paid && (site.status === 'live' || site.status === 'active')) {
    // Cancel → Stripe Customer Portal (or offline HIDOOK_TEST_PAY portal contract)
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-ghost btn-sm';
    cancelBtn.textContent = 'Anulează';
    cancelBtn.setAttribute('aria-label', 'Anulează abonamentul pentru ' + (site.projectName || site.slug || 'acest site'));
    cancelBtn.addEventListener('click', async () => {
      const projectLabel = site.projectName || site.slug || 'acest site';
      const confirmed = window.confirm(
        'Sigur vrei să anulezi abonamentul pentru „' + projectLabel + '”? Site-ul nu va mai fi public după confirmare.'
      );
      if (!confirmed) return;
      try {
        setBtnLoading(cancelBtn, true, 'Se deschide…');
        const data = await apiPost('/api/sites/' + encodeURIComponent(site.id) + '/billing-portal', {});
        const portalUrl = data.portalUrl || data.url;
        if (portalUrl) {
          window.location.href = portalUrl;
        } else {
          showToast('Portalul de facturare nu este disponibil acum.', 'error');
        }
      } catch (e) {
        showToast('Eroare: ' + e.message, 'error');
      } finally {
        setBtnLoading(cancelBtn, false);
      }
    });
    actions.appendChild(cancelBtn);
  }

  // "Actualizează cardul" (Wave 8 reachability sweep) — independent of the
  // pay/renew/cancel branches above: a 'critical' dunning site has already
  // been unpublished by a failed renewal (status flips away from live/active,
  // so neither of those branches fires above and this card previously showed
  // NO primary action at all), while a 'warning' one is still live and shows
  // this ALONGSIDE Anulează. Same billing-portal route Anulează already
  // uses — Stripe's customer portal covers both cancel and update-card.
  if (dunning) {
    const updateCardBtn = document.createElement('button');
    updateCardBtn.className = 'btn-primary btn-sm';
    updateCardBtn.textContent = 'Actualizează cardul';
    updateCardBtn.setAttribute('aria-label', 'Actualizează cardul pentru ' + (site.projectName || site.slug || 'acest site'));
    updateCardBtn.addEventListener('click', async () => {
      try {
        setBtnLoading(updateCardBtn, true, 'Se deschide…');
        const data = await apiPost('/api/sites/' + encodeURIComponent(site.id) + '/billing-portal', {});
        const portalUrl = data.portalUrl || data.url;
        if (portalUrl) {
          window.location.href = portalUrl;
        } else {
          showToast('Portalul de facturare nu este disponibil acum.', 'error');
        }
      } catch (e) {
        showToast('Eroare: ' + e.message, 'error');
      } finally {
        setBtnLoading(updateCardBtn, false);
      }
    });
    actions.appendChild(updateCardBtn);
  }

  const versBtn = document.createElement('button');
  versBtn.className = 'btn-ghost btn-sm';
  versBtn.textContent = 'Istoric';
  versBtn.setAttribute('aria-label', 'Istoric versiuni pentru ' + (site.projectName || site.slug || ''));
  versBtn.addEventListener('click', () => loadVersions(site.id));
  actions.appendChild(versBtn);

  // Custom domain (Wave 8 reachability fix): bot/domains.js's whole
  // self-serve BYO-domain state machine and its five auth-gated routes
  // (bot/server.js) existed with nothing in the product ever linking to
  // them. Same gate as the native-booking link above — a real Cloudflare
  // Pages project only exists once the site has actually been deployed.
  if (site.paid && (site.status === 'live' || site.status === 'active')) {
    const domainBtn = document.createElement('button');
    domainBtn.className = 'btn-ghost btn-sm';
    domainBtn.textContent = 'Domeniu';
    domainBtn.setAttribute('aria-label', 'Conectează domeniul tău propriu pentru ' + (site.projectName || site.slug || 'acest site'));
    domainBtn.addEventListener('click', () => openDomainModal(site));
    actions.appendChild(domainBtn);
  }

  // Invoices / billing history (Wave 8 reachability fix): GET /api/sites/:id
  // /invoices returns the full ledger-backed history but nothing ever
  // rendered it. `site.paid` covers a canceled/expired site too — past
  // invoices remain a legitimate thing an owner looks up.
  if (site.paid) {
    const invoicesBtn = document.createElement('button');
    invoicesBtn.className = 'btn-ghost btn-sm';
    invoicesBtn.textContent = 'Facturi';
    invoicesBtn.setAttribute('aria-label', 'Facturi și istoric plăți pentru ' + (site.projectName || site.slug || 'acest site'));
    invoicesBtn.addEventListener('click', () => openInvoicesModal(site.id));
    actions.appendChild(invoicesBtn);
  }

  // Native Hidook booking dashboard link (Wave 8 reachability fix): the owner
  // dashboard exists and its API is fully authenticated + tenant-isolated
  // (bot/server.js#resolveOwnerTenantOrReject), but nothing in the product
  // ever linked to it with a real site's ids — only a hardcoded demo page did.
  // Only professionals sites can opt into native booking (schema check), and
  // only a published (paid + live/active) site has gone through the publish
  // cutover that actually seeds the calendar engine (bot/calendar-native/
  // cutover.js), so check the site's last-published config before showing
  // this — a fetch per professionals card, not per every site.
  if (site.paid && (site.status === 'live' || site.status === 'active') && site.templateId === 'professionals') {
    apiGet('/api/sites/' + encodeURIComponent(site.id))
      .then((data) => {
        const cfg = data && data.config;
        const nativeOn = isNativeBookingOn(cfg && cfg.appointment && cfg.appointment.nativeBooking);
        if (!nativeOn) return;
        const bookBtn = document.createElement('a');
        bookBtn.className = 'btn-ghost btn-sm';
        bookBtn.textContent = 'Programări';
        bookBtn.target = '_blank';
        bookBtn.rel = 'noopener noreferrer';
        bookBtn.setAttribute(
          'aria-label',
          'Deschide programările pentru ' + (site.projectName || site.slug || 'acest site')
        );
        const qs = new URLSearchParams({
          customerId: site.userId,
          siteId: site.id,
          brand: site.projectName || site.slug || '',
        });
        bookBtn.href = '/calendar-native/owner/?' + qs.toString();
        bookBtn.addEventListener('click', e => e.stopPropagation());
        actions.appendChild(bookBtn);
      })
      .catch(() => { /* dashboard link is a bonus — never block the sites list on it */ });
  }

  card.appendChild(thumbWrap);
  card.appendChild(info);
  card.appendChild(actions);
  return card;
}

async function loadSiteForEdit(siteId) {
  try {
    setLoading(true, 'Se încarcă site-ul…');
    const data = await apiGet('/api/sites/' + encodeURIComponent(siteId));
    const site = data.site;
    const config = data.config;
    if (!site || !config) throw new Error('Date incomplete de la server.');

    currentSiteId = site.id;
    currentSitePaid = !!site.paid;
    currentSiteSlug = site.slug || '';
    draft.templateId = site.templateId;
    draft.config = deepClone(config);
    // A saved/published site is the owner's own content, never demo filler.
    isFreshDemoDraft = false;
    demoBannerDismissed = false;
    if (typeof resetHistory === 'function') resetHistory();
    saveDraft();

    let tplData = null;
    try {
      tplData = await ensureTemplateLoaded(site.templateId);
    } catch (_) {
      tplData = getTemplateById(site.templateId);
    }
    const registry = getTemplateList();
    const meta = registry.find(t => t.id === site.templateId) || { id: site.templateId, name: site.templateId, description: '' };
    currentTemplate = { meta, data: tplData };

    const nameEl = $('editor-template-name');
    if (nameEl) nameEl.textContent = meta.name;

    previewFirstRender = false;
    iframeReady = false;
    previewCookieAccepted = false;

    window.location.hash = '#edit';
  } catch (e) {
    showToast('Nu am putut încărca site-ul.', 'error');
  } finally {
    setLoading(false);
  }
}

async function loadVersions(siteId) {
  const list = $('versions-list');
  if (list) list.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0">Se încarcă…</p>';
  openModal('modal-versions');

  try {
    const data = await apiGet('/api/sites/' + encodeURIComponent(siteId) + '/versions');
    const versions = data.versions || [];
    if (!list) return;

    if (versions.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1.5rem">Nu există versiuni salvate.</p>';
      return;
    }

    list.innerHTML = '';
    // API listVersions is oldest-first; show newest-on-top with Versiunea N = newest.
    const versionsSorted = versions.slice().sort((a, b) => {
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
    versionsSorted.forEach((v, idx) => {
      const item = document.createElement('div');
      item.className = 'version-item';
      const d = new Date(v.publishedAt);
      const dateStr = d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
      const verNum = versionsSorted.length - idx;
      const label = 'Versiunea ' + verNum;
      item.innerHTML = `
        <span class="version-date">${escHtml(dateStr)}</span>
        <span style="font-size:.76rem;color:var(--text-light);flex:1;padding:0 .5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(label)}</span>
        <button class="btn-ghost btn-sm btn-rollback" data-siteid="${escHtml(siteId)}" data-verid="${escHtml(v.versionId)}">Restabilește</button>`;
      item.querySelector('.btn-rollback').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        setBtnLoading(btn, true, 'Se restabilește…');
        try {
          await apiPost('/api/sites/' + encodeURIComponent(siteId) + '/rollback', { versionId: v.versionId });
          showToast('Versiunea a fost restabilită.', 'success');
          closeModal('modal-versions');
        } catch (err) {
          showToast('Eroare la restabilire: ' + err.message, 'error');
          setBtnLoading(btn, false);
        }
      });
      list.appendChild(item);
    });
  } catch (e) {
    if (list) list.innerHTML = '<p style="color:var(--error);font-size:.85rem">' + escHtml(e.message) + '</p>';
  }
}

// ---------------------------------------------------------------------------
// 22b. Custom domain (Wave 8 — self-serve BYO domain, audit #47 reachability)
// ---------------------------------------------------------------------------
//
// bot/domains.js implements the whole state machine and bot/server.js mounts
// five auth-gated routes for it (GET/POST/DELETE /api/sites/:id/domain, POST
// .../domain/verify, POST .../domain/status). None of it was reachable from
// any UI. This panel lives in the "Proiectele mele" site card — the same
// place the Wave 8 calendar fix put its own reachability link — because
// that's where an owner already goes to manage a live site.
//
// GET /api/sites/:id/domain returns the RAW stored record (domain,
// targetHost, pagesHost, verificationToken, isApex, status, …), not the
// human-readable {records, note, instructiuni} shape bot/domains.js only
// builds inside startDomainConnection()'s response. Re-POSTing /domain just
// to re-fetch that shape would be wrong — startDomainConnection()
// unconditionally resets status back to 'awaiting_dns', which would silently
// regress an already-active connection back to "waiting". So the DNS
// records table below is (a) cached verbatim from the one POST response
// that ever carries it, in localStorage keyed by siteId, and (b)
// reconstructed client-side from the raw record as a fallback (same two
// records/apex-note bot/domains.js#_dnsInstructionsFor builds — see
// HANDOFF-owner-ui.md for the follow-up: ideally GET would return the same
// shape so this duplication is unnecessary).

let domainModalSiteId = null;
let domainModalProjectName = null;
let domainModalCurrentOrigin = null;

function domainInstructionsCacheKey(siteId) { return 'hb.domainDns.' + siteId; }

function cacheDomainInstructions(siteId, instructions) {
  try { localStorage.setItem(domainInstructionsCacheKey(siteId), JSON.stringify(instructions)); } catch (_) {}
}

function readCachedDomainInstructions(siteId, domain) {
  try {
    const raw = localStorage.getItem(domainInstructionsCacheKey(siteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.domain === domain) return parsed;
  } catch (_) {}
  return null;
}

/** Same wording as bot/domains.js#_messageForStatus — GET /domain returns
 *  only the raw record (no message), so this keeps the waiting states
 *  reading as normal/expected instead of blank or alarming. */
function domainMessageForStatus(status) {
  switch (status) {
    case 'awaiting_dns':
      return 'Nu am găsit încă înregistrările DNS. E normal — propagarea poate dura de la câteva minute până la câteva ore. Revino mai târziu și apasă din nou "Verifică".';
    case 'dns_partial':
      return 'Am găsit o parte din înregistrări, dar nu toate (sau au altă valoare decât cea indicată). Mai verifică o dată peste câteva minute.';
    case 'dns_verified':
      return 'Înregistrările DNS sunt corecte. Urmează activarea certificatului de securitate (HTTPS) — de obicei durează câteva minute.';
    case 'provisioning':
      return 'Certificatul de securitate (HTTPS) se activează. De obicei durează câteva minute, uneori până la o oră.';
    case 'active':
      return 'Domeniul tău este conectat și activ.';
    case 'error':
      return 'A apărut o problemă la conectarea domeniului. Poți încerca din nou.';
    case 'disconnected':
      return 'Domeniul a fost deconectat. Site-ul tău rămâne disponibil pe subdomeniul Hidook.';
    default:
      return '';
  }
}

function domainStatusBadge(status) {
  if (status === 'active') return { cls: 'status-live', label: 'Activ' };
  if (status === 'error') return { cls: 'status-expired', label: 'Eroare' };
  if (status === 'dns_verified' || status === 'provisioning') return { cls: 'status-draft', label: status === 'provisioning' ? 'Se activează certificatul' : 'DNS verificat' };
  if (status === 'dns_partial') return { cls: 'status-draft', label: 'DNS parțial' };
  if (status === 'awaiting_dns') return { cls: 'status-draft', label: 'Se așteaptă DNS' };
  return { cls: 'status-draft', label: 'Neconectat' };
}

/** Client-side rebuild of bot/domains.js#_dnsInstructionsFor from the raw
 *  record fields alone — see the module-doc comment above for why this
 *  can't just re-call the server. */
function buildDnsRecordsFromRecord(record) {
  const records = [
    {
      tip: 'TXT',
      nume: '_hidook-challenge.' + record.targetHost,
      valoare: 'hidook-verify=' + record.verificationToken,
      ttl: 'Auto (sau 300)',
    },
    {
      tip: 'CNAME',
      nume: record.targetHost,
      valoare: record.pagesHost,
      ttl: 'Auto (sau 300)',
    },
  ];
  const note = record.isApex
    ? `Domeniul principal "${record.domain}" nu poate avea o înregistrare CNAME — este o limitare a ` +
      `standardului DNS, nu a Hidook. Adaugă cele două înregistrări de mai jos pentru ` +
      `"${record.targetHost}", apoi la panoul domeniului tău configurează o redirecționare ` +
      `(forwarding) de la "${record.domain}" către "https://${record.targetHost}" — astfel vizitatorii ` +
      `care scriu "${record.domain}" ajung automat pe site.`
    : null;
  return { records, note };
}

function domainRecordsTableHtml(records) {
  const rows = records.map((r) => `
    <tr>
      <td class="dns-col-type">${escHtml(r.tip)}</td>
      <td>
        <div class="dns-copy-field">
          <code>${escHtml(r.nume)}</code>
          <button type="button" class="btn-copy-dns" data-copy="${escHtmlForAttr(r.nume)}">Copiază</button>
        </div>
      </td>
      <td>
        <div class="dns-copy-field">
          <code>${escHtml(r.valoare)}</code>
          <button type="button" class="btn-copy-dns" data-copy="${escHtmlForAttr(r.valoare)}">Copiază</button>
        </div>
      </td>
      <td class="dns-col-ttl">${escHtml(r.ttl)}</td>
    </tr>`).join('');
  return `
    <div class="dns-records-wrap">
      <table class="dns-records-table">
        <thead><tr><th>Tip</th><th>Nume</th><th>Valoare</th><th>TTL</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function wireDnsCopyButtons(container) {
  container.querySelectorAll('.btn-copy-dns').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy || '';
      try {
        await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = 'Copiat!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
      } catch (_) {
        showToast('Nu am putut copia. Selectează textul manual.', 'error');
      }
    });
  });
}

function domainConnectFormHtml(hasExisting) {
  return `
    <form id="domain-connect-form" class="domain-connect-form">
      <div class="field-group">
        <label class="field-label" for="domain-input">${hasExisting ? 'Domeniu nou' : 'Domeniul tău'}</label>
        <input class="field-input" id="domain-input" type="text" placeholder="ex: afacereamea.ro" autocomplete="off" autocapitalize="none" spellcheck="false" />
        <div class="field-hint">Introdu domeniul pe care îl deții deja la alt furnizor — nu este nevoie să-l cumperi de la Hidook.</div>
      </div>
      <div id="domain-connect-error" class="field-error" role="alert" style="display:none"></div>
      <button type="submit" class="btn-primary btn-sm" id="btn-domain-connect-submit">Conectează domeniul</button>
    </form>`;
}

function wireDomainConnectForm() {
  const form = $('domain-connect-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('domain-input');
    const errEl = $('domain-connect-error');
    const btn = $('btn-domain-connect-submit');
    const domain = input ? input.value.trim() : '';
    if (errEl) hide(errEl);
    if (!domain) {
      if (errEl) { errEl.textContent = 'Introdu domeniul tău (ex: myshop.com).'; show(errEl); }
      return;
    }
    try {
      setBtnLoading(btn, true, 'Se conectează…');
      const instructions = await apiPost(
        '/api/sites/' + encodeURIComponent(domainModalSiteId) + '/domain',
        { domain }
      );
      cacheDomainInstructions(domainModalSiteId, instructions);
      await refreshDomainModal();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'Nu am putut conecta domeniul.'; show(errEl); }
    } finally {
      setBtnLoading(btn, false);
    }
  });
}

/** Renders the whole domain panel from the raw record + last poll detail. */
function renderDomainModal(record, lastPoll) {
  const body = $('domain-modal-body');
  if (!body) return;

  if (!record || record.status === 'disconnected') {
    body.innerHTML = domainConnectFormHtml(!!record);
    wireDomainConnectForm();
    return;
  }

  const status = record.status;
  const badge = domainStatusBadge(status);
  const message = (lastPoll && lastPoll.message) || domainMessageForStatus(status);
  const messageCls = status === 'error' ? 'domain-message--error' : (status === 'active' ? 'domain-message--active' : '');

  let html = `
    <div class="domain-status-row">
      <span class="status-badge ${badge.cls}">${escHtml(badge.label)}</span>
      <span class="domain-current-host">${escHtml(record.domain)}</span>
    </div>
    <p class="domain-message ${messageCls}">${escHtml(message)}</p>`;

  if (status === 'active') {
    const liveHref = 'https://' + record.targetHost;
    html += `<p class="modal-sub"><a href="${escHtmlForAttr(liveHref)}" target="_blank" rel="noopener noreferrer">${escHtml(liveHref)}</a></p>`;
    if (record.isApex) {
      html += `<div class="domain-apex-note">Domeniul principal "${escHtml(record.domain)}" e nevoie să aibă o redirecționare (forwarding) către "${escHtml(liveHref)}" configurată la furnizorul tău de domeniu — CNAME nu funcționează pe domeniul principal.</div>`;
    }
    html += `
      <div class="domain-actions">
        <button type="button" class="btn-ghost btn-sm" id="btn-domain-disconnect">Deconectează</button>
        <button type="button" class="domain-switch-link" id="btn-domain-switch" style="margin:0">Folosește alt domeniu</button>
      </div>`;
  } else {
    // awaiting_dns / dns_partial / dns_verified / provisioning / error — show
    // the DNS records (cached instructions if we have them, else rebuilt from
    // the raw record) so the owner can always see/copy what to paste.
    const cached = readCachedDomainInstructions(domainModalSiteId, record.domain);
    const built = cached || buildDnsRecordsFromRecord(record);
    if (status !== 'provisioning' && status !== 'dns_verified') {
      html += domainRecordsTableHtml(built.records);
      if (built.note) html += `<div class="domain-apex-note">${escHtml(built.note)}</div>`;
    }
    const verifyLabel = (status === 'dns_verified' || status === 'provisioning') ? 'Verifică certificatul' : 'Verifică';
    html += `
      <div class="domain-actions">
        <button type="button" class="btn-primary btn-sm" id="btn-domain-verify">${escHtml(verifyLabel)}</button>
        <button type="button" class="btn-ghost btn-sm" id="btn-domain-disconnect">Deconectează</button>
        <button type="button" class="domain-switch-link" id="btn-domain-switch" style="margin:0">Folosește alt domeniu</button>
      </div>`;
    if (record.lastCheck && record.lastCheck.checkedAt) {
      html += `<p class="domain-last-check">Ultima verificare: ${escHtml(formatHostingUntilDate(record.lastCheck.checkedAt) || record.lastCheck.checkedAt)}</p>`;
    }
  }

  body.innerHTML = html;
  wireDnsCopyButtons(body);

  const verifyBtn = $('btn-domain-verify');
  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      setBtnLoading(verifyBtn, true, 'Se verifică…');
      try {
        // Already past raw DNS checking → poll TLS only (bot/domains.js's own
        // checkDomainConnection doc: "Use checkTlsStatus to poll those states
        // instead"). Otherwise /verify (which auto-chains into attach once
        // DNS comes back verified, so the owner never needs a second button).
        const route = (status === 'dns_verified' || status === 'provisioning') ? '/domain/status' : '/domain/verify';
        const result = await apiPost('/api/sites/' + encodeURIComponent(domainModalSiteId) + route, {});
        await refreshDomainModal(result);
      } catch (err) {
        if (err && err.code === 'RATE_LIMITED') {
          showToast(err.message, 'error', 6000);
        } else {
          showToast(err.message || 'Eroare la verificare.', 'error');
          await refreshDomainModal();
        }
      } finally {
        setBtnLoading(verifyBtn, false);
      }
    });
  }

  const disconnectBtn = $('btn-domain-disconnect');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async () => {
      const confirmed = window.confirm(
        'Sigur vrei să deconectezi domeniul „' + record.domain + '"? Site-ul tău rămâne disponibil pe subdomeniul Hidook.'
      );
      if (!confirmed) return;
      try {
        setBtnLoading(disconnectBtn, true, 'Se deconectează…');
        await apiDelete('/api/sites/' + encodeURIComponent(domainModalSiteId) + '/domain');
        try { localStorage.removeItem(domainInstructionsCacheKey(domainModalSiteId)); } catch (_) {}
        showToast('Domeniul a fost deconectat.', 'success');
        await refreshDomainModal();
      } catch (err) {
        showToast(err.message || 'Nu am putut deconecta domeniul.', 'error');
      } finally {
        setBtnLoading(disconnectBtn, false);
      }
    });
  }

  const switchBtn = $('btn-domain-switch');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      body.innerHTML = domainConnectFormHtml(true);
      wireDomainConnectForm();
    });
  }
}

async function refreshDomainModal(lastPoll) {
  const body = $('domain-modal-body');
  if (!body || !domainModalSiteId) return;
  try {
    const data = await apiGet('/api/sites/' + encodeURIComponent(domainModalSiteId) + '/domain');
    renderDomainModal(data.record, lastPoll);
  } catch (e) {
    body.innerHTML = '<p style="color:var(--error);font-size:.85rem">' + escHtml(e.message) + '</p>';
  }
}

async function openDomainModal(site) {
  domainModalSiteId = site.id;
  domainModalProjectName = site.projectName;
  domainModalCurrentOrigin = site.url || null;
  const body = $('domain-modal-body');
  if (body) body.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0">Se încarcă…</p>';
  openModal('modal-domain');
  await refreshDomainModal();
}

// ---------------------------------------------------------------------------
// 22c. Invoices / billing history (Wave 8 reachability)
// ---------------------------------------------------------------------------
//
// GET /api/sites/:id/invoices returns the ledger-backed history (newest
// first already); each entry carries kind ('publish' | 'renewal'),
// amountCents, currency, ts and — for a real Stripe renewal invoice —
// hostedInvoiceUrl/invoicePdf. Same "findable" placement as the domain
// panel: the "Proiectele mele" site card.

function invoiceKindLabel(kind) {
  if (kind === 'renewal') return 'Reînnoire hosting';
  if (kind === 'publish') return 'Publicare (primul an)';
  return kind || 'Plată';
}

function formatInvoiceAmount(amountCents, currency) {
  if (amountCents == null) return '—';
  const amount = amountCents / 100;
  const cur = String(currency || '').toUpperCase();
  try {
    return new Intl.NumberFormat('ro-RO', { style: 'currency', currency: cur || 'USD' }).format(amount);
  } catch (_) {
    return amount.toFixed(2) + (cur ? ' ' + cur : '');
  }
}

function formatInvoiceDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (_) {
    return iso.slice(0, 10);
  }
}

function renderInvoicesList(invoices) {
  const list = $('invoices-list');
  if (!list) return;
  if (!invoices || invoices.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1.5rem">Nu există încă nicio factură pentru acest site.</p>';
    return;
  }
  list.innerHTML = invoices.map((inv) => {
    let links = '';
    if (inv.hostedInvoiceUrl) {
      links += `<a class="btn-ghost btn-sm" href="${escHtmlForAttr(inv.hostedInvoiceUrl)}" target="_blank" rel="noopener noreferrer">Vezi factura</a>`;
    }
    if (inv.invoicePdf) {
      links += `<a class="btn-ghost btn-sm" href="${escHtmlForAttr(inv.invoicePdf)}" target="_blank" rel="noopener noreferrer">PDF</a>`;
    }
    return `
      <div class="invoice-item">
        <div class="invoice-item-main">
          <span class="invoice-date">${escHtml(formatInvoiceDate(inv.ts))}</span>
          <span class="invoice-kind">${escHtml(invoiceKindLabel(inv.kind))}</span>
        </div>
        <span class="invoice-amount">${escHtml(formatInvoiceAmount(inv.amountCents, inv.currency))}</span>
        ${links ? `<div class="invoice-links">${links}</div>` : ''}
      </div>`;
  }).join('');
}

async function openInvoicesModal(siteId) {
  const list = $('invoices-list');
  if (list) list.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0">Se încarcă…</p>';
  openModal('modal-invoices');
  try {
    const data = await apiGet('/api/sites/' + encodeURIComponent(siteId) + '/invoices');
    renderInvoicesList(data.invoices || []);
  } catch (e) {
    if (list) list.innerHTML = '<p style="color:var(--error);font-size:.85rem">' + escHtml(e.message) + '</p>';
  }
}

// ---------------------------------------------------------------------------
// 23. Router
// ---------------------------------------------------------------------------

const screens = ['templates', 'edit', 'dashboard'];

function showScreen(name) {
  // The editor canvas is itself a generated-site preview. Its consent belongs
  // inside the iframe, so the builder-origin notice must stay outside this view.
  document.body.classList.toggle('editor-preview-cookie-isolated', name === 'edit');
  screens.forEach(s => {
    const el = $('screen-' + s);
    if (el) el.style.display = s === name ? '' : 'none';
  });
  document.querySelectorAll('[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === name);
  });

  // Show/hide editor topbar and normal header
  const topbar = $('editor-topbar');
  const header = $('app-header');
  if (name === 'edit') {
    if (topbar) show(topbar);
    if (header) hide(header);
    // Details opens for every newly selected design; a manual close survives reload.
    if (shouldAutoOpenDrawer() && !drawerOpen) {
      requestAnimationFrame(() => {
        if (shouldAutoOpenDrawer() && !drawerOpen) openDrawer();
      });
    }
    // #edit already auto-resumes the local draft on its own (resumeLocalDraft,
    // via handleRoute) — the recovery banner is for OTHER entry points
    // (crash/accidental-close, then back to templates/dashboard), so the two
    // must never both be on screen at once.
    if (typeof hideRecoveryBanner === 'function') hideRecoveryBanner();
    syncDemoBanner();
  } else {
    if (topbar) hide(topbar);
    if (header) show(header);
    // Close drawer and color picker when leaving edit (do not write 'closed' pref —
    // leaving the screen is not an intentional user close).
    if (drawerOpen) {
      hide($('drawer-overlay'));
      hide($('details-drawer'));
      drawerOpen = false;
      const btn = $('btn-open-drawer');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
    if (colorPopoverOpen) closeColorPopover();
    if (accountMenuOpen) closeAccountMenu();
    if (checklistMenuOpen) closeChecklistMenu();
    hideTabConflictBanner();
    if (typeof maybeShowRecoveryBanner === 'function') maybeShowRecoveryBanner();
  }
}

async function handleRoute(hash) {
  const raw = (hash || '').replace(/^#/, '') || 'templates';
  // Offline test-pay return: #test-checkout=cs_test_*
  if (/^test-checkout=/.test(raw)) {
    const sessionId = raw.slice('test-checkout='.length).split('&')[0];
    // Clear hash so refresh does not re-fire
    if (history && history.replaceState) {
      try { history.replaceState(null, '', window.location.pathname + window.location.search + '#dashboard'); }
      catch (_) { window.location.hash = '#dashboard'; }
    } else {
      window.location.hash = '#dashboard';
    }
    await completeTestCheckout(sessionId);
    showScreen('dashboard');
    const user = await fetchCurrentUser().catch(() => null);
    updateUserUI(user);
    if (user) loadDashboard();
    return;
  }
  // Offline Cancel return: #test-billing-portal=bps_test_* (unpublish already applied server-side)
  // Also honour #sites return_url from billing-portal so stranger lands in Proiectele mele / Ciornă.
  if (/^test-billing-portal=/.test(raw) || raw === 'sites') {
    if (history && history.replaceState) {
      try { history.replaceState(null, '', window.location.pathname + window.location.search + '#dashboard'); }
      catch (_) { window.location.hash = '#dashboard'; }
    } else {
      window.location.hash = '#dashboard';
    }
    showScreen('dashboard');
    const user = await fetchCurrentUser().catch(() => null);
    updateUserUI(user);
    if (user) {
      loadDashboard();
      showToast('Abonamentul a fost anulat. Site-ul e ciornă.', 'success', 5000);
    } else {
      const list = $('sites-list');
      if (list) {
        list.innerHTML = '<div class="empty-state"><p>Autentifică-te ca să vezi proiectele.</p><button type="button" class="btn-primary" id="btn-dashboard-auth">Autentificare</button></div>';
        wireDashboardAuthButton();
      }
    }
    return;
  }
  const route = raw;

  if (route === 'templates' || route === 'cum-e' || route === 'templates-grid') {
    showScreen('templates');
    renderTemplatesGrid();
    if (route === 'cum-e' || route === 'templates-grid') {
      requestAnimationFrame(() => {
        const target = document.getElementById(route === 'cum-e' ? 'cum-e' : 'templates-grid');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  } else if (route === 'edit') {
    if (!draft.templateId) {
      if (await resumeLocalDraft()) {
        /* restored from localStorage */
      } else if (await loadPaidSiteForEmptyEdit()) {
        /* dashboard pay / empty draft: bind matching paid site (S92) */
      } else {
        window.location.hash = '#templates';
        return;
      }
    }
    // Bind signed-in paid site so Publică skips slug modal without dashboard Editează
    await bindSignedInPaidSiteForEdit();
    // Wave 9: resumeLocalDraft/bindSignedInPaidSiteForEdit above can each run
    // their own bookkeeping saveDraft() (site-bind hygiene, never a user
    // edit) — flatten the save-status pill to idle right before the editor
    // is actually shown so entering/re-entering #edit never opens on a
    // stale "Salvat"/error pill nobody earned yet. Only flattens when there
    // is genuinely nothing in flight, so it can never mask a real failure.
    if (typeof pendingLiveEdits === 'object' && Object.keys(pendingLiveEdits || {}).length === 0 &&
        typeof pendingOpCount === 'number' && pendingOpCount === 0 &&
        typeof serverSaveInFlight !== 'undefined' && !serverSaveInFlight) {
      if (typeof hasEverEdited !== 'undefined') hasEverEdited = false;
      if (typeof setSaveState === 'function') setSaveState('idle');
    }
    showScreen('edit');
    updateChecklist();
    scheduleRerender(true);
  } else if (route === 'dashboard') {
    showScreen('dashboard');
    const user = await fetchCurrentUser().catch(() => null);
    updateUserUI(user);
    if (user) loadDashboard();
    else {
      const list = $('sites-list');
      if (list) {
        list.innerHTML = '<div class="empty-state"><p>Autentifică-te ca să vezi proiectele.</p><button type="button" class="btn-primary" id="btn-dashboard-auth">Autentificare</button></div>';
        wireDashboardAuthButton();
      }
    }
  } else if (route === 'paid') {
    showToast('Plata a fost procesată. Site-ul tău va fi publicat în câteva momente.', 'success', 6000);
    window.location.hash = '#dashboard';
  } else if (route === 'cancelled') {
    showToast('Plata a fost anulată.', '', 4000);
    window.location.hash = '#edit';
  } else if (route === 'login-expired') {
    showToast('Linkul de autentificare a expirat. Încearcă din nou.', 'error', 5000);
    window.location.hash = '#templates';
  } else {
    showScreen('templates');
    renderTemplatesGrid();
  }
}

// ---------------------------------------------------------------------------
// 24. Static button wiring
// ---------------------------------------------------------------------------

async function returnToEditor() {
  closeModal('modal-success');
  if (!draft.templateId) {
    await ensureDraftBoundToPaidSite(currentSiteId);
  }
  if (!draft.templateId) return;
  // Checkout can update history without a hashchange. Run the route explicitly
  // so preview readiness belongs to a newly loaded, non-empty srcdoc document.
  try {
    history.replaceState(null, '', window.location.pathname + window.location.search + '#edit');
  } catch (_) {
    window.location.hash = '#edit';
  }
  await handleRoute('#edit');
}

function wireStaticButtons() {
  // Back to templates
  const backBtn = $('btn-back-templates');
  if (backBtn) backBtn.addEventListener('click', () => { window.location.hash = '#templates'; });

  // Catalog filter chips (landing)
  const chips = $('catalog-chips');
  if (chips) {
    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('.catalog-chip');
      if (!btn) return;
      applyCatalogFilter(btn.dataset.filter || 'all');
    });
  }

  // Device toggle
  const desktopBtn = $('btn-preview-desktop');
  const mobileBtn  = $('btn-preview-mobile');
  if (desktopBtn) desktopBtn.addEventListener('click', () => setDeviceMode('desktop'));
  if (mobileBtn)  mobileBtn.addEventListener('click',  () => setDeviceMode('mobile'));

  // Publish button in topbar
  const pubBtn = $('btn-publish');
  if (pubBtn) pubBtn.addEventListener('click', openPublishModal);

  // Download HTML of the current draft (server-rendered; not a live publish)
  const dlHtmlBtn = $('btn-download-html');
  if (dlHtmlBtn) dlHtmlBtn.addEventListener('click', downloadDraftHtml);
  const dlZipBtn = $('btn-download-zip');
  if (dlZipBtn) dlZipBtn.addEventListener('click', downloadDraftZip);

  const igBtn = $('btn-add-instagram');
  if (igBtn) igBtn.addEventListener('click', openInstagramModal);
  const igClose = $('btn-close-instagram');
  if (igClose) igClose.addEventListener('click', () => closeModal('modal-instagram'));
  const igCheck = $('ig-terms-check');
  const igGo = $('btn-ig-connect');
  if (igCheck && igGo) {
    igCheck.addEventListener('change', () => { igGo.disabled = !igCheck.checked; });
  }
  if (igGo) igGo.addEventListener('click', () => { connectInstagram(); });
  const igEditor = $('btn-ig-editor');
  if (igEditor) igEditor.addEventListener('click', openInstagramEditor);
  const igDisconnect = $('btn-ig-disconnect');
  if (igDisconnect) igDisconnect.addEventListener('click', disconnectInstagram);

  // Photos — one place for every image the site uses (hero, logo, galleries)
  const galleryOpenBtn = $('btn-open-gallery');
  if (galleryOpenBtn) galleryOpenBtn.addEventListener('click', openGalleryModal);

  // Drawer
  const drawerBtn = $('btn-open-drawer');
  if (drawerBtn) drawerBtn.addEventListener('click', () => {
    if (drawerOpen) closeDrawer(); else openDrawer();
  });

  const closeDrawerBtn = $('btn-close-drawer');
  if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);

  const drawerOverlay = $('drawer-overlay');
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

  // Publish modal slug input
  const slugInput = $('input-slug');
  if (slugInput) {
    slugInput.addEventListener('input', () => {
      slugInput.dataset.manuallyEdited = '1';
      const val = toSlug(slugInput.value);
      scheduleSlugCheck(val);
    });
  }

  const continueBtn = $('btn-publish-continue');
  if (continueBtn) {
    continueBtn.addEventListener('click', async () => {
      const rawSlug = slugInput ? toSlug(slugInput.value) : '';
      if (!rawSlug || rawSlug.length < 3) {
        const err = $('slug-error');
        if (err) { err.textContent = 'Adresa trebuie să aibă cel puțin 3 caractere (litere mici, cifre, cratime).'; show(err); }
        if (slugInput) slugInput.focus();
        return;
      }
      if (slugCheckTimer) {
        clearTimeout(slugCheckTimer);
        await checkSlug(rawSlug);
      }
      if (!slugValid) { if (slugInput) slugInput.focus(); return; }
      await doActualPublish(slugNormalized || rawSlug);
    });
  }

  // Copy URL button
  const copyBtn = $('btn-copy-url');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const url = publishedSiteUrl;
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.classList.add('copied');
        copyBtn.textContent = 'Copiat!';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2 10V2h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Copiază';
        }, 2000);
      } catch (_) {
        showToast('Nu am putut copia adresa. Selectează textul manual.', 'error');
      }
    });
  }

  // Logout
  const logoutBtn = $('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', doLogout);

  // Modal closes
  function wireModalClose(btnId, modalId) {
    const btn = $(btnId);
    if (btn) btn.addEventListener('click', () => closeModal(modalId));
  }
  wireModalClose('btn-close-publish',  'modal-publish');
  wireModalClose('btn-close-preview',  'modal-preview');
  wireModalClose('btn-close-success',  'modal-success');
  wireModalClose('btn-close-versions', 'modal-versions');
  wireModalClose('btn-close-gallery',  'modal-gallery');
  wireModalClose('btn-close-domain',   'modal-domain');
  wireModalClose('btn-close-invoices', 'modal-invoices');

  const successCloseBtn = $('btn-success-close');
  if (successCloseBtn) {
    successCloseBtn.addEventListener('click', returnToEditor);
  }

  // Preview modal device toggle
  const modalDesktopBtn = $('modal-preview-desktop');
  const modalMobileBtn  = $('modal-preview-mobile');
  const modalBody = $('modal-preview-body');
  if (modalDesktopBtn) {
    modalDesktopBtn.addEventListener('click', () => {
      if (modalBody) modalBody.classList.remove('mode-mobile');
      modalDesktopBtn.classList.add('active'); modalDesktopBtn.setAttribute('aria-pressed','true');
      if (modalMobileBtn) { modalMobileBtn.classList.remove('active'); modalMobileBtn.setAttribute('aria-pressed','false'); }
    });
  }
  if (modalMobileBtn) {
    modalMobileBtn.addEventListener('click', () => {
      if (modalBody) modalBody.classList.add('mode-mobile');
      modalMobileBtn.classList.add('active'); modalMobileBtn.setAttribute('aria-pressed','true');
      if (modalDesktopBtn) { modalDesktopBtn.classList.remove('active'); modalDesktopBtn.setAttribute('aria-pressed','false'); }
    });
  }

  // Close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Escape closes everything
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['modal-publish','modal-preview','modal-success','modal-versions','modal-gallery','modal-instagram'].forEach(id => {
        const el = $(id);
        if (el && el.style.display !== 'none') closeModal(id);
      });
      if (drawerOpen) closeDrawer();
      if (colorPopoverOpen) closeColorPopover();
      if (accountMenuOpen) closeAccountMenu();
      if (checklistMenuOpen) closeChecklistMenu();
    }
  });

  // Undo / redo keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z, Cmd on macOS).
  // Left to the browser's native per-field undo when focus is in a plain
  // input/textarea/contenteditable OUTSIDE the preview iframe (drawer fields,
  // modal forms, the color hex box) — the app-level history is still reachable
  // there via the visible Undo/Redo buttons. Inside the sandboxed preview
  // iframe (the canvas contenteditable text), edit-overlay.js intercepts the
  // same shortcut itself and forwards it here via postMessage (see
  // initPostMessageListener's 'undo'/'redo' cases) since keydown never
  // bubbles out of an iframe.
  document.addEventListener('keydown', (e) => {
    if ((e.key || '').toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey)) return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    const isNativeEditableField = tag === 'INPUT' || tag === 'TEXTAREA' || (active && active.isContentEditable);
    if (isNativeEditableField) return;
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  });

  // Multi-tab draft conflict warning (audit medium #8)
  initTabConflictWatcher();
  const tabConflictReloadBtn = $('btn-tab-conflict-reload');
  if (tabConflictReloadBtn) tabConflictReloadBtn.addEventListener('click', () => window.location.reload());
  const tabConflictDismissBtn = $('btn-tab-conflict-dismiss');
  if (tabConflictDismissBtn) tabConflictDismissBtn.addEventListener('click', hideTabConflictBanner);

  // Save state indicator + exit guard (Wave 9)
  initSaveGuard();
  initRecoveryBanner();
  const demoBannerDismissBtn = $('btn-dismiss-demo-banner');
  if (demoBannerDismissBtn) demoBannerDismissBtn.addEventListener('click', () => closeQuickstart());
  const quickstartForm = $('quickstart-form');
  if (quickstartForm) quickstartForm.addEventListener('submit', (e) => {
    e.preventDefault();
    applyQuickstart();
  });
  // Wave 12: the pill used to always jump straight to the quick-start form —
  // it now opens a menu naming exactly which fields are still missing (with
  // quick-start kept as its first item, one click further in but still one
  // click away), so an owner learns WHAT to fix, not just that something is
  // unfinished (see buildChecklistMenu()).
  const checklistBtn = $('checklist-indicator');
  if (checklistBtn) {
    checklistBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleChecklistMenu();
    });
  }
  document.addEventListener('click', (e) => {
    if (!checklistMenuOpen) return;
    const menu = $('checklist-menu');
    if (menu && !menu.contains(e.target) && e.target !== checklistBtn) closeChecklistMenu();
  });

  // Undo / redo toolbar buttons
  const undoBtn = $('btn-undo');
  if (undoBtn) undoBtn.addEventListener('click', undo);
  const redoBtn = $('btn-redo');
  if (redoBtn) redoBtn.addEventListener('click', redo);

  // Account menu (audit medium #7 — no way to reach logout/project list from the editor)
  const acctBtn = $('btn-account-menu');
  if (acctBtn) {
    acctBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (accountMenuOpen) closeAccountMenu(); else openAccountMenu();
    });
  }
  document.addEventListener('click', (e) => {
    if (!accountMenuOpen) return;
    const menu = $('account-menu');
    if (menu && !menu.contains(e.target) && e.target !== acctBtn) closeAccountMenu();
  });
  const acctProjectsBtn = $('account-menu-projects');
  if (acctProjectsBtn) {
    acctProjectsBtn.addEventListener('click', () => {
      closeAccountMenu();
      window.location.hash = '#dashboard';
    });
  }
  const acctLogoutBtn = $('account-menu-logout');
  if (acctLogoutBtn) acctLogoutBtn.addEventListener('click', () => { closeAccountMenu(); doLogout(); });
  const acctLogoutAllBtn = $('account-menu-logout-all');
  if (acctLogoutAllBtn) acctLogoutAllBtn.addEventListener('click', () => { closeAccountMenu(); doLogoutEverywhere(); });

  // Color picker
  initColorPicker();

  // Image file input
  initImageFileInput();
}

// ---------------------------------------------------------------------------
// 25. Bootstrap
// ---------------------------------------------------------------------------

async function boot() {
  setLoading(true, 'Se încarcă…');
  try {
    initPostMessageListener();
    wireStaticButtons();
    tryTelegramAuth();

    const [user] = await Promise.all([
      fetchCurrentUser().catch(() => null),
      fetchAppConfig(),
    ]);
    updateUserUI(user);

    window.addEventListener('hashchange', () => handleRoute(window.location.hash));
    await handleRoute(window.location.hash);
  } catch (e) {
    console.error('Boot error:', e);
    showToast('Inițializarea a eșuat. Reîncarcă pagina.', 'error', 8000);
  } finally {
    setLoading(false);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
