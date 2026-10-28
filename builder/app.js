'use strict';
/* ============================================================
   Hidook Builder — app.js
   Catalog, sign-in, "Site-urile mele" and billing returns.
   Sites are edited in the block editor (/app/blocks/).
   Vanilla JS, zero framework/CDN. User-facing strings in Romanian.
   ============================================================ */

// ---------------------------------------------------------------------------
// 1. State
// ---------------------------------------------------------------------------

// Local drafts of the retired form editor. Nothing writes them any more;
// sign-out still clears them so an old draft never outlives its owner's session.
const LEGACY_DRAFT_KEYS = ['hb.draft.v1', 'hb.draft.replaced.v1', 'hb.draft.scopes.v1'];
// The block editor's local draft (builder/blocks/editor.js STORE).
const BLOCKS_DRAFT_KEY = 'hb.blocks.draft.v1';

let currentUser = null;

// Runtime config from /api/config
let appConfig = { amount: null, currency: 'usd', renewal: null, priceEur: null, brandDomain: null, contactUrl: null, trialDays: 14 };

// Account menu state
let accountMenuOpen = false;

// ---------------------------------------------------------------------------
// 2. Helpers — DOM
// ---------------------------------------------------------------------------

function $(id) { return document.getElementById(id); }
function show(el) { if (el) el.style.display = ''; }
function hide(el) { if (el) el.style.display = 'none'; }
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

// Suite 4 QA (m20): #toast is a single global slot — a second showToast()
// call used to overwrite whatever was already showing instantly, even a
// message the user had not had a chance to read yet (e.g. a failed save
// immediately followed by another action's toast). TOAST_MIN_VISIBLE_MS is
// a floor per message; a call that arrives before it elapses is queued
// (capped at 2 pending, dropping the oldest so a burst of failures can't
// build a long stale tail) instead of erasing the current one.
//
// The floor was 2500ms at first, then 900ms, and both were wrong in the same
// way: they delayed the answer to the owner's OWN next click. fullpass caught
// it — export HTML, then immediately export ZIP, and the second refusal sat
// behind the first, which reads as the button doing nothing.
//
// The floor is not really about time; it is about WHOSE message is arriving.
// A background failure (an autosave that could not reach the server) must not
// wipe something the owner is still reading. A message they just asked for by
// clicking must never wait. So the floor applies only when no user gesture
// preceded the message — see toastFollowsUserGesture() below.
const TOAST_MIN_VISIBLE_MS = 2500;
// A toast arriving within this long after a click/keypress is that action's
// answer, not background noise, and jumps the queue.
const TOAST_GESTURE_WINDOW_MS = 1500;
let lastUserGestureAt = 0;
if (typeof document !== 'undefined') {
  ['pointerdown', 'keydown'].forEach((evt) => {
    document.addEventListener(evt, () => { lastUserGestureAt = Date.now(); }, true);
  });
}
function toastFollowsUserGesture() {
  return Date.now() - lastUserGestureAt <= TOAST_GESTURE_WINDOW_MS;
}
let toastTimer = null;
let toastShownAt = 0;
let toastQueue = [];

function renderToastNow(msg, type, durationMs) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (type ? ' toast-' + type : '');
  t.style.display = '';
  toastShownAt = Date.now();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(advanceToastQueue, durationMs || 3500);
}

function advanceToastQueue() {
  toastTimer = null;
  const next = toastQueue.shift();
  if (next) {
    renderToastNow(next.msg, next.type, next.durationMs);
  } else {
    const t = $('toast');
    if (t) t.style.display = 'none';
  }
}

function showToast(msg, type, durationMs) {
  const t = $('toast');
  if (!t) return;
  const isShowing = t.style.display !== 'none';
  if (!isShowing || toastFollowsUserGesture() || Date.now() - toastShownAt >= TOAST_MIN_VISIBLE_MS) {
    renderToastNow(msg, type, durationMs);
    return;
  }
  toastQueue.push({ msg, type, durationMs });
  if (toastQueue.length > 2) toastQueue.shift();
}

function hideToast() {
  const t = $('toast');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  toastQueue = [];
  if (t) t.style.display = 'none';
}

// Focus trap: keep Tab/Shift+Tab cycling inside the open modal instead of
// leaking into the page hidden behind the overlay. ARIA APG
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

