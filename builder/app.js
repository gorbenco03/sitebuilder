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

/** Human catalog badge — never show raw API ids (product-menu / local-service / portfolio). */
const DESIGN_BADGE_BY_ID = {
  'product-menu': 'Restaurant',
  'local-service': 'Meseriași',
  'portfolio': 'Salon',
  'professionals': 'Servicii profesionale',
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
const DRAWER_TYPES = new Set(['phone', 'url', 'color']);
const DRAWER_KEYS_PARTIAL = ['whatsapp', 'waHref', 'instagram.url', 'facebook.url', 'addressHref', 'seo.', 'jsonLd', 'canonical', 'lang', 'ogImage'];
// Factory/SEO machinery — keep in config for publish, never show in Detalii
const HIDDEN_DRAWER_KEYS = ['seo.jsonLd', 'seo.canonical'];

function isHiddenDrawerField(field) {
  const k = field && field.key ? String(field.key) : '';
  if (HIDDEN_DRAWER_KEYS.includes(k)) return true;
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
  const arr = Array.isArray(getPath(draft.config, listPath))
    ? getPath(draft.config, listPath).slice()
    : [];
  let newItem;
  // Restaurant menu: menu.en / menu.ro are section lists; *.items are string dishes
  if (/^menu\.(en|ro)$/.test(listPath)) {
    if (!draft.config.menu || typeof draft.config.menu !== 'object') {
      draft.config.menu = { title: 'Meniu', en: [], ro: [] };
    }
    if (!Array.isArray(draft.config.menu.en)) draft.config.menu.en = [];
    if (!Array.isArray(draft.config.menu.ro)) draft.config.menu.ro = [];
    newItem = { category: 'Secțiune nouă', items: ['Articol nou'] };
  } else if (/^menu\.(en|ro)\.\d+\.items$/.test(listPath)) {
    newItem = 'Articol nou';
  } else if (typeof itemShape === 'string') {
    newItem = itemShape === 'photos' ? [] : '';
  } else if (typeof itemShape === 'object' && itemShape !== null) {
    newItem = {};
    Object.keys(itemShape).forEach(k => {
      if (itemShape[k] === 'photos') newItem[k] = [];
      else if (itemShape[k] === 'list' || k === 'items') newItem[k] = [''];
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
    body.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:1rem 0">Alege un design mai întâi.</p>';
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
  const payload = { templateId: draft.templateId, config: draft.config };
  // Persist paid-site bind so fresh #edit (no dashboard «Editează») can republish
  if (currentSiteId) {
    payload.siteId = currentSiteId;
    payload.paid = !!currentSitePaid;
    if (currentSiteSlug) payload.slug = currentSiteSlug;
  }
  lsSet(DRAFT_KEY, payload);
}
function loadDraft() { return lsGet(DRAFT_KEY); }

/**
 * After pay, a fresh /app/#edit (or resume without loadSiteForEdit) must bind the
 * signed-in paid site so «Publică» republishes the same slug — never the new-address modal.
 */
async function bindSignedInPaidSiteForEdit() {
  if (currentSiteId && currentSitePaid && currentSiteSlug) return;
  try {
    if (!currentUser) {
      const user = await fetchCurrentUser().catch(() => null);
      if (user) updateUserUI(user);
      if (!currentUser) return;
    }

    const saved = loadDraft();
    if (saved && saved.siteId && saved.paid) {
      currentSiteId = saved.siteId;
      currentSitePaid = true;
      if (saved.slug) currentSiteSlug = saved.slug;
      publishedSiteId = saved.siteId;
      if (currentSiteId && currentSitePaid && currentSiteSlug) {
        saveDraft();
        return;
      }
    }

    const data = await apiGet('/api/sites');
    const sites = (data && data.sites) || [];
    if (!sites.length) return;

    const tpl = draft.templateId || (saved && saved.templateId) || '';
    const nameSlug = toSlug(getPath(draft.config, 'business.name') || '') || '';
    const wantSlug = String(currentSiteSlug || (saved && saved.slug) || nameSlug || '').trim();

    let match = null;
    if (currentSiteId) {
      match = sites.find(s => s && s.id === currentSiteId) || null;
    }
    if (!match && wantSlug) {
      match = sites.find(s => s && s.paid && (s.slug === wantSlug || s.projectName === wantSlug)) || null;
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
    if (!match) {
      const paid = sites.filter(s => s && s.paid);
      if (paid.length === 1) match = paid[0];
    }
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
}

/** Show auth panel vs connect panel inside the Instagram modal. */
function syncInstagramModalPanels() {
  const authPanel = $('ig-auth-panel');
  const connectPanel = $('ig-connect-panel');
  const hasUser = !!(currentUser && currentUser.email);
  if (authPanel) authPanel.style.display = hasUser ? 'none' : '';
  if (connectPanel) connectPanel.style.display = hasUser ? '' : 'none';
}

/**
 * Ensure an unpaid draft site exists so Instagram APIs have a siteId.
 * Does not open the publish success UI or require payment.
 * Sets currentSiteSlug so first «Publică site-ul» reuses the reserved address.
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
    throw new Error('Intră în cont ca să salvezi ciorna.');
  }
  if (!draft.config || !draft.templateId) {
    throw new Error('Alege mai întâi un design.');
  }
  setIgStatus('Salvez ciorna ca să pot conecta Instagram…');
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
  const data = await apiPost('/api/publish', payload);
  if (!data.site || !data.site.id) {
    throw new Error('Nu am putut salva ciorna.');
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
    setBtnLoading(submitBtn, true, 'Se trimite...');
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
              setIgStatus('Cont activ. Pregătesc conectarea…');
              try {
                await ensureDraftSiteForInstagram();
                setIgStatus('Poți conecta Instagram. Bifează termenii, apoi apasă Conectează.');
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
        errorDiv.textContent = err.message || 'Nu am putut trimite linkul.';
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

  // Logged in: ensure draft siteId (unpaid OK), then show connect controls.
  (async () => {
    try {
      await ensureDraftSiteForInstagram();
      setIgStatus('');
    } catch (e) {
      setIgStatus(e.message || 'Nu am putut pregăti Instagram.', true);
    }
  })();
}

async function connectInstagram() {
  const check = $('ig-terms-check');
  const btn = $('btn-ig-connect');
  if (!currentUser || !currentUser.email) {
    setIgStatus('Intră în cont ca să conectezi Instagram.', true);
    syncInstagramModalPanels();
    wireIgAuthForm();
    return;
  }
  if (!check || !check.checked) {
    setIgStatus('Bifează Termenii și Confidențialitatea pentru feed-ul Instagram.', true);
    return;
  }
  setBtnLoading(btn, true);
  setIgStatus('Conectez Instagram…');
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
    if (grant1.embedUrl) applyEmbedUrl(grant1.embedUrl);
    // Isolated/test finish: grant already stored embed; no partner editor UI required
    if (grant1.embedUrl && !(session && session.editorUrl)) {
      setIgStatus('Instagram e pe site.');
      showToast('Instagram e conectat.', 'success', 3500);
      closeModal('modal-instagram');
      return;
    }
    if (session.editorUrl) {
      window.open(session.editorUrl, 'instagram-feed-editor', 'noopener,width=920,height=720');
    }
    setIgStatus('După ce termini conectarea, revenim și actualizăm feed-ul pe site.');
    const onFocus = async () => {
      window.removeEventListener('focus', onFocus);
      try {
        const grant2 = await apiPost('/api/sites/' + encodeURIComponent(siteId) + '/social-feed/grant', {
          acceptedTerms: true,
        });
        if (grant2.embedUrl) {
          applyEmbedUrl(grant2.embedUrl);
          setIgStatus('Instagram e pe site.');
          showToast('Instagram e conectat.', 'success', 3500);
          closeModal('modal-instagram');
        } else {
          setIgStatus('Feed-ul încă nu e gata. Deschide din nou Instagram după ce salvezi conexiunea.');
        }
      } catch (e) {
        setIgStatus(e.message || 'Nu am putut reîncărca feed-ul Instagram.', true);
      }
    };
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

/** Human calendar date for hosting-until (not ISO dump, not trial countdown). */
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
    if (errorEl) { errorEl.textContent = 'Adresa trebuie să aibă minim 3 caractere (litere mici, cifre, liniuță).'; show(errorEl); }
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
  currentSitePaid = !!data.site.paid;
  if (data.site.slug) currentSiteSlug = data.site.slug;
  saveDraft();

  showSuccessScreen(data.site.url, data.paymentUrl);
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
                if (onAuthSuccess) {
                  setLoading(true, 'Se publică...');
                  try { await onAuthSuccess(); } catch (_) {} finally { setLoading(false); }
                } else if (resumeLocalDraft()) {
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
        if (errorDiv) { errorDiv.textContent = err.message || 'Eroare. Încearcă din nou.'; show(errorDiv); }
      } finally {
        setBtnLoading(submitBtn, false);
      }
    };
  }
}

function showSuccessScreen(url, paymentUrl) {
  const titleEl = $('modal-success-title');
  const draftNote = $('success-draft-note');
  const urlText = $('success-url-text');
  const urlLink = $('success-url-link');
  const copyBtn = $('btn-copy-url');
  const isLive = !!(url && String(url).indexOf('http') === 0);

  if (isLive) {
    if (titleEl) titleEl.textContent = 'Site-ul tău e live — hosting 12 luni';
    if (draftNote) hide(draftNote);
    if (urlText) urlText.textContent = url;
    if (urlLink) { urlLink.href = url; show(urlLink); }
    if (copyBtn) show(copyBtn);
  } else {
    if (titleEl) titleEl.textContent = 'Ciorna e salvată';
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
      const waText = encodeURIComponent('Bună! Am creat site-ul pentru ' + businessName + ': ' + url);
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
  setLoading(true, 'Confirmăm plata...');
  try {
    const data = await apiPost('/api/test-pay/complete', { sessionId: id });
    const site = data && data.site;
    if (site && site.id) {
      currentSiteId = site.id;
      publishedSiteId = site.id;
      publishedSiteUrl = site.url || null;
      currentSitePaid = !!site.paid;
      if (site.slug) currentSiteSlug = site.slug;
      saveDraft();
    }
    if (site && site.url && String(site.url).indexOf('http') === 0) {
      sitePaymentUrl = null;
      showSuccessScreen(site.url, null);
      showToast('Plata a fost confirmată. Site-ul tău e live.', 'success', 6000);
    } else if (site && site.paid) {
      try {
        const fresh = await apiGet('/api/sites/' + encodeURIComponent(site.id));
        const s = fresh && fresh.site;
        if (s && s.url) {
          publishedSiteUrl = s.url;
          showSuccessScreen(s.url, null);
        } else {
          showToast('Plata a fost confirmată. Publicarea finalizează în câteva momente.', 'success', 6000);
        }
      } catch (_) {
        showToast('Plata a fost confirmată. Publicarea finalizează în câteva momente.', 'success', 6000);
      }
    } else {
      showToast('Plata a fost procesată.', 'success', 5000);
    }
  } catch (e) {
    showToast('Eroare la confirmarea plății: ' + (e.message || 'reîncearcă'), 'error', 6000);
  } finally {
    setLoading(false);
  }
}

/** Restore local draft into editor state (after magic-link / empty dashboard). */
function resumeLocalDraft() {
  const saved = loadDraft();
  if (!saved || !saved.templateId || !saved.config) return false;
  const tplData = getTemplateById(saved.templateId);
  const registryList = getTemplateList();
  const meta = (registryList || []).find(t => t.id === saved.templateId);
  if (!tplData || !meta) return false;
  draft.templateId = saved.templateId;
  draft.config = deepClone(saved.config);
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
  const nameEl = $('editor-template-name');
  if (nameEl) nameEl.textContent = meta.name;
  return true;
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
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">&#128200;</div><p>Designurile nu sunt disponibile momentan.</p></div>';
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
    const badge = designBadgeLabel(tpl);
    body.innerHTML = `
      <span class="template-card-badge">${escHtml(badge)}</span>
      <div class="template-card-title">${escHtml(tpl.name)}</div>
      <div class="template-card-desc">${escHtml(tpl.description || '')}</div>
      <div class="template-card-actions">
        <button class="btn-primary btn-start-tpl" data-id="${escHtml(tpl.id)}" aria-label="Începe cu designul ${escHtml(tpl.name)}">Începe</button>
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
    const tplData = getTemplateById(tpl.id);
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
  });
  heroStagePopulated = true;
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
    iframe.title = 'Previzualizare design';
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
    showToast('Designul nu a putut fi încărcat.', 'error');
    return;
  }

  currentSiteId = null;
  currentSitePaid = false;
  currentSiteSlug = '';
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
      // Magic-link / verify landed on empty dashboard — resume in-progress local draft
      const saved = loadDraft();
      if (saved && saved.templateId && saved.config && resumeLocalDraft()) {
        window.location.hash = '#edit';
        return;
      }
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

  const hostingExpired = isHostingExpired(site);
  let badgeClass = 'status-draft', badgeLabel = 'Ciornă';

  if (site.paid && hostingExpired) {
    badgeClass = 'status-expired'; badgeLabel = 'Expirat';
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
  name.textContent = site.projectName || site.slug || site.id;

  const meta = document.createElement('div');
  meta.className = 'site-card-meta';

  const badge = document.createElement('span');
  badge.className = 'status-badge ' + badgeClass;
  badge.textContent = badgeLabel;
  meta.appendChild(badge);

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

  // Paid + active: stranger-readable hosting-until (calendar date from paidUntil)
  if (site.paid && !hostingExpired && site.paidUntil) {
    const untilStr = formatHostingUntilDate(site.paidUntil);
    if (untilStr) {
      const hostLine = document.createElement('div');
      hostLine.className = 'site-hosting-until';
      hostLine.textContent = 'Hosting până la ' + untilStr;
      info.appendChild(hostLine);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'site-card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-ghost btn-sm';
  editBtn.textContent = 'Editează';
  editBtn.setAttribute('aria-label', 'Editează site-ul ' + (site.projectName || site.slug || ''));
  editBtn.addEventListener('click', () => loadSiteForEdit(site.id));
  actions.appendChild(editBtn);

  // Unpaid → first publish 100; paid+expired → renew 29; paid+active → no pay CTA
  if (!site.paid || hostingExpired) {
    const keepBtn = document.createElement('button');
    keepBtn.className = 'btn-primary btn-sm';
    let payLabel;
    if (site.paid && hostingExpired) {
      payLabel = 'Reînnoiește hosting — ' + formatRenewalLabel(appConfig);
    } else {
      payLabel = 'Plătește și publică';
    }
    keepBtn.textContent = payLabel;
    keepBtn.setAttribute('aria-label', payLabel + ' site-ul');
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
    currentSitePaid = !!site.paid;
    currentSiteSlug = site.slug || '';
    draft.templateId = site.templateId;
    draft.config = deepClone(config);
    saveDraft();

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
    versions.forEach((v, idx) => {
      const item = document.createElement('div');
      item.className = 'version-item';
      const d = new Date(v.publishedAt);
      const dateStr = d.toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' });
      const verNum = versions.length - idx;
      const label = 'Versiunea ' + verNum;
      item.innerHTML = `
        <span class="version-date">${escHtml(dateStr)}</span>
        <span style="font-size:.76rem;color:var(--text-light);flex:1;padding:0 .5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(label)}</span>
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
      if (resumeLocalDraft()) {
        /* restored */
      } else {
        window.location.hash = '#templates';
        return;
      }
    }
    // Bind signed-in paid site so Publică skips slug modal without dashboard Editează
    await bindSignedInPaidSiteForEdit();
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
