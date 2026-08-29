'use strict';
/**
 * bot/test/s89-s88-advocate.test.js — S89 remake of S88 ADVOCATE: STILL STANDING leaks.
 *
 * Causal leftovers on parent 59468f4 (S86 ACCEPT):
 *   1. Meseriași template flow + gallery eyebrow undiacritic factory
 *   2. First preset trust/gallery titles + kitchen blurb undiacritic
 *   3. Professionals Detalii: "Link Instagram la contact" + language "(ro sau en)"
 *   4. Dashboard .site-live-link / .user-badge max-width + nowrap ellipsis clip
 *
 * Overlay RED on parent, GREEN on HEAD. Static source only.
 * Run: node bot/test/s89-s88-advocate.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '59468f42516addb18250bc6dfdcfc92cd1e94c2c';

const LS_PRESETS = 'templates/local-service/presets.json';
const LS_TEMPLATE = 'templates/local-service/template.html';
const PRO_SCHEMA = 'templates/professionals/schema.json';
const PM_SCHEMA = 'templates/product-menu/schema.json';
const LS_SCHEMA = 'templates/local-service/schema.json';
const PORT_SCHEMA = 'templates/portfolio/schema.json';
const APP_CSS = 'builder/app.css';

const SCHEMA_LANG = [PRO_SCHEMA, PM_SCHEMA, LS_SCHEMA, PORT_SCHEMA];

/** Undiacritic factory substrings a stranger still saw on S88. */
const MESERIASI_LEFTOVERS = [
  'Evaluare gratuita',
  'Contact in 24h',
  'fara costuri',
  'Executie controlata',
  'Echipa pe santier',
  'Receptie + garantie',
  'Predare impreuna',
  '>Lucrari<',
  'Asigurare completa',
  'Bucatarii si spatii',
  'Amenajam spatii',
  'demolare pereti',
  'portelanata si',
  'Extinderi si lucrari',
];

const MESERIASI_FINISHED = [
  'Free evaluation',
  'Contact within 24 hours, an on-site visit, and a clear estimate — no hidden costs.',
  'Controlled execution',
  'Crew on site, written deadlines, checked materials.',
  'Handover + warranty',
  'Handover together with you, backed by a warranty.',
  'Work',
  'Fully insured',
  'Kitchens & open-plan living',
  'We build modern living spaces: wall removal, framing, wiring, porcelain tile, and painting for a flawless result.',
  'Additions & structural work',
];

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

/** First Meseriași preset JSON slice (presets[0] only). */
function firstPresetSource(presetsJsonText) {
  const body = JSON.parse(presetsJsonText);
  const presets = body.presets || [];
  assert.ok(presets.length >= 1, 'local-service has presets');
  return JSON.stringify(presets[0]);
}

function ruleBlock(css, selector) {
  const re = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}',
    'm'
  );
  const m = re.exec(css);
  return m ? m[1] : '';
}

function hasClipCombo(block, maxWidthPx) {
  const mw = new RegExp('max-width\\s*:\\s*' + maxWidthPx + 'px', 'i').test(block);
  const nowrap = /white-space\s*:\s*nowrap/i.test(block);
  const ellipsis = /text-overflow\s*:\s*ellipsis/i.test(block);
  return mw && nowrap && ellipsis;
}

// ─── Causal RED on parent ───────────────────────────────────────────

check('causal RED: parent Meseriași first-preset + template still undiacritic factory', () => {
  const presets = parentBlob(LS_PRESETS);
  const tpl = parentBlob(LS_TEMPLATE);
  assert.ok(presets && tpl, 'parent local-service blobs');
  const joined = firstPresetSource(presets) + '\n' + tpl;
  let hits = 0;
  for (const s of MESERIASI_LEFTOVERS) {
    if (joined.includes(s)) hits++;
  }
  assert.ok(hits >= 8, 'parent still has undiacritic leftovers, hits=' + hits);
});

check('causal RED: parent professionals still Link Instagram la contact', () => {
  const schema = parentBlob(PRO_SCHEMA);
  assert.ok(schema, 'parent professionals schema');
  assert.ok(
    schema.includes('Link Instagram la contact') || /Link Instagram/.test(schema),
    'parent Link Instagram leftover'
  );
});

