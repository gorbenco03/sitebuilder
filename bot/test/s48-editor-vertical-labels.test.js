'use strict';
/**
 * S48: browser editor picker + schema labels match the current commercial catalog.
 * IDs stay product-menu | portfolio | local-service (+ professionals, desserdirina);
 * human names must not sell bakery leftovers on the restaurant system.
 *
 * STALE-ORACLE note (S-legacy G4 / t_96bf4c57): earlier asserts required English
 * "trade" inside the local-service *registry* display name. Shipped picker copy is
 * Romanian "Meserii" (schema.json still uses English "Trades"). Updated to pin the
 * live RO registry names from templates/registry.json.
 *
 * Run: node bot/test/s48-editor-vertical-labels.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
/** Core verticals exercised by S48 editor-label contract. */
const IDS = ['product-menu', 'portfolio', 'local-service'];
/** Full commercial catalog (registry order). */
const ALL_IDS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

/** Live registry display names (RO picker). */
const REGISTRY_NAMES = {
  'product-menu': 'Restaurant',
  'local-service': 'Meserii',
  portfolio: 'Salon',
  professionals: 'Servicii profesionale',
  desserdirina: 'Desserdirina',
};

/** Schema display names may differ slightly (EN schema title for trades). */
const SCHEMA_NAME_RE = {
  'product-menu': /restaurant/i,
  portfolio: /salon/i,
  // schema.json uses "Trades"; registry uses "Meserii"
  'local-service': /trade|meserii|construction|renov/i,
};

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

check('registry keeps five commercial ids with live RO picker names', () => {
  const byId = registryById();
  const reg = readJson('templates/registry.json');
  const ids = reg.templates.map((t) => t.id);
  assert.deepStrictEqual(ids, ALL_IDS, `registry order/ids drifted: ${JSON.stringify(ids)}`);

  for (const id of ALL_IDS) {
    assert.ok(byId[id], `missing registry id ${id}`);
    const name = String(byId[id].name || '');
    assert.strictEqual(
      name,
      REGISTRY_NAMES[id],
      `${id} registry name expected ${JSON.stringify(REGISTRY_NAMES[id])}, got ${JSON.stringify(name)}`
    );
  }

  for (const t of Object.values(byId)) {
    for (const bad of FORBIDDEN_DISPLAY) {
      assert.ok(t.name !== bad, `registry still sells leftover name ${JSON.stringify(bad)}`);
    }
  }
});

check('schema.json display names match verticals (not Meniu & magazin / Portofoliu / Servicii locale)', () => {
  for (const id of IDS) {
    const name = schemaName(id);
    assert.ok(!FORBIDDEN_DISPLAY.includes(name), `${id} schema name still ${JSON.stringify(name)}`);
    assert.ok(
      SCHEMA_NAME_RE[id].test(name),
      `${id} schema name needs ${SCHEMA_NAME_RE[id]}, got ${JSON.stringify(name)}`
    );
  }
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
  const hasRestaurantCue =
    /rezerv/i.test(raw) ||
    /meniu de sezon/i.test(raw) ||
    /bucătărie/i.test(raw) ||
    /restaurant/i.test(raw);
  assert.ok(hasRestaurantCue, 'product-menu schema should teach restaurant language (rezervă / meniu / bucătărie)');
});

check('instagram.embedUrl and instagram.gallery remain in commercial schemas', () => {
  for (const id of ALL_IDS) {
    const schema = readJson(path.join('templates', id, 'schema.json'));
    assert.strictEqual(schema.templateId, id, `${id}: templateId must stay ${id}`);
    assert.ok(hasEmbedField(schema), `${id}: missing instagram.embedUrl field`);
    assert.ok(hasGalleryField(schema), `${id}: missing instagram.gallery field`);
  }
});

check('schema field contracts keep keys (spot-check required core keys)', () => {
  for (const id of ALL_IDS) {
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
