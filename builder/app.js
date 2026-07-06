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

/** @type {{ templateId: string|null, config: object|null }} */
const draft = { templateId: null, config: null };

/** Current logged-in user, null if not authenticated */
let currentUser = null;

/** Current site being edited (loaded from /api/sites/:id) */
let currentSiteId = null;

/** Currently active template metadata */
let currentTemplate = null;

/** Preview debounce timer */
let previewTimer = null;

// ---------------------------------------------------------------------------
// 2. Helpers — DOM
// ---------------------------------------------------------------------------

function $(id) { return document.getElementById(id); }

function show(el) { if (el) el.style.display = ''; }
function hide(el) { if (el) el.style.display = 'none'; }

/** Show/hide by id */
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
    setTimeout(() => { if (overlay.classList.contains('hidden')) overlay.style.display = 'none'; }, 200);
  }
}

let toastTimer = null;
function showToast(msg, type /* 'error'|'success'|'' */, durationMs = 3500) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (type ? ' toast-' + type : '');
  t.style.display = '';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, durationMs);
}

function openModal(id) {
  const el = $(id);
  if (el) el.style.display = '';
}
function closeModal(id) {
  const el = $(id);
  if (el) el.style.display = 'none';
}

// ---------------------------------------------------------------------------
// 3. Helpers — data
// ---------------------------------------------------------------------------

/** Resolve dot-path like "contact.instagram.url" in an object. Returns undefined if missing. */
function getPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, k) => {
    if (acc == null) return undefined;
    // Support array indexing like categories[0].photos
    const m = k.match(/^([^\[]+)\[(\d+)\]$/);
    if (m) return (acc[m[1]] || [])[Number(m[2])];
    return acc[k];
  }, obj);
}

/** Set value at dot-path (supports categories[0].photos). Creates objects/arrays as needed. */
function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const m = k.match(/^([^\[]+)\[(\d+)\]$/);
    if (m) {
      const arrKey = m[1];
      const idx = Number(m[2]);
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
    const arrKey = m[1];
    const idx = Number(m[2]);
    if (!Array.isArray(cur[arrKey])) cur[arrKey] = [];
    while (cur[arrKey].length <= idx) cur[arrKey].push({});
    cur[arrKey][idx] = value;
  } else {
    cur[last] = value;
  }
}

/** Deep clone (no circular refs) */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Safe localStorage read */
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
}
/** Safe localStorage write with quota guard */
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (e.name === 'QuotaExceededError' || (e.code && e.code === 22)) {
      showToast('Proiectul conține imagini mari — nu a putut fi salvat ca draft. Publică înainte de a închide pagina.', 'error', 7000);
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. Helpers — HSL color manipulation
// ---------------------------------------------------------------------------

/** Parse #RRGGBB or #RGB -> { h, s, l } */
function hexToHsl(hex) {
  hex = hex.replace('#', '');
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
  const f = n => l - a*Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)));
  const toH = x => Math.round(x*255).toString(16).padStart(2,'0');
  return '#' + toH(f(0)) + toH(f(8)) + toH(f(4));
}

function deriveColors(primaryHex) {
  const hsl = hexToHsl(primaryHex);
  const light = hslToHex(hsl.h, Math.min(hsl.s + 5, 100), Math.min(hsl.l + 12, 95));
  const dark  = hslToHex(hsl.h, Math.min(hsl.s + 5, 100), Math.max(hsl.l - 12, 5));
  return { primaryLight: light, primaryDark: dark };
}

// ---------------------------------------------------------------------------
// 5. Template data access
// ---------------------------------------------------------------------------

function getTemplateData() {
  if (typeof window.HIDOOK_TEMPLATES !== 'undefined') return window.HIDOOK_TEMPLATES;
  return null;
}

function getTemplateList() {
  const d = getTemplateData();
  if (!d) return [];
  // Support both: array (future) and { templates: [...] } object
  if (Array.isArray(d.registry)) return d.registry;
  if (d.registry && Array.isArray(d.registry.templates)) return d.registry.templates;
  return [];
}

