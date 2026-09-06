'use strict';
/**
 * bot/test/wave7-sections-schema.test.js
 *
 * Wave 7 — every template's schema.json gains a `pageSections` array: the
 * canonical, ordered list of page sections that template offers, each with a
 * Romanian label and a `removable` flag. builder/app.js reads this to build
 * the "Secțiuni pagină" add/remove/reorder panel; build.js's
 * NON_REMOVABLE_SECTION_IDS is the render-time mirror of the same guardrail.
 *
 * Originally this only checked templates/professionals (the one template the
 * feature shipped on first). This wave brought local-service, product-menu,
 * desserdirina and portfolio up to the same contract, so the checks below
 * loop over every template directory under templates/ that has a
 * schema.json — no template-specific id lists hardcoded except where a test
 * is inherently about the shared "about"/"contact" contract.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-sections-schema.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { NON_REMOVABLE_SECTION_IDS, renderHtml } = require(path.join(ROOT, 'build.js'));

const TEMPLATES_DIR = path.join(ROOT, 'templates');
const TEMPLATE_IDS = fs.readdirSync(TEMPLATES_DIR).filter((name) => {
  return fs.existsSync(path.join(TEMPLATES_DIR, name, 'schema.json'))
      && fs.existsSync(path.join(TEMPLATES_DIR, name, 'template.html'));
}).sort();

// Fixture sanity: this suite only proves something if it actually iterates
// over every template that ships the feature. Five today (professionals +
// the four this wave brought up to parity) — bump this if a new template is
// added without a schema.pageSections, so the loop doesn't silently shrink.
test('fixture sanity: every template with a schema.json has one, and there are 5 of them', () => {
  assert.equal(TEMPLATE_IDS.length, 5, `expected 5 templates, found: ${TEMPLATE_IDS.join(', ')}`);
});

for (const templateId of TEMPLATE_IDS) {
  const schema = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, templateId, 'schema.json'), 'utf8'));
  const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, templateId, 'template.html'), 'utf8');

  test(`[${templateId}] schema.pageSections exists, lists each id exactly once, "about"+"contact" present`, () => {
    assert.ok(Array.isArray(schema.pageSections) && schema.pageSections.length > 0,
      `${templateId}: schema.json must have a non-empty pageSections array`);
    const ids = schema.pageSections.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${templateId}: no duplicate ids in pageSections`);
    assert.ok(ids.includes('about'), `${templateId}: pageSections must include "about"`);
    assert.ok(ids.includes('contact'), `${templateId}: pageSections must include "contact"`);
  });

  test(`[${templateId}] every pageSections entry has a Romanian label with correct diacritics and an explicit removable flag`, () => {
    const ASCII_FALLBACK_HINTS = /\b(sectiune|intrebari|programari|intalniri|galerie foto fara)\b/i; // common ASCII-ified RO mistakes
    for (const s of schema.pageSections) {
      assert.equal(typeof s.id, 'string', `${templateId}: pageSections entry id must be a string`);
      assert.ok(s.id.length > 0, `${templateId}: pageSections entry id must not be empty`);
      assert.equal(typeof s.label, 'string', `${templateId}: "${s.id}".label must be a string`);
      assert.ok(s.label.trim().length > 0, `${templateId}: "${s.id}" must have a non-whitespace label`);
      assert.equal(typeof s.removable, 'boolean', `${templateId}: "${s.id}".removable must be an explicit boolean`);
      assert.ok(!ASCII_FALLBACK_HINTS.test(s.label), `${templateId}: label for "${s.id}" looks ASCII-ified, not proper Romanian: "${s.label}"`);
    }
  });

  test(`[${templateId}] "about" and "contact" are marked non-removable, matching build.js's guardrail`, () => {
    const byId = new Map(schema.pageSections.map((s) => [s.id, s]));
    assert.equal(byId.get('about').removable, false, `${templateId}: "about" must be removable:false`);
    assert.equal(byId.get('contact').removable, false, `${templateId}: "contact" must be removable:false`);
    assert.ok(NON_REMOVABLE_SECTION_IDS.has('about') && NON_REMOVABLE_SECTION_IDS.has('contact'),
      'build.js NON_REMOVABLE_SECTION_IDS must guard about/contact (sanity — not template-specific)');
  });

  test(`[${templateId}] no other pageSections entry is locked in build.js's render-time guardrail`, () => {
    for (const s of schema.pageSections) {
      if (s.id === 'about' || s.id === 'contact') continue;
      assert.equal(s.removable, true, `${templateId}: "${s.id}" should be removable:true (only about/contact are structural)`);
      assert.ok(!NON_REMOVABLE_SECTION_IDS.has(s.id), `${templateId}: "${s.id}" is removable in schema but locked in build.js`);
    }
  });

  test(`[${templateId}] every pageSections id corresponds to a real <section id="…"> in template.html`, () => {
    const present = new Set(Array.from(tpl.matchAll(/<section\b[^>]*\bid="([a-zA-Z0-9_-]+)"/g)).map((m) => m[1]));
    for (const s of schema.pageSections) {
      assert.ok(present.has(s.id), `${templateId}: schema.pageSections declares "${s.id}" but template.html has no <section id="${s.id}">`);
    }
  });

  test(`[${templateId}] a real render has no duplicate ids anywhere (every preset, with Instagram forced on)`, () => {
    // Raw template.html source can legitimately contain the same id twice —
    // e.g. local-service's "steps"/"steps-heading" appear in both the
    // "@if steps" and mutually-exclusive "@if !steps" branches, and only one
    // branch ever survives a render. So this checks actual rendered output,
    // not the source, for every shipped preset — and forces Instagram on
    // (S111 gates the public Instagram section behind a connected embed) so
    // that section's id is exercised too.
    const presetsPath = path.join(TEMPLATES_DIR, templateId, 'presets.json');
    const presets = JSON.parse(fs.readFileSync(presetsPath, 'utf8')).presets;
    assert.ok(presets.length > 0, `${templateId}: fixture sanity — must ship at least one preset`);
    for (const preset of presets) {
      const cfg = JSON.parse(JSON.stringify(preset.config));
      cfg.instagram = Object.assign({}, cfg.instagram, {
        handle: 'test', url: 'https://instagram.com/test', embedUrl: 'https://embedsocial.com/abc123',
      });
      const html = renderHtml(tpl, cfg);
      const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g)).map((m) => m[1]);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      assert.deepEqual([...new Set(dupes)], [], `${templateId} preset "${preset.id}": duplicate id attribute(s) in rendered markup: ${dupes.join(', ')}`);
    }
  });
}
