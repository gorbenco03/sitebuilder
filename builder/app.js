'use strict';
/* ============================================================
   Hidook Builder — app.js
   Vanilla JS, zero framework/CDN, CommonJS-free (browser)
   All user-facing strings in Romanian.
   ============================================================ */

// ---------------------------------------------------------------------------
// 1. State
// ---------------------------------------------------------------------------

const DRAFT_KEY = 'hb.draft.v1';

const draft = { templateId: null, config: null };

let currentUser    = null;
let currentSiteId  = null;
let currentTemplate = null;

// Runtime config from /api/config
let appConfig = { priceEur: null, trialDays: 3, brandDomain: null, contactUrl: null };

// Wizard state
let wizardSteps      = [];   // [{id, title, fields, optional:[]}]
let wizardCurrentStep = 0;

// Preview debounce
let previewTimer       = null;
let previewSpinTimer   = null;
let previewFirstRender = false;

// Slug check debounce
let slugCheckTimer = null;
let slugValid      = false;
let slugNormalized = '';

// Countdown timer for success modal
let countdownTimer = null;
let trialEndsAt    = null;
let sitePaymentUrl = null;
let publishedSiteId = null;
let publishedSiteUrl = null;

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
  if (msgEl && msg) msgEl.textContent = msg;
  if (visible) {
    overlay.classList.remove('hidden');
    overlay.style.display = '';
  } else {
    overlay.classList.add('hidden');
    setTimeout(() => { if (overlay.classList.contains('hidden')) overlay.style.display = 'none'; }, 250);
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

function openModal(id) {
  const el = $(id);
  if (!el) return;
  el.style.display = '';
  // Focus trap: focus first focusable
  requestAnimationFrame(() => {
    const first = el.querySelector('button,input,a,[tabindex]:not([tabindex="-1"])');
    if (first) first.focus();
  });
}
function closeModal(id) {
  const el = $(id);
  if (el) el.style.display = 'none';
}

function setBtnLoading(btn, loading, originalText) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn._origText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-loading-text"><span class="spinner spinner--xs"></span>' + (originalText || 'Se procesează...') + '</span>';
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

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) {
    if (e.name === 'QuotaExceededError' || (e.code && e.code === 22)) {
      showToast('Proiectul conține imagini mari — nu a putut fi salvat ca draft. Publică înainte de a închide pagina.', 'error', 7000);
    }
    return false;
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Slugify
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

// Format time remaining
function fmtTimeRemaining(ms) {
  if (ms <= 0) return 'expirat';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const parts = [];
  if (d > 0) parts.push(d + 'z');
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
// 5. Template data access
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 6. Preview rendering
// ---------------------------------------------------------------------------

function schedulePreview(immediate) {
  if (previewTimer) clearTimeout(previewTimer);
  if (immediate) { renderPreview(); return; }
  previewTimer = setTimeout(renderPreview, 280);
}

function showPreviewSpinner(show) {
  const el = $('preview-spinner-overlay');
  if (el) el.style.display = show ? '' : 'none';
}

function renderPreview() {
  if (!draft.config || !draft.templateId) return;
  const tpl = getTemplateById(draft.templateId);
  if (!tpl || typeof window.HidookEngine === 'undefined') return;

  // Show spinner if re-render takes >300ms
  if (previewFirstRender) {
    if (previewSpinTimer) clearTimeout(previewSpinTimer);
    previewSpinTimer = setTimeout(() => showPreviewSpinner(true), 300);
  }

  try {
    const html = window.HidookEngine.renderPreview(tpl.files, draft.config);
    setIframeSrcdoc('preview-iframe-desktop', html);
    setIframeSrcdoc('preview-iframe-mobile', html);

    // First render: hide skeleton
    if (!previewFirstRender) {
      previewFirstRender = true;
      const skel = $('preview-skeleton');
      if (skel) skel.classList.add('hidden');
    }

    clearTimeout(previewSpinTimer);
    showPreviewSpinner(false);

    const status = $('preview-status');
    if (status) status.textContent = 'Actualizat ' + new Date().toLocaleTimeString('ro-RO', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  } catch (e) {
    console.warn('renderPreview error:', e);
    clearTimeout(previewSpinTimer);
    showPreviewSpinner(false);
  }
}

function setIframeSrcdoc(id, html) {
  const iframe = $(id);
  if (iframe) iframe.srcdoc = html;
}

// ---------------------------------------------------------------------------
// 7. Draft persistence
// ---------------------------------------------------------------------------

function saveDraft() {
  if (!draft.templateId || !draft.config) return;
  lsSet(DRAFT_KEY, { templateId: draft.templateId, config: draft.config });
}
function loadDraft() { return lsGet(DRAFT_KEY); }

// ---------------------------------------------------------------------------
// 8. API
// ---------------------------------------------------------------------------

async function apiGet(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) {
    const json = await r.json().catch(() => ({}));
    throw Object.assign(new Error(json.error || 'Eroare server'), { status: r.status });
  }
  return r.json();
}

async function apiPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(json.error || 'Eroare server'), { status: r.status });
  return json;
}

// ---------------------------------------------------------------------------
// 9. App config
// ---------------------------------------------------------------------------

async function fetchAppConfig() {
  try {
    const data = await apiGet('/api/config');
    appConfig = Object.assign(appConfig, data);
  } catch (_) {
    // Fallback defaults already in appConfig
  }
  // Update hero
  const heroPrice = $('hero-price');
  const heroTrialDays = $('hero-trial-days');
  if (heroPrice) heroPrice.textContent = appConfig.priceEur != null ? appConfig.priceEur + '€' : '—€';
  if (heroTrialDays) heroTrialDays.textContent = appConfig.trialDays + ' zile';
  // Update trial bullets in publish modal
  const bulletDays = $('trial-bullet-days');
  const bulletPrice = $('trial-bullet-price');
  if (bulletDays) bulletDays.textContent = appConfig.trialDays + ' zile';
  if (bulletPrice) bulletPrice.textContent = appConfig.priceEur != null ? appConfig.priceEur + '€' : '—€';
}

// ---------------------------------------------------------------------------
// 10. Auth
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
  if (user) {
    if (badge) { badge.textContent = user.email || ('ID: ' + String(user.id).slice(0,8)); show(badge); }
    if (logoutBtn) show(logoutBtn);
    if (navDash) show(navDash);
  } else {
    if (badge) hide(badge);
    if (logoutBtn) hide(logoutBtn);
    if (navDash) hide(navDash);
  }
}

function tryTelegramAuth() {
  const twa = window.Telegram && window.Telegram.WebApp;
  if (!twa || !twa.initData) return;
  apiPost('/api/auth/telegram', { initData: twa.initData })
    .then(data => { if (data.ok) updateUserUI(data.user); })
    .catch(e => console.warn('Telegram auth:', e.message));
}

// ---------------------------------------------------------------------------
// 11. Wizard — build from schema
// ---------------------------------------------------------------------------

/**
 * Parse schema.sections into wizard steps.
 * Required fields → step body; optional fields → collapsed group at bottom of step.
 */