function getTemplateById(id) {
  const d = getTemplateData();
  if (!d || !d.templates) return null;
  return d.templates[id] || null;
}

// ---------------------------------------------------------------------------
// 6. Preview rendering
// ---------------------------------------------------------------------------

function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 250);
}

function renderPreview() {
  if (!draft.config || !draft.templateId) return;
  const tpl = getTemplateById(draft.templateId);
  if (!tpl || typeof window.HidookEngine === 'undefined') {
    // No engine available — show placeholder
    const msg = '<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#888;font-size:0.95rem;margin:0;">Motorul de previzualizare nu este disponibil</body>';
    setIframeSrcdoc('preview-iframe-desktop', msg);
    setIframeSrcdoc('preview-iframe-mobile', msg);
    return;
  }
  try {
    const html = window.HidookEngine.renderPreview(tpl.files, draft.config);
    setIframeSrcdoc('preview-iframe-desktop', html);
    setIframeSrcdoc('preview-iframe-mobile', html);
    const status = $('preview-status');
    if (status) status.textContent = 'Actualizat ' + new Date().toLocaleTimeString('ro-RO', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  } catch (e) {
    console.warn('renderPreview error:', e);
  }
}

function setIframeSrcdoc(id, html) {
  const iframe = $(id);
  if (!iframe) return;
  iframe.srcdoc = html;
}

// ---------------------------------------------------------------------------
// 7. Draft persistence
// ---------------------------------------------------------------------------

function saveDraft() {
  if (!draft.templateId || !draft.config) return;
  lsSet(DRAFT_KEY, { templateId: draft.templateId, config: draft.config });
}

function loadDraft() {
  return lsGet(DRAFT_KEY);
}

// ---------------------------------------------------------------------------
// 8. Form generation from schema
// ---------------------------------------------------------------------------

function buildForm(schema, initialConfig) {
  const form = $('editor-form');
  if (!form) return;
  form.innerHTML = '';

  const sections = (schema && schema.sections) ? schema.sections : [];
  const isFirstSection = true;

  sections.forEach((section, secIdx) => {
    const div = document.createElement('div');
    div.className = 'form-section' + (secIdx === 0 ? ' open' : '');
    div.innerHTML = `
      <div class="form-section-header" role="button" tabindex="0" aria-expanded="${secIdx === 0}" aria-controls="sec-body-${secIdx}">
        <span class="section-title">${escHtml(section.title || section.id)}</span>
        <span class="section-chevron" aria-hidden="true">&#9660;</span>
      </div>
      <div class="form-section-body" id="sec-body-${secIdx}">
      </div>
    `;
    const header = div.querySelector('.form-section-header');
    const body = div.querySelector('.form-section-body');
    header.addEventListener('click', () => {
      const open = div.classList.toggle('open');
      header.setAttribute('aria-expanded', open);
    });
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click(); }
    });

    (section.fields || []).forEach(field => {
      const fg = buildFieldGroup(field, initialConfig);
      if (fg) body.appendChild(fg);
    });

    form.appendChild(div);
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function buildFieldGroup(field, config) {
  const key = field.key;
  const type = field.type;
  const label = field.label || key;
  const required = field.required;
  const maxLen = field.maxLen;

  const wrap = document.createElement('div');
  wrap.className = 'field-group';

  if (type === 'color') {
    return buildColorField(field, config, wrap);
  }
  if (type === 'list') {
    return buildListField(field, config, wrap);
  }
  if (type === 'photos') {
    return buildPhotosField(field, config, wrap);
  }

  // text / phone / url / textarea
  const labelEl = document.createElement('label');
  labelEl.className = 'field-label';
  const safeId = 'f_' + key.replace(/[^a-zA-Z0-9]/g,'_');
  labelEl.setAttribute('for', safeId);
  labelEl.innerHTML = escHtml(label) + (required ? '<span class="required" aria-hidden="true">*</span>' : '');
  wrap.appendChild(labelEl);

  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
    input.className = 'field-textarea';
    if (maxLen) input.maxLength = maxLen;
    input.rows = 3;
  } else {
    input = document.createElement('input');
    input.className = 'field-input';
    input.type = type === 'phone' ? 'tel' : (type === 'url' ? 'url' : 'text');
    if (maxLen) input.maxLength = maxLen;
  }
  input.id = safeId;
  input.name = key;
  if (required) input.required = true;
  const curVal = getPath(config, key);
  if (curVal != null && typeof curVal !== 'object') input.value = String(curVal);

  input.addEventListener('input', () => {
    setPath(draft.config, key, input.value);
    saveDraft();
    schedulePreview();
  });

  wrap.appendChild(input);
  return wrap;
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
  const curVal = getPath(config, key);
  if (curVal) swatch.value = curVal;

  const textInput = document.createElement('input');
  textInput.className = 'field-input';
  textInput.type = 'text';
  textInput.maxLength = 7;
  textInput.placeholder = '#RRGGBB';
  textInput.setAttribute('aria-label', label + ' (hex)');
  if (curVal) textInput.value = curVal;

  const syncFromSwatch = () => {
    const v = swatch.value;
    textInput.value = v;
    setPath(draft.config, key, v);
    // Auto-derive light/dark when primary changes
    if (key === 'theme.primary') {
      const derived = deriveColors(v);
      setPath(draft.config, 'theme.primaryLight', derived.primaryLight);
      setPath(draft.config, 'theme.primaryDark', derived.primaryDark);
      // Update sibling swatches
      const lightInput = document.getElementById('f_theme_primaryLight');
      const darkInput  = document.getElementById('f_theme_primaryDark');
      const lightText  = document.querySelector('[name="theme.primaryLight"]');
      const darkText   = document.querySelector('[name="theme.primaryDark"]');
      if (lightInput) { lightInput.value = derived.primaryLight; }
      if (darkInput)  { darkInput.value  = derived.primaryDark; }
      if (lightText)  { lightText.value  = derived.primaryLight; }
      if (darkText)   { darkText.value   = derived.primaryDark; }
    }
    saveDraft();
    schedulePreview();
  };

  swatch.addEventListener('input', syncFromSwatch);

  textInput.name = key;
  textInput.addEventListener('input', () => {
    const v = textInput.value;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      swatch.value = v;
      syncFromSwatch();
    } else {
      setPath(draft.config, key, v);
      saveDraft();
      schedulePreview();
    }
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

      // Remove button
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-list-remove';
      delBtn.setAttribute('aria-label', 'Șterge elementul ' + (idx+1));
      delBtn.innerHTML = '&times;';
      delBtn.addEventListener('click', () => {
        items.splice(idx, 1);
        setPath(draft.config, key, deepClone(items));
        saveDraft();
        schedulePreview();
        renderItems();
      });

      if (typeof itemShape === 'string' && itemShape === 'text') {
        // Simple string list
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
          saveDraft();
          schedulePreview();
        });
        row.appendChild(inp);
        row.appendChild(delBtn);
        itemDiv.appendChild(row);
      } else if (typeof itemShape === 'object' && itemShape !== null) {
        // Object: render each subfield
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
          const subId = `li_${idx}_${subKey}`;
          subLabel.setAttribute('for', subId);
          subLabel.textContent = subKey;
          subWrap.appendChild(subLabel);

          if (subType === 'photos') {
            // Inline photos for list item
            const photoField = buildPhotosInlineField(subKey, item, idx, key, items);
            subWrap.appendChild(photoField);
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
              saveDraft();
              schedulePreview();
            });
            subWrap.appendChild(inp);
          }

          itemDiv.appendChild(subWrap);
        });
      }

      listContainer.appendChild(itemDiv);
    });

    // Disable add button when at max
    addBtn.disabled = items.length >= maxItems;
    addBtn.title = items.length >= maxItems ? `Maxim ${maxItems} elemente` : '';
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
    saveDraft();
    schedulePreview();
    renderItems();
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
      img.src = src;
      img.alt = 'Fotografie ' + (pi+1);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'photo-thumb-del';
      del.setAttribute('aria-label', 'Șterge fotografia ' + (pi+1));
      del.innerHTML = '&times;';
      del.addEventListener('click', () => {
        photos.splice(pi, 1);
        item[subKey] = photos;
        items[itemIdx] = item;
        setPath(draft.config, parentKey, deepClone(items));
        saveDraft();
        schedulePreview();
        renderThumbs();
      });
      div.appendChild(img);
      div.appendChild(del);
      thumbs.appendChild(div);
    });
  }

  renderThumbs();

  const addLabel = document.createElement('label');
  addLabel.className = 'photos-add-label';
  addLabel.setAttribute('aria-label', 'Adaugă fotografii');
  addLabel.innerHTML = '+ Fotografii <input type="file" multiple accept="image/jpeg,image/png,image/webp" />';
  const fileInput = addLabel.querySelector('input[type=file]');
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files);
    for (const file of files) {
      const dataUrl = await resizeImageToDataUrl(file, 1600, 0.82);
      if (!Array.isArray(item[subKey])) item[subKey] = [];
      item[subKey].push({ src: dataUrl, alt: file.name.replace(/\.[^.]+$/, '') });
      items[itemIdx] = item;
      setPath(draft.config, parentKey, deepClone(items));
      saveDraft();
      schedulePreview();
    }
    renderThumbs();
    fileInput.value = '';
  });

  photosWrap.appendChild(thumbs);
  photosWrap.appendChild(addLabel);
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

  const container = document.createElement('div');
  container.className = 'photos-container';

  const thumbs = document.createElement('div');
  thumbs.className = 'photos-thumbs';

  function renderThumbs() {
    thumbs.innerHTML = '';
    const photos = getPath(draft.config, key);
    if (!Array.isArray(photos)) return;
    photos.forEach((p, idx) => {
      const src = typeof p === 'string' ? p : (p && p.src);
      if (!src) return;
      const div = document.createElement('div');
      div.className = 'photo-thumb';
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'Fotografie ' + (idx+1);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'photo-thumb-del';
      del.setAttribute('aria-label', 'Șterge fotografia ' + (idx+1));
      del.innerHTML = '&times;';
      del.addEventListener('click', () => {
        const arr = getPath(draft.config, key) || [];
        arr.splice(idx, 1);
        setPath(draft.config, key, arr);
        saveDraft();
        schedulePreview();
        renderThumbs();
      });
      div.appendChild(img);
      div.appendChild(del);
      thumbs.appendChild(div);
    });
  }

  const addLabel = document.createElement('label');
  addLabel.className = 'photos-add-label';
  addLabel.setAttribute('aria-label', 'Adaugă fotografii');
  addLabel.innerHTML = '+ Adaugă fotografii <input type="file" multiple accept="image/jpeg,image/png,image/webp" />';
  const fileInput = addLabel.querySelector('input[type=file]');

  fileInput.addEventListener('change', async () => {
    const existing = getPath(draft.config, key) || [];
    const remaining = maxPhotos - existing.length;
    if (remaining <= 0) {
      showToast(`Maxim ${maxPhotos} fotografii permise.`, 'error');
      fileInput.value = '';
      return;
    }
    const files = Array.from(fileInput.files).slice(0, remaining);
    for (const file of files) {
      const dataUrl = await resizeImageToDataUrl(file, 1600, 0.82);
      existing.push({ src: dataUrl, alt: file.name.replace(/\.[^.]+$/, '') });
    }
    setPath(draft.config, key, existing);
    saveDraft();
    schedulePreview();
    renderThumbs();
    fileInput.value = '';
  });

  renderThumbs();
  container.appendChild(thumbs);
  container.appendChild(addLabel);
  wrap.appendChild(container);
  return wrap;
}

