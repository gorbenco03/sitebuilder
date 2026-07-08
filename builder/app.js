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

const draft = { templateId: null, config: null };

let currentUser    = null;
let currentSiteId  = null;
let currentTemplate = null;

// Runtime config from /api/config
let appConfig = { priceEur: null, trialDays: 3, brandDomain: null, contactUrl: null };

// Preview/iframe state
let previewTimer       = null;
let previewSpinTimer   = null;
let previewFirstRender = false;
let iframeReady        = false;   // did overlay send {hb:'ready'}?
let pendingRender      = false;   // is a srcdoc re-render queued?

// Pending image replacement request
let pendingImagePath = null;

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

// Color popover state
let colorPopoverOpen = false;

// Drawer state
let drawerOpen = false;
let drawerSaveTimer = null;

// Device mode
let deviceMode = 'desktop'; // 'desktop' | 'mobile'

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
// 6. Schema helpers — identify inline vs drawer fields
// ---------------------------------------------------------------------------

// Field types that go in the drawer (not editable inline on the canvas)
const DRAWER_TYPES = new Set(['phone', 'url', 'color']);
const DRAWER_KEYS_PARTIAL = ['whatsapp', 'waHref', 'instagram.url', 'facebook.url', 'addressHref', 'seo.', 'jsonLd', 'canonical', 'lang', 'ogImage'];

function isDrawerField(field) {
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

function isFieldComplete(field) {
  const val = getPath(draft.config, field.key);
  if (val == null || val === '') return false;
  if (Array.isArray(val) && val.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 7. Checklist indicator
// ---------------------------------------------------------------------------

function updateChecklist() {
  if (!currentTemplate || !currentTemplate.data || !currentTemplate.data.schema) return;
  const required = getRequiredFields(currentTemplate.data.schema);
  const done = required.filter(isFieldComplete).length;
  const total = required.length;
  const el = $('checklist-text');
  const ind = $('checklist-indicator');
  if (el) el.textContent = done + '/' + total;
  if (ind) {
    ind.classList.toggle('checklist-ok', done === total);
    ind.classList.toggle('checklist-warn', done < total);
  }
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
  '      el.style.outline="3px solid #5B5BD6";',
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
  '    el.style.boxShadow="0 0 0 2px #5B5BD6,0 0 0 5px rgba(91,91,214,.18)";',
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
  '  el.title="Apasa pentru a schimba imaginea";',
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
  '  sp.textContent="Schimba poza";',
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
  '    btn.type="button";btn.textContent="+ Adauga element";',
  '    btn.style.marginTop="8px";btn.style.padding="5px 10px";btn.style.fontSize="12px";',
  '    btn.style.fontFamily="system-ui";btn.style.background="#5B5BD6";btn.style.color="#fff";',
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
  const tpl = getTemplateById(draft.templateId);
  if (!tpl || typeof window.HidookEngine === 'undefined') return '';
  try {
    // Pass editMode:true so renderHtml emits data-hb-edit attributes and
    // renderPreview injects the modern edit-overlay.js (bundled in engine.js).
    let html = window.HidookEngine.renderPreview(tpl.files, draft.config, { editMode: true });
    return html;
  } catch (e) {
    console.warn('buildSrcdoc error:', e);
    return '<body style="font-family:system-ui;padding:2rem;color:#9CA3AF">Eroare randare: ' + escHtml(e.message) + '</body>';
  }
}

function showPreviewSpinner(vis) {
  const el = $('preview-spinner-overlay');
  if (el) el.style.display = vis ? '' : 'none';
}

// Full re-render: new srcdoc. Called for: initial load, image change, list add/remove, color change.
function fullRerender() {
  if (!draft.config || !draft.templateId) return;
  iframeReady = false;
  pendingRender = false;

  if (previewSpinTimer) clearTimeout(previewSpinTimer);
  previewSpinTimer = setTimeout(() => showPreviewSpinner(true), 200);

  const html = buildSrcdoc();
  const iframe = getPreviewIframe();
  if (!iframe) return;

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
        onInlineTextEdit(msg.path, msg.value);
        break;
      case 'image':
        onImageChangeRequest(msg.path);
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
    }
  });
}

function buildImgMap(config) {
  // Build a src→path reverse-lookup map for all image values in config.
  // Used by the modern edit-overlay.js to resolve {hb:'image', path} on img clicks.
  const map = {};
  function walk(obj, prefix) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, prefix + '.' + i));
      return;
    }
    Object.entries(obj).forEach(([k, v]) => {
      const full = prefix ? prefix + '.' + k : k;
      if (typeof v === 'string' && v.length > 0 &&
          (v.startsWith('data:image') || v.startsWith('images/') || v.startsWith('http'))) {
        map[v] = full;
      } else if (typeof v === 'object' && v !== null) {
        walk(v, full);
      }
    });
  }
  walk(config, '');
  return map;
}