function buildWizardSteps(schema) {
  if (!schema || !schema.sections) return [];
  return schema.sections.map(section => {
    const required = (section.fields || []).filter(f => f.required !== false);
    const optional = (section.fields || []).filter(f => f.required === false);
    return { id: section.id, title: section.title || section.id, fields: required, optional };
  });
}

function renderWizard(schema, config) {
  wizardSteps = buildWizardSteps(schema);
  wizardCurrentStep = 0;
  previewFirstRender = false;

  renderStepper();
  renderAllStepPanels(config);
  goToStep(0);
}

function renderStepper() {
  const stepper = $('wizard-stepper');
  if (!stepper) return;
  if (wizardSteps.length <= 1) { hide(stepper); return; }
  show(stepper);
  stepper.innerHTML = '';
  wizardSteps.forEach((step, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'stepper-sep';
      sep.setAttribute('aria-hidden','true');
      sep.textContent = '›';
      stepper.appendChild(sep);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stepper-step';
    btn.setAttribute('aria-label', 'Pasul ' + (i+1) + ': ' + step.title);
    btn.dataset.step = i;
    btn.innerHTML =
      '<span class="step-num">' + (i+1) + '</span>' +
      '<span class="step-label">' + escHtml(step.title) + '</span>';
    btn.addEventListener('click', () => {
      // Only allow navigating to completed steps
      if (i <= wizardCurrentStep) goToStep(i);
    });
    stepper.appendChild(btn);
  });
}

function renderAllStepPanels(config) {
  const wrap = $('wizard-steps-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const totalSteps = wizardSteps.length;

  wizardSteps.forEach((step, i) => {
    const isLast = i === totalSteps - 1;
    const panel = document.createElement('div');
    panel.className = 'wizard-step-panel';
    panel.id = 'wstep-' + i;
    panel.setAttribute('role','tabpanel');

    if (isLast) {
      // Summary / publish step
      panel.appendChild(buildSummaryPanel());
    } else {
      // Build fields
      const reqWrap = document.createElement('div');
      reqWrap.className = 'step-fields-required';
      reqWrap.style.display = 'flex';
      reqWrap.style.flexDirection = 'column';
      reqWrap.style.gap = '1rem';

      step.fields.forEach(field => {
        const fg = buildFieldGroup(field, config);
        if (fg) reqWrap.appendChild(fg);
      });
      panel.appendChild(reqWrap);

      // Optional fields
      if (step.optional && step.optional.length > 0) {
        const optGroup = document.createElement('div');
        optGroup.className = 'optional-group';

        const togBtn = document.createElement('button');
        togBtn.type = 'button';
        togBtn.className = 'optional-toggle';
        togBtn.setAttribute('aria-expanded','false');
        togBtn.innerHTML =
          '+ Mai multe opțiuni <span class="optional-toggle-chevron" aria-hidden="true">&#9660;</span>';
        togBtn.addEventListener('click', () => {
          const open = optGroup.classList.toggle('open');
          togBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        const optFields = document.createElement('div');
        optFields.className = 'optional-fields';
        step.optional.forEach(field => {
          const fg = buildFieldGroup(field, config);
          if (fg) optFields.appendChild(fg);
        });

        optGroup.appendChild(togBtn);
        optGroup.appendChild(optFields);
        panel.appendChild(optGroup);
      }
    }

    wrap.appendChild(panel);
  });
}

function buildSummaryPanel() {
  const div = document.createElement('div');
  div.className = 'summary-step';

  const title = document.createElement('div');
  title.className = 'summary-step-title';
  title.textContent = 'Totul arată bine?';
  div.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'step-section-sub';
  sub.style.marginTop = '0';
  sub.textContent = 'Verifică previzualizarea și publică site-ul gratuit.';
  div.appendChild(sub);

  // Mini preview
  const previewBox = document.createElement('div');
  previewBox.className = 'summary-preview-box';
  const previewIframe = document.createElement('iframe');
  previewIframe.id = 'summary-preview-iframe';
  previewIframe.title = 'Previzualizare rezumat';
  previewIframe.setAttribute('sandbox', 'allow-scripts');
  previewIframe.setAttribute('aria-label', 'Previzualizare site în rezumat');
  previewBox.appendChild(previewIframe);
  div.appendChild(previewBox);

  const publishBtn = document.createElement('button');
  publishBtn.type = 'button';
  publishBtn.id = 'btn-publish';
  publishBtn.className = 'btn-primary btn-full';
  publishBtn.style.padding = '0.85rem 1rem';
  publishBtn.style.fontSize = '1rem';
  publishBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v8M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 14h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
    'Publică site-ul GRATUIT';
  publishBtn.addEventListener('click', doPublish);
  div.appendChild(publishBtn);

  const trialNote = document.createElement('p');
  trialNote.style.cssText = 'font-size:.78rem;color:var(--text-muted);text-align:center;line-height:1.45';
  trialNote.textContent =
    'Site-ul devine live imediat. Ai ' + appConfig.trialDays + ' zile gratuite.';
  div.appendChild(trialNote);

  return div;
}

function goToStep(index) {
  if (index < 0 || index >= wizardSteps.length) return;
  wizardCurrentStep = index;

  // Show/hide panels
  document.querySelectorAll('.wizard-step-panel').forEach((panel, i) => {
    panel.classList.toggle('active', i === index);
  });

  // Autofocus first input
  requestAnimationFrame(() => {
    const panel = document.getElementById('wstep-' + index);
    if (panel) {
      const first = panel.querySelector('input:not([type=file]):not([type=color]),textarea');
      if (first) first.focus();
    }
  });

  // Update stepper
  document.querySelectorAll('.stepper-step').forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
    btn.classList.toggle('done', i < index);
    btn.setAttribute('aria-current', i === index ? 'step' : 'false');
  });

  // Update progress bar
  const total = wizardSteps.length;
  const pct = total > 1 ? Math.round((index / (total - 1)) * 100) : 100;
  const bar = $('wizard-progress-bar');
  if (bar) bar.style.width = pct + '%';

  // Footer buttons
  const backBtn = $('btn-step-back');
  const nextBtn = $('btn-step-next');
  const isLast = index === wizardSteps.length - 1;

  if (backBtn) {
    if (index === 0) hide(backBtn); else show(backBtn);
  }
  if (nextBtn) {
    if (isLast) {
      hide(nextBtn);
    } else {
      show(nextBtn);
      nextBtn.innerHTML = (index === wizardSteps.length - 2)
        ? 'Verifică și publică <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 2l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : 'Continuă <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 2l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
  }

  // Scroll stepper item into view
  const stepperBtn = document.querySelector('.stepper-step[data-step="' + index + '"]');
  if (stepperBtn) stepperBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

  // Sync summary iframe
  if (isLast) {
    syncSummaryPreview();
  }
}

function syncSummaryPreview() {
  const iframe = $('summary-preview-iframe');
  if (!iframe || !draft.config || !draft.templateId) return;
  const tpl = getTemplateById(draft.templateId);
  if (!tpl || typeof window.HidookEngine === 'undefined') return;
  try {
    const html = window.HidookEngine.renderPreview(tpl.files, draft.config);
    iframe.srcdoc = html;
  } catch (_) {}
}

function nextStep() {
  if (wizardCurrentStep < wizardSteps.length - 1) {
    goToStep(wizardCurrentStep + 1);
    schedulePreview();
  }
}

function prevStep() {
  if (wizardCurrentStep > 0) goToStep(wizardCurrentStep - 1);
}

// ---------------------------------------------------------------------------
// 12. Field builders
// ---------------------------------------------------------------------------

function buildFieldGroup(field, config) {
  const type = field.type;

  const wrap = document.createElement('div');
  wrap.className = 'field-group';

  if (type === 'color') return buildColorField(field, config, wrap);
  if (type === 'list')  return buildListField(field, config, wrap);
  if (type === 'photos') return buildPhotosField(field, config, wrap);

  // text / phone / url / textarea / email
  const key = field.key;
  const label = field.label || key;
  const required = field.required !== false;
  const maxLen = field.maxLen;

  const safeId = 'f_' + key.replace(/[^a-zA-Z0-9]/g,'_');

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

  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
    input.className = 'field-textarea';
    if (maxLen) input.maxLength = maxLen;
    input.rows = 3;
  } else {
    input = document.createElement('input');
    input.className = 'field-input';
    input.type = type === 'phone' ? 'tel' : (type === 'url' ? 'url' : (type === 'email' ? 'email' : 'text'));
    if (maxLen) input.maxLength = maxLen;
  }
  input.id = safeId;
  input.name = key;
  if (required) input.required = true;
  const curVal = getPath(config, key);
  if (curVal != null && typeof curVal !== 'object') input.value = String(curVal);

  // Autoslug from business name
  if (key === 'business.name') {
    input.addEventListener('input', () => {
      setPath(draft.config, key, input.value);
      saveDraft();
      schedulePreview();
      // Pre-fill slug when user hasn't manually set it
      const slugInput = $('input-slug');
      if (slugInput && !slugInput.dataset.manuallyEdited) {
        const s = toSlug(input.value);
        slugInput.value = s;
        scheduleSlugCheck(s);
      }
    });
  } else {
    input.addEventListener('input', () => {
      setPath(draft.config, key, input.value);
      saveDraft();
      schedulePreview();
    });
  }

  // Inline validation on blur
  if (required) {
    input.addEventListener('blur', () => {
      validateField(input, required);
    });
  }

  wrap.appendChild(input);

  // Error placeholder
  const errEl = document.createElement('p');
  errEl.className = 'field-error';
  errEl.setAttribute('role','alert');
  errEl.style.display = 'none';
  wrap.appendChild(errEl);
  input._errEl = errEl;

  return wrap;
}

function validateField(input, required) {
  const errEl = input._errEl;
  const val = input.value.trim();
  if (required && !val) {
    input.classList.add('invalid');
    if (errEl) { errEl.textContent = 'Câmp obligatoriu'; errEl.style.display = ''; }
    return false;
  }
  input.classList.remove('invalid');
  if (errEl) errEl.style.display = 'none';
  return true;
}

function buildColorField(field, config, wrap) {
  const key = field.key;
  const label = field.label || key;
  const safeId = 'f_' + key.replace(/[^a-zA-Z0-9]/g,'_');

  const labelEl = document.createElement('label');
  labelEl.className = 'field-label';
  labelEl.setAttribute('for', safeId);
  labelEl.textContent = label;
  wrap.appendChild(labelEl);

  const row = document.createElement('div');
  row.className = 'field-color-row';

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'field-color-swatch';
  swatch.id = safeId;
  swatch.setAttribute('aria-label', label + ' (selector culoare)');
  const curVal = getPath(config, key);
  if (curVal) swatch.value = curVal;

  const textInput = document.createElement('input');
  textInput.className = 'field-input';
  textInput.type = 'text';
  textInput.maxLength = 7;
  textInput.placeholder = '#RRGGBB';
  textInput.setAttribute('aria-label', label + ' (cod hex)');
  if (curVal) textInput.value = curVal;

  const syncFromSwatch = () => {
    const v = swatch.value;
    textInput.value = v;
    setPath(draft.config, key, v);
    if (key === 'theme.primary') {
      const derived = deriveColors(v);
      setPath(draft.config, 'theme.primaryLight', derived.primaryLight);
      setPath(draft.config, 'theme.primaryDark', derived.primaryDark);
      const lI = document.getElementById('f_theme_primaryLight');
      const dI = document.getElementById('f_theme_primaryDark');
      if (lI) lI.value = derived.primaryLight;
      if (dI) dI.value = derived.primaryDark;
    }
    saveDraft();
    schedulePreview();
  };

  swatch.addEventListener('input', syncFromSwatch);
  textInput.name = key;
  textInput.addEventListener('input', () => {
    const v = textInput.value;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) { swatch.value = v; syncFromSwatch(); }
    else { setPath(draft.config, key, v); saveDraft(); schedulePreview(); }
  });

  row.appendChild(swatch);
  row.appendChild(textInput);
  wrap.appendChild(row);
  return wrap;
}