check('causal RED: parent language labels still (ro sau en)', () => {
  let hit = false;
  for (const rel of SCHEMA_LANG) {
    const s = parentBlob(rel);
    assert.ok(s, 'parent ' + rel);
    if (/\(ro sau en\)/.test(s)) hit = true;
  }
  assert.ok(hit, 'parent has Limba site-ului (ro sau en)');
});

check('causal RED: parent .site-live-link clips with 200px nowrap ellipsis', () => {
  const css = parentBlob(APP_CSS);
  assert.ok(css, 'parent app.css');
  const block = ruleBlock(css, '.site-live-link');
  assert.ok(block, 'parent .site-live-link rule');
  assert.ok(
    hasClipCombo(block, 200),
    'parent .site-live-link has max-width:200px + nowrap + ellipsis'
  );
});

check('causal RED: parent .user-badge clips with 140px nowrap ellipsis', () => {
  const css = parentBlob(APP_CSS);
  assert.ok(css, 'parent app.css');
  const block = ruleBlock(css, '.user-badge');
  assert.ok(block, 'parent .user-badge rule');
  assert.ok(
    hasClipCombo(block, 140),
    'parent .user-badge has max-width:140px + nowrap + ellipsis'
  );
});

// ─── GREEN on HEAD ──────────────────────────────────────────────────

check('HEAD: Meseriași first-preset + template have no undiacritic leftovers', () => {
  const joined = firstPresetSource(read(LS_PRESETS)) + '\n' + read(LS_TEMPLATE);
  for (const s of MESERIASI_LEFTOVERS) {
    assert.ok(!joined.includes(s), 'no leftover: ' + s);
  }
});

check('HEAD: Meseriași first-preset + template contain finished English', () => {
  const joined = firstPresetSource(read(LS_PRESETS)) + '\n' + read(LS_TEMPLATE);
  for (const s of MESERIASI_FINISHED) {
    assert.ok(joined.includes(s), 'has finished: ' + s);
  }
});

check('HEAD: professionals schema has no Link Instagram la contact / Link Instagram', () => {
  const schema = read(PRO_SCHEMA);
  assert.ok(!schema.includes('Link Instagram la contact'), 'no Link Instagram la contact');
  assert.ok(!/Link Instagram/.test(schema), 'no Link Instagram');
  // RO Detalii family (Flow 4): not English "Instagram (contact section)"
  assert.ok(
    /Instagram \(secțiune contact\)/.test(schema) ||
      /Instagram \(secțiunea contact\)/.test(schema),
    'has Instagram (secțiune contact) RO label'
  );
  assert.ok(
    !schema.includes('Instagram (contact section)'),
    'no English Instagram (contact section)'
  );
});

check('HEAD: four schemas language label is Limba site-ului without (ro sau en)', () => {
  for (const rel of SCHEMA_LANG) {
    const s = read(rel);
    assert.ok(!/\(ro sau en\)/.test(s), rel + ' no (ro sau en)');
    assert.ok(
      /"label"\s*:\s*"Limba site-ului"/.test(s),
      rel + ' has Limba site-ului label'
    );
    assert.ok(
      !/"label"\s*:\s*"Site language"/.test(s),
      rel + ' no English Site language label'
    );
  }
});

check('HEAD: .site-live-link does not combine max-width 200px with nowrap ellipsis', () => {
  const css = read(APP_CSS);
  const block = ruleBlock(css, '.site-live-link');
  assert.ok(block, '.site-live-link rule exists');
  assert.ok(
    !hasClipCombo(block, 200),
    '.site-live-link must not clip slug with 200px nowrap ellipsis'
  );
});

check('HEAD: .user-badge does not clip with max-width 140px + nowrap ellipsis', () => {
  const css = read(APP_CSS);
  const block = ruleBlock(css, '.user-badge');
  assert.ok(block, '.user-badge rule exists');
  assert.ok(
    !hasClipCombo(block, 140),
    '.user-badge must not mid-clip email with 140px nowrap ellipsis'
  );
});

if (failed) {
  console.error('\n' + failed + ' failed');
  process.exit(1);
}
console.log('\nAll s89-s88-advocate checks passed');
