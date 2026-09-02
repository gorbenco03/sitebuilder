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
/** localStorage key for Details drawer open/closed preference (VISION Flow 2). */
const DRAWER_PREF_KEY = 'hb-details-drawer-pref';
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

function hideToast() {
  const t = $('toast');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  if (t) t.style.display = 'none';
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
  if (id === 'modal-preview') document.body.classList.remove('preview-cookie-isolated');
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
    'seo.jsonLd',
  ].forEach(cascadeStringPath);
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
const HIDDEN_DRAWER_KEYS = ['seo.jsonLd', 'seo.canonical', 'contact.waHref'];

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

function prepareInteractivePreviewDocument(documentHtml, readyToken) {
  // The preview is only ready once generated consent is bound and the first
  // animation-forcer pass has completed. This applies equally to catalog and
  // editor srcdoc documents.
  const readyScript = '<script data-hb-preview-ready>(function(){var token=' +
    JSON.stringify(readyToken) +
    ';var sent=false;var send=function(){if(sent)return;sent=true;try{parent.postMessage({type:"hb-preview-ready",token:token},"*");}catch(e){}};' +
    'var ensureConsent=function(){var el=document.getElementById("hb-cookie-banner");var btn=document.getElementById("hb-cookie-accept");' +
    'if(!el||!btn)return true;' +
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

function waitForInteractivePreview(target, readyToken) {
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
  iframeReady = false;
  pendingRender = false;

  if (previewSpinTimer) clearTimeout(previewSpinTimer);
  previewSpinTimer = setTimeout(() => showPreviewSpinner(true), 200);

  const readyToken = 'hb-editor-preview-ready-' + (++editorPreviewGeneration);
  const html = prepareInteractivePreviewDocument(buildSrcdoc(), readyToken);
  const iframe = getPreviewIframe();
  if (!iframe) return;

  if (clearEditorPreviewReadyListener) clearEditorPreviewReadyListener();
  clearEditorPreviewReadyListener = waitForInteractivePreview(iframe, readyToken);
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
  let prevName = null;
  if (path === 'business.name' && draft.config) {
    prevName = getPath(draft.config, 'business.name');
  }
  setPath(draft.config, path, value);
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
      draft.config.menu = { title: 'Menu', en: [], ro: [] };
    }
    if (!Array.isArray(draft.config.menu.en)) draft.config.menu.en = [];
    if (!Array.isArray(draft.config.menu.ro)) draft.config.menu.ro = [];
    newItem = { category: 'New section', items: ['New item'] };
  } else if (/^menu\.(en|ro)\.\d+\.items$/.test(listPath)) {
    newItem = 'New item';
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
    await applySelectedImageFile(file, path, '', '');
    fileInput.value = '';
  });
}

async function applySelectedImageFile(file, path, src, alt) {
  if (!path) path = resolveImagePathFromSrc(src);
  if (!path) path = resolveImagePathFromAlt(alt);
  if (!file || !path) return;
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
  saveDraft();
  // Re-render needed for color changes
  fullRerender();
}

/** Page / paper background — theme.cream drives --color-cream → --paper in all templates. */
function applyThemeBackground(hex) {
  if (!draft.config) return;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  setPath(draft.config, 'theme.cream', hex);
  saveDraft();
  fullRerender();
}

// ---------------------------------------------------------------------------
// 13. Drawer — details panel
// ---------------------------------------------------------------------------

/** Prefer open on first editor entry; remember closed/open across reload. */
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

/** True when Details should auto-open (first visit or last preference was open). */
function shouldAutoOpenDrawer() {
  const pref = getDrawerPref();
  if (pref === 'closed') return false;
  return true; // null (first entry) or 'open'
}

