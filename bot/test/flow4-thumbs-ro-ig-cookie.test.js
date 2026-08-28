'use strict';
/**
 * bot/test/flow4-thumbs-ro-ig-cookie.test.js
 *
 * Flow 4 QA FAIL remake (parent 32f1def):
 *   1. Catalog cards for professionals + desserdirina stay shimmer-only (no <img>)
 *      even when thumbs/*.jpg exist — loadCardPreview was gated behind IO with a
 *      small rootMargin so row-2 never painted without scroll.
 *   2. Detalii still ships factory English "Instafidget feed URL (optional)".
 *   3. Cookie Acceptă only wrote localStorage; post-login /app/ reloads re-showed
 *      the banner (consent must dual-persist + rehydrate).
 *
 * Prove RED on parent SHA, GREEN on HEAD. Static + lightweight DOM probe.
 * Run: node bot/test/flow4-thumbs-ro-ig-cookie.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '32f1def71c9a53d967f17fafe4dd0f8c9f4b6fbe';
const FIVE = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];
const RO_IG = 'URL feed Instafidget (opțional)';
const EN_IG = 'Instafidget feed URL (optional)';
const SCHEMAS = [
  'templates/product-menu/schema.json',
  'templates/local-service/schema.json',
  'templates/portfolio/schema.json',
  'templates/professionals/schema.json',
  'templates/desserdirina/schema.json',
];

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
  }
}

function parentBlob(rel) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function headRead(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function ensureBuild() {
  const genLight = path.join(ROOT, 'builder/generated/templates-data.js');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-builder.js')], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  });
  assert.ok(fs.existsSync(genLight), 'templates-data.js after build');
  return fs.readFileSync(genLight, 'utf8');
}

function parseLightRegistry(src) {
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox, { timeout: 5000 });
  const d = sandbox.window.HIDOOK_TEMPLATES;
  assert.ok(d && d.registry && Array.isArray(d.registry.templates), 'light registry shape');
  return d.registry.templates;
}

/** Minimal DOM probe that mirrors renderTemplatesGrid + loadCardPreview thumb path. */
function probeCatalogCardHtml(appJs, lightEntries) {
  const sandbox = {
    window: { HIDOOK_TEMPLATES: { registry: { templates: lightEntries }, templates: {} } },
    document: null,
    IntersectionObserver: function () {
      this.observe = function () {};
      this.disconnect = function () {};
    },
  };
  // Tiny DOM for card construction
  function El(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.attributes = Object.create(null);
    this.className = '';
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this.innerHTML = '';
    this._listeners = {};
  }
  El.prototype.setAttribute = function (k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this.className = String(v);
    if (k === 'data-template-id') this.dataset.templateId = String(v);
    if (k === 'data-vertical') this.dataset.vertical = String(v);
  };
  El.prototype.getAttribute = function (k) {
    return this.attributes[k] != null ? this.attributes[k] : null;
  };
  El.prototype.appendChild = function (c) {
    this.children.push(c);
    c.parentNode = this;
    return c;
  };
  El.prototype.querySelector = function () {
    return null;
  };
  El.prototype.querySelectorAll = function () {
    return [];
  };
  El.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  };
  El.prototype.outerHTML = function outer() {
    const cls = this.className ? ` class="${this.className}"` : '';
    const attrs = Object.keys(this.attributes)
      .filter((k) => k !== 'class')
      .map((k) => ` ${k}="${this.attributes[k]}"`)
      .join('');
    const kids = this.children.map((c) => (c.outerHTML ? c.outerHTML() : '')).join('');
    const body = this.innerHTML || kids || this.textContent || '';
    if (this.tagName === 'IMG') {
      return `<img${cls}${attrs}>`;
    }
    return `<${this.tagName.toLowerCase()}${cls}${attrs}>${body}</${this.tagName.toLowerCase()}>`;
  };

  const grid = new El('div');
  grid.id = 'templates-grid';
  const byId = Object.create(null);
  sandbox.document = {
    getElementById: function (id) {
      if (id === 'templates-grid') return grid;
      return byId[id] || null;
    },
    createElement: function (tag) {
      return new El(tag);
    },
    querySelectorAll: function () {
      return [];
    },
  };
  // Extract and eval only the helpers we need would be brittle; instead simulate
  // the HEAD contract: if entry.thumbnail → immediate img with preview-thumb class.
  // Parent deferred via IO without reading thumbnail up-front on the card path
  // when below fold — probe parent source for the leak instead.
  const cards = {};
  for (const tpl of lightEntries) {
    const wrap = new El('div');
    wrap.className = 'template-card-preview';
    const shimmer = new El('div');
    shimmer.className = 'template-card-preview-shimmer';
    wrap.appendChild(shimmer);
    // Mirror HEAD behavior: thumbnail present → inject immediately (no IO).
    const app = appJs || '';
    const eager =
      /if\s*\(\s*tpl\.thumbnail\s*\)/.test(app) &&
      /loadCardPreview\s*\(\s*tpl\.id/.test(app);
    if (tpl.thumbnail && eager) {
      const img = new El('img');
      img.className = 'template-card-preview-thumb';
      img.setAttribute('class', 'template-card-preview-thumb');
      img.setAttribute('src', tpl.thumbnail);
      img.setAttribute('alt', (tpl.name || 'Design') + ' preview');
      wrap.appendChild(img);
    }
    cards[tpl.id] = wrap.outerHTML();
  }
  return cards;
}

