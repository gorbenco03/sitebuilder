'use strict';
/**
 * bot/test/ro-copy-sweep.test.js — product-visible surfaces must be Romanian.
 *
 * Authority: VISION.md §3 (client/site surfaces in Romanian) + Flow 2
 * ("toate șabloanele în română"). Confirmed English leaks 2026-08-28.
 *
 * Causal: base 893042e still ships the English chrome strings listed below;
 * HEAD must not.
 *
 * Run: node bot/test/ro-copy-sweep.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BASE_SHA = '893042e3afa8a8dc367d983c00e9734b3e3a3a61';

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

function headRead(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function baseBlob(rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${BASE_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** Exact English product strings that must not appear on customer surfaces. */
const BUILDER_EN_LEAKS = [
  '>Designs</a>',
  '>How it works</a>',
  '>My projects</a>',
  '>My projects</h2>',
  'Sign out',
  'Choose a design',
  'New site',
  'Send via WhatsApp',
  'Back to editor',
  'We use essential browser storage so you can stay signed in and keep draft progress.',
  '>Accept</button>',
  '>Learn more</a>',
  '>Add Instagram</',
  'Email address',
  'email@example.com',
  'Send magic link',
  'Included free for 12 months, then Instafidget Free',
  '>Color</span>',
  'Download HTML',
  "versBtn.textContent = 'History'",
  "badgeLabel = 'Active'",
];

const BUILDER_RO_MUST = [
  '>Designuri</a>',
  '>Cum funcționează</a>',
  '>Proiectele mele</a>',
  'Deconectare',
  'Alege un design',
  'Site nou',
  'Trimite pe WhatsApp',
  'Înapoi la editor',
  'Folosim stocare esențială în browser',
  'Cookie-uri',
  'Acceptă',
  'Află mai mult',
  'Adaugă Instagram',
  'Adresă de email',
  'Trimite linkul pe email',
  'Inclus gratuit 12 luni',
  'Instafidget Free (filigran)',
  '>Culoare</span>',
  'Descarcă HTML',
  "versBtn.textContent = 'Istoric'",
  "badgeLabel = 'Activ'",
];

const PRESET_EN_LEAKS = [
  'Evening dinners, cellar wines',
  'Book a table',
  'At the table',
  '"about":"Our story"',
  '"scroll":"Explore"',
  '"title":"Reservations"',
];

const PRESET_RO_MUST = [
  'Cine de seară, vinuri de pivniță',
  'Rezervă o masă',
  'La masă',
  'Povestea noastră',
  'Explorează',
  'Rezervări',
  'Meniu',
];

// ── Causal RED on base ────────────────────────────────────────────────────
check(`causal RED: base ${BASE_SHA.slice(0, 7)} builder still ships English chrome leaks`, () => {
  const html = baseBlob('builder/index.html');
  const js = baseBlob('builder/app.js');
  const blob = html + '\n' + js;
  let hits = 0;
  for (const s of BUILDER_EN_LEAKS) {
    if (blob.includes(s)) hits++;
  }
  assert.ok(
    hits >= 8,
    `base must still have many EN leaks (got ${hits}); wrong BASE_SHA?`
  );
});

check(`causal RED: base ${BASE_SHA.slice(0, 7)} product-menu preset0 still English marketing`, () => {
  const raw = baseBlob('templates/product-menu/presets.json');
  const data = JSON.parse(raw);
  const cfg = data.presets[0].config;
  const blob = JSON.stringify(cfg);
  assert.ok(/Evening dinners/i.test(blob), 'base tagline English');
  assert.ok(/Book a table/i.test(blob), 'base CTA English');
  assert.ok(/At the table/i.test(blob), 'base servicesTitle English');
});

// ── GREEN on HEAD ─────────────────────────────────────────────────────────
check('HEAD builder chrome has no listed English leaks', () => {
  const html = headRead('builder/index.html');
  const js = headRead('builder/app.js');
  // Strip comments in app.js so // Add Instagram does not false-positive
  const jsNoComments = js.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const blob = html + '\n' + jsNoComments;
  for (const s of BUILDER_EN_LEAKS) {
    assert.ok(!blob.includes(s), 'EN leak still present: ' + s);
  }
});