function openModal(id, opener) {
  const el = $(id);
  if (!el) return;
  el.style.display = '';
  const state = modalFocusState[id] || (modalFocusState[id] = {});
  // Most triggers are a plain, still-visible button: document.activeElement
  // at call time IS that button, so the default (no `opener` arg) keeps
  // working exactly as before. A caller passes `opener` explicitly when its
  // own trigger will not still be around to refocus — e.g. a dropdown menu
  // item whose containing menu the caller already closed (and hid) before
  // calling openModal(), which would otherwise leave document.activeElement
  // on document.body (focus falls off a hidden element) and make the modal
  // un-refocusable on close. See openDeleteAccountModal().
  state.opener = opener || document.activeElement;
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
  // SESS-03: closing the auth/publish modal abandons whatever it was waiting
  // for — never leave a poll loop ticking in the background after that.
  if (id === 'modal-publish' && typeof stopAuthPolling === 'function') stopAuthPolling();
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

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* U-08: small inline SVG icon set for empty/loading/error chrome states —
 * stroke icons, currentColor, 1.5px stroke, 24px viewBox. Replaces the
 * system emoji (clipboard/chart) PLAN-UX-2026-09-27.md §6 flags as
 * off-style. No external icon font/CDN — see AGENTS.md "self-contained". */
const STATE_ICONS = {
  tray: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 13l2.2-7.2A2 2 0 0 1 8.1 4.5h7.8a2 2 0 0 1 1.9 1.3L20 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 13h4.2a2 2 0 0 1 1.9 1.4l.1.4a2 2 0 0 0 1.9 1.4h.6a2 2 0 0 0 1.9-1.4l.1-.4A2 2 0 0 1 16.8 13H21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="15.8" r="1" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5"/><path d="M8.3 12.4l2.5 2.5 4.9-5.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9" rx="1.8" stroke="currentColor" stroke-width="1.5"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  spinner: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5" opacity=".25"/><path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

/** One consistent block for an empty or error placeholder: icon badge, a
 * one-line title, a one-line explanation and one primary action. `actionHtml`
 * is already-escaped markup (a <button>/<a>); pass '' for no action. */
function escHtmlForAttr(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function stateBlockHTML({ icon = 'tray', isError = false, title, desc, actionHtml = '', style = '' }) {
  return '<div class="empty-state"' + (style ? ' style="' + escHtml(style) + '"' : '') + '>'
    + '<div class="empty-state-icon' + (isError ? ' is-error' : '') + '">' + (STATE_ICONS[icon] || STATE_ICONS.tray) + '</div>'
    + '<p class="empty-state-title">' + escHtml(title) + '</p>'
    + (desc ? '<p>' + escHtml(desc) + '</p>' : '')
    + actionHtml
    + '</div>';
}

/** One consistent inline loading placeholder: spinning icon + one-line text. */
function loadingStateHTML(text) {
  return '<div class="loading-state"><span class="loading-state-icon">' + STATE_ICONS.spinner + '</span><span>' + escHtml(text) + '</span></div>';
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 16. API
// ---------------------------------------------------------------------------

async function apiGet(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) {
    const json = await r.json().catch(() => ({}));
    // Same fromServer contract as apiPost/apiDelete below — safeServerMessage
    // needs it to tell a deliberate 4xx refusal from a 5xx it must never show.
    throw Object.assign(new Error(json.error || 'Eroare server'), {
      status: r.status,
      code: json.code,
      fromServer: true,
    });
  }
  return r.json();
}

/**
 * The one rule this file uses to turn a failed apiGet/apiPost/apiDelete call
 * into text safe to show a customer — extracted from the publish flow's own
 * catch (PLAN-UX-2026-09-27 §4/§5.8), now the single copy every call site
 * shares instead of reimplementing it:
 *   - a 4xx the server sent on purpose (fromServer, status 400-499, has a
 *     message) is a deliberate refusal written in Romanian for a person to
 *     read — shown as-is;
 *   - a 5xx was never written for a customer (an internal failure, a stack,
 *     a driver error) and is never shown, whether or not it has a message —
 *     UNLESS its e.code is in the caller's own `safeCodes` allowlist (R-27:
 *     a specific, hand-written Romanian message for a specific known 5xx
 *     case, e.g. "the account delete aborted because Stripe could not be
 *     reached" — still never a blanket "show any 5xx text" escape hatch);
 *   - a raw network/timeout failure (fetch's own TypeError, or an
 *     AbortError) never reached the server at all — the fallback gets a
 *     concrete next step instead of a bare "something failed";
 *   - anything else reaching here is one of this file's own local Romanian
 *     messages (never the browser's raw text), shown as-is.
 * Never returns a raw e.message the browser or a 5xx body produced, except
 * for a code explicitly named in safeCodes.
 */
function safeServerMessage(e, fallbackRo, safeCodes) {
  fallbackRo = fallbackRo || RO.GENERIC_FALLBACK;
  if (e && e.fromServer && typeof e.status === 'number') {
    if (e.status >= 400 && e.status < 500 && e.message) return e.message;
    if (e.status >= 500 && e.message && Array.isArray(safeCodes) && safeCodes.indexOf(e.code) !== -1) return e.message;
    return fallbackRo;
  }
  if (e && (e.name === 'TypeError' || e.name === 'AbortError')) {
    return fallbackRo + ' Verifică conexiunea și încearcă din nou.';
  }
  return (e && e.message) || fallbackRo;
}

/**
 * Download a site as a self-hostable static ZIP (dashboard card).
 * GET /api/export-zip?siteId= — HTML/CSS/JS/images/legal pages. Not a live
 * publish. The server enforces the same entitlement as live publish.
 */
async function downloadSiteZip(siteId, btn) {
  if (btn) setBtnLoading(btn, true, 'Se pregătește…');
  try {
    const res = await fetch('/api/export-zip?siteId=' + encodeURIComponent(siteId), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/zip' },
    });
    if (!res.ok) {
      const msg = res.status === 401
        ? RO.DOWNLOAD_ZIP_SIGNIN
        : res.status === 402
          ? RO.DOWNLOAD_ZIP_TRIAL_REQUIRED
          : RO.DOWNLOAD_ZIP_FAILED;
      showToast(msg, 'error', 5000);
      return;
    }
    const blob = await res.blob();
    let filename = 'site.zip';
    const cd = res.headers.get('Content-Disposition') || '';
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
    showToast(RO.DOWNLOAD_ZIP_DONE, 'success', 2500);
  } catch (_) {
    showToast(RO.DOWNLOAD_ZIP_FAILED, 'error', 5000);
  } finally {
    if (btn) setBtnLoading(btn, false);
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
 * by the custom-domain "Deconectează" action (DELETE /api/sites/:id/domain)
 * and by the site "Șterge" confirm modal (DELETE /api/sites/:id with a
 * {confirmName} body).
 */
async function apiDelete(url, body) {
  const opts = { method: 'DELETE', credentials: 'include' };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
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
  // Landing price honesty (owner 2026-09-27): the currency symbol and the
  // 29/year renewal are back on every landing zone — see builder/terms.html
  // §3 and the publish/success modals for the wording this must match.
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
  // How-it-works: same commercial config (no hard-coded 99€/29€)
  const howPrice = $('how-price');
  const howRenewal = $('how-renewal');
  if (howPrice) howPrice.textContent = priceLabel;
  if (howRenewal) howRenewal.textContent = renewalLabel;
}

/**
 * ONE money formatter for every price surface (owner decision 2026-09-27,
 * gap-pricing-display-consistency-live#1/#2): the currency symbol is back
 * everywhere a price shows — landing, publish/success modals, dashboard
 * card and Facturi all render through this, instead of five separate
 * ad-hoc implementations that drifted apart (plain "99", "99€", and
 * Intl's "99,00 EUR" were all live in production at once before this).
 */
function formatMoneyLabel(amount, currency) {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const cur = String(currency || 'usd').toLowerCase();
  const rounded = Math.round(amount * 100) / 100;
  const num = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  if (cur === 'gbp') return '£' + num;
  if (cur === 'eur') return num + '€';
  return '$' + num;
}

function formatPriceLabel(cfg) {
  const amount = cfg.amount != null ? cfg.amount : cfg.priceEur;
  return formatMoneyLabel(amount, cfg.currency);
}

function formatRenewalLabel(cfg) {
  const amount = cfg.renewal != null ? cfg.renewal : 29;
  return formatMoneyLabel(amount, cfg.currency);
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
 * Reactivating a canceled site costs the yearly price and adds one year on top
 * of any paid time left: max(paidUntil, now) + 12 months (same rule as
 * webpublish.computeRenewalPaidUntil, which applies it after payment).
 */
function reactivationPaidUntilIso(site) {
  const now = Date.now();
  const cur = site && site.paid === true && site.paidUntil ? Date.parse(site.paidUntil) : NaN;
  const d = new Date(Number.isFinite(cur) && cur > now ? cur : now);
  d.setUTCMonth(d.getUTCMonth() + 12);
  return d.toISOString();
}

/** The price + resulting date, stated on the canceled card before any click. */
function buildReactivationNote(site) {
  const note = document.createElement('div');
  note.className = 'site-hosting-until site-reactivate-note';
  note.setAttribute('data-reactivate-note', site.id || '');
  note.textContent = t('REACTIVATE_NOTE', {
    price: formatRenewalLabel(appConfig),
    date: formatHostingUntilDate(reactivationPaidUntilIso(site)),
  });
  return note;
}


/**
 * PLAN-FEEDBACK-2026-09-14 defect #2 — ONE source of truth for "this site's
 * public address" on the client: `site.publicUrl || site.url`. The server
 * attaches `publicUrl` (an active verified custom domain, else the same
 * value already in `url`) to every site object it returns (GET /api/sites,
 * GET /api/sites/:id, POST /api/publish, POST /api/test-pay/complete — see
 * withPublicUrl() in bot/server.js). Every display surface — the success
 * modal, its copy button, "Trimite pe WhatsApp", and the dashboard card
 * link — reads the URL this way so they can never show different addresses
 * for the same site. `site.url` itself is left untouched for callers that
 * legitimately need the platform host regardless of a custom domain
 * (openDomainModal's "current origin").
 *
 * Every call site inlines `site.publicUrl || site.url` directly rather than
 * calling a shared function: execPublish, completeTestCheckout,
 * ensureDraftBoundToPaidSite, bindSignedInPaidSiteForEdit and buildSiteCard
 * are all extracted and eval'd standalone by isolated-extraction tests (e.g.
 * bot/test/s92-s91-advocate.test.js) that never declare a helper by this
 * name — see saveDraft()'s own typeof-guard comments above for the same
 * constraint. Kept here only as documentation of the rule, not as a
 * function anything currently calls.
 */

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

/** Card trial length in days, from /api/config (server: SUBSCRIPTION_TRIAL_DAYS). */
function trialDaysConfigured() {
  const n = Number(appConfig && appConfig.trialDays);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

/**
 * Trial end ISO for dashboard chrome.
 * Prefer site.trialEnd / Stripe trial fields; else checkout start + trial days;
 * else derive from paidUntil (first hosting year start + trial days).
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
      d.setUTCDate(d.getUTCDate() + trialDaysConfigured());
      return d.toISOString();
    }
  }
  // paidUntil ≈ checkout + 12 months on first publish → trial end ≈ paidUntil − 1y + trial days
  if (site.paidUntil) {
    const until = new Date(site.paidUntil);
    if (Number.isFinite(until.getTime())) {
      const trialEnd = new Date(until);
      trialEnd.setUTCFullYear(trialEnd.getUTCFullYear() - 1);
      trialEnd.setUTCDate(trialEnd.getUTCDate() + trialDaysConfigured());
      return trialEnd.toISOString();
    }
  }
  if (site.createdAt) {
    const d = new Date(site.createdAt);
    if (Number.isFinite(d.getTime())) {
      d.setUTCDate(d.getUTCDate() + trialDaysConfigured());
      return d.toISOString();
    }
  }
  return null;
}

/**
 * Paid + live, not yet first invoice: show 14-day trial line instead of Hosting until.
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
  // R-27: the header account menu carries "Descarcă datele mele" /
  // "Șterge contul" / "Deconectare de pe toate dispozitivele".
  const headerMenuWrap = $('account-menu-wrap-header');
  if (user) {
    if (badge) { badge.textContent = user.email || ('ID: ' + String(user.id).slice(0,8)); show(badge); }
    if (logoutBtn) show(logoutBtn);
    if (navDash) show(navDash);
    if (headerMenuWrap) show(headerMenuWrap);
  } else {
    if (badge) hide(badge);
    if (logoutBtn) hide(logoutBtn);
    if (navDash) hide(navDash);
    if (headerMenuWrap) hide(headerMenuWrap);
  }
}

/**
 * Called by doLogout()/confirmLogoutEverywhere()/confirmDeleteAccount()
 * before currentUser is cleared: removes local drafts tied to an account, so
 * the next person to sign in on this browser never resumes this account's
 * business data. An anonymous block draft (no siteId yet) is left alone.
 */
async function clearOwnedLocalDraftState() {
  LEGACY_DRAFT_KEYS.forEach((key) => {
    try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
  });
  try {
    const blocksDraft = lsGet(BLOCKS_DRAFT_KEY);
    if (blocksDraft && blocksDraft.siteId) localStorage.removeItem(BLOCKS_DRAFT_KEY);
  } catch (_) { /* ignore */ }
}

/**
 * Header "Deconectare".
 *
 * Wave 8 (AUDIT-07 re-audit): this now also revokes the session server-side
 * (bot/server.js POST /api/auth/logout), not just clears client-side state —
 * see bot/auth.js#revokeSession.
 *
 * gap-cross-account-draft-leak-depth: also clears this account's local draft
 * state (see clearOwnedLocalDraftState() above) BEFORE the account is
 * cleared from memory — the next person to sign in on this browser must
 * never be able to resume this account's business data.
 */
async function doLogout() {
  await clearOwnedLocalDraftState();
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
  updateUserUI(null);
  if (typeof broadcastAuthSignedOut === 'function') broadcastAuthSignedOut();
  showToast(RO.LOGGED_OUT, '', 3000);
  window.location.hash = '#templates';
}

/**
 * "Deconectare de pe toate dispozitivele" — ends every session for this
 * account, not just the current browser (Wave 8 / AUDIT-07 re-audit). Meant
 * for the case where the account's magic-link email may have been read by
 * someone else: one click ends every device's access, not only this one.
 *
 * U-01 (PLAN-UX-2026-09-27 §3): opens the product's own modal instead of
 * window.confirm() — same open/close contract (Esc, backdrop, 44px X, focus
 * trap/return) as every other modal, via the shared openModal()/closeModal().
 * `opener`: same reasoning as openDeleteAccountModal() — the real trigger is
 * a dropdown item whose containing menu the caller already closed (hidden)
 * before calling this, so callers pass the still-visible menu TOGGLE button.
 */
function openLogoutEverywhereModal(opener) {
  openModal('modal-logout-everywhere', opener);
}

async function confirmLogoutEverywhere() {
  const confirmBtn = $('btn-confirm-logout-everywhere');
  if (confirmBtn) setBtnLoading(confirmBtn, true, 'Se deconectează…');
  await clearOwnedLocalDraftState();
  try { await fetch('/api/auth/logout-everywhere', { method: 'POST', credentials: 'include' }); } catch (_) {}
  closeModal('modal-logout-everywhere');
  updateUserUI(null);
  if (typeof broadcastAuthSignedOut === 'function') broadcastAuthSignedOut();
  showToast(RO.LOGGED_OUT_EVERYWHERE, '', 3000);
  window.location.hash = '#templates';
  if (confirmBtn) setBtnLoading(confirmBtn, false);
}

// ---------------------------------------------------------------------------
// 15c. Session-expiry recovery (SESS-01/02)
// ---------------------------------------------------------------------------
//
// handleAuthExpired() is the single choke point for a 401 and for a
// same-account sign-out noticed in another tab: it flips the account UI to
// signed-out, shows one fixed Romanian banner, and offers the existing
// magic-link modal inline (reauthenticateInline()).

const AUTH_SIGNAL_KEY = 'hb.auth.signal.v1';
// Per-tab identity, so a tab ignores its own sign-out broadcast.
const TAB_ID = (function () {
  try { if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (_) {}
  return 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}());
let sessionExpiredActive = false;

/** SESS-02: tell every OTHER tab of this browser "this account just signed
 * out here" — doLogout()/confirmLogoutEverywhere() call this after clearing
 * their own state. A plain localStorage write is enough: the `storage`
 * event fires in every other same-origin tab (never this one), which is
 * exactly the audience that needs to know. */
function broadcastAuthSignedOut() {
  try {
    localStorage.setItem(AUTH_SIGNAL_KEY, JSON.stringify({ type: 'signed-out', at: Date.now(), tabId: TAB_ID }));
  } catch (_) { /* ignore — worst case that other tab only finds out on its next 401 */ }
}

function initCrossTabAuthWatcher() {
  window.addEventListener('storage', (e) => {
    if (e.key !== AUTH_SIGNAL_KEY || !e.newValue) return;
    let signal;
    try { signal = JSON.parse(e.newValue); } catch (_) { return; }
    if (!signal || signal.tabId === TAB_ID || signal.type !== 'signed-out') return;
    // Only matters if THIS tab still thinks it is signed in — a tab that was
    // never authenticated (or already knows it is not) has nothing to lose.
    if (!currentUser) return;
    handleAuthExpired();
  });
}

function showSessionExpiredBanner() {
  const banner = $('session-expired-banner');
  if (banner) { banner.style.display = ''; banner.setAttribute('aria-hidden', 'false'); }
}

function hideSessionExpiredBanner() {
  const banner = $('session-expired-banner');
  if (banner) { banner.style.display = 'none'; banner.setAttribute('aria-hidden', 'true'); }
  sessionExpiredActive = false;
}

/**
 * SESS-01/02: called on a 401 and on a same-account sign-out noticed from
 * another tab.
 */
function handleAuthExpired() {
  updateUserUI(null);
  if (sessionExpiredActive) return; // already showing — do not restack
  sessionExpiredActive = true;
  showSessionExpiredBanner();
}

/** Wired to the session-expired banner's own button — opens the same
 * magic-link modal as the dashboard sign-in, then reloads the site list. */
function reauthenticateInline() {
  const authTitleEl = $('modal-auth-title');
  if (authTitleEl) authTitleEl.textContent = RO.SESSION_EXPIRED_SHORT;
  show($('form-auth-email'));
  hide($('auth-sent'));
  hideId('auth-error');
  openModal('modal-publish');
  wireAuthForm(async () => {
    closeModal('modal-publish');
    hideSessionExpiredBanner();
    if (window.location.hash === '#dashboard') await loadDashboard();
  });
}

function initSessionExpiredBanner() {
  const btn = $('btn-session-expired-reauth');
  if (btn) btn.addEventListener('click', reauthenticateInline);
}

/** Header account menu (#btn-account-menu-header / #account-menu-header). */
function openAccountMenu() {
  const menu = $('account-menu-header');
  const btn = $('btn-account-menu-header');
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
  const menu = $('account-menu-header');
  if (menu) menu.style.display = 'none';
  const btn = $('btn-account-menu-header');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  accountMenuOpen = false;
}

function tryTelegramAuth() {
  const twa = window.Telegram && window.Telegram.WebApp;
  if (!twa || !twa.initData) return;
  apiPost('/api/auth/telegram', { initData: twa.initData })
    .then(data => { if (data.ok) updateUserUI(data.user); })
    .catch(e => console.warn('Telegram auth:', e.message));
}

// ---------------------------------------------------------------------------
/** Unauth #dashboard Intră — same magic-link modal as publish (no second auth system). */
function wireDashboardAuthButton() {
  const btn = $('btn-dashboard-auth');
  if (!btn) return;
  btn.onclick = () => {
    // m1: this modal is reused from the publish flow, but nobody here is
    // publishing anything — set a context-appropriate title BEFORE opening it
    // (the static markup default is the publish-flow copy, for that caller).
    const authTitleEl = $('modal-auth-title');
    if (authTitleEl) authTitleEl.textContent = RO.AUTH_TITLE_VIEW_SITES;
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

// ---------------------------------------------------------------------------
// SESS-03: desktop tab waiting on a magic link
// ---------------------------------------------------------------------------
//
// Before this fix, the "Link trimis! Verifică inbox-ul." screen was a dead
// end for the SPA — the tab had no way to learn the link had been used, so
// finishing sign-in required a manual reload (losing the "resume this
// action" continuation `onAuthSuccess` was there to provide). This polls
// /api/me with backoff (and immediately on window focus — the common case
// of tabbing back after checking email) so the SAME browser continues on
// its own the moment a session cookie exists, exactly like clicking the dev
// link already did.
//
// Cross-device decision: opening the link on a PHONE verifies and sets the
// session cookie in the PHONE's browser only (hb_session is HttpOnly,
// bot/auth.js) — there is no server-side channel that could promote this
// desktop tab from that. Rather than fake a "continue here" button that
// cannot actually work, #auth-sent explains this plainly and points back at
// opening the link in THIS browser instead (see builder/index.html).
let authPollTimer = null;
let authPollAttempt = 0;
let authPollActive = false;
let authPollFocusHandler = null;

function stopAuthPolling() {
  authPollActive = false;
  if (authPollTimer) { clearTimeout(authPollTimer); authPollTimer = null; }
  if (authPollFocusHandler) { window.removeEventListener('focus', authPollFocusHandler); authPollFocusHandler = null; }
}

function startAuthPolling(onAuthSuccess) {
  stopAuthPolling(); // only one poll loop live at a time
  authPollActive = true;
  authPollAttempt = 0;

  async function tryOnce() {
    if (!authPollActive) return;
    const user = await fetchCurrentUser().catch(() => null);
    if (!authPollActive) return; // the modal/form moved on while this was in flight
    if (user) {
      stopAuthPolling();
      updateUserUI(user);
      closeModal('modal-publish');
      hideToast();
      if (onAuthSuccess) {
        setLoading(true, 'Se încarcă…');
        try { await onAuthSuccess(); } catch (_) { /* ignore */ } finally { setLoading(false); }
      } else {
        window.location.hash = '#dashboard';
      }
      return;
    }
    authPollAttempt++;
    const delay = Math.min(2000 * Math.pow(1.6, authPollAttempt - 1), 15000);
    authPollTimer = setTimeout(tryOnce, delay);
  }

  authPollFocusHandler = () => { if (authPollActive) tryOnce(); };
  window.addEventListener('focus', authPollFocusHandler);
  authPollTimer = setTimeout(tryOnce, 2000);
}

function wireAuthForm(onAuthSuccess) {
  const form = $('form-auth-email');
  const sentDiv = $('auth-sent');
  const errorDiv = $('auth-error');
  const devLink = $('dev-link');

  stopAuthPolling(); // a fresh form submission supersedes any earlier wait

  if (form) form.style.display = '';
  if (sentDiv) sentDiv.style.display = 'none';
  if (errorDiv) errorDiv.style.display = 'none';

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const emailInput = $('input-email');
      const email = emailInput ? emailInput.value.trim() : '';
      if (!email) {
        if (errorDiv) { errorDiv.textContent = RO.AUTH_EMAIL_REQUIRED; show(errorDiv); }
        return;
      }
      const submitBtn = $('btn-send-magic');
      setBtnLoading(submitBtn, true, 'Se trimite…');
      if (errorDiv) hide(errorDiv);
      try {
        const res = await apiPost('/api/auth/email', { email });
        if (form) hide(form);
        if (sentDiv) show(sentDiv);
        // SESS-03: start waiting for the SAME browser to become signed in —
        // covers both "clicked the link in this same browser" and the dev
        // link below (which also stops this once it succeeds on its own).
        startAuthPolling(onAuthSuccess);
        if (res.devLink && devLink) {
          devLink.href = res.devLink;
          devLink.textContent = 'Deschide site-ul';
          show(devLink);
          // SESS-01: assignment (not addEventListener) — a second wireAuthForm()
          // call on the SAME page (e.g. session-expiry reauthenticateInline()
          // after an earlier publish/dashboard auth prompt) must REPLACE this
          // handler, not stack a second one alongside it. Two live handlers
          // on the same click used to both fire — the OLDER one's stale
          // `onAuthSuccess` closure (e.g. a plain loadDashboard() refresh)
          // ran right alongside the new one and could stomp on state it set,
          // such as the newly (re)scheduled autosave retry.
          devLink.onclick = async (ev) => {
            // Keep SPA: verify via fetch so draft/publish resume works (S62)
            ev.preventDefault();
            try {
              const href = devLink.getAttribute('href') || res.devLink;
              await fetch(href, { credentials: 'include', redirect: 'follow' });
              const user = await fetchCurrentUser().catch(() => null);
              if (user) {
                stopAuthPolling(); // this click already finished what the poll loop was waiting for
                updateUserUI(user);
                closeModal('modal-publish');
                hideToast();
                if (onAuthSuccess) {
                  setLoading(true, 'Se încarcă…');
                  try { await onAuthSuccess(); } catch (_) {} finally { setLoading(false); }
                } else {
                  window.location.hash = '#dashboard';
                }
              } else {
                window.location.href = href;
              }
            } catch (_) {
              window.location.href = devLink.href || res.devLink;
            }
          };
        }
      } catch (err) {
        // audit medium #6: the server sends a specific reason (rate limit,
        // invalid email, service unavailable) — safeServerMessage() shows it
        // for a 4xx it marked fromServer, never a transport failure's raw
        // browser text.
        if (errorDiv) { errorDiv.textContent = safeServerMessage(err, RO.IG_LINK_SEND_FAILED); show(errorDiv); }
      } finally {
        setBtnLoading(submitBtn, false);
      }
    };
  }
}
/**
 * HIDOOK_TEST_PAY offline return: #test-checkout=cs_test_* completes the same
 * paid transition as the unsigned test webhook (POST /api/test-pay/complete).
 */
async function completeTestCheckout(sessionId) {
  const id = String(sessionId || '').trim();
  if (!/^cs_test_[A-Za-z0-9]+$/.test(id)) {
    showToast(RO.INVALID_PAYMENT_SESSION, 'error');
    return;
  }
  setLoading(true, 'Se confirmă plata…');
  try {
    const data = await apiPost('/api/test-pay/complete', { sessionId: id });
    let site = data && data.site;
    // Drop pay-loading before any success chrome so title and loader never contradict.
    setLoading(false);
    hideToast();
    if (data && data.reactivation) {
      // A canceled site paid the yearly price: back online, no trial involved.
      showToast(t('REACTIVATED_DONE', { date: formatHostingUntilDate(site && site.paidUntil) }), 'success', 7000);
      return;
    }
    if (site && site.paid && !isLiveSiteUrl(site.url)) {
      try {
        const fresh = await apiGet('/api/sites/' + encodeURIComponent(site.id));
        if (fresh && fresh.site) site = fresh.site;
      } catch (_) { /* fall through to the plain toast */ }
    }
    if (site && isLiveSiteUrl(site.url)) {
      showSuccessScreen(site);
    } else if (site && site.paid) {
      showToast(RO.TRIAL_STARTED, 'success', 6000);
    } else {
      showToast(RO.PAYMENT_PROCESSED, 'success', 5000);
    }
  } catch (e) {
    showToast(RO.PAYMENT_CONFIRM_FAILED, 'error', 6000);
  } finally {
    setLoading(false);
  }
}

// The site the success modal is about — «Înapoi la editor» reopens it.
let successSiteId = null;

/** Payment confirmed and the site is live: address, copy, WhatsApp share. */
function showSuccessScreen(site) {
  setLoading(false);
  hideToast();
  closeModal('modal-publish');
  successSiteId = site.id || null;

  const url = site.publicUrl || site.url;
  const href = absoluteSiteUrl(url) || url;
  const urlText = $('success-url-text');
  const urlLink = $('success-url-link');
  // Soft-wrap only at `/` so a long /live/<slug>/ stays readable at 390px.
  if (urlText) fillUrlWithSlashWbr(urlText, href);
  if (urlLink) urlLink.href = href;

  const waBtn = $('btn-share-wa');
  if (waBtn) {
    const businessName = site.projectName || 'Site-ul nostru';
    const waText = encodeURIComponent('Salut! Am creat site-ul pentru ' + businessName + ': ' + href);
    waBtn.onclick = () => { window.open('https://wa.me/?text=' + waText, '_blank', 'noopener'); };
  }

  openModal('modal-success');
}

// ---------------------------------------------------------------------------
// 21. Templates screen
// ---------------------------------------------------------------------------

function renderTemplatesGrid() {
  const grid = $('templates-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // New sites are block sites (builder/blocks/); a starter pack is the "design".
  const packs = window.SB_PACKS || {};
  if (!window.SB || !Object.keys(packs).length) {
    grid.innerHTML = stateBlockHTML({
      icon: 'alert',
      isError: true,
      title: 'Designurile nu sunt disponibile momentan',
      desc: 'Verifică-ți conexiunea și încearcă din nou.',
      actionHtml: '<button type="button" class="btn-ghost" id="btn-retry-templates">Reîncearcă</button>',
      style: 'grid-column:1/-1',
    });
    $('btn-retry-templates').addEventListener('click', reloadDesignPacks);
    return;
  }
  const order = ['gol'].concat(Object.keys(packs).filter((id) => id !== 'gol'));
  window.SB.setAssetBase('/app/generated/template-assets/');

  order.forEach((id) => {
    const pack = packs[id];
    if (!pack) return;
    const card = document.createElement('div');
    card.className = 'template-card';
    card.setAttribute('role', 'listitem');
    card.dataset.templateId = id;
    card.dataset.vertical = PACK_FILTER[id] || 'all';

    const previewWrap = document.createElement('div');
    previewWrap.className = 'template-card-preview';
    const shimmer = document.createElement('div');
    shimmer.className = 'template-card-preview-shimmer';
    previewWrap.appendChild(shimmer);
    let previewLoaded = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || previewLoaded) return;
      previewLoaded = true;
      observer.disconnect();
      try {
        const site = window.SB.defaultSite(id);
        const iframe = document.createElement('iframe');
        iframe.className = 'template-card-preview-frame';
        iframe.title = 'Previzualizare ' + pack.label;
        iframe.setAttribute('sandbox', '');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.tabIndex = -1;
        iframe.addEventListener('load', () => shimmer.classList.add('loaded'));
        iframe.srcdoc = window.SB.renderPage(site, site.pages[0].id, location.origin + '/app/');
        previewWrap.appendChild(iframe);
      } catch (_) {
        shimmer.classList.add('loaded');
      }
    }, { rootMargin: '400px' });
    observer.observe(previewWrap);

    const pages = pack.blank ? 'O pagină, o completezi tu' : pack.pages.length + ' pagini gata scrise';
    const body = document.createElement('div');
    body.className = 'template-card-body';
    body.innerHTML = `
      <span class="template-card-badge">${escHtml(pages)}</span>
      <div class="template-card-title">${escHtml(pack.label)}</div>
      <div class="template-card-desc">${escHtml(pack.desc || '')}</div>
      <div class="template-card-actions">
        <button class="btn-primary btn-start-tpl" data-id="${escHtml(id)}" aria-label="Începe cu designul ${escHtml(pack.label)}">Începe</button>
      </div>`;
    const start = (e) => { if (e) e.stopPropagation(); startBlocksSite(id); };
    body.querySelector('.btn-start-tpl').addEventListener('click', start);
    card.addEventListener('click', start);

    card.appendChild(previewWrap);
    card.appendChild(body);
    grid.appendChild(card);
  });

  applyCatalogFilter(activeCatalogFilter);
  populateHeroStage();
}

/** Catalog chip each starter pack sits under; "De la zero" shows under every chip. */
const PACK_FILTER = {
  restaurant: 'product-menu', cafenea: 'product-menu', catering: 'product-menu',
  salon: 'portfolio', mireasa: 'portfolio', cosmetica: 'portfolio',
  meserii: 'local-service', renovari: 'local-service',
  profesionisti: 'professionals', consultanta: 'professionals', contabilitate: 'professionals',
  cofetarie: 'desserdirina',
};

/** Retry for the empty state: load the pack scripts again, then redraw. */
function reloadDesignPacks() {
  const files = ['/app/blocks/packs.js', '/app/blocks/packs-more.js', '/app/blocks/blocks.js'];
  const next = (i) => {
    if (i >= files.length) { renderTemplatesGrid(); return; }
    const el = document.createElement('script');
    el.src = files[i] + '?r=' + Date.now();
    el.onload = () => next(i + 1);
    el.onerror = () => renderTemplatesGrid();
    document.head.appendChild(el);
  };
  next(0);
}

/**
 * A block-editor draft that left for the sign-in link or for checkout:
 * returns the editor URL to go back to (and clears the flag), or null.
 */
function blocksResumeUrl(reason) {
  try {
    const d = JSON.parse(localStorage.getItem(BLOCKS_DRAFT_KEY) || 'null');
    if (!d || d.resume !== reason) return null;
    if (reason === 'checkout') { d.resume = null; localStorage.setItem(BLOCKS_DRAFT_KEY, JSON.stringify(d)); }
    return '/app/blocks/' + (d.siteId ? '?site=' + encodeURIComponent(d.siteId) : '');
  } catch (_) {
    return null;
  }
}

/** Open the block editor on a fresh copy of a starter pack. */
function startBlocksSite(packId) {
  window.location.href = '/app/blocks/?pack=' + encodeURIComponent(packId);
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
      || vert === 'all'
      || vert === activeCatalogFilter
      || id === activeCatalogFilter;
    card.hidden = !show;
  });
}

/** Landing hero: three starter packs as small live pages (restaurant in the middle). */
function populateHeroStage() {
  const stack = $('hero-stage-stack');
  if (!stack || heroStagePopulated || !window.SB) return;
  const slots = stack.querySelectorAll('[data-stage-slot]');
  const packs = window.SB_PACKS || {};
  const ids = ['salon', 'restaurant', 'meserii'].filter((id) => packs[id]);
  if (!slots.length || !ids.length) return;
  slots.forEach((slot, i) => {
    const id = ids[i % ids.length];
    try {
      const site = window.SB.defaultSite(id);
      const iframe = document.createElement('iframe');
      iframe.title = '';
      iframe.setAttribute('sandbox', '');
      iframe.setAttribute('tabindex', '-1');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.srcdoc = window.SB.renderPage(site, site.pages[0].id, location.origin + '/app/');
      slot.innerHTML = '';
      slot.appendChild(iframe);
    } catch (_) { /* keep empty paper card */ }
  });
  heroStagePopulated = true;
}

// ---------------------------------------------------------------------------
// 22. Dashboard
// ---------------------------------------------------------------------------

async function loadDashboard() {
  const list = $('sites-list');
  if (!list) return;
  list.innerHTML = loadingStateHTML('Se încarcă site-urile…');

  try {
    const data = await apiGet('/api/sites');
    const sites = data.sites || [];

    if (sites.length === 0) {
      list.innerHTML = stateBlockHTML({
        icon: 'tray',
        title: RO.DASHBOARD_EMPTY_TITLE,
        desc: RO.DASHBOARD_EMPTY_DESC,
        actionHtml: '<a href="#templates" class="btn-primary">Creează primul site</a>',
      });
      return;
    }

    list.innerHTML = '';
    // U-01: newest first by createdAt (API has no ORDER BY; see PLAN-UX-2026-09-27 §3).
    const sitesNewestFirst = sites.slice().sort((a, b) => {
      const ta = Date.parse(a && a.createdAt) || 0;
      const tb = Date.parse(b && b.createdAt) || 0;
      return tb - ta;
    });
    sitesNewestFirst.forEach(site => { list.appendChild(buildSiteCard(site)); });
  } catch (e) {
    if (e.status === 401) {
      list.innerHTML = stateBlockHTML({
        icon: 'lock',
        title: RO.DASHBOARD_AUTH_REQUIRED_TITLE,
        desc: RO.DASHBOARD_AUTH_REQUIRED_DESC,
        actionHtml: '<button type="button" class="btn-primary" id="btn-dashboard-auth">Autentificare</button>',
      });
      wireDashboardAuthButton();
    } else {
      list.innerHTML = stateBlockHTML({
        icon: 'alert',
        isError: true,
        title: RO.DASHBOARD_LOAD_FAILED_TITLE,
        desc: safeServerMessage(e, RO.TRY_AGAIN),
        actionHtml: '<button type="button" class="btn-ghost" id="btn-retry-dashboard">Reîncearcă</button>',
      });
      const retryBtn = $('btn-retry-dashboard');
      if (retryBtn) retryBtn.addEventListener('click', loadDashboard);
    }
  }
}

/**
 * Mirrors bot/calendar-native/cutover.js#isNativeBookingEnabled (the builder
 * cannot require() server modules): appointment.nativeBooking is a text field.
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

function buildSiteCard(site) {
  const card = document.createElement('div');
  card.className = 'site-card';

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'site-card-preview-thumb';
  if (site.templateId === 'blocks' && window.SB) {
    apiGet('/api/sites/' + encodeURIComponent(site.id)).then((data) => {
      const cfg = data && data.config;
      if (!cfg || cfg.v !== 2) return;
      window.SB.setAssetBase('/app/generated/template-assets/');
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', '');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.title = 'Previzualizare ' + (site.projectName || site.slug || 'site');
      iframe.srcdoc = window.SB.renderPage(cfg, cfg.pages[0].id, location.origin + '/app/');
      thumbWrap.appendChild(iframe);
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

  // Inlined rather than calling siteDisplayUrl() — buildSiteCard() is
  // extracted and eval'd standalone by isolated-extraction tests.
  const displayUrl = site && (site.publicUrl || site.url);
  if (displayUrl) {
    const link = document.createElement('a');
    link.className = 'site-live-link';
    const liveHref = absoluteSiteUrl(displayUrl);
    link.href = liveHref || displayUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    // Soft-wrap only at `/` — same as success URL (W13 390 slug shred).
    // Show absolute same-origin so the stranger can open/copy a real URL.
    fillUrlWithSlashWbr(link, liveHref || displayUrl);
    link.addEventListener('click', e => e.stopPropagation());
    meta.appendChild(link);
  }

  info.appendChild(name);
  info.appendChild(meta);

  // During live/active trial only: trial de 14 zile · prima taxare 99 pe <day-14 date>
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
      const trialLabel = 'Trial de 14 zile · prima taxare ' + price;
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

  // Only block sites have an editor; a site made with the retired form editor
  // keeps its billing, domain and delete actions.
  if (site.templateId === 'blocks') {
    const editBtn = document.createElement('a');
    editBtn.className = 'btn-ghost btn-sm';
    editBtn.textContent = 'Editează';
    editBtn.href = '/app/blocks/?site=' + encodeURIComponent(site.id);
    editBtn.setAttribute('aria-label', 'Editează site-ul ' + (site.projectName || site.slug || ''));
    actions.appendChild(editBtn);
  }

  // Unpaid → add card / start trial; paid+expired → renew; paid+active → Cancel (portal).
  // A canceled site (even one canceled in its trial, paid=false) is reactivated
  // below at the yearly price — it never gets a second trial.
  if ((!site.paid || hostingExpired) && site.status !== 'unpublished') {
    const keepBtn = document.createElement('button');
    keepBtn.className = 'btn-primary btn-sm';
    let payLabel, payAriaLabel;
    if (site.paid && hostingExpired) {
      payLabel = 'Reînnoiește hosting — ' + formatRenewalLabel(appConfig);
      payAriaLabel = 'Reînnoiește hostingul pentru acest site';
    } else {
      payLabel = 'Adaugă un card — începe trialul de 14 zile';
      payAriaLabel = 'Adaugă un card ca să începi trialul de 14 zile';
    }
    keepBtn.textContent = payLabel;
    keepBtn.setAttribute('aria-label', payAriaLabel);
    keepBtn.addEventListener('click', async () => {
      try {
        setBtnLoading(keepBtn, true, 'Se procesează…');
        const data = await apiPost('/api/sites/' + encodeURIComponent(site.id) + '/checkout', {});
        if (data.paymentUrl) window.location.href = data.paymentUrl;
      } catch (e) {
        showToast(safeServerMessage(e, RO.ACTION_GENERIC_FAILED), 'error');
      } finally {
        setBtnLoading(keepBtn, false);
      }
    });
    actions.appendChild(keepBtn);
  } else if (site.status === 'unpublished') {
    // Canceled: yearly price, no new trial; the note states price and date first.
    info.appendChild(buildReactivationNote(site));
    const reactivateBtn = document.createElement('button');
    reactivateBtn.className = 'btn-primary btn-sm';
    reactivateBtn.textContent = 'Reactivează site-ul — ' + formatRenewalLabel(appConfig);
    reactivateBtn.setAttribute('aria-label', 'Reactivează site-ul ' + (site.projectName || site.slug || '') + ' pentru ' + formatRenewalLabel(appConfig));
    reactivateBtn.addEventListener('click', async () => {
      try {
        setBtnLoading(reactivateBtn, true, 'Se procesează…');
        const data = await apiPost('/api/sites/' + encodeURIComponent(site.id) + '/checkout', {});
        if (data.paymentUrl) window.location.href = data.paymentUrl;
      } catch (e) {
        showToast(safeServerMessage(e, RO.ACTION_GENERIC_FAILED), 'error');
      } finally {
        setBtnLoading(reactivateBtn, false);
      }
    });
    actions.appendChild(reactivateBtn);
  } else if (site.paid && (site.status === 'live' || site.status === 'active')) {
    // Cancel → Stripe Customer Portal (or offline HIDOOK_TEST_PAY portal contract).
    // U-01: opens the product's own modal instead of window.confirm() —
    // see openCancelSubscriptionModal()/confirmCancelSubscription() below.
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-ghost btn-sm';
    cancelBtn.textContent = 'Anulează';
    cancelBtn.setAttribute('aria-label', 'Anulează abonamentul pentru ' + (site.projectName || site.slug || 'acest site'));
    cancelBtn.addEventListener('click', () => openCancelSubscriptionModal(site, cancelBtn));
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
          showToast(RO.BILLING_PORTAL_UNAVAILABLE, 'error');
        }
      } catch (e) {
        showToast(safeServerMessage(e, RO.ACTION_GENERIC_FAILED), 'error');
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

  // Contact-form inbox (S-2C, PLAN-UX §5.2 supporting piece): only a live,
  // paid site has ever had its form's data-site-messages-api filled in (see
  // bot/webpublish.js), so only such a site can have received any messages.
  // Unread count is fetched async so it never blocks the card itself.
  if (site.paid && (site.status === 'live' || site.status === 'active')) {
    const messagesBtn = document.createElement('button');
    messagesBtn.className = 'btn-ghost btn-sm';
    messagesBtn.textContent = 'Mesaje';
    messagesBtn.setAttribute('data-site-messages-btn', site.id);
    messagesBtn.setAttribute('aria-label', 'Mesaje primite pe ' + (site.projectName || site.slug || 'acest site'));
    messagesBtn.addEventListener('click', () => openSiteMessagesModal(site.id, messagesBtn));
    actions.appendChild(messagesBtn);
    apiGet('/api/sites/' + encodeURIComponent(site.id) + '/messages')
      .then((data) => { if (data && data.unread) messagesBtn.textContent = `Mesaje (${data.unread})`; })
      .catch(() => { /* unread badge is a bonus — never block the card on it */ });
  }

  // Native Hidook booking dashboard (CAL-01). Only a site published with
  // appointment.nativeBooking on has a calendar; block sites never do.
  if (site.templateId !== 'blocks' && site.paid && (site.status === 'live' || site.status === 'active')) {
    apiGet('/api/sites/' + encodeURIComponent(site.id))
      .then((data) => {
        const cfg = data && data.config;
        if (!isNativeBookingOn(cfg && cfg.appointment && cfg.appointment.nativeBooking)) return;
        const bookBtn = document.createElement('a');
        bookBtn.className = 'btn-ghost btn-sm';
        bookBtn.textContent = 'Programări';
        bookBtn.target = '_blank';
        bookBtn.rel = 'noopener noreferrer';
        bookBtn.setAttribute('aria-label', 'Deschide programările pentru ' + (site.projectName || site.slug || 'acest site'));
        const qs = new URLSearchParams({ customerId: site.userId, siteId: site.id, brand: site.projectName || site.slug || '' });
        bookBtn.href = '/calendar-native/owner/?' + qs.toString();
        bookBtn.addEventListener('click', e => e.stopPropagation());
        actions.insertBefore(bookBtn, actions.lastElementChild);
      })
      .catch(() => { /* dashboard link is a bonus — never block the sites list on it */ });
  }

  // Static ZIP for self-hosting (VISION §6). The server applies the same
  // entitlement as live publish, so only a live paid site offers it.
  if (site.paid && (site.status === 'live' || site.status === 'active')) {
    const zipBtn = document.createElement('button');
    zipBtn.className = 'btn-ghost btn-sm';
    zipBtn.textContent = 'Descarcă ZIP';
    zipBtn.setAttribute('aria-label', 'Descarcă site-ul ' + (site.projectName || site.slug || '') + ' ca arhivă ZIP');
    zipBtn.addEventListener('click', () => downloadSiteZip(site.id, zipBtn));
    actions.appendChild(zipBtn);
  }

  // Delete (permanent — not cancel/unpublish): always reachable regardless
  // of paid/status, since an abandoned draft that was never paid needs
  // cleanup just as much as a cancelled one. Server enforces the real
  // refusal rules (active subscription / future bookings); this button only
  // opens the confirm-by-typing-the-name modal.
  // U-01: distinct danger style — every other card action used the same
  // btn-ghost as this one, so the one irreversible action on the card
  // looked exactly as safe as "Editează" or "Istoric".
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-danger btn-sm';
  deleteBtn.textContent = 'Șterge';
  deleteBtn.setAttribute('aria-label', 'Șterge definitiv site-ul ' + (site.projectName || site.slug || ''));
  deleteBtn.addEventListener('click', () => openDeleteSiteModal(site));
  actions.appendChild(deleteBtn);

  card.appendChild(thumbWrap);
  card.appendChild(info);
  card.appendChild(actions);

  return card;
}