// ---------------------------------------------------------------------------
// 9. Image resize on canvas
// ---------------------------------------------------------------------------

/**
 * Resize an image File to max dimension and return as dataURL (JPEG).
 * @param {File} file
 * @param {number} maxPx — longest side in px
 * @param {number} quality — JPEG quality 0..1
 * @returns {Promise<string>} dataURL
 */
function resizeImageToDataUrl(file, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxPx || h > maxPx) {
        const ratio = Math.min(maxPx/w, maxPx/h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Eroare la citirea imaginii')); };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// 10. API calls
// ---------------------------------------------------------------------------

async function apiGet(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) {
    const json = await r.json().catch(() => ({}));
    throw Object.assign(new Error(json.error || 'Eroare server'), { status: r.status });
  }
  return r.json();
}

async function apiPost(url, body, opts) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(opts || {}),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(json.error || 'Eroare server'), { status: r.status });
  return json;
}

// ---------------------------------------------------------------------------
// 11. Auth
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
    if (badge) { badge.textContent = user.email || ('ID: ' + user.id.slice(0, 8)); show(badge); }
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
  // Auto auth via Telegram Mini App
  apiPost('/api/auth/telegram', { initData: twa.initData })
    .then(data => {
      if (data.ok) updateUserUI(data.user);
    })
    .catch(e => console.warn('Telegram auth failed:', e.message));
}