function onIframeReady() {
  iframeReady = true;
  clearTimeout(previewSpinTimer);
  showPreviewSpinner(false);
  // Send imgmap to modern overlay so image src→config-path resolution works.
  const iframe = getPreviewIframe();
  if (iframe && draft.config) {
    const map = buildImgMap(draft.config);
    iframe.contentWindow.postMessage({ hb: 'imgmap', map }, '*');
  }
}

function onInlineTextEdit(path, value) {
  if (!path) return;
  setPath(draft.config, path, value);
  saveDraft();
  updateChecklist();
  // Update drawer field if open
  syncDrawerField(path, value);
  // No re-render — text is already visible in contenteditable
}

function onImageChangeRequest(path) {
  if (!path) return;
  pendingImagePath = path;
  const fileInput = $('img-file-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

function onListAdd(listPath) {
  if (!listPath) return;
  const tpl = currentTemplate && currentTemplate.data;
  const schema = tpl && tpl.schema;
  // Find field definition for itemShape
  let itemShape = null;
  if (schema) {
    getAllSchemaFields(schema).forEach(f => {
      if (f.key === listPath && f.type === 'list') itemShape = f.itemShape;
    });
  }
  const arr = getPath(draft.config, listPath) || [];
  let newItem;
  if (typeof itemShape === 'string') {
    newItem = '';
  } else if (typeof itemShape === 'object' && itemShape !== null) {
    newItem = {};
    Object.keys(itemShape).forEach(k => { newItem[k] = itemShape[k] === 'photos' ? [] : ''; });
  } else {
    newItem = '';
  }
  arr.push(newItem);
  setPath(draft.config, listPath, arr);
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

function initImageFileInput() {
  const fileInput = $('img-file-input');
  if (!fileInput) return;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file || !pendingImagePath) { fileInput.value = ''; return; }
    const path = pendingImagePath;
    pendingImagePath = null;
    try {
      showPreviewSpinner(true);
      const dataUrl = await resizeImageToDataUrl(file, 1600, 0.82);
      setPath(draft.config, path, dataUrl);
      saveDraft();
      fullRerender();
    } catch (e) {
      showToast('Eroare la procesarea imaginii: ' + e.message, 'error');
      showPreviewSpinner(false);
    }
    fileInput.value = '';
  });
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Eroare la citirea imaginii')); };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// 12. Color Picker Popover
// ---------------------------------------------------------------------------

const COLOR_PRESETS = [
  { label: 'Indigo',   hex: '#5B5BD6' },
  { label: 'Teal',     hex: '#0D9488' },
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

  // Sync current color
  const curColor = (draft.config && getPath(draft.config, 'theme.primary')) || '#5B5BD6';
  const sw = $('color-custom-swatch');
  const ti = $('color-custom-text');
  if (sw) sw.value = curColor;
  if (ti) ti.value = curColor;

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
  saveDraft();
  // Re-render needed for color changes
  fullRerender();
}

// ---------------------------------------------------------------------------
// 13. Drawer — details panel
// ---------------------------------------------------------------------------

function openDrawer() {
  const overlay = $('drawer-overlay');
  const drawer = $('details-drawer');
  if (!drawer) return;
  buildDrawer();
  show(overlay);
  show(drawer);
  drawerOpen = true;
  const btn = $('btn-open-drawer');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  // Focus first field
  requestAnimationFrame(() => {
    const first = drawer.querySelector('input,textarea,select');
    if (first) first.focus();
  });
}

function closeDrawer() {
  hide($('drawer-overlay'));
  hide($('details-drawer'));
  drawerOpen = false;
  const btn = $('btn-open-drawer');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  // Re-render if any drawer field was edited (deferred)
  if (drawerSaveTimer) {
    clearTimeout(drawerSaveTimer);
    drawerSaveTimer = null;
    fullRerender();
  }
}

function buildDrawer() {
  const body = $('drawer-body');
  if (!body) return;
  body.innerHTML = '';

  if (!currentTemplate || !currentTemplate.data || !currentTemplate.data.schema) {
    body.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:1rem 0">Selectează un șablon mai întâi.</p>';
    return;
  }

  const schema = currentTemplate.data.schema;
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

  // Photo gallery section
  const photoPaths = findPhotoPaths();
  if (photoPaths.length > 0) {
    const section = document.createElement('div');
    section.className = 'drawer-section';
    const title = document.createElement('div');
    title.className = 'drawer-section-title';
    title.textContent = 'Galerie foto';
    section.appendChild(title);

    const galleryBtn = document.createElement('button');
    galleryBtn.type = 'button';
    galleryBtn.className = 'btn-ghost btn-sm';
    galleryBtn.style.marginTop = '.35rem';
    galleryBtn.textContent = 'Administrează pozele';
    galleryBtn.addEventListener('click', () => openGalleryModal());
    section.appendChild(galleryBtn);
    body.appendChild(section);
  }
}

function buildDrawerField(field) {
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

  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
    input.className = 'field-textarea';
    if (field.maxLen) input.maxLength = field.maxLen;
    input.rows = 3;
  } else if (type === 'color') {
    // Skip — handled by color picker popover
    return null;
  } else {
    input = document.createElement('input');
    input.className = 'field-input';
    input.type = type === 'phone' ? 'tel' : (type === 'url' ? 'url' : (type === 'email' ? 'email' : 'text'));
    if (field.maxLen) input.maxLength = field.maxLen;
  }

  input.id = safeId;
  input.name = key;
  if (required) input.required = true;
  const curVal = getPath(draft.config, key);
  if (curVal != null && typeof curVal !== 'object') input.value = String(curVal);

  // Sync to config on change
  input.addEventListener('input', () => {
    setPath(draft.config, key, input.value);
    saveDraft();
    updateChecklist();
    // Try chirurgical update if field has a visible representation
    sendSetToIframe(key, input.value);
    // Schedule re-render on drawer close
    if (drawerSaveTimer) clearTimeout(drawerSaveTimer);
    drawerSaveTimer = setTimeout(() => {
      drawerSaveTimer = null;
      // Re-render if drawer is still open (lazy)
    }, 2000);
  });

  wrap.appendChild(input);
  wrap.dataset.fieldKey = key;
  return wrap;
}