// ---------------------------------------------------------------------------
// 22c2. Cancel subscription (own modal, not window.confirm — U-01)
// ---------------------------------------------------------------------------

/** Same "is this site actively billed" test the card already used to decide
 * whether to show its "Anulează" button at all — reused here so the
 * delete-site modal's gate can never disagree with what the card shows. */
function siteHasActiveSubscription(site) {
  return !!(site && site.paid && (site.status === 'live' || site.status === 'active'));
}

let cancelSubscriptionModalSite = null;

/**
 * U-01 (PLAN-UX-2026-09-27 §3): replaces window.confirm() with the
 * product's own modal, explaining what the bare native dialog did not —
 * access stops immediately, no partial refund, reactivate anytime.
 */
function openCancelSubscriptionModal(site, opener) {
  cancelSubscriptionModalSite = site;
  const nameEl = $('cancel-subscription-name');
  if (nameEl) nameEl.textContent = site.projectName || site.slug || 'acest site';
  const errEl = $('cancel-subscription-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  openModal('modal-cancel-subscription', opener);
}

async function confirmCancelSubscription() {
  const site = cancelSubscriptionModalSite;
  if (!site) return;
  const confirmBtn = $('btn-confirm-cancel-subscription');
  const errEl = $('cancel-subscription-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  try {
    if (confirmBtn) setBtnLoading(confirmBtn, true, 'Se deschide…');
    const data = await apiPost('/api/sites/' + encodeURIComponent(site.id) + '/billing-portal', {});
    const portalUrl = data.portalUrl || data.url;
    if (portalUrl) {
      // Real Stripe portal URLs are a full off-app navigation, which tears
      // the whole page (and this modal) down on its own. The offline
      // HIDOOK_TEST_PAY portal is a same-app hash (#test-billing-portal),
      // which does NOT reload — close this modal explicitly first, or it
      // stays visibly open (and still intercepting clicks) behind whatever
      // the hash change routes to next.
      closeModal('modal-cancel-subscription');
      window.location.href = portalUrl;
    } else if (errEl) {
      errEl.textContent = RO.BILLING_PORTAL_UNAVAILABLE;
      errEl.style.display = '';
    }
  } catch (e) {
    if (errEl) {
      errEl.textContent = safeServerMessage(e, RO.CANCEL_MODAL_UNAVAILABLE);
      errEl.style.display = '';
    }
  } finally {
    if (confirmBtn) setBtnLoading(confirmBtn, false);
  }
}

// ---------------------------------------------------------------------------
// 22d. Delete site (permanent — not cancel/unpublish)
// ---------------------------------------------------------------------------

let deleteSiteModalSite = null;

/**
 * U-01 (PLAN-UX-2026-09-27 §3): the "Anulează abonamentul" alternative now
 * shows BEFORE the typed-confirmation field (not after it), and "Șterge
 * definitiv" is disabled — with the reason visible, not just a disabled
 * button — for as long as the site's subscription is active. The server
 * (handleDeleteSite) already refuses this case with a 409; this only stops
 * an owner from typing the exact name and hitting a button that was always
 * going to be refused, without first telling them why or offering the one
 * action that unblocks it.
 */
function openDeleteSiteModal(site) {
  deleteSiteModalSite = site;
  const nameLabel = site.projectName || site.slug || site.id || '';
  const nameEl = $('delete-site-name');
  if (nameEl) nameEl.textContent = nameLabel;
  const input = $('input-delete-confirm');
  if (input) input.value = '';
  const errEl = $('delete-site-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  const hasActiveSub = siteHasActiveSubscription(site);
  const noticeEl = $('delete-site-subscription-notice');
  if (noticeEl) noticeEl.style.display = hasActiveSub ? '' : 'none';
  const confirmBtn = $('btn-confirm-delete-site');
  if (confirmBtn) confirmBtn.disabled = true;
  openModal('modal-delete-site');
  if (input) input.focus();
}

function expectedDeleteSiteName() {
  if (!deleteSiteModalSite) return '';
  return String(deleteSiteModalSite.projectName || deleteSiteModalSite.slug || '').trim();
}

/**
 * A permanent delete also retires the block editor's local draft of that
 * same site, so reopening the editor never resurrects the deleted site as a
 * new unpaid one. An unrelated local draft is left untouched.
 */
function retireLocalDraftForDeletedSite(siteId) {
  if (!siteId) return;
  try {
    const saved = lsGet(BLOCKS_DRAFT_KEY);
    if (saved && saved.siteId === siteId) localStorage.removeItem(BLOCKS_DRAFT_KEY);
  } catch (_) { /* ignore */ }
}

async function confirmDeleteSite() {
  const site = deleteSiteModalSite;
  if (!site) return;
  const confirmBtn = $('btn-confirm-delete-site');
  const errEl = $('delete-site-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  try {
    if (confirmBtn) setBtnLoading(confirmBtn, true, 'Se șterge…');
    const input = $('input-delete-confirm');
    const confirmName = input ? input.value : '';
    await apiDelete('/api/sites/' + encodeURIComponent(site.id), { confirmName });
    retireLocalDraftForDeletedSite(site.id);
    closeModal('modal-delete-site');
    deleteSiteModalSite = null;
    showToast(t('SITE_DELETED_NAMED', { name: site.projectName || site.slug || '' }));
    loadDashboard();
  } catch (e) {
    if (errEl) {
      errEl.textContent = safeServerMessage(e, RO.DELETE_FAILED);
      errEl.style.display = '';
    }
  } finally {
    if (confirmBtn) setBtnLoading(confirmBtn, false);
  }
}

// ---------------------------------------------------------------------------
// 22e. R-27 — GDPR self-service: "Descarcă datele mele" / "Șterge contul"
// (auth-account#3). Same download-as-file pattern as downloadDraftHtml()/
// downloadDraftZip() above, and the same typed-confirmation modal pattern as
// confirmDeleteSite() above (email instead of site name).
// ---------------------------------------------------------------------------

/**
 * GET /api/me/export-data → triggers a browser download of the account's
 * own data (profile, every site's config history, orders/invoices,
 * native-calendar services/bookings). Not a fetch the app ever renders —
 * same blob + a[download] pattern as downloadDraftHtml()/downloadDraftZip().
 */
async function downloadMyData() {
  if (!currentUser) {
    showToast(RO.ACCOUNT_SIGNIN_DOWNLOAD_DATA, 'error', 5000);
    return;
  }
  try {
    const res = await fetch('/api/me/export-data', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const msg = res.status === 401
        ? RO.ACCOUNT_SIGNIN_DOWNLOAD_DATA
        : res.status === 429
          ? RO.DATA_DOWNLOAD_RATE_LIMITED
          : RO.DATA_DOWNLOAD_FAILED;
      showToast(msg, 'error', 5000);
      return;
    }
    const blob = await res.blob();
    let filename = 'datele-mele.json';
    const cd = res.headers.get('Content-Disposition') || res.headers.get('content-disposition') || '';
    const mStar = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const mPlain = /filename="?([^";]+)"?/i.exec(cd);
    if (mStar && mStar[1]) {
      try { filename = decodeURIComponent(mStar[1].trim()); } catch (_) { filename = mStar[1].trim(); }
    } else if (mPlain && mPlain[1]) {
      filename = mPlain[1].trim();
    }
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
    showToast(RO.DATA_DOWNLOADED, 'success', 2500);
  } catch (_) {
    showToast(RO.DATA_DOWNLOAD_FAILED, 'error', 5000);
  }
}

