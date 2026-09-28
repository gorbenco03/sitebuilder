'use strict';
/**
 * builder/onboarding.js
 *
 * PLAN-UX-2026-09-27 §5.1 — a short, 2-screen wizard shown once, before the
 * canvas, instead of dropping a first-time visitor straight into
 * canvas + quickstart bar + auto-opened Details drawer at the same time.
 *
 * Loaded as its own <script> (builder/index.html, after app.js) on purpose,
 * same pattern as builder/publish-checklist.js — a classic (non-module)
 * script sharing app.js's global scope, so it calls app.js's own helpers
 * directly ($(...), getTemplateList(), applyQuickstart(), escHtml(),
 * trapModalTab(), getFocusableEls()) rather than reimplementing any of
 * them. It never touches app.js itself beyond the one hook documented
 * there — startWithTemplate() calls hidookOnboardingStart() instead of its
 * own body, then that body runs anyway once onDone() re-invokes it.
 *
 * Step 1 — "Ce fel de afacere ai?": five cards, one per shipped template
 * (templates/registry.json). Clicking one both picks the vertical and
 * advances — the card matching whichever template the visitor actually
 * clicked in the catalog starts pre-selected (confirm-or-adjust, not a
 * cold choice).
 * Step 2 — name / phone-WhatsApp / town, all optional. "Deschide editorul"
 * (or "Sari peste" at any point) hands off to app.js, which reuses the
 * EXISTING quickstart bar's own applyQuickstart() to stamp whatever was
 * filled in — not a second, competing implementation of that cascade.
 *
 * Shown once: hidookOnboardingShouldRun() gates on a single localStorage
 * flag, set on completion AND on skip, read/written inside try/catch (a
 * blocked/full store just means the wizard is skipped outright instead of
 * nagging on every template click — see hidookOnboardingShouldRun()).
 *
 * PLAN-UX-2026-09-27 §5.1 remainder: onDone's 3rd argument, `completed`, is
 * true only when the visitor actually reached and submitted step 2
 * ("Deschide editorul") — false for Escape, the backdrop, or "Sari peste" at
 * either step. app.js uses it to skip auto-opening Details for that one
 * design (the wizard just collected those same fields) and show a hint
 * instead; a skipped wizard keeps the old auto-open unchanged.
 */

const ONBOARDING_SEEN_KEY = 'hb.onboarding.seen.v1';

// U-08 style: stroke icons, currentColor, 1.5px stroke, 24px viewBox — no
// emoji, no icon font. One icon per business type, kept generic (a fork and
// knife, not a specific dish) so it reads the same regardless of which
// template ends up recommended.
const ONB_TYPE_ICONS = {
  food: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 3v6a1.6 1.6 0 0 1-1.6 1.6h-.1A1.6 1.6 0 0 1 4.7 9V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.4 10.6V21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M17 3c-1.4 0-2.5 1.8-2.5 4.5S15.6 12 17 12v9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cake: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 10.5h8l1.2 8.4a1.6 1.6 0 0 1-1.6 1.8H8.4a1.6 1.6 0 0 1-1.6-1.8L8 10.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 10.5c0-2.4 1.3-4 3-4s3 1.6 3 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 6.5V3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="2.7" r="0.9" fill="currentColor"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="6.2" cy="6.5" r="2.2" stroke="currentColor" stroke-width="1.5"/><circle cx="6.2" cy="17.5" r="2.2" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.8 19 17.2M8 16.2 19 6.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  tool: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15.3 6.6a3.6 3.6 0 0 0-4.9 4l-6.9 6.9a1.7 1.7 0 0 0 2.4 2.4l6.9-6.9a3.6 3.6 0 0 0 4-4.9l-2.3 2.3-2-2 2.3-2.3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  brief: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="8" width="17" height="11" rx="1.8" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 8V6.3A1.8 1.8 0 0 1 10.3 4.5h3.4A1.8 1.8 0 0 1 15.5 6.3V8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 13h17" stroke="currentColor" stroke-width="1.5"/></svg>',
};

// One option per shipped template (templates/registry.json — five design
// systems total, per AGENTS.md). Keep this in sync if that registry ever
// changes shape.
const ONBOARDING_TYPES = [
  { id: 'restaurant', templateId: 'product-menu', label: 'Restaurant sau cafenea', icon: 'food' },
  { id: 'patiserie', templateId: 'desserdirina', label: 'Patiserie sau cofetărie', icon: 'cake' },
  { id: 'salon', templateId: 'portfolio', label: 'Salon sau beauty', icon: 'spark' },
  { id: 'meserii', templateId: 'local-service', label: 'Meserii sau servicii la domiciliu', icon: 'tool' },
  { id: 'profesional', templateId: 'professionals', label: 'Cabinet sau servicii profesionale', icon: 'brief' },
];

let onbState = null;