async function sendMagicLink(email) {
  return apiPost('/api/auth/email', { email });
}

// ---------------------------------------------------------------------------
// 12. Publish flow
// ---------------------------------------------------------------------------

/**
 * Extract images from config (find all dataURL values) and return
 * { cleanConfig, images: [{name, dataUrl}] }
 */
function extractImages(config, templateId) {
  const images = [];
  const clean = deepClone(config);

  function walk(obj, parentKey) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, parentKey + '[' + i + ']'));
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.startsWith('data:image/')) {
        // Determine name
        let name;
        if (k === 'src' || k === 'logo') {
          // Try to infer name from context
          if (parentKey.includes('logo') || k === 'logo') {
            name = 'logo';
          } else {
            // gallery-N
            const n = images.filter(x => x.name.startsWith('gallery')).length + 1;
            name = 'gallery-' + n;
          }
          images.push({ name, dataUrl: v });
          obj[k] = 'images/' + (name === 'logo' ? 'logo.jpg' : name + '.jpg');
        }
      } else {
        walk(v, parentKey ? parentKey + '.' + k : k);
      }
    }
  }

  walk(clean, '');
  return { cleanConfig: clean, images };
}

async function doPublish() {
  const btn = $('btn-publish');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('loading');
  }

  try {
    // Check auth
    if (!currentUser) {
      const user = await fetchCurrentUser();
      updateUserUI(user);
    }

    if (!currentUser) {
      // Need auth — open modal
      openAuthModalForPublish();
      return;
    }

    // Build payload
    const { cleanConfig, images } = extractImages(draft.config, draft.templateId);

    const payload = {
      templateId: draft.templateId,
      config: cleanConfig,
      images,
    };
    if (currentSiteId) payload.siteId = currentSiteId;

    const data = await apiPost('/api/publish', payload);

    if (data.paymentUrl) {
      // Redirect to Stripe checkout
      window.location.href = data.paymentUrl;
      return;
    }

    if (data.site && data.site.url) {
      // Success!
      currentSiteId = data.site.id;
      showSuccessModal(data.site.url);
      return;
    }

    showToast('Răspuns neașteptat de la server.', 'error');

  } catch (e) {
    showToast(e.message || 'Eroare la publicare. Încearcă din nou.', 'error', 5000);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  }
}