function expectedDeleteAccountEmail() {
  return String((currentUser && currentUser.email) || '').trim().toLowerCase();
}

/**
 * Product modal (NOT window.confirm) — types the account's own email to confirm.
 *
 * `opener`: the element focus should return to once this modal closes. Its
 * real trigger is a menu item inside the account dropdown, and both call
 * sites close that dropdown (hiding the item) before calling this function —
 * so document.activeElement is already gone (off to document.body) by the
 * time openModal() would otherwise read it. Callers pass the dropdown's own
 * toggle button instead, since that stays visible after the menu closes and
 * is the same element the user would use to reopen this flow.
 */
function openDeleteAccountModal(opener) {
  if (!currentUser) {
    showToast(RO.ACCOUNT_SIGNIN_DELETE, 'error', 4000);
    return;
  }
  if (!currentUser.email) {
    showToast(RO.ACCOUNT_DELETE_NEEDS_EMAIL, 'error', 5000);
    return;
  }
  const emailEl = $('delete-account-email');
  if (emailEl) emailEl.textContent = currentUser.email;
  const input = $('input-delete-account-confirm');
  if (input) input.value = '';
  const errEl = $('delete-account-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  const confirmBtn = $('btn-confirm-delete-account');
  if (confirmBtn) confirmBtn.disabled = true;
  openModal('modal-delete-account', opener);
  if (input) input.focus();
}

/**
 * POST /api/me/delete-account. On success, the account no longer exists:
 * clears this tab's own locally-owned draft state (same helper doLogout()
 * uses), flips the UI to signed-out, and returns to #templates — there is
 * no account left to route back to.
 */
async function confirmDeleteAccount() {
  const confirmBtn = $('btn-confirm-delete-account');
  const errEl = $('delete-account-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  try {
    if (confirmBtn) setBtnLoading(confirmBtn, true, 'Se șterge…');
    const input = $('input-delete-account-confirm');
    const confirmEmail = input ? input.value : '';
    await apiPost('/api/me/delete-account', { confirmEmail });
    await clearOwnedLocalDraftState();
    closeModal('modal-delete-account');
    updateUserUI(null);
    if (typeof broadcastAuthSignedOut === 'function') broadcastAuthSignedOut();
    showToast(RO.ACCOUNT_DELETED, '', 4000);
    window.location.hash = '#templates';
  } catch (e) {
    if (errEl) {
      // R-27: SUBSCRIPTION_CANCEL_FAILED is a 502 the server sends on purpose,
      // with an exact Romanian message ("Stripe could not confirm the
      // cancellation, nothing was deleted") — customer-safe by name, unlike
      // any other 5xx. See safeServerMessage()'s doc comment.
      errEl.textContent = safeServerMessage(e, RO.DELETE_FAILED, ['SUBSCRIPTION_CANCEL_FAILED']);
      errEl.style.display = '';
    }
  } finally {
    if (confirmBtn) setBtnLoading(confirmBtn, false);
  }
}

async function loadVersions(siteId) {
  const list = $('versions-list');
  if (list) list.innerHTML = loadingStateHTML('Se încarcă…');
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
      // W-7: Romanian date via the shared formatter + 24h time, so rows
      // published the same day still differ.
      let timeStr = '';
      try { timeStr = d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }); } catch (_) { /* date only */ }
      const dateStr = [formatHostingUntilDate(v.publishedAt), timeStr].filter(Boolean).join(', ') || String(v.publishedAt || '');
      const verNum = versionsSorted.length - idx;
      const label = 'Versiunea ' + verNum;
      // U-01 (PLAN-UX-2026-09-27 §3): rows used to say only "Versiunea N" —
      // no way to tell which one had what content before restoring it.
      // `description` (business name + start of tagline at that point in
      // time) comes from GET .../versions when the server has it; an older
      // version pushed before that field existed simply has none.
      const description = String((v && v.description) || '').trim();
      item.innerHTML = `
        <div class="version-item-row">
          <span class="version-date">${escHtml(dateStr)}</span>
          <span class="version-label">${escHtml(label)}</span>
          ${v.live ? '<span class="version-live-badge">Live</span>' : ''}
          <button class="btn-ghost btn-sm btn-rollback" data-siteid="${escHtml(siteId)}" data-verid="${escHtml(v.versionId)}">Restabilește</button>
        </div>
        ${description ? `<div class="version-item-desc">${escHtml(description)}</div>` : ''}`;
      item.querySelector('.btn-rollback').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        setBtnLoading(btn, true, 'Se restabilește…');
        try {
          await apiPost('/api/sites/' + encodeURIComponent(siteId) + '/rollback', { versionId: v.versionId });
          showToast(RO.VERSION_RESTORED, 'success');
          closeModal('modal-versions');
        } catch (err) {
          showToast(safeServerMessage(err, RO.VERSION_RESTORE_FAILED), 'error');
          setBtnLoading(btn, false);
        }
      });
      list.appendChild(item);
    });
  } catch (e) {
    if (list) list.innerHTML = '<p style="color:var(--error);font-size:.85rem">' + escHtml(safeServerMessage(e, RO.VERSIONS_LOAD_FAILED)) + '</p>';
  }
}