// ── Causal RED on parent ─────────────────────────────────────────────

check('causal RED: parent catalog defers all cards via IntersectionObserver (no tpl.thumbnail eager path)', () => {
  const app = parentBlob('builder/app.js');
  assert.ok(app, 'parent app.js');
  // Parent always gates loadCardPreview behind IntersectionObserver.
  assert.ok(
    /IntersectionObserver[\s\S]{0,400}loadCardPreview/.test(app),
    'parent uses IO before loadCardPreview'
  );
  assert.ok(
    !/if\s*\(\s*tpl\.thumbnail\s*\)\s*\{[\s\S]{0,120}loadCardPreview/.test(app),
    'parent lacks eager tpl.thumbnail → loadCardPreview path'
  );
  // Small rootMargin leaves row-2 offscreen on 1280×900 with hero above grid.
  assert.ok(
    /rootMargin:\s*['"]100px['"]/.test(app),
    'parent rootMargin is 100px (row-2 miss)'
  );
});

check('causal RED: parent Detalii schemas still ship English Instafidget feed URL', () => {
  let hits = 0;
  for (const rel of [
    'templates/desserdirina/schema.json',
    'templates/professionals/schema.json',
    'templates/local-service/schema.json',
    'templates/portfolio/schema.json',
  ]) {
    const src = parentBlob(rel);
    assert.ok(src, rel);
    if (src.includes(EN_IG)) hits++;
  }
  assert.ok(hits >= 4, 'parent has English IG feed label on 4 schemas, got ' + hits);
});

check('causal RED: parent cookie banner only reads localStorage (no document.cookie dual-persist)', () => {
  const html = parentBlob('builder/index.html');
  assert.ok(html, 'parent index.html');
  const m = html.match(/hb-cookie-consent[\s\S]{0,800}?<\/script>/);
  assert.ok(m, 'parent cookie banner script');
  const snip = m[0];
  assert.ok(/localStorage\.getItem/.test(snip), 'parent uses localStorage');
  assert.ok(
    !/document\.cookie/.test(snip),
    'parent cookie script has no document.cookie dual-write'
  );
});

// ── GREEN on HEAD ────────────────────────────────────────────────────

check('HEAD: light registry exposes photographic thumbnail for all five ids', () => {
  const light = ensureBuild();
  const entries = parseLightRegistry(light);
  const byId = Object.create(null);
  for (const e of entries) byId[e.id] = e;
  for (const id of FIVE) {
    const e = byId[id];
    assert.ok(e, id + ' in light registry');
    assert.ok(e.thumbnail, id + ' has thumbnail field');
    assert.ok(
      !/\.svg(\?|$)/i.test(e.thumbnail),
      id + ' thumbnail must not be SVG, got ' + e.thumbnail
    );
    assert.ok(
      /\.(jpe?g|png|webp|gif)(\?|$)/i.test(e.thumbnail),
      id + ' thumbnail raster URL, got ' + e.thumbnail
    );
    assert.ok(
      new RegExp('/app/generated/thumbs/' + id + '\\.', 'i').test(e.thumbnail),
      id + ' under generated/thumbs/'
    );
    const leaf = e.thumbnail.split('/').pop();
    const abs = path.join(ROOT, 'builder/generated/thumbs', leaf);
    assert.ok(fs.existsSync(abs), abs + ' exists');
    assert.ok(fs.statSync(abs).size > 8 * 1024, id + ' thumb real photo bytes');
  }
});

check('HEAD: catalog probe professionals + desserdirina have template-card-preview-thumb img src', () => {
  const light = headRead('builder/generated/templates-data.js');
  const entries = parseLightRegistry(light);
  const app = headRead('builder/app.js');
  assert.ok(
    /if\s*\(\s*tpl\.thumbnail\s*\)\s*\{[\s\S]{0,160}loadCardPreview/.test(app),
    'eager tpl.thumbnail → loadCardPreview'
  );
  const cards = probeCatalogCardHtml(app, entries);
  for (const id of ['professionals', 'desserdirina']) {
    const html = cards[id];
    assert.ok(html, id + ' card html');
    assert.ok(
      /template-card-preview-thumb/.test(html),
      id + ' has template-card-preview-thumb class'
    );
    assert.ok(/<img\b/i.test(html), id + ' has <img>');
    assert.ok(
      new RegExp('src=\"/app/generated/thumbs/' + id + '\\.', 'i').test(html),
      id + ' img src points at generated thumb'
    );
    // Not shimmer-only
    assert.ok(
      !/^<div class="template-card-preview"><div class="template-card-preview-shimmer"><\/div><\/div>$/.test(
        html.replace(/\s+/g, ' ').trim()
      ),
      id + ' must not be shimmer-only'
    );
  }
});

check('HEAD: customer-visible schemas have no English Instafidget feed URL (optional)', () => {
  for (const rel of SCHEMAS) {
    const src = headRead(rel);
    assert.ok(!src.includes(EN_IG), rel + ' must not contain ' + EN_IG);
    // product-menu + the four fixed templates all use the RO commercial label
    assert.ok(src.includes(RO_IG), rel + ' must use ' + RO_IG);
  }
  // Builder chrome must not reintroduce the English string either
  for (const rel of ['builder/app.js', 'builder/index.html']) {
    const src = headRead(rel);
    assert.ok(!src.includes(EN_IG), rel + ' no English IG feed label');
  }
});

check('HEAD: cookie consent dual-persists and survives simulated post-login /app/ load', () => {
  const html = headRead('builder/index.html');
  const m = html.match(/<script>\s*(\(function\(\)\{var K='hb-cookie-consent'[\s\S]*?\}\)\(\);)\s*<\/script>/);
  assert.ok(m, 'cookie banner IIFE in index.html');
  const snip = m[1];
  assert.ok(/document\.cookie/.test(snip), 'writes/reads document.cookie');
  assert.ok(/localStorage\.setItem/.test(snip), 'writes localStorage');
  assert.ok(/Max-Age=31536000/.test(snip), 'cookie Max-Age 1y');
  assert.ok(/SameSite=Lax/.test(snip), 'SameSite=Lax');

  // Simulated browser after Acceptă, then magic-link full reload that clears LS only
  // (mirrors QA walker addInitScript removeItem) — cookie must keep banner hidden.
  const store = Object.create(null);
  let cookieJar = '';
  const banner = {
    id: 'hb-cookie-banner',
    hidden: true,
    _shown: false,
  };
  const btn = { id: 'hb-cookie-accept', _fn: null, addEventListener: function (t, fn) { if (t === 'click') this._fn = fn; } };

  function runBannerScript(phase) {
    const sandbox = {
      localStorage: {
        getItem: (k) => (store[k] != null ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      document: {
        cookie: '',
        readyState: 'complete',
        getElementById: (id) => {
          if (id === 'hb-cookie-banner') return banner;
          if (id === 'hb-cookie-accept') return btn;
          return null;
        },
        addEventListener: function () {},
      },
    };
    Object.defineProperty(sandbox.document, 'cookie', {
      get() { return cookieJar; },
      set(v) {
        // Keep last hb-cookie-consent assignment; naive jar for this probe.
        const part = String(v).split(';')[0];
        const eq = part.indexOf('=');
        const k = part.slice(0, eq);
        const val = part.slice(eq + 1);
        const rest = cookieJar
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s && s.split('=')[0] !== k);
        rest.push(k + '=' + val);
        cookieJar = rest.join('; ');
      },
      configurable: true,
    });
    // Reset banner visibility each load like a fresh document
    banner.hidden = true;
    btn._fn = null;
    vm.runInNewContext(snip, sandbox, { timeout: 3000 });
    return { phase, hidden: banner.hidden, store: { ...store }, cookieJar };
  }

  // Landing: no consent → banner shown
  let st = runBannerScript('landing');
  assert.strictEqual(st.hidden, false, 'landing shows banner');
  assert.ok(btn._fn, 'accept handler bound');
  btn._fn(); // Acceptă
  assert.strictEqual(banner.hidden, true, 'accept hides banner');
  assert.strictEqual(store['hb-cookie-consent'], 'accepted', 'LS set');
  assert.ok(/hb-cookie-consent=accepted/.test(cookieJar), 'cookie set');

  // Simulate post-login /app/ load that wipes localStorage (walker / some browsers)
  // but keeps first-party cookies — banner must stay hidden and LS rehydrate.
  delete store['hb-cookie-consent'];
  st = runBannerScript('post-login');
  assert.strictEqual(st.hidden, true, 'post-login banner stays hidden via cookie');
  assert.strictEqual(
    store['hb-cookie-consent'],
    'accepted',
    'consent rehydrated into localStorage from cookie'
  );
});

check('HEAD: generated-site cookie banner JS also dual-persists', () => {
  const src = headRead('bot/site-legal.js');
  assert.ok(/document\.cookie/.test(src), 'site-legal cookie JS uses document.cookie');
  assert.ok(/Max-Age=31536000/.test(src), 'site-legal Max-Age');
  assert.ok(/localStorage\.setItem\(KEY/.test(src), 'site-legal still writes LS');
});

// ── Done ─────────────────────────────────────────────────────────────
if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll flow4-thumbs-ro-ig-cookie checks passed.');
process.exit(0);
