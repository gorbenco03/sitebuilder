'use strict';
/**
 * S48: browser editor picker + schema labels are restaurant / salon / trade.
 * IDs stay product-menu | portfolio | local-service; human names must not sell bakery leftovers.
 * Run: node bot/test/s48-editor-vertical-labels.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const IDS = ['product-menu', 'portfolio', 'local-service'];

/** Bakery/patisserie editor copy that must not appear in product-menu schema. */
const BAKERY_FORBIDDEN = [
  'Inspirație dulce',
  'Cofetăria',
  'Creații cu suflet',
  'Comandă o surpriză',
];

/** Leftover generic picker names that must not remain as display names. */
const FORBIDDEN_DISPLAY = [
  'Meniu & magazin',
  'Portofoliu',
  'Servicii locale',
];

let failed = false;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed = true;
    console.error('FAIL', name, '-', e.message);
  }
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function schemaRaw(id) {
  return fs.readFileSync(path.join(ROOT, 'templates', id, 'schema.json'), 'utf8');
}

function schemaName(id) {
  return readJson(path.join('templates', id, 'schema.json')).name;
}

function registryById() {
  const reg = readJson('templates/registry.json');
  assert.ok(Array.isArray(reg.templates), 'registry.templates must be array');
  const map = Object.create(null);
  for (const t of reg.templates) {
    assert.ok(t && t.id, 'registry entry needs id');
    map[t.id] = t;
  }
  return map;
}

function hasEmbedField(schema) {
  for (const sec of schema.sections || []) {
    for (const f of sec.fields || []) {
      if (f.key === 'instagram.embedUrl') return true;
    }
  }
  return false;
}

function hasGalleryField(schema) {
  for (const sec of schema.sections || []) {
    for (const f of sec.fields || []) {
      if (f.key === 'instagram.gallery') return true;
    }
  }
  return false;
}

check('registry keeps system ids and names restaurant / salon / trade', () => {
  const byId = registryById();
  for (const id of IDS) {
    assert.ok(byId[id], `missing registry id ${id}`);
  }
  assert.strictEqual(byId['product-menu'].id, 'product-menu');
  assert.strictEqual(byId['portfolio'].id, 'portfolio');
  assert.strictEqual(byId['local-service'].id, 'local-service');

  const pm = String(byId['product-menu'].name || '');
  const pf = String(byId['portfolio'].name || '');
  const ls = String(byId['local-service'].name || '');

  assert.ok(!FORBIDDEN_DISPLAY.includes(pm), `product-menu still named ${JSON.stringify(pm)}`);
  assert.ok(!FORBIDDEN_DISPLAY.includes(pf), `portfolio still named ${JSON.stringify(pf)}`);
  assert.ok(!FORBIDDEN_DISPLAY.includes(ls), `local-service still named ${JSON.stringify(ls)}`);

  assert.ok(/restaurant/i.test(pm), `product-menu name should read restaurant, got ${JSON.stringify(pm)}`);
  assert.ok(/salon/i.test(pf), `portfolio name should read salon, got ${JSON.stringify(pf)}`);
  assert.ok(/meseria|construc/i.test(ls), `local-service name should read trade/construction, got ${JSON.stringify(ls)}`);

  for (const t of Object.values(byId)) {
    for (const bad of FORBIDDEN_DISPLAY) {
      assert.ok(t.name !== bad, `registry still sells leftover name ${JSON.stringify(bad)}`);
    }
  }
});

check('schema.json display names match verticals (not Meniu & magazin / Portofoliu / Servicii locale)', () => {
  const pm = schemaName('product-menu');
  const pf = schemaName('portfolio');
  const ls = schemaName('local-service');

  assert.ok(!FORBIDDEN_DISPLAY.includes(pm), `product-menu schema name still ${JSON.stringify(pm)}`);
  assert.ok(!FORBIDDEN_DISPLAY.includes(pf), `portfolio schema name still ${JSON.stringify(pf)}`);
  assert.ok(!FORBIDDEN_DISPLAY.includes(ls), `local-service schema name still ${JSON.stringify(ls)}`);

  assert.ok(/restaurant/i.test(pm), `product-menu schema name needs restaurant, got ${JSON.stringify(pm)}`);
  assert.ok(/salon/i.test(pf), `portfolio schema name needs salon, got ${JSON.stringify(pf)}`);
  assert.ok(/meseria|construc/i.test(ls), `local-service schema name needs trade/construction, got ${JSON.stringify(ls)}`);
});

check('product-menu schema editor copy is not bakery/patisserie/cofetărie', () => {
  const raw = schemaRaw('product-menu');
  for (const phrase of BAKERY_FORBIDDEN) {
    assert.ok(!raw.includes(phrase), `product-menu schema still contains bakery copy: ${JSON.stringify(phrase)}`);
  }
  // Broader leftovers called out in the card
  assert.ok(!/cofetărie/i.test(raw), 'product-menu schema still mentions cofetărie');
  assert.ok(!/roz-cărămiziu/i.test(raw), 'product-menu schema still teaches roz-cărămiziu bakery accent');
  // Restaurant-facing examples should teach reservation / seasonal menu / kitchen Instagram language
  const lower = raw.toLowerCase();
  const hasRestaurantCue =
    /rezerv/i.test(raw) ||
    /meniu de sezon/i.test(raw) ||
    /bucătărie/i.test(raw) ||
    /restaurant/i.test(raw);
  assert.ok(hasRestaurantCue, 'product-menu schema should teach restaurant language (rezervă / meniu / bucătărie)');
  void lower;
});

check('instagram.embedUrl and instagram.gallery remain in all three schemas', () => {
  for (const id of IDS) {
    const schema = readJson(path.join('templates', id, 'schema.json'));
    assert.strictEqual(schema.templateId, id, `${id}: templateId must stay ${id}`);
    assert.ok(hasEmbedField(schema), `${id}: missing instagram.embedUrl field`);
    assert.ok(hasGalleryField(schema), `${id}: missing instagram.gallery field`);
  }
});

check('schema field contracts keep keys (spot-check required core keys)', () => {
  for (const id of IDS) {
    const schema = readJson(path.join('templates', id, 'schema.json'));
    const keys = new Set();
    for (const sec of schema.sections || []) {
      for (const f of sec.fields || []) {
        if (f.key) keys.add(f.key);
      }
    }
    for (const need of ['business.name', 'business.tagline', 'instagram.embedUrl', 'instagram.gallery']) {
      assert.ok(keys.has(need), `${id}: missing field key ${need}`);
    }
  }
});

if (failed) {
  console.error('s48-editor-vertical-labels: FAILED');
  process.exit(1);
}
console.log('s48-editor-vertical-labels: ok');
process.exit(0);