// ---------------------------------------------------------------------------
// 22b. Custom domain (Wave 8 — self-serve BYO domain, audit #47 reachability)
// ---------------------------------------------------------------------------
//
// bot/domains.js implements the whole state machine and bot/server.js mounts
// five auth-gated routes for it (GET/POST/DELETE /api/sites/:id/domain, POST
// .../domain/verify, POST .../domain/status). None of it was reachable from
// any UI. This panel lives in the "Site-urile mele" site card — the same
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

/** Same three plain-language DNS states as PRODUCT.md's own description of
 *  this flow ("not visible yet / visible but wrong / verified"), one line
 *  short enough to read at a glance next to the longer domainMessageForStatus
 *  explanation. Purely presentational — derived from the same `status` the
 *  badge and message already use, never a separate source of truth. */
function domainShortStatusLabel(status) {
  switch (status) {
    case 'awaiting_dns': return 'DNS: nu se vede încă';
    case 'dns_partial': return 'DNS: se vede, dar greșit';
    case 'dns_verified':
    case 'provisioning': return 'DNS: verificat — se activează certificatul';
    case 'active': return 'DNS: verificat și activ';
    case 'error': return 'A apărut o eroare';
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Numbered-step UI (PLAN-UX-2026-09-27 §4 "Modal Domeniu propriu cu pași
// expliciți"): a 4-step stepper laid purely on top of the existing DNS/TLS
// state machine — it reads the same `status` the badge/message already read,
// so it can never drift out of sync with what actually happened.
// ---------------------------------------------------------------------------
const DOMAIN_STEP_LABELS = ['Domeniul', 'Înregistrări DNS', 'Verificare', 'Gata'];

function domainStepForStatus(status) {
  if (status === 'active') return 4;
  if (status === 'dns_verified' || status === 'provisioning') return 3;
  if (status === 'awaiting_dns' || status === 'dns_partial' || status === 'error') return 2;
  return 1; // no record yet, or disconnected
}

function domainStepsHtml(current) {
  const items = DOMAIN_STEP_LABELS.map((label, i) => {
    const n = i + 1;
    const cls = n < current ? 'is-done' : (n === current ? 'is-current' : 'is-upcoming');
    return `
      <div class="domain-step ${cls}">
        <span class="domain-step-num" aria-hidden="true">${n < current ? '✓' : n}</span>
        <span class="domain-step-label">${escHtml(label)}</span>
      </div>`;
  }).join('<span class="domain-step-sep" aria-hidden="true"></span>');
  return `<div class="domain-steps" role="list" aria-label="Pașii conectării domeniului">${items}</div>`;
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
        showToast(RO.COPY_FAILED, 'error');
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
      if (errEl) { errEl.textContent = RO.DOMAIN_INPUT_REQUIRED; show(errEl); }
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
      if (errEl) { errEl.textContent = safeServerMessage(err, RO.DOMAIN_CONNECT_FAILED); show(errEl); }
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
    body.innerHTML = domainStepsHtml(1) + domainConnectFormHtml(!!record);
    wireDomainConnectForm();
    return;
  }

  const status = record.status;
  const badge = domainStatusBadge(status);
  const message = (lastPoll && lastPoll.message) || domainMessageForStatus(status);
  const messageCls = status === 'error' ? 'domain-message--error' : (status === 'active' ? 'domain-message--active' : '');

  let html = domainStepsHtml(domainStepForStatus(status));
  html += `
    <div class="domain-status-row">
      <span class="status-badge ${badge.cls}">${escHtml(badge.label)}</span>
      <span class="domain-current-host">${escHtml(record.domain)}</span>
    </div>`;

  if (status === 'active') {
    const liveHref = 'https://' + record.targetHost;
    html += `<h3 class="domain-step-card-title">Pasul 4 · Gata — domeniul e conectat</h3>`;
    html += `<p class="domain-message ${messageCls}">${escHtml(message)}</p>`;
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
    // the raw record) so the owner can always see/copy what to paste, laid
    // out as two explicit, numbered cards (DNS records, then live status) so
    // "what do I do right now" never depends on scrolling past a wall of text.
    const cached = readCachedDomainInstructions(domainModalSiteId, record.domain);
    const built = cached || buildDnsRecordsFromRecord(record);
    if (status !== 'provisioning' && status !== 'dns_verified') {
      html += `<div class="domain-step-card">
        <h3 class="domain-step-card-title">Pasul 2 · Adaugă aceste înregistrări DNS</h3>`;
      html += domainRecordsTableHtml(built.records);
      if (built.note) html += `<div class="domain-apex-note">${escHtml(built.note)}</div>`;
      html += `</div>`;
    }
    const verifyLabel = (status === 'dns_verified' || status === 'provisioning') ? 'Verifică certificatul' : 'Verifică';
    const shortStatus = domainShortStatusLabel(status);
    html += `
      <div class="domain-step-card domain-step-card--status">
        <h3 class="domain-step-card-title">Pasul 3 · Verifică starea conexiunii</h3>
        ${shortStatus ? `<p class="domain-status-short">${escHtml(shortStatus)}</p>` : ''}
        <p class="domain-message ${messageCls}">${escHtml(message)}</p>
        <div class="domain-actions">
          <button type="button" class="btn-primary btn-sm" id="btn-domain-verify">${escHtml(verifyLabel)}</button>
          <button type="button" class="btn-ghost btn-sm" id="btn-domain-disconnect">Deconectează</button>
          <button type="button" class="domain-switch-link" id="btn-domain-switch" style="margin:0">Folosește alt domeniu</button>
        </div>
        ${record.lastCheck && record.lastCheck.checkedAt ? `<p class="domain-last-check">Ultima verificare: ${escHtml(formatHostingUntilDate(record.lastCheck.checkedAt) || record.lastCheck.checkedAt)}</p>` : ''}
      </div>`;
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
        const msg = safeServerMessage(err, RO.DOMAIN_VERIFY_FAILED);
        if (err && err.code === 'RATE_LIMITED') {
          showToast(msg, 'error', 6000);
        } else {
          showToast(msg, 'error');
          await refreshDomainModal();
        }
      } finally {
        setBtnLoading(verifyBtn, false);
      }
    });
  }

  const disconnectBtn = $('btn-domain-disconnect');
  if (disconnectBtn) {
    // U-01: the product's own modal instead of window.confirm() — same
    // open/close contract (Esc, backdrop, 44px X, focus trap/return) as
    // every other modal. See openDomainDisconnectModal()/confirmDomainDisconnect().
    disconnectBtn.addEventListener('click', () => {
      openDomainDisconnectModal(record.domain, disconnectBtn);
    });
  }

  const switchBtn = $('btn-domain-switch');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      // U-01: explicit confirm (now the product's own modal, not
      // window.confirm()) before wiping the current domain's progress — the
      // eventual submit has the same immediate real-world effect as
      // "Deconectează" (detaches the live Cloudflare hostname on an
      // active/provisioning domain).
      const attached = status === 'active' || status === 'provisioning' || status === 'dns_verified';
      openDomainSwitchModal(attached, record.domain, switchBtn);
    });
  }
}

