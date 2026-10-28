'use strict';
/**
 * bot/test/s83-s82-advocate.test.js — S83 remake of S82 ADVOCATE: STILL STANDING leaks.
 *
 * Form editor removed 2026-10-28: leftover 1 (cascadeBusinessNameIdentity — editor name change
 * cascading into title/about/facebook label) lived in the deleted editor; its parent-RED, HEAD and
 * wiring checks were dropped. Leftovers 2 and 3 are template/schema content and stay.
 *
 * Causal leftovers on parent 420b3e5 (S80 ACCEPT):
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
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '420b3e5a76e25bb0025f6b00f1f57953da766366';
const LS_PRESETS = 'templates/local-service/presets.json';
const LS_TEMPLATE = 'templates/local-service/template.html';
const PRO_SCHEMA = 'templates/professionals/schema.json';

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
  // Positive: finished Romanian forms remain present in the opened Meserii source.
  assert.ok(/Cere o ofertă gratuită/.test(joined), 'Cere o ofertă gratuită');
  assert.ok(/lucrări structurale/i.test(joined), 'lucrări structurale');
  assert.ok(/De ce să ne alegi/.test(joined), 'De ce să ne alegi');
  assert.ok(/garanție scrisă/i.test(joined), 'garanție scrisă');
  assert.ok(/Lucrări finalizate/.test(joined), 'Lucrări finalizate');
  assert.ok(/Renovări complete de baie/i.test(joined), 'Renovări complete de baie');
  assert.ok(/Cum lucrăm/.test(joined), 'Cum lucrăm');
  assert.ok(/\bUrmărește\b/.test(joined), 'Urmărește');
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

// Non-regression smoke (static) — do not weaken S80/S77/S74/S69 surfaces
check('HEAD non-regress: catalog chips still name five systems', () => {
  const html = read('builder/index.html');
  const chips = (html.match(/id=["']catalog-chips["'][\s\S]*?<\/div>/i) || [''])[0];
  assert.ok(/Restaurant/.test(chips), 'Restaurant chip');
  assert.ok(/Meserii|Trades/.test(chips), 'Meserii chip');
  assert.ok(/Salon/.test(chips), 'Salon chip');
  assert.ok(/Servicii profesionale|Professional services/.test(chips), 'Servicii profesionale chip');
  assert.ok(/Cofetărie|Desserdirina/.test(chips), 'Cofetărie chip');
});

check('HEAD non-regress: landing shows price+renewal spans (currency owner 2026-09-27), and Fără boți', () => {
  const html = read('builder/index.html');
  assert.ok(/id="hero-price">99</.test(html), 'hero-price span with 99 fallback');
  // Owner decision 2026-09-27: the 29/year renewal (with currency symbol,
  // filled by app.js from /api/config) is back on the landing page.
  assert.ok(/id="hero-renewal">29</.test(html), 'hero-renewal span with 29 fallback');
  assert.ok(/Fără boți|Fara boti/i.test(html), 'Fără boți RO denial');
  assert.ok(!/No bots/i.test(html), 'no English No bots on landing');
});

if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll s83-s82-advocate checks passed.');
process.exit(0);