function buildListField(field, config, wrap) {
  const key = field.key;
  const label = field.label || key;
  const itemShape = field.itemShape;
  const maxItems = field.max || 20;

  const labelEl = document.createElement('div');
  labelEl.className = 'field-label';
  labelEl.textContent = label;
  wrap.appendChild(labelEl);

  const listContainer = document.createElement('div');
  listContainer.className = 'list-items';

  const curVal = getPath(config, key);
  const items = Array.isArray(curVal) ? deepClone(curVal) : [];

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-list-add';
  addBtn.textContent = '+ Adaugă element';

  function renderItems() {
    listContainer.innerHTML = '';
    items.forEach((item, idx) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'list-item';

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-list-remove';
      delBtn.setAttribute('aria-label', 'Șterge elementul ' + (idx+1));
      delBtn.innerHTML = '&times;';
      delBtn.addEventListener('click', () => {
        items.splice(idx, 1);
        setPath(draft.config, key, deepClone(items));
        saveDraft(); schedulePreview(); renderItems();
      });

      if (typeof itemShape === 'string' && itemShape === 'text') {
        const row = document.createElement('div');
        row.className = 'list-item-row';
        const inp = document.createElement('input');
        inp.className = 'field-input';
        inp.type = 'text';
        inp.value = typeof item === 'string' ? item : '';
        inp.setAttribute('aria-label', 'Element ' + (idx+1));
        inp.addEventListener('input', () => {
          items[idx] = inp.value;
          setPath(draft.config, key, deepClone(items));
          saveDraft(); schedulePreview();
        });
        row.appendChild(inp);
        row.appendChild(delBtn);
        itemDiv.appendChild(row);
      } else if (typeof itemShape === 'object' && itemShape !== null) {
        const headerRow = document.createElement('div');
        headerRow.className = 'list-item-row';
        headerRow.style.justifyContent = 'flex-end';
        headerRow.appendChild(delBtn);
        itemDiv.appendChild(headerRow);

        Object.entries(itemShape).forEach(([subKey, subType]) => {
          const subWrap = document.createElement('div');
          subWrap.className = 'list-item-subfield field-group';

          const subLabel = document.createElement('label');
          subLabel.className = 'field-label';
          const subId = 'li_' + idx + '_' + subKey;
          subLabel.setAttribute('for', subId);
          subLabel.textContent = subKey;
          subWrap.appendChild(subLabel);

          if (subType === 'photos') {
            subWrap.appendChild(buildPhotosInlineField(subKey, item, idx, key, items));
          } else {
            const inp = document.createElement('input');
            inp.className = 'field-input';
            inp.type = 'text';
            inp.id = subId;
            inp.setAttribute('aria-label', subKey + ' element ' + (idx+1));
            if (item && item[subKey] != null) inp.value = String(item[subKey]);
            inp.addEventListener('input', () => {
              if (!items[idx]) items[idx] = {};
              items[idx][subKey] = inp.value;
              setPath(draft.config, key, deepClone(items));
              saveDraft(); schedulePreview();
            });
            subWrap.appendChild(inp);
          }
          itemDiv.appendChild(subWrap);
        });
      }

      listContainer.appendChild(itemDiv);
    });
    addBtn.disabled = items.length >= maxItems;
    addBtn.title = items.length >= maxItems ? 'Maxim ' + maxItems + ' elemente' : '';
  }

  addBtn.addEventListener('click', () => {
    if (items.length >= maxItems) return;
    if (typeof itemShape === 'string') {
      items.push('');
    } else if (typeof itemShape === 'object' && itemShape !== null) {
      const newItem = {};
      Object.keys(itemShape).forEach(k => { newItem[k] = itemShape[k] === 'photos' ? [] : ''; });
      items.push(newItem);
    } else {
      items.push('');
    }
    setPath(draft.config, key, deepClone(items));
    saveDraft(); schedulePreview(); renderItems();
  });

  renderItems();
  wrap.appendChild(listContainer);
  wrap.appendChild(addBtn);
  return wrap;
}