// ---------------------------------------------------------------------------
// 22b2. Disconnect / switch custom domain (own modals, not window.confirm — U-01)
// ---------------------------------------------------------------------------

function openDomainDisconnectModal(domain, opener) {
  const nameEl = $('domain-disconnect-name');
  if (nameEl) nameEl.textContent = domain;
  openModal('modal-domain-disconnect', opener);
}

async function confirmDomainDisconnect() {
  const confirmBtn = $('btn-confirm-domain-disconnect');
  try {
    if (confirmBtn) setBtnLoading(confirmBtn, true, 'Se deconectează…');
    await apiDelete('/api/sites/' + encodeURIComponent(domainModalSiteId) + '/domain');
    try { localStorage.removeItem(domainInstructionsCacheKey(domainModalSiteId)); } catch (_) {}
    closeModal('modal-domain-disconnect');
    showToast(RO.DOMAIN_DISCONNECTED, 'success');
    await refreshDomainModal();
  } catch (err) {
    closeModal('modal-domain-disconnect');
    showToast(safeServerMessage(err, RO.DOMAIN_DISCONNECT_FAILED), 'error');
  } finally {
    if (confirmBtn) setBtnLoading(confirmBtn, false);
  }
}

function openDomainSwitchModal(attached, domain, opener) {
  const msgEl = $('domain-switch-message');
  if (msgEl) {
    msgEl.textContent = attached
      ? 'Sigur vrei să folosești alt domeniu? Domeniul „' + domain + '" va fi deconectat imediat, iar ' +
        'site-ul tău rămâne disponibil pe subdomeniul Hidook cât timp conectezi și verifici noul domeniu.'
      : 'Sigur vrei să introduci alt domeniu? Progresul pentru „' + domain + '" (înregistrările DNS ' +
        'deja pregătite) se pierde. Site-ul tău rămâne disponibil pe subdomeniul Hidook.';
  }
  openModal('modal-domain-switch', opener);
}