// Sync a drawer field value when it changes via inline editing
function syncDrawerField(path, value) {
  if (!drawerOpen) return;
  const body = $('drawer-body');
  if (!body) return;
  const wrap = body.querySelector('[data-field-key="' + path + '"]');
  if (!wrap) return;
  const input = wrap.querySelector('input,textarea');
  if (input && input.value !== value) input.value = value;
}

// ---------------------------------------------------------------------------
// 14. Gallery Modal
// ---------------------------------------------------------------------------

function findPhotoPaths() {
  // Return list of paths to photo arrays in config
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
      if (Array.isArray(v) && v.length > 0 && v.some(p => typeof p === 'object' && p && p.src)) {
        paths.push(full);
      } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        walk(v, full);
      }
    });
  }
  walk(draft.config, '');
  return paths;
}

function openGalleryModal() {
  buildGalleryModal();
  openModal('modal-gallery');
}

function buildGalleryModal() {
  const body = $('gallery-modal-body');
  if (!body) return;
  body.innerHTML = '';

  const photoPaths = findPhotoPaths();
  if (photoPaths.length === 0) {
    body.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">Nu există fotografii în config.</p>';
    return;
  }

  photoPaths.forEach(path => {
    const section = document.createElement('div');
    section.className = 'gallery-path-section';

    const title = document.createElement('div');
    title.className = 'field-label';
    title.style.marginBottom = '.5rem';
    title.textContent = path;
    section.appendChild(title);

    const thumbs = document.createElement('div');
    thumbs.className = 'photos-thumbs';

    function renderThumbs() {
      thumbs.innerHTML = '';
      const photos = getPath(draft.config, path) || [];
      photos.forEach((p, idx) => {
        const src = typeof p === 'string' ? p : (p && p.src);
        if (!src) return;
        const div = document.createElement('div');
        div.className = 'photo-thumb';

        const img = document.createElement('img');
        img.src = src; img.alt = 'Fotografie ' + (idx+1); img.loading = 'lazy';

        const del = document.createElement('button');
        del.type = 'button'; del.className = 'photo-thumb-del';
        del.setAttribute('aria-label', 'Șterge fotografia ' + (idx+1));
        del.innerHTML = '&times;';
        del.addEventListener('click', () => {
          const arr = getPath(draft.config, path) || [];
          arr.splice(idx, 1);
          setPath(draft.config, path, arr);
          saveDraft();
          fullRerender();
          renderThumbs();
        });
        div.appendChild(img); div.appendChild(del); thumbs.appendChild(div);
      });
    }
    renderThumbs();
    section.appendChild(thumbs);

    const addBtn = document.createElement('label');
    addBtn.className = 'photos-dropzone';
    addBtn.style.marginTop = '.5rem';
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.multiple = true; fileInput.accept = 'image/jpeg,image/png,image/webp';
    addBtn.innerHTML = '<div class="photos-dropzone-icon" aria-hidden="true">+</div><div>Adaugă fotografii</div>';
    addBtn.appendChild(fileInput);
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files);
      for (const file of files) {
        const dataUrl = await resizeImageToDataUrl(file, 1600, 0.82);
        const arr = getPath(draft.config, path) || [];
        arr.push({ src: dataUrl, alt: file.name.replace(/\.[^.]+$/, '') });
        setPath(draft.config, path, arr);
      }
      saveDraft();
      fullRerender();
      renderThumbs();
      fileInput.value = '';
    });
    section.appendChild(addBtn);
    body.appendChild(section);
  });
}

