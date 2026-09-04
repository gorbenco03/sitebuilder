'use strict';
/**
 * bot/test/wave20-w19-advocate-leaks.test.js — Wave 20 remake of Wave 19 advocate leak.
 *
 * Opened Professional services Details on parent b4f48b2 still showed factory path globs:
 *   Share image (images/... or URL)
 *   Instagram gallery photos (URLs or images/...)
 *
 * Restaurant / trades / salon already use human RO labels (Imagine pentru partajare
 * socială…). Labels only — no key/type/value changes.
 *
 * VISION 2026-08-26: card → 7-day trial → live now → charge day 7 unless cancel.
 *
 * Run: node bot/test/wave20-w19-advocate-leaks.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = 'b4f48b2843acf3f7f5cb0e584f1500014c9abb9b';

const PRO_SCHEMA = 'templates/professionals/schema.json';
const OTHER_SCHEMAS = [
  'templates/product-menu/schema.json',
  'templates/portfolio/schema.json',
  'templates/local-service/schema.json',
];

/** Factory path-glob copy a stranger still saw under Search details / Instagram. */
const FACTORY_SHARE =
  'Share image (images/... or URL)';
const FACTORY_GALLERY =
  'Instagram gallery photos (URLs or images/...)';

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
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function headRead(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function fieldByKey(schema, key) {
  const sections = schema.sections || schema;
  const list = Array.isArray(sections) ? sections : Object.values(sections || {});
  for (const sec of list) {
    const fields = sec && sec.fields;
    if (!Array.isArray(fields)) continue;
    for (const f of fields) {
      if (f && f.key === key) return f;
    }
  }
  return null;
}

function parseSchema(src) {
  return JSON.parse(src);
}

function labelHasFactoryPathHint(label) {
  if (typeof label !== 'string') return true;
  // Factory path-glob copy only — plain "… URL" on a url-type field is fine.
  return (
    /images\/\.\.\./.test(label) ||
    /images\/\*\.jpg/i.test(label) ||
    /images\/\.\.\.\s*or\s*URL/i.test(label) ||
    /\(URLs?\s+or\s+images\//i.test(label) ||
    /images\/\.\.\.\s*or\s+URL/i.test(label) ||
    /\(images\/\.\.\.\s*or\s+URL\)/i.test(label)
  );
}

// ── Causal RED on parent Wave 17 / W19 advocate HEAD ─────────────────────
check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} professionals share-image is factory path glob`, () => {
  const src = parentBlob(PRO_SCHEMA);
  assert.ok(
    src.includes(FACTORY_SHARE),
    'parent must still carry Share image (images/... or URL)'
  );
  const schema = parseSchema(src);
  const f = fieldByKey(schema, 'seo.ogImage');
  assert.ok(f, 'parent seo.ogImage field');
  assert.strictEqual(f.label, FACTORY_SHARE, 'parent share label exact factory string');
  assert.ok(labelHasFactoryPathHint(f.label), 'parent share label has images/... or URL');
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} professionals Instagram gallery is factory path hint`, () => {
  const src = parentBlob(PRO_SCHEMA);
  assert.ok(
    src.includes(FACTORY_GALLERY),
    'parent must still carry Instagram gallery photos (URLs or images/...)'
  );
  const schema = parseSchema(src);
  const f = fieldByKey(schema, 'instagram.gallery');
  assert.ok(f, 'parent instagram.gallery field');
  assert.strictEqual(f.label, FACTORY_GALLERY, 'parent gallery label exact factory string');
  assert.ok(labelHasFactoryPathHint(f.label), 'parent gallery label has URLs or images/...');
});

// ── HEAD GREEN ───────────────────────────────────────────────────────────
check('HEAD professionals seo.ogImage is not a customer field (no factory path)', () => {
  const src = headRead(PRO_SCHEMA);
  assert.ok(!src.includes(FACTORY_SHARE), 'factory Share image (images/... or URL) gone');
  const schema = parseSchema(src);
  assert.ok(!fieldByKey(schema, 'seo.ogImage'), 'seo.ogImage must not be a customer field');
  assert.ok(!/Imagine pentru partajare socială/.test(src), 'no customer social-image URL copy');
  assert.ok(!/Share image\b/i.test(src), 'must not keep terse factory "Share image" lead-in');
  assert.ok(!/social sharing/i.test(src), 'no English "social sharing" in schema');
});

check('HEAD professionals instagram.gallery label is photo list (no path/URL factory hint)', () => {
  const src = headRead(PRO_SCHEMA);
  assert.ok(
    !src.includes(FACTORY_GALLERY),
    'factory Instagram gallery photos (URLs or images/...) gone'
  );
  const schema = parseSchema(src);
  const f = fieldByKey(schema, 'instagram.gallery');
  assert.ok(f, 'instagram.gallery present');
  assert.strictEqual(f.key, 'instagram.gallery');
  assert.strictEqual(f.type, 'list', 'type unchanged');
  assert.ok(typeof f.label === 'string' && f.label.length > 4, 'label present');
  assert.ok(!labelHasFactoryPathHint(f.label), 'no URLs or images/... in label');
  assert.ok(
    /Poze galerie Instagram/.test(f.label),
    'still a photo list label: ' + f.label
  );
});

check('HEAD professionals drops share field; gallery keys/types unchanged from parent', () => {
  const parent = parseSchema(parentBlob(PRO_SCHEMA));
  const head = parseSchema(headRead(PRO_SCHEMA));
  assert.ok(fieldByKey(parent, 'seo.ogImage'), 'parent still has seo.ogImage');
  assert.ok(!fieldByKey(head, 'seo.ogImage'), 'HEAD dropped seo.ogImage');
  const key = 'instagram.gallery';
  const p = fieldByKey(parent, key);
  const h = fieldByKey(head, key);
  assert.ok(p && h, key + ' on both');
  assert.strictEqual(h.key, p.key);
  assert.strictEqual(h.type, p.type);
  if (p.required !== undefined) assert.strictEqual(h.required, p.required);
  if (p.maxLen !== undefined) assert.strictEqual(h.maxLen, p.maxLen);
  if (p.min !== undefined) assert.strictEqual(h.min, p.min);
  if (p.max !== undefined) assert.strictEqual(h.max, p.max);
});

check('HEAD other three schemas drop customer social-image field (no factory regression)', () => {
  for (const rel of OTHER_SCHEMAS) {
    const src = headRead(rel);
    assert.ok(
      !src.includes(FACTORY_SHARE) && !/Share image \(images\//.test(src),
      rel + ' must not gain factory Share image path glob'
    );
    assert.ok(!fieldByKey(parseSchema(src), 'seo.ogImage'), rel + ' no seo.ogImage field');
    assert.ok(
      !/Imagine pentru partajare socială/.test(src),
      rel + ' no customer social-image URL copy'
    );
    assert.ok(
      !/Image for social sharing|Social sharing image/.test(src),
      rel + ' must not keep English social-sharing factory label'
    );
  }
});

check('HEAD professionals schema has no images/... or URL glob in any visible label', () => {
  const schema = parseSchema(headRead(PRO_SCHEMA));
  const labels = [];
  function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      if (typeof n.label === 'string') labels.push(n.label);
      Object.values(n).forEach(walk);
    }
  }
  walk(schema);
  for (const label of labels) {
    assert.ok(
      !labelHasFactoryPathHint(label),
      'label must not show factory path/URL hint: ' + label
    );
  }
});

process.exit(failed ? 1 : 0);