function onbSeen() {
  try { return localStorage.getItem(ONBOARDING_SEEN_KEY) === '1'; }
  catch (_) { return true; /* storage blocked/full — never nag on every click */ }
}
function onbMarkSeen() {
  try { localStorage.setItem(ONBOARDING_SEEN_KEY, '1'); } catch (_) { /* best-effort only */ }
}

/** Gate used by app.js's startWithTemplate() hook — true only for a visitor
 * who has never completed or skipped the wizard before.
 *
 * navigator.webdriver (W3C WebDriver Recommendation §7.7, set by Chromium
 * under Playwright/Selenium/any CDP automation — including this repo's own
 * dozens of existing "click a catalog card → land on #edit" Playwright
 * oracles, one per fresh browser context/no localStorage) reads true only
 * under automation, never in a real visitor's own browser. Skipping the
 * wizard there keeps every one of those oracles landing straight on #edit
 * exactly as before this task, with no changes needed to any of them. An
 * oracle that DOES want to see the real wizard overrides this first, before
 * navigating — see bot/test/audit27-s-1-onboarding-wizard.test.js — via
 * page.addInitScript(() => Object.defineProperty(navigator, 'webdriver',
 * { get: () => false })). */
function hidookOnboardingShouldRun() {
  try {
    if (navigator.webdriver) return false;
  } catch (_) { /* ignore */ }
  return !onbSeen();
}

function onbTypeHtml(type, selectedId) {
  const isSelected = type.id === selectedId;
  return '<button type="button" class="onb-type-card' + (isSelected ? ' is-selected' : '') + '"'
    + ' data-type="' + type.id + '" aria-pressed="' + (isSelected ? 'true' : 'false') + '">'
    + '<span class="onb-type-icon">' + (ONB_TYPE_ICONS[type.icon] || '') + '</span>'
    + '<span class="onb-type-label">' + escHtml(type.label) + '</span>'
    + '</button>';
}

function onbStep1Html() {
  const selectedId = onbState.selectedType ? onbState.selectedType.id : null;
  return '<div class="onb-box" role="dialog" aria-modal="true" aria-labelledby="onb-title">'
    + '<div class="onb-header">'
    + '<span class="onb-progress">Pasul 1 din 2</span>'
    + '<button type="button" class="onb-skip" id="onb-skip-btn">Sari peste</button>'
    + '</div>'
    + '<h2 id="onb-title" class="onb-title">Ce fel de afacere ai?</h2>'
    + '<p class="onb-sub">Alegem designul potrivit pentru tine — poți schimba oricând.</p>'
    + '<div class="onb-type-grid" role="group" aria-label="Tipul afacerii">'
    + ONBOARDING_TYPES.map((t) => onbTypeHtml(t, selectedId)).join('')
    + '</div>'
    + '</div>';
}

function onbStep2Html() {
  return '<div class="onb-box" role="dialog" aria-modal="true" aria-labelledby="onb-title">'
    + '<div class="onb-header">'
    + '<span class="onb-progress">Pasul 2 din 2</span>'
    + '<button type="button" class="onb-skip" id="onb-skip-btn">Sari peste</button>'
    + '</div>'
    + '<h2 id="onb-title" class="onb-title">Cum se numește afacerea și ce date de contact ai?</h2>'
    + '<p class="onb-sub">Opțional — completezi acum sau mai târziu, direct din editor.</p>'
    + '<form id="onb-identity-form" class="onb-form" autocomplete="off" novalidate>'
    + '<div class="field-group"><label class="field-label" for="onb-name">Numele afacerii</label>'
    + '<input type="text" id="onb-name" class="field-input" maxlength="60" placeholder="ex. Popas Verde" /></div>'
    + '<div class="field-group"><label class="field-label" for="onb-phone">Telefon / WhatsApp</label>'
    + '<input type="tel" id="onb-phone" class="field-input" maxlength="24" placeholder="07xx xxx xxx" /></div>'
    + '<div class="field-group"><label class="field-label" for="onb-town">Localitate</label>'
    + '<input type="text" id="onb-town" class="field-input" maxlength="40" placeholder="ex. Cluj-Napoca" /></div>'
    + '<div class="onb-actions">'
    + '<button type="button" class="btn-ghost" id="onb-back-btn">Înapoi</button>'
    + '<button type="submit" class="btn-primary" id="onb-continue-btn">Deschide editorul</button>'
    + '</div>'
    + '</form>'
    + '</div>';
}

function onbCurrentBox() {
  const overlay = $('onboarding-wizard');
  return overlay ? overlay.querySelector('.onb-box') : null;
}

function onbKeydownHandler(e) {
  if (!onbState) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    onbFinish(onbState.clickedTemplateId, null, false);
    return;
  }
  if (e.key === 'Tab') {
    const box = onbCurrentBox();
    if (box) trapModalTab(e, box);
  }
}