// ---------------------------------------------------------------------------
// 15. Draft persistence
// ---------------------------------------------------------------------------

function saveDraft() {
  if (!draft.templateId || !draft.config) return;
  lsSet(DRAFT_KEY, { templateId: draft.templateId, config: draft.config });
}
function loadDraft() { return lsGet(DRAFT_KEY); }

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
// 17. App config
// ---------------------------------------------------------------------------

async function fetchAppConfig() {
  try {
    const data = await apiGet('/api/config');
    appConfig = Object.assign(appConfig, data);
  } catch (_) {}
  const heroPrice = $('hero-price');
  const heroTrialDays = $('hero-trial-days');
  if (heroPrice) heroPrice.textContent = appConfig.priceEur != null ? appConfig.priceEur + '€' : '—€';
  if (heroTrialDays) heroTrialDays.textContent = appConfig.trialDays + ' zile';
  const bulletDays = $('trial-bullet-days');
  const bulletPrice = $('trial-bullet-price');
  if (bulletDays) bulletDays.textContent = appConfig.trialDays + ' zile';
  if (bulletPrice) bulletPrice.textContent = appConfig.priceEur != null ? appConfig.priceEur + '€' : '—€';
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
  show($('publish-step-1'));
  hide($('publish-step-2'));
  hide($('auth-sent'));
  show($('form-auth-email'));
  hideId('auth-error');
  hideId('slug-error');

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
      // Open drawer if field is a drawer field
      if (isDrawerField(firstMissing)) {
        openDrawer();
      }
      return;
    }
  }

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
          devLink.addEventListener('click', async () => {
            await new Promise(r => setTimeout(r, 800));
            const user = await fetchCurrentUser().catch(() => null);
            if (user) {
              updateUserUI(user);
              closeModal('modal-publish');
              if (onAuthSuccess) {
                setLoading(true, 'Se publică...');
                try { await onAuthSuccess(); } catch (_) {} finally { setLoading(false); }
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
  const urlText = $('success-url-text');
  const urlLink = $('success-url-link');
  if (urlText) urlText.textContent = url;
  if (urlLink) urlLink.href = url;

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

  const waBtn = $('btn-share-wa');
  if (waBtn) {
    const businessName = getPath(draft.config, 'business.name') || 'Site-ul nostru';
    const waText = encodeURIComponent('Bună! Am creat site-ul pentru ' + businessName + ': ' + url);
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

  const registry = getTemplateList();
  if (!registry || registry.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">&#128200;</div><p>Șabloanele nu sunt disponibile momentan.</p></div>';
    return;
  }

  registry.forEach(tpl => {
    const card = document.createElement('div');
    card.className = 'template-card';
    card.setAttribute('role','listitem');

    const previewWrap = document.createElement('div');
    previewWrap.className = 'template-card-preview';

    const shimmer = document.createElement('div');
    shimmer.className = 'template-card-preview-shimmer';
    previewWrap.appendChild(shimmer);

    let previewLoaded = false;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !previewLoaded) {
        previewLoaded = true;
        observer.disconnect();
        loadCardPreview(tpl.id, previewWrap, shimmer);
      }
    }, { rootMargin: '100px' });
    observer.observe(previewWrap);

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
  iframeReady = false;

  const nameEl = $('editor-template-name');
  if (nameEl) nameEl.textContent = meta.name;

  window.location.hash = '#edit';
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

  const body = $('modal-preview-body');
  const desktopBtn = $('modal-preview-desktop');
  const mobileBtn = $('modal-preview-mobile');
  if (body) body.classList.remove('mode-mobile');
  if (desktopBtn) { desktopBtn.classList.add('active'); desktopBtn.setAttribute('aria-pressed','true'); }
  if (mobileBtn)  { mobileBtn.classList.remove('active'); mobileBtn.setAttribute('aria-pressed','false'); }

  openModal('modal-preview');
}

// ---------------------------------------------------------------------------
// 22. Dashboard
// ---------------------------------------------------------------------------

async function loadDashboard() {
  const list = $('sites-list');
  if (!list) return;
  list.innerHTML = '<p style="color:var(--text-muted);padding:1rem 0;font-size:.9rem">Se încarcă proiectele...</p>';

  try {
    const data = await apiGet('/api/sites');
    const sites = data.sites || [];

    if (sites.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">&#128203;</div><p>Nu ai site-uri create încă.</p><a href="#templates" class="btn-primary">Creează primul tău site</a></div>`;
      return;
    }

    list.innerHTML = '';
    sites.forEach(site => { list.appendChild(buildSiteCard(site)); });
  } catch (e) {
    if (e.status === 401) {
      list.innerHTML = '<div class="empty-state"><p>Trebuie să te autentifici pentru a vedea proiectele.</p></div>';
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

  const actions = document.createElement('div');
  actions.className = 'site-card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-ghost btn-sm';
  editBtn.textContent = 'Editează';
  editBtn.setAttribute('aria-label', 'Editează site-ul ' + (site.projectName || site.slug || ''));
  editBtn.addEventListener('click', () => loadSiteForEdit(site.id));
  actions.appendChild(editBtn);

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

    const nameEl = $('editor-template-name');
    if (nameEl) nameEl.textContent = meta.name;

    previewFirstRender = false;
    iframeReady = false;

    window.location.hash = '#edit';
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
    if (list) list.innerHTML = '<p style="color:var(--error);font-size:.85rem">' + escHtml(e.message) + '</p>';
  }
}

// ---------------------------------------------------------------------------
// 23. Router
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

  // Show/hide editor topbar and normal header
  const topbar = $('editor-topbar');
  const header = $('app-header');
  if (name === 'edit') {
    if (topbar) show(topbar);
    if (header) hide(header);
  } else {
    if (topbar) hide(topbar);
    if (header) show(header);
    // Close drawer and color picker when leaving edit
    if (drawerOpen) closeDrawer();
    if (colorPopoverOpen) closeColorPopover();
  }
}

async function handleRoute(hash) {
  const route = (hash || '').replace('#','') || 'templates';

  if (route === 'templates') {
    showScreen('templates');
    renderTemplatesGrid();
  } else if (route === 'edit') {
    if (!draft.templateId) { window.location.hash = '#templates'; return; }
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
      if (list) list.innerHTML = '<div class="empty-state"><p>Trebuie să te autentifici pentru a vedea proiectele.</p></div>';
    }
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
// 24. Static button wiring
// ---------------------------------------------------------------------------

function wireStaticButtons() {
  // Back to templates
  const backBtn = $('btn-back-templates');
  if (backBtn) backBtn.addEventListener('click', () => { window.location.hash = '#templates'; });

  // Device toggle
  const desktopBtn = $('btn-preview-desktop');
  const mobileBtn  = $('btn-preview-mobile');
  if (desktopBtn) desktopBtn.addEventListener('click', () => setDeviceMode('desktop'));
  if (mobileBtn)  mobileBtn.addEventListener('click',  () => setDeviceMode('mobile'));

  // Publish button in topbar
  const pubBtn = $('btn-publish');
  if (pubBtn) pubBtn.addEventListener('click', openPublishModal);

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
        if (err) { err.textContent = 'Introdu o adresă validă (minim 3 caractere).'; show(err); }
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
        showToast('Nu s-a putut copia. Selectează manual.', 'error');
      }
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
  wireModalClose('btn-close-gallery',  'modal-gallery');

  const successCloseBtn = $('btn-success-close');
  if (successCloseBtn) successCloseBtn.addEventListener('click', () => closeModal('modal-success'));

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
      if (e.target === overlay) overlay.style.display = 'none';
    });
  });

  // Escape closes everything
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['modal-publish','modal-preview','modal-success','modal-versions','modal-gallery'].forEach(id => {
        const el = $(id);
        if (el && el.style.display !== 'none') el.style.display = 'none';
      });
      if (drawerOpen) closeDrawer();
      if (colorPopoverOpen) closeColorPopover();
    }
  });

  // Color picker
  initColorPicker();

  // Image file input
  initImageFileInput();
}

// ---------------------------------------------------------------------------
// 25. Bootstrap
// ---------------------------------------------------------------------------

async function boot() {
  setLoading(true, 'Se încarcă...');
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