/** Open auth modal. After auth resolved, retrigger publish. */
function openAuthModalForPublish() {
  const form = $('form-auth-email');
  const sentDiv = $('auth-sent');
  const errorDiv = $('auth-error');
  const devLink = $('dev-link');
  if (form) show(form);
  if (sentDiv) hide(sentDiv);
  if (errorDiv) hide(errorDiv);
  openModal('modal-auth');

  // One-shot submit handler
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
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Se trimite...'; }
      if (errorDiv) hide(errorDiv);
      try {
        const res = await sendMagicLink(email);
        if (form) hide(form);
        if (sentDiv) show(sentDiv);
        if (res.devLink && devLink) {
          devLink.href = res.devLink;
          devLink.textContent = 'Link de dezvoltare (testare): ' + res.devLink;
          show(devLink);
        }
      } catch (err) {
        if (errorDiv) { errorDiv.textContent = err.message || 'Eroare la trimitere. Încearcă din nou.'; show(errorDiv); }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Trimite link magic'; }
      }
    };
  }
}

function showSuccessModal(url) {
  const urlText = $('success-url-text');
  const urlLink = $('success-url-link');
  if (urlText) urlText.textContent = url;
  if (urlLink) { urlLink.href = url; urlLink.textContent = 'Deschide site-ul →'; }
  openModal('modal-success');
}