function openDrawer() {
  const overlay = $('drawer-overlay');
  const drawer = $('details-drawer');
  if (!drawer) return;
  buildDrawer();
  show(overlay);
  show(drawer);
  drawerOpen = true;
  setDrawerPref('open');
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
  setDrawerPref('closed');
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
    body.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:1rem 0">Alege mai întâi un design.</p>';
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
    title.textContent = 'Photo gallery';
    section.appendChild(title);

    const galleryBtn = document.createElement('button');
    galleryBtn.type = 'button';
    galleryBtn.className = 'btn-ghost btn-sm';
    galleryBtn.style.marginTop = '.35rem';
    galleryBtn.textContent = 'Manage photos';
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
    saveDraft();
    updateChecklist();
    // Try chirurgical update if field has a visible representation
    sendSetToIframe(key, nextValue);
    // Schedule re-render on drawer close
    if (drawerSaveTimer) clearTimeout(drawerSaveTimer);
    drawerSaveTimer = setTimeout(() => {
      drawerSaveTimer = null;
      // Re-render if drawer is still open (lazy)
    }, 2000);
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
    const reader = new FileReader();
    reader.onload = () => {
      const chosenImage = String(reader.result || '');
      if (input._hbPathImagePicker !== request) return;
      release();
      if (chosenImage && typeof cb === 'function') cb(chosenImage);
    };
    reader.onerror = release;
    reader.onabort = release;
    try {
      reader.readAsDataURL(file);
    } catch (_) {
      release();
    }
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
    body.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">No photos yet.</p>';
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
        img.src = src; img.alt = 'Photo ' + (idx+1); img.loading = 'lazy';

        const del = document.createElement('button');
        del.type = 'button'; del.className = 'photo-thumb-del';
        del.setAttribute('aria-label', 'Delete photo ' + (idx+1));
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
    addBtn.innerHTML = '<div class="photos-dropzone-icon" aria-hidden="true">+</div><div>Add photos</div>';
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
  deriveWaHref(draft.config);
  const payload = { templateId: draft.templateId, config: draft.config };
  // Persist paid-site bind so fresh #edit (no dashboard «Edit») can republish
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

function disconnectInstagram() {
  instagramEditorUrl = '';
  applyEmbedUrl('');
  setIgStatus('Instagram a fost deconectat. Feed-ul nu mai este afișat pe site.');
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
          setIgStatus('Feed-ul nu este gata încă. Redeschide Instagram după ce salvezi conectarea.');
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

/**
 * Download the current draft as a complete static HTML file.
 * Fetches GET /api/export-html (session cookie) and saves via blob + a[download].
 * Does not publish or open checkout.
 */
async function downloadDraftHtml() {
  const btn = $('btn-download-html');
  if (btn) btn.disabled = true;
  try {
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
        ? 'Intră în cont ca să descarci ciorna ca HTML.'
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
  } catch (_) {
    showToast('Nu am putut descărca HTML-ul.', 'error', 5000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Download the current draft as a self-hostable static ZIP (Flow 3).
 * GET /api/export-zip — HTML/CSS/JS/images/legal pages. Not a live publish.
 */
async function downloadDraftZip() {
  const btn = $('btn-download-zip');
  if (!currentUser) {
    showToast('Autentifică-te ca să descarci ZIP-ul.', 'error', 5000);
    return;
  }
  if (btn) btn.disabled = true;
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
    if (btn) btn.disabled = false;
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
        if (errorDiv) { errorDiv.textContent = 'Nu am putut trimite linkul. Încearcă din nou.'; show(errorDiv); }
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
  } else {
    const presets = tplData.presets || [];
    draft.config = presets.length > 0 ? deepClone(presets[0].config) : {};
  }
  // Persist cleared bind so localStorage cannot re-attach a foreign paid siteId.
  saveDraft();

  currentTemplate = { meta, data: tplData };
  previewFirstRender = false;
  iframeReady = false;

  const nameEl = $('editor-template-name');
  if (nameEl) nameEl.textContent = meta.name;

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

  const versBtn = document.createElement('button');
  versBtn.className = 'btn-ghost btn-sm';
  versBtn.textContent = 'Istoric';
  versBtn.setAttribute('aria-label', 'Istoric versiuni pentru ' + (site.projectName || site.slug || ''));
  versBtn.addEventListener('click', () => loadVersions(site.id));
  actions.appendChild(versBtn);

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
    // VISION 4.3: Details opens on first editor entry; preference survives reload.
    if (shouldAutoOpenDrawer() && !drawerOpen) {
      requestAnimationFrame(() => {
        if (shouldAutoOpenDrawer() && !drawerOpen) openDrawer();
      });
    }
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
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method:'POST', credentials:'include' }); } catch (_) {}
      updateUserUI(null);
      showToast('Te-ai deconectat.', '', 3000);
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
  if (successCloseBtn) {
    successCloseBtn.addEventListener('click', async () => {
      closeModal('modal-success');
      // After pay, open the paid site editor — not stay on dashboard/catalog (S92)
      if (!draft.templateId) {
        await ensureDraftBoundToPaidSite(currentSiteId);
      }
      if (draft.templateId) {
        window.location.hash = '#edit';
      }
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

  // Close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Escape closes everything
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['modal-publish','modal-preview','modal-success','modal-versions','modal-gallery'].forEach(id => {
        const el = $(id);
        if (el && el.style.display !== 'none') closeModal(id);
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