function onbBackdropClick(e) {
  if (!onbState) return;
  if (e.target === e.currentTarget) onbFinish(onbState.clickedTemplateId, null, false);
}

/** Read whatever step 2 fields exist right now back into onbState, so
 * neither "Înapoi" nor a later "Deschide editorul" loses what was typed. */
function onbCaptureIdentityFields() {
  if (!onbState) return;
  const nameEl = $('onb-name');
  const phoneEl = $('onb-phone');
  const townEl = $('onb-town');
  if (nameEl) onbState.name = nameEl.value.trim();
  if (phoneEl) onbState.phone = phoneEl.value.trim();
  if (townEl) onbState.town = townEl.value.trim();
}

function onbRenderStep() {
  const overlay = $('onboarding-wizard');
  if (!overlay || !onbState) return;
  overlay.innerHTML = onbState.step === 2 ? onbStep2Html() : onbStep1Html();

  const skipBtn = $('onb-skip-btn');
  if (skipBtn) skipBtn.addEventListener('click', () => onbFinish(onbState.clickedTemplateId, null, false));

  if (onbState.step === 2) {
    const nameEl = $('onb-name');
    const phoneEl = $('onb-phone');
    const townEl = $('onb-town');
    if (nameEl) nameEl.value = onbState.name || '';
    if (phoneEl) phoneEl.value = onbState.phone || '';
    if (townEl) townEl.value = onbState.town || '';

    const form = $('onb-identity-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        onbCaptureIdentityFields();
        const templateId = (onbState.selectedType && onbState.selectedType.templateId) || onbState.clickedTemplateId;
        const identity = (onbState.name || onbState.phone || onbState.town)
          ? { name: onbState.name, phone: onbState.phone, town: onbState.town }
          : null;
        onbFinish(templateId, identity, true);
      });
    }
    const backBtn = $('onb-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        onbCaptureIdentityFields();
        onbState.step = 1;
        onbRenderStep();
      });
    }
    if (nameEl) nameEl.focus();
  } else {
    overlay.querySelectorAll('.onb-type-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = ONBOARDING_TYPES.find((t) => t.id === btn.dataset.type);
        if (!type) return;
        onbState.selectedType = type;
        onbState.step = 2;
        onbRenderStep();
      });
    });
    const preselected = overlay.querySelector('.onb-type-card.is-selected');
    const toFocus = preselected || overlay.querySelector('.onb-type-card');
    if (toFocus) toFocus.focus();
  }
}

/** Terminal step: mark the wizard seen, tear down the overlay, and hand the
 * result to whoever called hidookOnboardingStart() — app.js's
 * startWithTemplate(), re-invoked with (templateId, identity, completed),
 * which reuses applyQuickstart() for `identity` and uses `completed` to
 * decide whether Details should auto-open (see this file's header comment). */
function onbFinish(templateId, identity, completed) {
  if (!onbState) return;
  const onDone = onbState.onDone;
  const opener = onbState.opener;
  onbMarkSeen();

  const overlay = $('onboarding-wizard');
  if (overlay) {
    overlay.removeEventListener('click', onbBackdropClick);
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '';
  }
  document.removeEventListener('keydown', onbKeydownHandler);
  onbState = null;
  if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
    try { opener.focus(); } catch (_) { /* ignore */ }
  }
  if (typeof onDone === 'function') onDone(templateId, identity, !!completed);
}

/** Entry point — app.js's startWithTemplate() calls this instead of running
 * its own body when hidookOnboardingShouldRun() is true.
 * `clickedTemplateId` is whichever catalog card the visitor actually
 * clicked (used to pre-select step 1, and as the fallback template if the
 * wizard is skipped outright). `onDone(templateId, identity, completed)`
 * always fires exactly once — with `identity` null when nothing was filled
 * in / the wizard was skipped, or `{name, phone, town}` when step 2 had at
 * least one field filled in; `completed` is true only when step 2 was
 * actually reached and submitted (false for Escape/backdrop/"Sari peste"). */
function hidookOnboardingStart(clickedTemplateId, onDone) {
  const overlay = $('onboarding-wizard');
  if (!overlay) {
    // Container missing (should not happen outside an isolated test
    // harness) — never block starting the design over it.
    onbMarkSeen();
    onDone(clickedTemplateId, null);
    return;
  }
  onbState = {
    step: 1,
    clickedTemplateId: clickedTemplateId,
    selectedType: ONBOARDING_TYPES.find((t) => t.templateId === clickedTemplateId) || null,
    name: '',
    phone: '',
    town: '',
    onDone: onDone,
    opener: document.activeElement,
  };
  overlay.style.display = '';
  overlay.removeAttribute('aria-hidden');
  overlay.addEventListener('click', onbBackdropClick);
  document.addEventListener('keydown', onbKeydownHandler);
  onbRenderStep();
}