function buildPhotosInlineField(subKey, item, itemIdx, parentKey, items) {
  const photosWrap = document.createElement('div');
  photosWrap.className = 'photos-container';
  const thumbs = document.createElement('div');
  thumbs.className = 'photos-thumbs';

  function renderThumbs() {
    thumbs.innerHTML = '';
    const photos = (item && Array.isArray(item[subKey])) ? item[subKey] : [];
    photos.forEach((p, pi) => {
      const src = typeof p === 'string' ? p : (p && p.src);
      if (!src) return;
      const div = document.createElement('div');
      div.className = 'photo-thumb';
      const img = document.createElement('img');
      img.src = src; img.alt = 'Fotografie ' + (pi+1);
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'photo-thumb-del';
      del.setAttribute('aria-label', 'Șterge fotografia ' + (pi+1));
      del.innerHTML = '&times;';
      del.addEventListener('click', () => {
        photos.splice(pi, 1); item[subKey] = photos; items[itemIdx] = item;
        setPath(draft.config, parentKey, deepClone(items));
        saveDraft(); schedulePreview(); renderThumbs();
      });
      div.appendChild(img); div.appendChild(del); thumbs.appendChild(div);
    });
  }

  renderThumbs();

  const dropzone = buildDropzone(null, async (files) => {
    for (const file of files) {
      const dataUrl = await resizeImageToDataUrl(file, 1600, 0.82);
      if (!Array.isArray(item[subKey])) item[subKey] = [];
      item[subKey].push({ src: dataUrl, alt: file.name.replace(/\.[^.]+$/, '') });
      items[itemIdx] = item;
      setPath(draft.config, parentKey, deepClone(items));
      saveDraft(); schedulePreview();
    }
    renderThumbs();
  });

  photosWrap.appendChild(thumbs);
  photosWrap.appendChild(dropzone);
  return photosWrap;
}

function buildPhotosField(field, config, wrap) {
  const key = field.key;
  const label = field.label || key;
  const maxPhotos = field.max || 12;

  const labelEl = document.createElement('div');
  labelEl.className = 'field-label';
  labelEl.textContent = label;
  wrap.appendChild(labelEl);

  const countEl = document.createElement('div');
  countEl.className = 'photos-count';

  const thumbs = document.createElement('div');
  thumbs.className = 'photos-thumbs';

  // Drag reorder state
  let dragIdx = null;

  function renderThumbs() {
    thumbs.innerHTML = '';
    const photos = getPath(draft.config, key);
    const count = Array.isArray(photos) ? photos.length : 0;
    countEl.textContent = count + ' din ' + maxPhotos + ' poze';
    countEl.className = 'photos-count' + (count >= maxPhotos ? ' at-limit' : '');
    if (!Array.isArray(photos)) return;
    photos.forEach((p, idx) => {
      const src = typeof p === 'string' ? p : (p && p.src);
      if (!src) return;
      const div = document.createElement('div');
      div.className = 'photo-thumb';
      div.setAttribute('draggable','true');
      div.dataset.idx = idx;

      const img = document.createElement('img');
      img.src = src; img.alt = 'Fotografie ' + (idx+1); img.loading = 'lazy';
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'photo-thumb-del';
      del.setAttribute('aria-label', 'Șterge fotografia ' + (idx+1));
      del.innerHTML = '&times;';
      del.addEventListener('click', () => {
        const arr = getPath(draft.config, key) || [];
        arr.splice(idx, 1);
        setPath(draft.config, key, arr);
        saveDraft(); schedulePreview(); renderThumbs();
      });

      // Drag handlers
      div.addEventListener('dragstart', () => { dragIdx = idx; div.classList.add('dragging'); });
      div.addEventListener('dragend', () => { dragIdx = null; div.classList.remove('dragging'); document.querySelectorAll('.photo-thumb').forEach(d => d.classList.remove('drag-over')); });
      div.addEventListener('dragover', (e) => { e.preventDefault(); div.classList.add('drag-over'); });
      div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
      div.addEventListener('drop', (e) => {
        e.preventDefault();
        div.classList.remove('drag-over');
        if (dragIdx == null || dragIdx === idx) return;
        const arr = getPath(draft.config, key) || [];
        const moved = arr.splice(dragIdx, 1)[0];
        arr.splice(idx, 0, moved);
        setPath(draft.config, key, arr);
        saveDraft(); schedulePreview(); renderThumbs();
      });

      div.appendChild(img); div.appendChild(del); thumbs.appendChild(div);
    });
  }

  const dropzone = buildDropzone(maxPhotos, async (files) => {
    const existing = getPath(draft.config, key) || [];
    const remaining = maxPhotos - existing.length;
    if (remaining <= 0) { showToast('Maxim ' + maxPhotos + ' fotografii.', 'error'); return; }
    const toAdd = files.slice(0, remaining);
    for (const file of toAdd) {
      const dataUrl = await resizeImageToDataUrl(file, 1600, 0.82);
      existing.push({ src: dataUrl, alt: file.name.replace(/\.[^.]+$/, '') });
    }
    setPath(draft.config, key, existing);
    saveDraft(); schedulePreview(); renderThumbs();
  }, () => {
    // Return current count for limit checking
    const arr = getPath(draft.config, key);
    return Array.isArray(arr) ? arr.length : 0;
  }, maxPhotos);

  renderThumbs();

  const container = document.createElement('div');
  container.className = 'photos-container';
  container.appendChild(thumbs);
  container.appendChild(countEl);
  container.appendChild(dropzone);
  wrap.appendChild(container);
  return wrap;
}

