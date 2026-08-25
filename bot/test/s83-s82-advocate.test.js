'use strict';
/**
 * bot/test/s83-s82-advocate.test.js — S83 remake of S82 ADVOCATE: STILL STANDING leaks.
 *
 * Causal leftovers on parent 420b3e5 (S80 ACCEPT):
 *   1. Name change on business.name does not cascade to business.title / about /
 *      contact.facebook.label → live <title>/og and chips stay Casa Nord / Cabinet Marin
 *   2. Meseriași below-fold factory still ASCII: Cere oferta gratuita, Zidarie si structura,
 *      De ce sa ne alegi, Garantie scrisa, Lucrari realizate, Renovari baie, Cum lucram, URMARESTE
 *   3. Professionals Detalii labels still: Telefon (... tel:), URL Instagram contact, URL Facebook,
 *      URL profil Instagram
 *
 * Overlay RED on parent, GREEN on HEAD. Isolated static + renderHtml only (no live server).
 * Run: node bot/test/s83-s82-advocate.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '420b3e5a76e25bb0025f6b00f1f57953da766366';
const APP_JS = 'builder/app.js';
const LS_PRESETS = 'templates/local-service/presets.json';
const LS_TEMPLATE = 'templates/local-service/template.html';
const PRO_SCHEMA = 'templates/professionals/schema.json';
const PM_PRESETS = 'templates/product-menu/presets.json';
const PRO_PRESETS = 'templates/professionals/presets.json';
const PM_TPL = 'templates/product-menu/template.html';
const PRO_TPL = 'templates/professionals/template.html';

const { renderHtml } = require('../../build.js');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i++];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return src.slice(m.index, i);
}

function loadFirstPreset(rel) {
  const body = JSON.parse(read(rel));
  const presets = body.presets || [];
  assert.ok(presets.length >= 1, rel + ' has presets');
  return JSON.parse(JSON.stringify(presets[0].config));
}

function collectLabels(schema) {
  const labels = [];
  function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      if (typeof n.label === 'string') labels.push(n.label);
      if (typeof n.title === 'string') labels.push(n.title);
      Object.values(n).forEach(walk);
    }
  }
  walk(schema);
  return labels;
}

/** Run cascadeBusinessNameIdentity from app source against a config clone. */
function runCascade(appSrc, config, oldName, newName) {
  const fn = extractFunction(appSrc, 'cascadeBusinessNameIdentity');
  assert.ok(fn && fn.length > 40, 'cascadeBusinessNameIdentity must exist in app.js');
  const getPathFn = extractFunction(appSrc, 'getPath');
  const setPathFn = extractFunction(appSrc, 'setPath');
  assert.ok(getPathFn && setPathFn, 'getPath/setPath required');
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(getPathFn + '\n' + setPathFn + '\n' + fn + '\n', sandbox);
  const cfg = JSON.parse(JSON.stringify(config));
  sandbox.cascadeBusinessNameIdentity(cfg, oldName, newName);
  if (cfg.business) cfg.business.name = newName;
  return cfg;
}

// ASCII / undiacritic factory leftovers a stranger still sees below the fold on Meseriași
const MESERIASI_ASCII_LEFTOVERS = [
  'Cere oferta gratuita',
  'Zidarie si structura',
  'De ce sa ne alegi',
  'Garantie scrisa',
  'Lucrari realizate',
  'Renovari baie',
  'Cum lucram',
  'URMARESTE',
];