function confirmDomainSwitch() {
  closeModal('modal-domain-switch');
  const body = $('domain-modal-body');
  if (!body) return;
  body.innerHTML = domainStepsHtml(1) + domainConnectFormHtml(true);
  wireDomainConnectForm();
}

async function refreshDomainModal(lastPoll) {
  const body = $('domain-modal-body');
  if (!body || !domainModalSiteId) return;
  try {
    const data = await apiGet('/api/sites/' + encodeURIComponent(domainModalSiteId) + '/domain');
    renderDomainModal(data.record, lastPoll);
  } catch (e) {
    body.innerHTML = '<p style="color:var(--error);font-size:.85rem">' + escHtml(safeServerMessage(e, RO.DOMAIN_LOAD_FAILED)) + '</p>';
  }
}

async function openDomainModal(site) {
  domainModalSiteId = site.id;
  domainModalProjectName = site.projectName;
  domainModalCurrentOrigin = site.url || null;
  const body = $('domain-modal-body');
  if (body) body.innerHTML = loadingStateHTML('Se încarcă…');
  openModal('modal-domain');
  await refreshDomainModal();
}

// ---------------------------------------------------------------------------
// 22c. Invoices / billing history (Wave 8 reachability; Wave 12 trial truth)
// ---------------------------------------------------------------------------
//
// GET /api/sites/:id/invoices returns the ledger-backed history (newest
// first already); each entry carries kind ('publish' | 'renewal'),
// amountCents, currency, ts and — for a real Stripe renewal invoice —
// hostedInvoiceUrl/invoicePdf. Same "findable" placement as the domain
// panel: the "Site-urile mele" site card.
//
// Wave 12 — bot/webpublish.js#getInvoiceHistory now attaches a `status` to
// every row: 'paid' (real money moved), 'trial_started' (the 14-day card
// trial just began — $0 charged, the real charge is a separate later row
// once Stripe actually collects it on day 14) or 'failed' (a declined
// attempt). A trial-start row must never render like a paid invoice — that
// was the audited bug (a customer reading "99€" next to today's date, a
// week before any money moved).

function invoiceKindLabel(kind) {
  if (kind === 'renewal') return 'Reînnoire hosting';
  if (kind === 'publish') return 'Publicare (primul an)';
  return kind || 'Plată';
}

/** Human status line for one invoice row — never claims money moved when it hasn't. */
function invoiceStatusLabel(inv) {
  if (inv.status === 'trial_started') {
    const chargeDate = formatInvoiceDate(inv.scheduledChargeAt);
    return chargeDate
      ? 'Trial pornit · taxare programată pe ' + chargeDate
      : 'Trial pornit · nicio taxare încă';
  }
  if (inv.status === 'failed') {
    return inv.attemptCount
      ? 'Card refuzat (încercarea ' + inv.attemptCount + ')'
      : 'Card refuzat';
  }
  return 'Achitat';
}

// gap-pricing-display-consistency-live#2: Facturi used to be a fifth,
// independent price format ("99,00 EUR") that matched nothing else in the
// product — now the same formatMoneyLabel() as every other price surface.
function formatInvoiceAmount(amountCents, currency) {
  if (amountCents == null) return '—';
  return formatMoneyLabel(amountCents / 100, currency);
}

// copy-i18n#4: Facturi used to show an abbreviated month ("27 sept. 2026")
// while the site card showed the full month for the same kind of date
// ("11 octombrie 2026") — one Romanian date formatter for both now.
function formatInvoiceDate(iso) {
  return formatHostingUntilDate(iso);
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
    // A failed attempt never charged anything — never print a fabricated
    // amount next to "Card refuzat". A trial-start row DOES show the
    // scheduled amount (that is the point — "99€ pe <date>", not paid yet),
    // just visually de-emphasized and labelled via invoiceStatusLabel below.
    const amountText = inv.status === 'failed'
      ? '—'
      : formatInvoiceAmount(inv.amountCents, inv.currency);
    const amountClass = 'invoice-amount' + (inv.status === 'paid' ? '' : ' invoice-amount--pending');
    return `
      <div class="invoice-item invoice-item--${escHtmlForAttr(inv.status || 'paid')}">
        <div class="invoice-item-main">
          <span class="invoice-date">${escHtml(formatInvoiceDate(inv.ts))}</span>
          <span class="invoice-kind">${escHtml(invoiceKindLabel(inv.kind))}</span>
          <span class="invoice-status">${escHtml(invoiceStatusLabel(inv))}</span>
        </div>
        <span class="${amountClass}">${escHtml(amountText)}</span>
        ${links ? `<div class="invoice-links">${links}</div>` : ''}
      </div>`;
  }).join('');
}

async function openInvoicesModal(siteId) {
  const list = $('invoices-list');
  if (list) list.innerHTML = loadingStateHTML('Se încarcă…');
  openModal('modal-invoices');
  try {
    const data = await apiGet('/api/sites/' + encodeURIComponent(siteId) + '/invoices');
    renderInvoicesList(data.invoices || []);
  } catch (e) {
    if (list) list.innerHTML = '<p style="color:var(--error);font-size:.85rem">' + escHtml(safeServerMessage(e, RO.INVOICES_LOAD_FAILED)) + '</p>';
  }
}

// ---------------------------------------------------------------------------
// Site contact-form messages (S-2C, PLAN-UX §5.2 supporting piece)
// ---------------------------------------------------------------------------