/** Build a reusable drag&drop + click zone. */
function buildDropzone(maxPhotos, onFiles, getCurrentCount, maxCount) {
  const label = document.createElement('label');
  label.className = 'photos-dropzone';

  const icon = document.createElement('div');
  icon.className = 'photos-dropzone-icon';
  icon.setAttribute('aria-hidden','true');
  icon.textContent = '📷';

  const text = document.createElement('div');
  text.textContent = 'Adaugă fotografii — trage sau apasă';

  const hint = document.createElement('div');
  hint.className = 'photos-dropzone-hint';
  hint.textContent = 'JPG, PNG, WebP' + (maxCount ? ' · max ' + maxCount + ' poze' : '');

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = 'image/jpeg,image/png,image/webp';

  label.appendChild(icon);
  label.appendChild(text);
  label.appendChild(hint);
  label.appendChild(fileInput);

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files);
    if (files.length) await onFiles(files);
    fileInput.value = '';
  });

  // Drag events
  label.addEventListener('dragover', (e) => { e.preventDefault(); label.classList.add('dragover'); });
  label.addEventListener('dragleave', () => label.classList.remove('dragover'));
  label.addEventListener('drop', async (e) => {
    e.preventDefault();
    label.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length) await onFiles(files);
  });

  return label;
}

// ---------------------------------------------------------------------------
// 13. Image resize
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Eroare la citirea imaginii')); };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// 14. Publish flow
// ---------------------------------------------------------------------------

function extractImages(config) {
  const images = [];
  const clean = deepClone(config);
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.startsWith('data:image/')) {
        let name;
        if (k === 'logo' || (obj._parentKey || '').includes('logo')) {
          name = 'logo';
        } else {
          name = 'gallery-' + (images.filter(x => x.name.startsWith('gallery')).length + 1);
        }
        images.push({ name, dataUrl: v });
        obj[k] = 'images/' + (name === 'logo' ? 'logo.jpg' : name + '.jpg');
      } else {
        walk(v);
      }
    }
  }
  walk(clean);
  return { cleanConfig: clean, images };
}

function openPublishModal() {
  // Reset to step 1
  show($('publish-step-1'));
  hide($('publish-step-2'));
  hide($('auth-sent'));
  show($('form-auth-email'));
  hideId('auth-error');
  hideId('slug-error');

  // Pre-fill slug from business name
  const businessName = getPath(draft.config, 'business.name') || '';
  const slugInput = $('input-slug');
  if (slugInput && businessName) {
    const s = toSlug(businessName);
    slugInput.value = s;
    slugInput.dataset.manuallyEdited = '';
    scheduleSlugCheck(s);
  } else if (slugInput) {
    updateSlugPreview('');
  }

  openModal('modal-publish');
}

// Slug checking
function scheduleSlugCheck(value) {
  if (slugCheckTimer) clearTimeout(slugCheckTimer);
  updateSlugPreview(value, 'checking');
  slugCheckTimer = setTimeout(() => checkSlug(value), 550);
}

function updateSlugPreview(slug, state) {
  const preview = $('slug-preview');
  const icon = $('slug-status-icon');
  const domain = appConfig.brandDomain || 'hidook.ro';

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
    if (errorEl) { errorEl.textContent = 'Adresa trebuie să aibă minim 3 caractere (litere mici, cifre, liniuță).'; show(errorEl); }
    slugValid = false;
    return;
  }

  try {
    const data = await apiGet('/api/slug-check?slug=' + encodeURIComponent(rawSlug));
    slugNormalized = data.slug || rawSlug;
    if (data.available) {
      updateSlugPreview(slugNormalized, 'valid');
      if (errorEl) hide(errorEl);
      slugValid = true;
      if (slugInput) slugInput.value = slugNormalized;
    } else {
      updateSlugPreview(slugNormalized, 'taken');
      if (errorEl) { errorEl.textContent = 'Această adresă e deja folosită. Încearcă alta.'; show(errorEl); }
      slugValid = false;
    }
  } catch (_) {
    // Offline or server doesn't have endpoint yet — treat as valid, server will check
    updateSlugPreview(rawSlug, 'valid');
    slugValid = true;
    slugNormalized = rawSlug;
    if (errorEl) hide(errorEl);
  }
}

async function doPublish() {
  // Open publish modal — step 1 slug selection
  openPublishModal();
}

async function doActualPublish(chosenSlug) {
  if (!currentUser) {
    // Need auth — show step 2
    hide($('publish-step-1'));
    show($('publish-step-2'));
    show($('form-auth-email'));
    hide($('auth-sent'));
    // After auth, we retry doActualPublish
    wireAuthForm(() => doActualPublish(chosenSlug));
    return;
  }

  const continueBtn = $('btn-publish-continue');
  setBtnLoading(continueBtn, true, 'Se publică...');
  try {
    await execPublish(chosenSlug);
  } catch (e) {
    showToast(e.message || 'Eroare la publicare.', 'error', 5000);
  } finally {
    setBtnLoading(continueBtn, false);
  }
}

async function execPublish(slug) {
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

  if (data.site.trialEndsAt) {
    trialEndsAt = new Date(data.site.trialEndsAt);
  } else {
    trialEndsAt = null;
  }

  showSuccessScreen(data.site.url, data.paymentUrl, data.site.trialEndsAt);
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
      setBtnLoading(submitBtn, true, 'Se trimite...');
      if (errorDiv) hide(errorDiv);
      try {
        const res = await apiPost('/api/auth/email', { email });
        if (form) hide(form);
        if (sentDiv) show(sentDiv);
        if (res.devLink && devLink) {
          devLink.href = res.devLink;
          devLink.textContent = 'Deschide linkul de testare';
          show(devLink);
          // After devLink, re-check user after slight delay
          devLink.addEventListener('click', async () => {
            await new Promise(r => setTimeout(r, 800));
            const user = await fetchCurrentUser().catch(() => null);
            if (user) {
              updateUserUI(user);
              closeModal('modal-publish');
              if (onAuthSuccess) {
                setLoading(true, 'Se publică...');
                try { await onAuthSuccess(); } catch (_) { /* errors shown via showToast in doActualPublish */ } finally { setLoading(false); }
              }
            }
          });
        }
      } catch (err) {
        if (errorDiv) { errorDiv.textContent = err.message || 'Eroare. Încearcă din nou.'; show(errorDiv); }
      } finally {
        setBtnLoading(submitBtn, false);
      }
    };
  }
}