check('HEAD builder chrome ships Romanian counterparts', () => {
  const html = headRead('builder/index.html');
  const js = headRead('builder/app.js');
  const blob = html + '\n' + js;
  for (const s of BUILDER_RO_MUST) {
    assert.ok(blob.includes(s), 'missing RO: ' + s);
  }
});

check('HEAD product-menu default preset (presets[0]) is Romanian marketing copy', () => {
  const data = JSON.parse(headRead('templates/product-menu/presets.json'));
  const cfg = data.presets[0].config;
  const blob = JSON.stringify(cfg);
  for (const s of PRESET_EN_LEAKS) {
    assert.ok(!blob.includes(s), 'preset EN leak: ' + s);
  }
  for (const s of PRESET_RO_MUST) {
    assert.ok(blob.includes(s), 'preset missing RO: ' + s);
  }
  assert.strictEqual(cfg.business.lang, 'ro');
  // Default demo brand is Romanian commercial Casa Nord (not EN North House / Chicago)
  assert.ok(cfg.business.name, 'has business.name');
  assert.ok(!/North House|Chicago|Lincoln Park/i.test(JSON.stringify(cfg)), 'no EN factory geo identity');
  assert.strictEqual(cfg.hero.ctaLabel, 'Rezervă o masă');
  assert.strictEqual(cfg.servicesTitle, 'La masă');
  assert.strictEqual(cfg.menu.title, 'Meniu');
  assert.strictEqual(cfg.contact.title, 'Rezervări');
  assert.strictEqual(cfg.labels.about, 'Povestea noastră');
  assert.strictEqual(cfg.labels.scroll, 'Explorează');
});

check('HEAD rendered product-menu default preset has RO nav/hero, no EN marketing', () => {
  const { renderHtml } = require('../../build.js');
  const tpl = headRead('templates/product-menu/template.html');
  const data = JSON.parse(headRead('templates/product-menu/presets.json'));
  const html = renderHtml(tpl, data.presets[0].config);
  assert.ok(/La masă/.test(html), 'nav servicesTitle RO');
  assert.ok(/Meniu/.test(html), 'menu title RO');
  assert.ok(/Rezervări/.test(html), 'contact title RO');
  assert.ok(/Rezervă o masă/.test(html), 'CTA RO');
  assert.ok(/Cine de seară/.test(html), 'tagline RO');
  assert.ok(/Povestea noastră/.test(html), 'about label RO');
  assert.ok(/Explorează/.test(html), 'scroll RO');
  assert.ok(!/Evening dinners, cellar wines/i.test(html));
  assert.ok(!/>\s*Book a table\s*</i.test(html));
  assert.ok(!/>\s*At the table\s*</i.test(html));
  assert.ok(!/>\s*Our story\s*</i.test(html));
  assert.ok(!/>\s*Explore\s*</i.test(html));
  assert.ok(!/>\s*Reservations\s*</i.test(html));
});

check('HEAD Instafidget commercial facts survive RO translation', () => {
  const html = headRead('builder/index.html');
  const m = html.match(/id=["']ig-partner-note["'][^>]*>([\s\S]*?)<\/p>/i);
  assert.ok(m, 'ig-partner-note present');
  const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(/Instafidget/i.test(text), 'names Instafidget');
  assert.ok(/produs partener|partner/i.test(text), 'partner framing');
  assert.ok(/12\s*luni|12\s*months/i.test(text), '12 months');
  assert.ok(/gratuit|free/i.test(text), 'free');
  assert.ok(/Instafidget Free/i.test(text) && /filigran/i.test(text), 'Free filigran');
});

check('HEAD cookie Accept button is Acceptă on builder + site-legal source', () => {
  const html = headRead('builder/index.html');
  assert.ok(/id=["']hb-cookie-accept["']>\s*Acceptă\s*</.test(html), 'builder Acceptă');
  assert.ok(!/id=["']hb-cookie-accept["']>\s*Accept\s*</.test(html), 'no bare Accept');
  const legal = headRead('bot/site-legal.js');
  assert.ok(/hb-cookie-accept["']?>Acceptă</.test(legal), 'site-legal Acceptă');
});

if (failed) {
  console.error('\nro-copy-sweep: FAILED (' + failed + ')');
  process.exit(1);
}
console.log('\nro-copy-sweep: OK');
process.exit(0);