// ── Causal RED on parent ───────────────────────────────────────────────────
check('causal RED: parent app.js has no business-name identity cascade', () => {
  const src = parentBlob(APP_JS);
  assert.ok(src, 'parent app.js');
  assert.ok(
    !/function\s+cascadeBusinessNameIdentity\s*\(/.test(src),
    'parent lacks cascadeBusinessNameIdentity'
  );
  // Parent setPath / drawer input just write the key — no title/about/facebook sync
  assert.ok(/function\s+setPath\s*\(/.test(src), 'parent still has setPath');
});

check('causal RED: parent restaurant preset still factory Casa Nord identity', () => {
  const presets = parentBlob(PM_PRESETS);
  assert.ok(presets, 'parent product-menu presets');
  assert.ok(/Casa Nord \| Restaurant/.test(presets), 'parent title Casa Nord');
  assert.ok(/"about":\s*"Casa Nord e o sal/.test(presets), 'parent about starts Casa Nord');
  assert.ok(/"label":\s*"Casa Nord"/.test(presets), 'parent facebook label Casa Nord');
});

check('causal RED: parent Meseriași source still has undiacritic below-fold factory', () => {
  const presets = parentBlob(LS_PRESETS);
  const tpl = parentBlob(LS_TEMPLATE);
  assert.ok(presets && tpl, 'parent local-service files');
  const joined = presets + '\n' + tpl;
  for (const s of MESERIASI_ASCII_LEFTOVERS) {
    // URMARESTE may appear only as Urmareste (CSS uppercases); accept either form as RED
    if (s === 'URMARESTE') {
      assert.ok(
        /URMARESTE/.test(joined) || /\bUrmareste\b/.test(joined),
        'parent has URMARESTE/Urmareste leftover'
      );
      continue;
    }
    assert.ok(joined.includes(s), 'parent leftover: ' + s);
  }
});

check('causal RED: parent professionals Detalii still teaches tel: / URL Instagram contact', () => {
  const schema = parentBlob(PRO_SCHEMA);
  assert.ok(schema, 'parent professionals schema');
  assert.ok(/tel:/.test(schema), 'parent has tel: in labels');
  assert.ok(/URL Instagram contact/.test(schema), 'parent URL Instagram contact');
  assert.ok(/URL Facebook/.test(schema) || /URL profil Instagram/.test(schema),
    'parent URL Facebook / URL profil Instagram');
});

// ── GREEN on HEAD ──────────────────────────────────────────────────────────
check('HEAD: cascadeBusinessNameIdentity updates restaurant title/about/facebook', () => {
  const appSrc = read(APP_JS);
  const cfg = loadFirstPreset(PM_PRESETS);
  assert.strictEqual(cfg.business.name, 'North House');
  const newName = 'QaLive S81';
  const next = runCascade(appSrc, cfg, 'North House', newName);
  assert.strictEqual(next.business.name, newName);
  assert.ok(next.business.title.includes(newName), 'title contains new name: ' + next.business.title);
  assert.ok(!/North House/.test(next.business.title), 'title no longer North House');
  assert.ok(next.business.about.startsWith(newName), 'about starts with new name');
  assert.ok(!next.business.about.startsWith('North House'), 'about no longer starts North House');
  assert.strictEqual(next.contact.facebook.label, newName);
});

check('HEAD: after name cascade, restaurant renderHtml <title>/og drop North House', () => {
  const appSrc = read(APP_JS);
  const cfg = loadFirstPreset(PM_PRESETS);
  const newName = 'QaLive S81';
  const next = runCascade(appSrc, cfg, 'North House', newName);
  const html = renderHtml(read(PM_TPL), next);
  const titleM = html.match(/<title>([^<]*)<\/title>/i);
  assert.ok(titleM, 'has title');
  assert.ok(titleM[1].includes(newName), 'title has new name: ' + titleM[1]);
  assert.ok(!/North House/.test(titleM[1]), 'title free of North House');
  const ogM = html.match(/property=["']og:title["']\s+content=["']([^"']*)["']/i)
    || html.match(/content=["']([^"']*)["']\s+property=["']og:title["']/i);
  assert.ok(ogM, 'og:title present');
  assert.ok(ogM[1].includes(newName), 'og:title has new name');
  assert.ok(!/North House/.test(ogM[1]), 'og:title free of North House');
  // Facebook chip label in body
  assert.ok(html.includes(newName), 'body mentions new name');
  // About must not still lead with factory name
  assert.ok(!/North House is a small dining room/i.test(html), 'about no longer factory lead-in');
});

check('HEAD: cascadeBusinessNameIdentity updates professionals title for Whitfield Law', () => {
  const appSrc = read(APP_JS);
  const cfg = loadFirstPreset(PRO_PRESETS);
  assert.ok(/Whitfield Law/.test(cfg.business.name + cfg.business.title), 'factory Whitfield Law');
  const newName = 'Cabinet S81';
  const next = runCascade(appSrc, cfg, 'Whitfield Law', newName);
  assert.ok(next.business.title.includes(newName), 'title has new name: ' + next.business.title);
  assert.ok(!/Whitfield Law/.test(next.business.title), 'title free of Whitfield Law');
  const html = renderHtml(read(PRO_TPL), next);
  const titleM = html.match(/<title>([^<]*)<\/title>/i);
  assert.ok(titleM, 'has title');
  assert.ok(titleM[1].includes(newName), 'live title has new name');
  assert.ok(!/Whitfield Law/.test(titleM[1]), 'live title free of Whitfield Law');
});

check('HEAD: Meseriași first opened preset/template has no ASCII below-fold leftovers', () => {
  const presets = read(LS_PRESETS);
  const tpl = read(LS_TEMPLATE);
  const joined = presets + '\n' + tpl;
  for (const s of MESERIASI_ASCII_LEFTOVERS) {
    if (s === 'URMARESTE') {
      assert.ok(!/\bURMARESTE\b/.test(joined), 'no bare URMARESTE');
      assert.ok(!/\bUrmareste\b/.test(joined), 'no Urmareste without diacritics');
      continue;
    }
    assert.ok(!joined.includes(s), 'no leftover: ' + s);
  }
  // Positive: finished English forms present somewhere in opened Trades source
  assert.ok(/Get a free quote/.test(joined), 'finished "Get a free quote"');
  assert.ok(/structural work/i.test(joined), 'finished "structural work"');
  assert.ok(/Why choose us/.test(joined), 'finished "Why choose us"');
  assert.ok(/written warranty/i.test(joined), 'finished "written warranty"');
  assert.ok(/Completed work/.test(joined), 'finished "Completed work"');
  assert.ok(/bathroom renovation/i.test(joined), 'finished "bathroom renovations"');
  assert.ok(/How we work/.test(joined), 'finished "How we work"');
  assert.ok(/\bFollow\b/.test(joined), 'finished "Follow"');
});

check('HEAD: professionals Detalii labels have no tel: and no URL Instagram contact', () => {
  const schema = JSON.parse(read(PRO_SCHEMA));
  const labels = collectLabels(schema);
  const joined = labels.join('\n');
  assert.ok(!/tel:/.test(joined), 'no tel: in Detalii labels');
  assert.ok(!/URL Instagram contact/i.test(joined), 'no URL Instagram contact');
  assert.ok(!/\bURL Facebook\b/i.test(joined), 'no bare URL Facebook label');
  assert.ok(!/URL profil Instagram/i.test(joined), 'no URL profil Instagram');
  // Fields must remain usable (keys still present)
  const keys = [];
  function walkKeys(n) {
    if (Array.isArray(n)) return n.forEach(walkKeys);
    if (n && typeof n === 'object') {
      if (typeof n.key === 'string') keys.push(n.key);
      Object.values(n).forEach(walkKeys);
    }
  }
  walkKeys(schema);
  assert.ok(keys.includes('contact.phone'), 'contact.phone field stays');
  assert.ok(keys.includes('contact.instagram.url'), 'contact.instagram.url stays');
  assert.ok(keys.includes('contact.facebook.url'), 'contact.facebook.url stays');
  assert.ok(keys.includes('instagram.url'), 'instagram.url stays');
});

check('HEAD: drawer/inline name edits call cascade (wiring)', () => {
  const src = read(APP_JS);
  assert.ok(/cascadeBusinessNameIdentity\s*\(/.test(src), 'cascade called somewhere');
  // Must run when business.name is written from drawer or inline
  const hasWiring =
    /business\.name[\s\S]{0,200}cascadeBusinessNameIdentity|cascadeBusinessNameIdentity[\s\S]{0,200}business\.name/.test(src)
    || /key\s*===\s*['"]business\.name['"][\s\S]{0,300}cascadeBusinessNameIdentity/.test(src)
    || /path\s*===\s*['"]business\.name['"][\s\S]{0,300}cascadeBusinessNameIdentity/.test(src);
  assert.ok(hasWiring, 'cascade wired to business.name edits');
});

// Non-regression smoke (static) — do not weaken S80/S77/S74/S69 surfaces
check('HEAD non-regress: catalog chips still name four systems', () => {
  const html = read('builder/index.html');
  const chips = (html.match(/id=["']catalog-chips["'][\s\S]*?<\/div>/i) || [''])[0];
  assert.ok(/Restaurant/.test(chips), 'Restaurant chip');
  assert.ok(/Trades/.test(chips), 'Trades chip');
  assert.ok(/Salon/.test(chips), 'Salon chip');
  assert.ok(/Professional services/.test(chips), 'Professional services chip');
});

check('HEAD non-regress: landing still shows 100€ / 29€ and No bots', () => {
  const html = read('builder/index.html');
  assert.ok(/100\s*€|100€/.test(html), '100€');
  assert.ok(/29\s*€|29€/.test(html), '29€');
  assert.ok(/No bots/i.test(html), 'No bots');
});

if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll s83-s82-advocate checks passed.');
process.exit(0);