function showSuccessScreen(url, paymentUrl, trialEndsAtIso) {
  // URL
  const urlText = $('success-url-text');
  const urlLink = $('success-url-link');
  if (urlText) urlText.textContent = url;
  if (urlLink) urlLink.href = url;

  // Keep site button
  const keepBtn = $('btn-keep-site');
  const successPrice = $('success-price');
  if (keepBtn) {
    if (paymentUrl) {
      show(keepBtn);
      keepBtn.onclick = () => { window.location.href = paymentUrl; };
    } else {
      hide(keepBtn);
    }
    if (successPrice) successPrice.textContent = appConfig.priceEur != null ? appConfig.priceEur + '€' : '—€';
  }

  // Trial countdown
  const countdownEl = $('trial-countdown');
  const countdownText = $('trial-countdown-text');
  if (trialEndsAtIso && countdownEl && countdownText) {
    show(countdownEl);
    if (countdownTimer) clearInterval(countdownTimer);
    const endsAt = new Date(trialEndsAtIso);
    function tick() {
      const remaining = endsAt - Date.now();
      if (remaining <= 0) {
        countdownText.textContent = 'Proba a expirat';
        clearInterval(countdownTimer);
      } else {
        countdownText.textContent = 'Proba expiră în ' + fmtTimeRemaining(remaining);
      }
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  } else if (countdownEl) {
    hide(countdownEl);
  }

  // WhatsApp share
  const waBtn = $('btn-share-wa');
  if (waBtn) {
    const businessName = getPath(draft.config, 'business.name') || 'Site-ul nostru';
    const waText = encodeURIComponent('Bună! Am creat site-ul pentru ' + businessName + ': ' + url);
    waBtn.onclick = () => { window.open('https://wa.me/?text=' + waText, '_blank', 'noopener'); };
  }

  openModal('modal-success');
}

// ---------------------------------------------------------------------------
// 15. Slug input wiring in publish modal
// ---------------------------------------------------------------------------

function wirePublishModal() {
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
        if (err) { err.textContent = 'Introdu o adresă validă (minim 3 caractere).'; show(err); }
        if (slugInput) slugInput.focus();
        return;
      }

      // Wait for slug check to complete
      if (slugCheckTimer) {
        clearTimeout(slugCheckTimer);
        await checkSlug(rawSlug);
      }

      if (!slugValid) {
        if (slugInput) slugInput.focus();
        return;
      }

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
        setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2 10V2h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Copiază'; }, 2000);
      } catch (_) {
        showToast('Nu s-a putut copia. Selectează manual.', 'error');
      }
    });
  }
}

// ---------------------------------------------------------------------------
// 16. Templates screen
// ---------------------------------------------------------------------------

function renderTemplatesGrid() {
  const grid = $('templates-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const registry = getTemplateList();
  if (!registry || registry.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-state-icon">&#128200;</div>
      <p>Șabloanele nu sunt disponibile momentan.</p>
    </div>`;
    return;
  }

  registry.forEach(tpl => {
    const card = document.createElement('div');
    card.className = 'template-card';
    card.setAttribute('role','listitem');

    // Mini preview area
    const previewWrap = document.createElement('div');
    previewWrap.className = 'template-card-preview';

    const shimmer = document.createElement('div');
    shimmer.className = 'template-card-preview-shimmer';
    previewWrap.appendChild(shimmer);

    // Lazy-load preview via IntersectionObserver
    let previewLoaded = false;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !previewLoaded) {
        previewLoaded = true;
        observer.disconnect();
        loadCardPreview(tpl.id, previewWrap, shimmer);
      }
    }, { rootMargin: '100px' });
    observer.observe(previewWrap);

    // Body
    const body = document.createElement('div');
    body.className = 'template-card-body';
    body.innerHTML = `
      <span class="template-card-badge">${escHtml(tpl.vertical || tpl.id)}</span>
      <div class="template-card-title">${escHtml(tpl.name)}</div>
      <div class="template-card-desc">${escHtml(tpl.description || '')}</div>
      <div class="template-card-actions">
        <button class="btn-primary btn-start-tpl" data-id="${escHtml(tpl.id)}" aria-label="Începe cu șablonul ${escHtml(tpl.name)}">Începe</button>
        <button class="btn-ghost btn-preview-tpl" data-id="${escHtml(tpl.id)}" aria-label="Vezi exemplu pentru ${escHtml(tpl.name)}">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><ellipse cx="8" cy="8" rx="7" ry="5" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/></svg>
          Exemplu
        </button>
      </div>`;

    body.querySelector('.btn-start-tpl').addEventListener('click', (e) => { e.stopPropagation(); startWithTemplate(tpl.id); });
    body.querySelector('.btn-preview-tpl').addEventListener('click', (e) => { e.stopPropagation(); openPreviewModal(tpl.id); });

    // Card click = start
    card.addEventListener('click', () => startWithTemplate(tpl.id));

    card.appendChild(previewWrap);
    card.appendChild(body);
    grid.appendChild(card);
  });
}

function loadCardPreview(templateId, wrap, shimmer) {
  const tplData = getTemplateById(templateId);
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
    iframe.title = 'Previzualizare șablon';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.addEventListener('load', () => shimmer.classList.add('loaded'));
    iframe.srcdoc = html;
    wrap.appendChild(iframe);
  } catch (_) {
    shimmer.classList.add('loaded');
  }
}

function startWithTemplate(templateId) {
  const tplData = getTemplateById(templateId);
  const registry = getTemplateList();
  const meta = registry.find(t => t.id === templateId);

  if (!tplData || !meta) {
    showToast('Șablonul nu a putut fi încărcat.', 'error');
    return;
  }

  currentSiteId = null;
  draft.templateId = templateId;

  const saved = loadDraft();
  if (saved && saved.templateId === templateId && saved.config) {
    draft.config = saved.config;
  } else {
    const presets = tplData.presets || [];
    draft.config = presets.length > 0 ? deepClone(presets[0].config) : {};
    saveDraft();
  }

  currentTemplate = { meta, data: tplData };
  previewFirstRender = false;

  const nameEl = $('editor-template-name');
  if (nameEl) nameEl.textContent = meta.name;

  renderWizard(tplData.schema, draft.config);

  window.location.hash = '#edit';
  schedulePreview();
}

function openPreviewModal(templateId) {
  const tplData = getTemplateById(templateId);
  const registry = getTemplateList();
  const meta = (registry || []).find(t => t.id === templateId) || {};

  const title = $('modal-preview-title');
  if (title) title.textContent = 'Previzualizare: ' + (meta.name || templateId);

  const iframe = $('preview-modal-iframe');

  if (!tplData || typeof window.HidookEngine === 'undefined') {
    if (iframe) iframe.srcdoc = '<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#9CA3AF;margin:0;font-size:.95rem">Previzualizare indisponibilă</body>';
    openModal('modal-preview');
    return;
  }

  try {
    const config = (tplData.presets || []).length > 0 ? tplData.presets[0].config : {};
    const html = window.HidookEngine.renderPreview(tplData.files, config);
    if (iframe) iframe.srcdoc = html;
  } catch (e) {
    if (iframe) iframe.srcdoc = '<body style="font-family:system-ui;padding:2rem;color:#9CA3AF">Eroare: ' + escHtml(e.message) + '</body>';
  }

  // Reset to desktop mode
  const body = $('modal-preview-body');
  const desktopBtn = $('modal-preview-desktop');
  const mobileBtn = $('modal-preview-mobile');
  if (body) body.classList.remove('mode-mobile');
  if (desktopBtn) { desktopBtn.classList.add('active'); desktopBtn.setAttribute('aria-pressed','true'); }
  if (mobileBtn)  { mobileBtn.classList.remove('active'); mobileBtn.setAttribute('aria-pressed','false'); }

  openModal('modal-preview');
}

// ---------------------------------------------------------------------------
// 17. Dashboard
// ---------------------------------------------------------------------------

async function loadDashboard() {
  const list = $('sites-list');
  if (!list) return;
  list.innerHTML = '<p style="color:var(--text-muted);padding:1rem 0;font-size:.9rem">Se încarcă proiectele...</p>';

  try {
    const data = await apiGet('/api/sites');
    const sites = data.sites || [];

    if (sites.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#128203;</div>
          <p>Nu ai site-uri create încă.</p>
          <a href="#templates" class="btn-primary">Creează primul tău site</a>
        </div>`;
      return;
    }

    list.innerHTML = '';
    sites.forEach(site => {
      list.appendChild(buildSiteCard(site));
    });
  } catch (e) {
    if (e.status === 401) {
      list.innerHTML = `<div class="empty-state"><p>Trebuie să te autentifici pentru a vedea proiectele.</p></div>`;
    } else {
      list.innerHTML = `<div class="empty-state"><p>Eroare la încărcare: ${escHtml(e.message)}</p></div>`;
    }
  }
}