// ---------------------------------------------------------------------------
// 13. Dashboard
// ---------------------------------------------------------------------------

async function loadDashboard() {
  const list = $('sites-list');
  if (!list) return;
  list.innerHTML = '<p class="empty-state" style="padding:1.5rem">Se încarcă proiectele...</p>';

  try {
    const data = await apiGet('/api/sites');
    const sites = data.sites || [];

    if (sites.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#128196;</div>
          <p>Nu ai site-uri create încă.</p>
          <a href="#templates" class="btn-primary">Creează primul tău site</a>
        </div>`;
      return;
    }

    list.innerHTML = '';
    sites.forEach(site => {
      const card = document.createElement('div');
      card.className = 'site-card';

      const statusMap = { live: 'live', draft: 'draft', 'needs-retry': 'pending', pending: 'pending' };
      const statusLabel = { live: 'Online', draft: 'Ciornă', 'needs-retry': 'Reîncearcă', pending: 'În așteptare' };
      const st = statusMap[site.status] || 'draft';
      const stLabel = statusLabel[site.status] || site.status;

      card.innerHTML = `
        <div class="site-card-info">
          <div class="site-card-name">${escHtml(site.projectName || site.slug || site.id)}</div>
          <div class="site-card-meta">
            <span class="status-badge status-${st}">${escHtml(stLabel)}</span>
            ${site.url ? `<a href="${escHtml(site.url)}" target="_blank" rel="noopener noreferrer" class="site-live-link">${escHtml(site.url)}</a>` : ''}
          </div>
        </div>
        <div class="site-card-actions">
          <button class="btn-ghost btn-sm btn-edit-site" data-id="${escHtml(site.id)}">Editează</button>
          <button class="btn-ghost btn-sm btn-versions-site" data-id="${escHtml(site.id)}">Istoric</button>
        </div>`;

      card.querySelector('.btn-edit-site').addEventListener('click', () => {
        loadSiteForEdit(site.id);
      });
      card.querySelector('.btn-versions-site').addEventListener('click', () => {
        loadVersions(site.id);
      });

      list.appendChild(card);
    });
  } catch (e) {
    if (e.status === 401) {
      list.innerHTML = `<div class="empty-state"><p>Trebuie să te autentifici pentru a vedea proiectele.</p></div>`;
    } else {
      list.innerHTML = `<div class="empty-state"><p>Eroare la încărcare: ${escHtml(e.message)}</p></div>`;
    }
  }
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

    // Find template
    const tplData = getTemplateById(site.templateId);
    const registry = getTemplateList();
    const meta = registry.find(t => t.id === site.templateId) || { id: site.templateId, name: site.templateId, description: '' };
    currentTemplate = { meta, data: tplData };

    if (tplData) {
      buildForm(tplData.schema, draft.config);
    }
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
  if (list) list.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">Se încarcă...</p>';
  const title = $('modal-versions-title');
  if (title) title.textContent = 'Istoricul versiunilor';
  openModal('modal-versions');

  try {
    const data = await apiGet('/api/sites/' + encodeURIComponent(siteId) + '/versions');
    const versions = data.versions || [];

    if (!list) return;
    if (versions.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1rem">Nu există versiuni salvate.</p>';
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
        <span style="font-size:.78rem;color:var(--text-muted);flex:1;padding:0 .5rem">${escHtml(v.versionId.slice(0, 8))}</span>
        <button class="btn-ghost btn-sm btn-rollback" data-siteid="${escHtml(siteId)}" data-verid="${escHtml(v.versionId)}">Restaurează</button>`;
      item.querySelector('.btn-rollback').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Se restaurează...';
        try {
          await apiPost('/api/sites/' + encodeURIComponent(siteId) + '/rollback', { versionId: v.versionId });
          showToast('Versiune restaurată cu succes!', 'success');
          closeModal('modal-versions');
        } catch (err) {
          showToast('Eroare la restaurare: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Restaurează';
        }
      });
      list.appendChild(item);
    });
  } catch (e) {
    if (list) list.innerHTML = `<p style="color:var(--error);font-size:.85rem">${escHtml(e.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// 14. Templates screen
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
    card.setAttribute('role', 'listitem');

    card.innerHTML = `
      <span class="template-card-badge">${escHtml(tpl.vertical || tpl.id)}</span>
      <div class="template-card-title">${escHtml(tpl.name)}</div>
      <div class="template-card-desc">${escHtml(tpl.description || '')}</div>
      <div class="template-card-actions">
        <button class="btn-primary btn-start-tpl" data-id="${escHtml(tpl.id)}">Începe cu acest model</button>
        <button class="btn-ghost btn-sm btn-preview-tpl" data-id="${escHtml(tpl.id)}">Vezi exemplu</button>
      </div>`;

    card.querySelector('.btn-start-tpl').addEventListener('click', () => startWithTemplate(tpl.id));
    card.querySelector('.btn-preview-tpl').addEventListener('click', () => openPreviewModal(tpl.id));

    grid.appendChild(card);
  });
}

function startWithTemplate(templateId) {
  const tplData = getTemplateById(templateId);
  const registry = getTemplateList();
  const meta = registry.find(t => t.id === templateId);

  if (!tplData || !meta) {
    showToast('Șablonul nu a putut fi încărcat.', 'error');
    return;
  }

  // Reset state
  currentSiteId = null;
  draft.templateId = templateId;

  // Load from saved draft if same template
  const saved = loadDraft();
  if (saved && saved.templateId === templateId && saved.config) {
    draft.config = saved.config;
  } else {
    // Use preset[0] as initial config
    const presets = tplData.presets || [];
    draft.config = presets.length > 0 ? deepClone(presets[0].config) : {};
    saveDraft();
  }

  currentTemplate = { meta, data: tplData };

  buildForm(tplData.schema, draft.config);

  const nameEl = $('editor-template-name');
  if (nameEl) nameEl.textContent = meta.name;

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
  if (!iframe) { openModal('modal-preview'); return; }

  if (!tplData || typeof window.HidookEngine === 'undefined') {
    iframe.srcdoc = '<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#888;margin:0;font-size:0.95rem">Previzualizare indisponibilă</body>';
    openModal('modal-preview');
    return;
  }

  try {
    const presets = tplData.presets || [];
    const config = presets.length > 0 ? presets[0].config : {};
    const html = window.HidookEngine.renderPreview(tplData.files, config);
    iframe.srcdoc = html;
  } catch (e) {
    iframe.srcdoc = '<body style="font-family:system-ui;padding:2rem;color:#888">Eroare la previzualizare: ' + escHtml(e.message) + '</body>';
  }

  openModal('modal-preview');
}

// ---------------------------------------------------------------------------
// 15. Router
// ---------------------------------------------------------------------------

const screens = ['templates', 'edit', 'dashboard'];

function showScreen(name) {
  screens.forEach(s => {
    const el = $('screen-' + s);
    if (el) el.style.display = s === name ? '' : 'none';
  });
  // Update nav active state
  document.querySelectorAll('[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === name);
  });
}

async function handleRoute(hash) {
  const route = (hash || '').replace('#', '') || 'templates';

  if (route === 'templates') {
    showScreen('templates');
    renderTemplatesGrid();
  } else if (route === 'edit') {
    if (!draft.templateId) {
      window.location.hash = '#templates';
      return;
    }
    showScreen('edit');
    schedulePreview();
  } else if (route === 'dashboard') {
    showScreen('dashboard');
    const user = await fetchCurrentUser().catch(() => null);
    updateUserUI(user);
    loadDashboard();
  } else if (route === 'platit') {
    // Payment success — redirect to dashboard
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
// 16. Bootstrap
// ---------------------------------------------------------------------------

function wireStaticButtons() {
  // Back button
  const backBtn = $('btn-back-templates');
  if (backBtn) backBtn.addEventListener('click', () => { window.location.hash = '#templates'; });

  // Publish button
  const publishBtn = $('btn-publish');
  if (publishBtn) publishBtn.addEventListener('click', doPublish);

  // Logout
  const logoutBtn = $('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch (_) {}
      updateUserUI(null);
      showToast('Ai ieșit din cont.', '', 3000);
      window.location.hash = '#templates';
    });
  }

  // Auth modal close
  const closeAuth = $('btn-close-auth');
  if (closeAuth) closeAuth.addEventListener('click', () => closeModal('modal-auth'));

  // Preview modal close
  const closePreview = $('btn-close-preview');
  if (closePreview) closePreview.addEventListener('click', () => closeModal('modal-preview'));

  // Success modal close
  const closeSuccess = $('btn-success-close');
  if (closeSuccess) closeSuccess.addEventListener('click', () => closeModal('modal-success'));

  // Versions modal close
  const closeVersions = $('btn-close-versions');
  if (closeVersions) closeVersions.addEventListener('click', () => closeModal('modal-versions'));

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    });
  });

  // Mobile editor tabs
  const tabFormBtn = $('tab-form-btn');
  const tabPreviewBtn = $('tab-preview-btn');
  if (tabFormBtn && tabPreviewBtn) {
    tabFormBtn.addEventListener('click', () => {
      tabFormBtn.classList.add('active');
      tabFormBtn.setAttribute('aria-selected', 'true');
      tabPreviewBtn.classList.remove('active');
      tabPreviewBtn.setAttribute('aria-selected', 'false');
      showId('tab-form');
      hideId('tab-preview');
    });
    tabPreviewBtn.addEventListener('click', () => {
      tabPreviewBtn.classList.add('active');
      tabPreviewBtn.setAttribute('aria-selected', 'true');
      tabFormBtn.classList.remove('active');
      tabFormBtn.setAttribute('aria-selected', 'false');
      showId('tab-preview');
      hideId('tab-form');
      // Trigger preview render when switching to mobile preview tab
      renderPreview();
    });
  }

  // Close modals with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['modal-auth', 'modal-preview', 'modal-success', 'modal-versions'].forEach(id => {
        const el = $(id);
        if (el && el.style.display !== 'none') el.style.display = 'none';
      });
    }
  });
}

async function boot() {
  setLoading(true, 'Se încarcă...');

  try {
    // Wire all static buttons
    wireStaticButtons();

    // Try Telegram Mini App auth first
    tryTelegramAuth();

    // Check session
    const user = await fetchCurrentUser().catch(() => null);
    updateUserUI(user);

    // Route
    window.addEventListener('hashchange', () => handleRoute(window.location.hash));
    await handleRoute(window.location.hash);

  } catch (e) {
    console.error('Boot error:', e);
    showToast('Eroare la inițializare. Reîncarcă pagina.', 'error', 8000);
  } finally {
    setLoading(false);
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