function renderSiteMessagesList(siteId, messages) {
  const list = $('site-messages-list');
  if (!list) return;
  if (!messages || messages.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1.5rem">Niciun mesaj primit încă pe acest site.</p>';
    return;
  }
  list.innerHTML = messages.map((m) => `
    <div class="site-message-item${m.readAt ? '' : ' site-message-item--unread'}">
      <div class="site-message-meta">
        <span class="site-message-date">${escHtml(formatHostingUntilDate(m.createdAt))}</span>
        ${m.readAt ? '' : '<span class="site-message-badge">Necitit</span>'}
      </div>
      <div class="site-message-from"><strong>${escHtml(m.name)}</strong> — ${escHtml(m.contact)}</div>
      <p class="site-message-text">${escHtml(m.message)}</p>
      <div class="site-message-actions">
        ${m.readAt ? '' : `<button type="button" class="btn-ghost btn-sm" data-action="read" data-mid="${escHtmlForAttr(m.id)}">Marchează citit</button>`}
        <button type="button" class="btn-ghost btn-sm" data-action="delete" data-mid="${escHtmlForAttr(m.id)}">Șterge</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-action="read"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mid = btn.getAttribute('data-mid');
      setBtnLoading(btn, true, 'Se salvează…');
      try {
        await apiPost('/api/sites/' + encodeURIComponent(siteId) + '/messages/' + encodeURIComponent(mid) + '/read', {});
        await reloadSiteMessagesModal(siteId);
      } catch (e) {
        setBtnLoading(btn, false);
        showToast(safeServerMessage(e, RO.MESSAGE_MARK_READ_FAILED), 'error');
      }
    });
  });
  list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mid = btn.getAttribute('data-mid');
      setBtnLoading(btn, true, 'Se șterge…');
      try {
        await apiDelete('/api/sites/' + encodeURIComponent(siteId) + '/messages/' + encodeURIComponent(mid));
        await reloadSiteMessagesModal(siteId);
      } catch (e) {
        setBtnLoading(btn, false);
        showToast(safeServerMessage(e, RO.MESSAGE_DELETE_FAILED), 'error');
      }
    });
  });
}

/** Re-fetch + re-render without touching modal open/focus state (used after
 *  mark-read/delete, while the modal is already open). */
async function reloadSiteMessagesModal(siteId) {
  try {
    const data = await apiGet('/api/sites/' + encodeURIComponent(siteId) + '/messages');
    renderSiteMessagesList(siteId, data.messages || []);
    refreshSiteMessagesBadge(siteId, data.unread || 0);
  } catch (e) {
    showToast(safeServerMessage(e, RO.MESSAGES_RELOAD_FAILED), 'error');
  }
}

/** Keep the dashboard card's "Mesaje (N)" button in sync after a read/delete. */
function refreshSiteMessagesBadge(siteId, unread) {
  const btn = document.querySelector('button[data-site-messages-btn="' + siteId + '"]');
  if (btn) btn.textContent = unread ? `Mesaje (${unread})` : 'Mesaje';
}

async function openSiteMessagesModal(siteId, opener) {
  const list = $('site-messages-list');
  if (list) list.innerHTML = loadingStateHTML('Se încarcă…');
  openModal('modal-site-messages', opener);
  try {
    const data = await apiGet('/api/sites/' + encodeURIComponent(siteId) + '/messages');
    renderSiteMessagesList(siteId, data.messages || []);
    refreshSiteMessagesBadge(siteId, data.unread || 0);
  } catch (e) {
    if (list) list.innerHTML = '<p style="color:var(--error);font-size:.85rem">' + escHtml(safeServerMessage(e, RO.MESSAGES_LOAD_FAILED)) + '</p>';
  }
}

// ---------------------------------------------------------------------------
// 23. Router
// ---------------------------------------------------------------------------

const screens = ['templates', 'dashboard'];

function showScreen(name) {
  screens.forEach(s => {
    const el = $('screen-' + s);
    if (el) el.style.display = s === name ? '' : 'none';
  });
  document.querySelectorAll('[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === name);
  });
  if (accountMenuOpen) closeAccountMenu();
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
  // Also honour #sites return_url from billing-portal so stranger lands in Site-urile mele / Ciornă.
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
      showToast(RO.SUBSCRIPTION_CANCELLED, 'success', 5000);
    } else {
      const list = $('sites-list');
      if (list) {
        list.innerHTML = stateBlockHTML({
          icon: 'lock',
          title: RO.DASHBOARD_AUTH_REQUIRED_TITLE,
          desc: RO.DASHBOARD_AUTH_REQUIRED_DESC,
          actionHtml: '<button type="button" class="btn-primary" id="btn-dashboard-auth">Autentificare</button>',
        });
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
    // The retired form editor's route: sites are edited from Site-urile mele.
    window.location.hash = '#dashboard';
  } else if (route === 'dashboard') {
    const user = await fetchCurrentUser().catch(() => null);
    const blocksBack = user && blocksResumeUrl('auth');
    if (blocksBack) { window.location.href = blocksBack; return; }
    showScreen('dashboard');
    updateUserUI(user);
    if (user) loadDashboard();
    else {
      const list = $('sites-list');
      if (list) {
        list.innerHTML = stateBlockHTML({
          icon: 'lock',
          title: RO.DASHBOARD_AUTH_REQUIRED_TITLE,
          desc: RO.DASHBOARD_AUTH_REQUIRED_DESC,
          actionHtml: '<button type="button" class="btn-primary" id="btn-dashboard-auth">Autentificare</button>',
        });
        wireDashboardAuthButton();
      }
    }
  } else if (route === 'paid') {
    blocksResumeUrl('checkout');
    showToast(RO.PAYMENT_PROCESSED_SITE_SOON, 'success', 6000);
    window.location.hash = '#dashboard';
  } else if (route === 'reactivated') {
    showToast(RO.REACTIVATED_SOON, 'success', 6000);
    window.location.hash = '#dashboard';
  } else if (route === 'cancelled') {
    showToast(RO.PAYMENT_CANCELLED, '', 4000);
    const blocksBack = blocksResumeUrl('checkout');
    if (blocksBack) { window.location.href = blocksBack; return; }
    window.location.hash = '#dashboard';
  } else if (route === 'login-expired') {
    showToast(RO.LOGIN_LINK_EXPIRED, 'error', 5000);
    window.location.hash = '#templates';
  } else {
    showScreen('templates');
    renderTemplatesGrid();
  }
}

// ---------------------------------------------------------------------------
// 24. Static button wiring
// ---------------------------------------------------------------------------

/** Success modal «Înapoi la editor»: reopen the paid site in the block editor. */
function returnToEditor() {
  closeModal('modal-success');
  window.location.href = successSiteId
    ? '/app/blocks/?site=' + encodeURIComponent(successSiteId)
    : '#dashboard';
}

function wireStaticButtons() {
  // Catalog filter chips (landing)
  const chips = $('catalog-chips');
  if (chips) {
    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('.catalog-chip');
      if (!btn) return;
      applyCatalogFilter(btn.dataset.filter || 'all');
    });
  }

  // Copy URL button (success modal)
  const copyBtn = $('btn-copy-url');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const link = $('success-url-link');
      const url = link && link.getAttribute('href');
      if (!url || url === '#') return;
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.classList.add('copied');
        copyBtn.textContent = 'Copiat!';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2 10V2h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Copiază';
        }, 2000);
      } catch (_) {
        showToast(RO.COPY_ADDRESS_FAILED, 'error');
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
  wireModalClose('btn-close-success',  'modal-success');
  wireModalClose('btn-close-versions', 'modal-versions');
  wireModalClose('btn-close-domain',   'modal-domain');
  wireModalClose('btn-close-invoices', 'modal-invoices');
  wireModalClose('btn-close-site-messages', 'modal-site-messages');
  wireModalClose('btn-close-delete-site', 'modal-delete-site');
  wireModalClose('btn-close-delete-account', 'modal-delete-account');
  wireModalClose('btn-close-logout-everywhere', 'modal-logout-everywhere');
  wireModalClose('btn-close-cancel-subscription', 'modal-cancel-subscription');
  wireModalClose('btn-close-domain-disconnect', 'modal-domain-disconnect');
  wireModalClose('btn-close-domain-switch', 'modal-domain-switch');
  const domainDisconnectDismissBtn = $('btn-dismiss-domain-disconnect');
  if (domainDisconnectDismissBtn) domainDisconnectDismissBtn.addEventListener('click', () => closeModal('modal-domain-disconnect'));
  const domainDisconnectConfirmBtn = $('btn-confirm-domain-disconnect');
  if (domainDisconnectConfirmBtn) domainDisconnectConfirmBtn.addEventListener('click', confirmDomainDisconnect);
  const domainSwitchDismissBtn = $('btn-dismiss-domain-switch');
  if (domainSwitchDismissBtn) domainSwitchDismissBtn.addEventListener('click', () => closeModal('modal-domain-switch'));
  const domainSwitchConfirmBtn = $('btn-confirm-domain-switch');
  if (domainSwitchConfirmBtn) domainSwitchConfirmBtn.addEventListener('click', confirmDomainSwitch);
  const logoutEverywhereDismissBtn = $('btn-dismiss-logout-everywhere');
  if (logoutEverywhereDismissBtn) logoutEverywhereDismissBtn.addEventListener('click', () => closeModal('modal-logout-everywhere'));
  const logoutEverywhereConfirmBtn = $('btn-confirm-logout-everywhere');
  if (logoutEverywhereConfirmBtn) logoutEverywhereConfirmBtn.addEventListener('click', confirmLogoutEverywhere);
  const cancelSubscriptionDismissBtn = $('btn-dismiss-cancel-subscription');
  if (cancelSubscriptionDismissBtn) cancelSubscriptionDismissBtn.addEventListener('click', () => closeModal('modal-cancel-subscription'));
  const cancelSubscriptionConfirmBtn = $('btn-confirm-cancel-subscription');
  if (cancelSubscriptionConfirmBtn) cancelSubscriptionConfirmBtn.addEventListener('click', confirmCancelSubscription);
  const deleteSiteCancelAltBtn = $('btn-delete-site-cancel-alt');
  if (deleteSiteCancelAltBtn) deleteSiteCancelAltBtn.addEventListener('click', () => {
    const site = deleteSiteModalSite;
    closeModal('modal-delete-site');
    if (site) openCancelSubscriptionModal(site, deleteSiteCancelAltBtn);
  });

  // Delete-site confirm: the button stays disabled until the typed text
  // matches the site's own name exactly — the server re-checks this too.
  const deleteConfirmInput = $('input-delete-confirm');
  const deleteConfirmBtn = $('btn-confirm-delete-site');
  if (deleteConfirmInput && deleteConfirmBtn) {
    deleteConfirmInput.addEventListener('input', () => {
      // U-01: an exact name match is never enough on its own — the button
      // stays disabled the whole time a subscription is still active.
      const nameMatches = deleteConfirmInput.value.trim() === expectedDeleteSiteName();
      const blockedByActiveSub = siteHasActiveSubscription(deleteSiteModalSite);
      deleteConfirmBtn.disabled = !nameMatches || blockedByActiveSub;
    });
  }
  if (deleteConfirmBtn) {
    deleteConfirmBtn.addEventListener('click', confirmDeleteSite);
  }

  // R-27: delete-ACCOUNT confirm — same disabled-until-exact-match contract
  // as delete-site above, matched against the signed-in account's own email.
  const deleteAccountConfirmInput = $('input-delete-account-confirm');
  const deleteAccountConfirmBtn = $('btn-confirm-delete-account');
  if (deleteAccountConfirmInput && deleteAccountConfirmBtn) {
    deleteAccountConfirmInput.addEventListener('input', () => {
      deleteAccountConfirmBtn.disabled =
        deleteAccountConfirmInput.value.trim().toLowerCase() !== expectedDeleteAccountEmail();
    });
  }
  if (deleteAccountConfirmBtn) {
    deleteAccountConfirmBtn.addEventListener('click', confirmDeleteAccount);
  }

  const successCloseBtn = $('btn-success-close');
  if (successCloseBtn) successCloseBtn.addEventListener('click', returnToEditor);
  const successViewSitesBtn = $('btn-success-view-sites');
  if (successViewSitesBtn) {
    successViewSitesBtn.addEventListener('click', () => {
      closeModal('modal-success');
      window.location.hash = '#dashboard';
    });
  }

  // Close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Escape closes every open modal (read from the DOM, so a new modal needs
  // no entry here) and the account menu.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(overlay => {
        if (getComputedStyle(overlay).display !== 'none') closeModal(overlay.id);
      });
      if (accountMenuOpen) closeAccountMenu();
    }
  });

  // Session-expiry recovery (SESS-01/02)
  initCrossTabAuthWatcher();
  initSessionExpiredBanner();

  // Account menu (R-27): GDPR self-service + sign out everywhere.
  const menuBtn = $('btn-account-menu-header');
  if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (accountMenuOpen) closeAccountMenu();
      else openAccountMenu();
    });
  }
  document.addEventListener('click', (e) => {
    if (!accountMenuOpen) return;
    const menu = $('account-menu-header');
    if (menu && !menu.contains(e.target) && e.target !== menuBtn) closeAccountMenu();
  });
  const acctLogoutAllBtn = $('account-menu-header-logout-all');
  if (acctLogoutAllBtn) acctLogoutAllBtn.addEventListener('click', () => {
    closeAccountMenu();
    openLogoutEverywhereModal(menuBtn);
  });
  const acctExportBtn = $('account-menu-header-export-data');
  if (acctExportBtn) acctExportBtn.addEventListener('click', () => { closeAccountMenu(); downloadMyData(); });
  const acctDeleteBtn = $('account-menu-header-delete-account');
  if (acctDeleteBtn) acctDeleteBtn.addEventListener('click', () => {
    closeAccountMenu();
    openDeleteAccountModal(menuBtn);
  });
}

// ---------------------------------------------------------------------------
// 25. Bootstrap
// ---------------------------------------------------------------------------

async function boot() {
  setLoading(true, 'Se încarcă…');
  try {
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
    showToast(RO.BOOT_FAILED, 'error', 8000);
  } finally {
    setLoading(false);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