function buildSiteCard(site) {
  const card = document.createElement('div');
  card.className = 'site-card';

  // Mini preview
  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'site-card-preview-thumb';
  const tplData = site.templateId ? getTemplateById(site.templateId) : null;
  if (tplData && typeof window.HidookEngine !== 'undefined') {
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
  }

  // Badge + trial info
  const now = Date.now();
  const trialEnd = site.trialEndsAt ? new Date(site.trialEndsAt) : null;
  const remaining = trialEnd ? (trialEnd - now) : null;
  let badgeClass = 'status-draft', badgeLabel = 'Ciornă';

  if (site.status === 'live' || site.status === 'active') {
    if (site.paid) {
      badgeClass = 'status-live'; badgeLabel = 'Activ';
    } else if (remaining != null && remaining > 0) {
      badgeClass = 'status-trial'; badgeLabel = 'Probă';
    } else {
      badgeClass = 'status-expired'; badgeLabel = 'Expirat';
    }
  } else if (site.status === 'expired') {
    badgeClass = 'status-expired'; badgeLabel = 'Expirat';
  } else if (site.status === 'needs-retry') {
    badgeClass = 'status-draft'; badgeLabel = 'Reîncearcă';
  }

  // Info
  const info = document.createElement('div');
  info.className = 'site-card-info';

  const name = document.createElement('div');
  name.className = 'site-card-name';
  name.textContent = site.projectName || site.slug || site.id;

  const meta = document.createElement('div');
  meta.className = 'site-card-meta';

  const badge = document.createElement('span');
  badge.className = 'status-badge ' + badgeClass;
  badge.textContent = badgeLabel;
  meta.appendChild(badge);

  if (remaining != null && remaining > 0 && !site.paid) {
    const countdown = document.createElement('span');
    countdown.className = 'trial-time';
    countdown.textContent = 'expiră în ' + fmtTimeRemaining(remaining);
    meta.appendChild(countdown);
  }

  if (site.url) {
    const link = document.createElement('a');
    link.className = 'site-live-link';
    link.href = site.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = site.url;
    link.addEventListener('click', e => e.stopPropagation());
    meta.appendChild(link);
  }

  info.appendChild(name);
  info.appendChild(meta);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'site-card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-ghost btn-sm';
  editBtn.textContent = 'Editează';
  editBtn.setAttribute('aria-label', 'Editează site-ul ' + (site.projectName || site.slug || ''));
  editBtn.addEventListener('click', () => loadSiteForEdit(site.id));
  actions.appendChild(editBtn);

  // Keep/reactivate button
  if (!site.paid || site.status === 'expired') {
    const keepBtn = document.createElement('button');
    keepBtn.className = 'btn-primary btn-sm';
    keepBtn.textContent = site.status === 'expired' ? 'Reactivează' : 'Păstrează';
    keepBtn.setAttribute('aria-label', (site.status === 'expired' ? 'Reactivează' : 'Păstrează') + ' site-ul');
    keepBtn.addEventListener('click', async () => {
      try {
        setBtnLoading(keepBtn, true, 'Se procesează...');
        const data = await apiPost('/api/sites/' + encodeURIComponent(site.id) + '/checkout', {});
        if (data.paymentUrl) window.location.href = data.paymentUrl;
      } catch (e) {
        showToast('Eroare: ' + e.message, 'error');
      } finally {
        setBtnLoading(keepBtn, false);
      }
    });
    actions.appendChild(keepBtn);
  }

  const versBtn = document.createElement('button');
  versBtn.className = 'btn-ghost btn-sm';
  versBtn.textContent = 'Istoric';
  versBtn.setAttribute('aria-label', 'Istoricul versiunilor pentru ' + (site.projectName || site.slug || ''));
  versBtn.addEventListener('click', () => loadVersions(site.id));
  actions.appendChild(versBtn);

  card.appendChild(thumbWrap);
  card.appendChild(info);
  card.appendChild(actions);
  return card;
}

async function loadSiteForEdit(siteId) {
  try {
    setLoading(true, 'Se încarcă site-ul...');
    const data = await apiGet('/api/sites/' + encodeURIComponent(siteId));
    const site = data.site;
    const config = data.config;
    if (!site || !config) throw new Error('Date incomplete de la server.');

    currentSiteId = site.id;
    draft.templateId = site.templateId;
    draft.config = deepClone(config);

    const tplData = getTemplateById(site.templateId);
    const registry = getTemplateList();
    const meta = registry.find(t => t.id === site.templateId) || { id: site.templateId, name: site.templateId, description: '' };
    currentTemplate = { meta, data: tplData };

    if (tplData) renderWizard(tplData.schema, draft.config);
    const nameEl = $('editor-template-name');
    if (nameEl) nameEl.textContent = meta.name;

    window.location.hash = '#edit';
    schedulePreview();
  } catch (e) {
    showToast('Eroare la încărcarea site-ului: ' + e.message, 'error');
  } finally {
    setLoading(false);
  }
}

