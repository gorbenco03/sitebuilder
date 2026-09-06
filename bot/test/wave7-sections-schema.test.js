'use strict';
/**
 * bot/test/wave7-sections-schema.test.js
 *
 * Wave 7 — templates/professionals/schema.json gains a `pageSections` array:
 * the canonical, ordered list of page sections this template offers, each
 * with a Romanian label and a `removable` flag. builder/app.js reads this to
 * build the "Secțiuni pagină" add/remove/reorder panel; build.js's
 * NON_REMOVABLE_SECTION_IDS is the render-time mirror of the same guardrail.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-sections-schema.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/schema.json'), 'utf8'));
const { NON_REMOVABLE_SECTION_IDS } = require(path.join(ROOT, 'build.js'));

test('schema.pageSections exists and lists every reorderable section id exactly once', () => {
  assert.ok(Array.isArray(schema.pageSections) && schema.pageSections.length > 0);
  const ids = schema.pageSections.map((s) => s.id);
  const expected = ['services', 'process', 'about', 'appointment', 'faq', 'instagram', 'contact'];
  assert.deepEqual(ids.slice().sort(), expected.slice().sort());
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
});

test('every pageSections entry has a Romanian label with correct diacritics and an explicit removable flag', () => {
  const ASCII_FALLBACK_HINTS = /\b(sectiune|servicii\b.*intrebari|programari|intalniri)\b/i; // common ASCII-ified RO mistakes
  for (const s of schema.pageSections) {
    assert.equal(typeof s.id, 'string');
    assert.ok(s.id.length > 0);
    assert.equal(typeof s.label, 'string');
    assert.ok(s.label.length > 0, `section "${s.id}" must have a label`);
    assert.equal(typeof s.removable, 'boolean', `section "${s.id}".removable must be an explicit boolean`);
    assert.ok(!ASCII_FALLBACK_HINTS.test(s.label), `label for "${s.id}" looks ASCII-ified, not proper Romanian: "${s.label}"`);
    assert.ok(s.label.trim().length > 0, 'label must not be whitespace-only');
  }
});

test('non-removable ids in the schema match build.js\'s render-time guardrail (defense in depth)', () => {
  const schemaLocked = new Set(schema.pageSections.filter((s) => s.removable === false).map((s) => s.id));
  assert.deepEqual(schemaLocked, new Set(['about', 'contact']));
  for (const id of schemaLocked) {
    assert.ok(NON_REMOVABLE_SECTION_IDS.has(id), `schema marks "${id}" non-removable but build.js does not guard it`);
  }
});

test('removable sections (services, process, appointment, faq, instagram) are NOT in the render-time guardrail set', () => {
  const removable = schema.pageSections.filter((s) => s.removable === true).map((s) => s.id);
  assert.deepEqual(removable.slice().sort(), ['appointment', 'faq', 'instagram', 'process', 'services']);
  for (const id of removable) {
    assert.ok(!NON_REMOVABLE_SECTION_IDS.has(id), `"${id}" is marked removable in schema but locked in build.js`);
  }
});

test('every pageSections id corresponds to a real <section id="…"> in the template', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
  const present = new Set(Array.from(tpl.matchAll(/<section\b[^>]*\bid="([a-zA-Z0-9_-]+)"/g)).map((m) => m[1]));
  for (const s of schema.pageSections) {
    assert.ok(present.has(s.id), `schema.pageSections declares "${s.id}" but template.html has no <section id="${s.id}">`);
  }
});