async function loadVersions(siteId) {
  const list = $('versions-list');
  if (list) list.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0">Se încarcă...</p>';
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
    versions.forEach(v => {
      const item = document.createElement('div');
      item.className = 'version-item';
      const d = new Date(v.publishedAt);
      const dateStr = d.toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' });
      item.innerHTML = `
        <span class="version-date">${escHtml(dateStr)}</span>
        <span style="font-size:.76rem;color:var(--text-light);flex:1;padding:0 .5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(v.versionId.slice(0,8))}</span>
        <button class="btn-ghost btn-sm btn-rollback" data-siteid="${escHtml(siteId)}" data-verid="${escHtml(v.versionId)}">Restaurează</button>`;
      item.querySelector('.btn-rollback').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        setBtnLoading(btn, true, 'Se restaurează...');
        try {
          await apiPost('/api/sites/' + encodeURIComponent(siteId) + '/rollback', { versionId: v.versionId });
          showToast('Versiune restaurată cu succes!', 'success');
          closeModal('modal-versions');
        } catch (err) {
          showToast('Eroare la restaurare: ' + err.message, 'error');
          setBtnLoading(btn, false);
        }
      });
      list.appendChild(item);
    });
  } catch (e) {
    if (list) list.innerHTML = `<p style="color:var(--error);font-size:.85rem">${escHtml(e.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// 18. Preview device toggle
// ---------------------------------------------------------------------------

function setPreviewMode(mode) {
  const wrap = $('preview-iframe-wrap');
  const iframe = $('preview-iframe-desktop');
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
// 19. Router
// ---------------------------------------------------------------------------

const screens = ['templates', 'edit', 'dashboard'];

function showScreen(name) {
  screens.forEach(s => {
    const el = $('screen-' + s);
    if (el) el.style.display = s === name ? '' : 'none';
  });
  document.querySelectorAll('[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === name);
  });
}

async function handleRoute(hash) {
  const route = (hash || '').replace('#','') || 'templates';

  if (route === 'templates') {
    showScreen('templates');
    renderTemplatesGrid();
  } else if (route === 'edit') {
    if (!draft.templateId) { window.location.hash = '#templates'; return; }
    showScreen('edit');
    schedulePreview();
  } else if (route === 'dashboard') {
    showScreen('dashboard');
    const user = await fetchCurrentUser().catch(() => null);
    updateUserUI(user);
    if (user) loadDashboard();
    else $('sites-list').innerHTML = '<div class="empty-state"><p>Trebuie să te autentifici pentru a vedea proiectele.</p></div>';
  } else if (route === 'platit') {
    showToast('Plata a fost procesată! Site-ul tău va fi publicat în câteva momente.', 'success', 6000);
    window.location.hash = '#dashboard';
  } else if (route === 'anulat') {
    showToast('Plata a fost anulată.', '', 4000);
    window.location.hash = '#edit';
  } else if (route === 'login-expirat') {
    showToast('Linkul de autentificare a expirat. Încearcă din nou.', 'error', 5000);
    window.location.hash = '#templates';
  } else {
    showScreen('templates');
    renderTemplatesGrid();
  }
}

// ---------------------------------------------------------------------------
// 20. Mobile tabs wiring
// ---------------------------------------------------------------------------

function wireMobileTabs() {
  const editTab = $('mob-tab-edit');
  const previewTab = $('mob-tab-preview');
  const formPanel = $('wizard-steps-wrap');
  const previewPanel = $('preview-panel-mobile');
  const wizardFooter = $('wizard-footer');
  const mobileTabs = $('editor-form-panel');

  function switchTab(which) {
    if (which === 'edit') {
      editTab.classList.add('active'); editTab.setAttribute('aria-selected','true');
      previewTab.classList.remove('active'); previewTab.setAttribute('aria-selected','false');
      if (formPanel) show(formPanel);
      if (wizardFooter) show(wizardFooter);
      if (previewPanel) hide(previewPanel);
    } else {
      previewTab.classList.add('active'); previewTab.setAttribute('aria-selected','true');
      editTab.classList.remove('active'); editTab.setAttribute('aria-selected','false');
      if (formPanel) hide(formPanel);
      if (wizardFooter) hide(wizardFooter);
      if (previewPanel) {
        show(previewPanel);
        // Render into mobile iframe
        const mobileIframe = $('preview-iframe-mobile');
        const desktopIframe = $('preview-iframe-desktop');
        if (mobileIframe && desktopIframe && desktopIframe.srcdoc) {
          mobileIframe.srcdoc = desktopIframe.srcdoc;
        } else {
          renderPreview();
        }
      }
    }
  }

  if (editTab) editTab.addEventListener('click', () => switchTab('edit'));
  if (previewTab) previewTab.addEventListener('click', () => switchTab('preview'));
}

// ---------------------------------------------------------------------------
// 21. Static button wiring
// ---------------------------------------------------------------------------

function wireStaticButtons() {
  // Back to templates
  const backBtn = $('btn-back-templates');
  if (backBtn) backBtn.addEventListener('click', () => { window.location.hash = '#templates'; });

  // Wizard step nav
  const nextBtn = $('btn-step-next');
  if (nextBtn) nextBtn.addEventListener('click', nextStep);
  const prevBtn = $('btn-step-back');
  if (prevBtn) prevBtn.addEventListener('click', prevStep);

  // Preview device toggle
  const desktopBtn = $('btn-preview-desktop');
  const mobileBtn  = $('btn-preview-mobile');
  if (desktopBtn) desktopBtn.addEventListener('click', () => setPreviewMode('desktop'));
  if (mobileBtn)  mobileBtn.addEventListener('click',  () => setPreviewMode('mobile'));

  // Fullscreen preview
  const fsBtn = $('btn-preview-fullscreen');
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (!currentTemplate) return;
      openPreviewModal(draft.templateId);
      // Override iframe with current live preview
      const iframe = $('preview-modal-iframe');
      const src = $('preview-iframe-desktop');
      if (iframe && src && src.srcdoc) iframe.srcdoc = src.srcdoc;
      const title = $('modal-preview-title');
      if (title && currentTemplate && currentTemplate.meta) title.textContent = currentTemplate.meta.name;
    });
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

  // Logout
  const logoutBtn = $('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method:'POST', credentials:'include' }); } catch (_) {}
      updateUserUI(null);
      showToast('Ai ieșit din cont.', '', 3000);
      window.location.hash = '#templates';
    });
  }

  // Modal closes
  function wireModalClose(btnId, modalId) {
    const btn = $(btnId);
    if (btn) btn.addEventListener('click', () => closeModal(modalId));
  }
  wireModalClose('btn-close-publish',  'modal-publish');
  wireModalClose('btn-close-preview',  'modal-preview');
  wireModalClose('btn-close-success',  'modal-success');
  wireModalClose('btn-close-versions', 'modal-versions');
  const successCloseBtn = $('btn-success-close');
  if (successCloseBtn) successCloseBtn.addEventListener('click', () => closeModal('modal-success'));

  // Close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    });
  });

  // Escape closes all modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['modal-publish','modal-preview','modal-success','modal-versions'].forEach(id => {
        const el = $(id);
        if (el && el.style.display !== 'none') el.style.display = 'none';
      });
    }
  });

  // Wire publish modal (slug input, continue btn, copy btn)
  wirePublishModal();
  // Wire mobile tabs
  wireMobileTabs();
}

// ---------------------------------------------------------------------------
// 22. Bootstrap
// ---------------------------------------------------------------------------

async function boot() {
  setLoading(true, 'Se încarcă...');
  try {
    wireStaticButtons();
    tryTelegramAuth();

    // Fetch config + user in parallel
    const [user] = await Promise.all([
      fetchCurrentUser().catch(() => null),
      fetchAppConfig(),
    ]);
    updateUserUI(user);

    window.addEventListener('hashchange', () => handleRoute(window.location.hash));
    await handleRoute(window.location.hash);
  } catch (e) {
    console.error('Boot error:', e);
    showToast('Eroare la inițializare. Reîncarcă pagina.', 'error', 8000);
  } finally {
    setLoading(false);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
