'use strict';
/**
 * bot/test/audit27-t-1c-addable-faq-schedule-location.test.js
 *
 * Oracle for task T-1C (PLAN-AUDIT-2026-09-27.md §4/§9), scoped to
 * templates/portfolio and templates/professionals: adds the addable blocks
 * each template lacked among "Întrebări frecvente" (FAQ), "Program"
 * (schedule) and "Unde ne găsești" (location), and fixes portfolio's
 * schedule.rows, which was declared `"editable": false` in schema.json
 * because templates/portfolio/template.html rendered `@each schedule.rows`
 * TWICE on the same published page (the "Program" section's own list, and
 * a second copy inside the appointment/contact panel) — see
 * bot/test/suite1-lists-from-schema.test.js's file header for the verified
 * root cause. Duplicate `data-hb-edit="schedule.rows.N.…"` paths made the
 * builder's list-item-container climb land on <main>, corrupting unrelated
 * lists' own add/remove controls, which is why the field was excluded
 * rather than fixed at the time.
 *
 * The CONTRACT this task introduces on `schema.json`'s `pageSections`
 * entries: `"addable": true` + `"description"` + `"seed"` marks a page
 * section that is hidden until a customer explicitly adds it (T-1A builds
 * the "add a block" builder UI that reads this — out of scope here). The
 * actual hiding is enforced the same way every other optional section in
 * this codebase already hides itself (testimonials, team): a content-gated
 * `<!-- @if …--> ` in template.html, driven by the underlying field being
 * empty by default (no seed data pre-populated in presets.json) — so the
 * contract holds regardless of whether the builder UI has landed yet.
 *
 * RED (git show 98ae941, the commit this task started from):
 *   - portfolio schema.json: schedule.rows carries `"editable": false`;
 *     template.html renders `@each schedule.rows` twice; no faq/location
 *     sections or pageSections entries exist at all.
 *   - professionals schema.json: no schedule/location sections or
 *     pageSections entries exist (FAQ already existed and stays as-is —
 *     already always-on/removable, not newly "addable").
 *
 * GREEN (HEAD): all of the above fixed/added, verified against the real
 * renderHtml()/build.js pipeline — no browser needed, this is pure
 * schema+render-pipeline verification (fast, deterministic).
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-t-1c-addable-faq-schedule-location.test.js
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const PARENT_SHA = '98ae941712ada203d4b50ede5f83a06535229ad';

function parentBlob(relPath) {
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${relPath}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function headSchema(templateId) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'schema.json'), 'utf8'));
}
function headTemplateHtml(templateId) {
  return fs.readFileSync(path.join(ROOT, 'templates', templateId, 'template.html'), 'utf8');
}
function headPreset(templateId, idx = 0) {
  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'presets.json'), 'utf8')).presets;
  return JSON.parse(JSON.stringify(presets[idx].config));
}
function pageSection(schema, id) {
  return (schema.pageSections || []).find((s) => s.id === id) || null;
}
function schemaField(schema, key) {
  for (const sec of schema.sections || []) {
    for (const f of sec.fields || []) {
      if (f && f.key === key) return f;
    }
  }
  return null;
}

test('RED (parent 98ae941): portfolio schedule.rows was editable:false and duplicated in template.html', () => {
  const parentSchema = JSON.parse(parentBlob('templates/portfolio/schema.json'));
  const rowsField = schemaField(parentSchema, 'schedule.rows');
  assert.equal(rowsField.editable, false, 'fixture sanity: parent schedule.rows must be editable:false');

  const parentTpl = parentBlob('templates/portfolio/template.html');
  const eachCount = (parentTpl.match(/<!--\s*@each\s+schedule\.rows\s*-->/g) || []).length;
  assert.equal(eachCount, 2, 'fixture sanity: parent template.html must render @each schedule.rows twice');

  assert.equal(pageSection(parentSchema, 'faq'), null, 'fixture sanity: parent portfolio has no faq pageSection yet');
  assert.equal(pageSection(parentSchema, 'location'), null, 'fixture sanity: parent portfolio has no location pageSection yet');
});

test('RED (parent 98ae941): professionals had no schedule/location pageSections', () => {
  const parentSchema = JSON.parse(parentBlob('templates/professionals/schema.json'));
  assert.equal(pageSection(parentSchema, 'schedule'), null, 'fixture sanity: parent professionals has no schedule pageSection yet');
  assert.equal(pageSection(parentSchema, 'location'), null, 'fixture sanity: parent professionals has no location pageSection yet');
});

test('GREEN: portfolio schedule.rows is editable and rendered exactly once', () => {
  const schema = headSchema('portfolio');
  const rowsField = schemaField(schema, 'schedule.rows');
  assert.notEqual(rowsField.editable, false, 'schedule.rows must no longer be editable:false');

  const tpl = headTemplateHtml('portfolio');
  const eachCount = (tpl.match(/<!--\s*@each\s+schedule\.rows\s*-->/g) || []).length;
  assert.equal(eachCount, 1, 'template.html must render @each schedule.rows exactly once now');

  const cfg = headPreset('portfolio');
  assert.ok(Array.isArray(cfg.schedule.rows) && cfg.schedule.rows.length > 0, 'fixture sanity: default preset has schedule.rows');
  const html = renderHtml(tpl, cfg);
  const rowMatches = (html.match(/class="pf-sched__row"/g) || []).length;
  assert.equal(rowMatches, cfg.schedule.rows.length, 'each schedule row must render exactly once in the DOM');
  // The old duplicate copy is gone; the appointment panel now links to the
  // single Program section instead of repeating the list.
  assert.ok(!html.includes('pf-appt__hr'), 'the old duplicate hours markup must be gone');
  assert.ok(html.includes('href="#schedule"'), 'the appointment panel must link to the single Program section');
});

for (const [templateId, addableIds] of [
  ['portfolio', ['faq', 'location']],
  ['professionals', ['schedule', 'location']],
]) {
  test(`GREEN: ${templateId} pageSections declares the new addable blocks with description+seed`, () => {
    const schema = headSchema(templateId);
    for (const id of addableIds) {
      const entry = pageSection(schema, id);
      assert.ok(entry, `${templateId}: pageSections must include "${id}"`);
      assert.equal(entry.addable, true, `${templateId}: "${id}".addable must be true`);
      assert.equal(entry.removable, true, `${templateId}: "${id}".removable must be true (not structural)`);
      assert.equal(typeof entry.description, 'string', `${templateId}: "${id}".description must be a string`);
      assert.ok(entry.description.trim().length > 0, `${templateId}: "${id}".description must not be empty`);
      assert.ok(entry.seed && typeof entry.seed === 'object', `${templateId}: "${id}".seed must be an object`);
      // Every seed key must actually be a declared field under that section,
      // so the builder can apply it directly at cfg[id] without guessing.
      const sectionSchema = (schema.sections || []).find((s) => s.id === id);
      assert.ok(sectionSchema, `${templateId}: schema.sections must declare a "${id}" section for its fields`);
      for (const seedKey of Object.keys(entry.seed)) {
        const fieldKey = `${id}.${seedKey}`;
        assert.ok(
          sectionSchema.fields.some((f) => f.key === fieldKey),
          `${templateId}: seed key "${seedKey}" has no matching schema field "${fieldKey}"`
        );
      }
    }
  });

  test(`GREEN: ${templateId} addable blocks are hidden on the default preset and shown once seeded`, () => {
    const schema = headSchema(templateId);
    const tpl = headTemplateHtml(templateId);
    const baseCfg = headPreset(templateId);

    const baseHtml = renderHtml(tpl, baseCfg);
    for (const id of addableIds) {
      assert.ok(!baseHtml.includes(`id="${id}"`), `${templateId}: "#${id}" must be hidden on the unmodified default preset`);
    }

    for (const id of addableIds) {
      const entry = pageSection(schema, id);
      const seededCfg = JSON.parse(JSON.stringify(baseCfg));
      seededCfg[id] = Object.assign({}, seededCfg[id], entry.seed);
      const seededHtml = renderHtml(tpl, seededCfg);
      assert.ok(seededHtml.includes(`id="${id}"`), `${templateId}: "#${id}" must render once its schema-declared seed is applied`);
      // No duplicate ids anywhere on the seeded render.
      const ids = Array.from(seededHtml.matchAll(/\bid="([^"]+)"/g)).map((m) => m[1]);
      const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
      assert.deepEqual([...new Set(dupes)], [], `${templateId}: seeding "${id}" must not create duplicate ids: ${dupes.join(', ')}`);
    }
  });
}

test('GREEN: portfolio "Unde ne găsești" renders the address and a real Google Maps link, no iframe', () => {
  const tpl = headTemplateHtml('portfolio');
  const cfg = headPreset('portfolio');
  cfg.location = { title: 'Unde ne găsești', address: 'Strada Exemplu 1\nBucurești', addressHref: 'https://maps.google.com/?q=Strada+Exemplu+1' };
  const html = renderHtml(tpl, cfg);
  assert.ok(html.includes('Strada Exemplu 1'), 'address text must render');
  assert.ok(html.includes('href="https://maps.google.com/?q=Strada+Exemplu+1"'), 'the Maps link href must render');
  assert.ok(!/id="location"[\s\S]*?<iframe/i.test(html), 'the location section must never embed an <iframe>');
});

test('GREEN: professionals "Unde ne găsești" renders the address and a real Google Maps link, no iframe', () => {
  const tpl = headTemplateHtml('professionals');
  const cfg = headPreset('professionals');
  cfg.location = { title: 'Unde ne găsești', address: 'Strada Exemplu 1\nBucurești', addressHref: 'https://maps.google.com/?q=Strada+Exemplu+1' };
  const html = renderHtml(tpl, cfg);
  assert.ok(html.includes('Strada Exemplu 1'), 'address text must render');
  assert.ok(html.includes('href="https://maps.google.com/?q=Strada+Exemplu+1"'), 'the Maps link href must render');
  assert.ok(!/id="location"[\s\S]*?<iframe/i.test(html), 'the location section must never embed an <iframe>');
});

test('GREEN: portfolio "Întrebări frecvente" renders accessible question/answer pairs', () => {
  const tpl = headTemplateHtml('portfolio');
  const cfg = headPreset('portfolio');
  cfg.faq = { title: 'Întrebări frecvente', items: [{ q: 'Cum programez?', a: 'Scrie-ne pe WhatsApp.' }] };
  const html = renderHtml(tpl, cfg);
  assert.ok(html.includes('<details class="pf-faq__item">'), 'FAQ items must use native <details> (no JS required)');
  assert.ok(html.includes('Cum programez?') && html.includes('Scrie-ne pe WhatsApp.'), 'question and answer text must render');
});

test('GREEN: professionals "Program" (schedule) renders day/hours rows', () => {
  const tpl = headTemplateHtml('professionals');
  const cfg = headPreset('professionals');
  cfg.schedule = { title: 'Program', rows: [{ day: 'Luni–Vineri', hours: '09:00–18:00' }] };
  const html = renderHtml(tpl, cfg);
  assert.ok(html.includes('id="schedule"'), 'schedule section must render');
  assert.ok(html.includes('Luni–Vineri') && html.includes('09:00–18:00'), 'day/hours must render');
});

test('GREEN: professionals FAQ is untouched (still always-on, not duplicated as a second block)', () => {
  const schema = headSchema('professionals');
  const faqEntries = (schema.pageSections || []).filter((s) => s.id === 'faq');
  assert.equal(faqEntries.length, 1, 'exactly one "faq" pageSections entry — no duplicate block was introduced');
  assert.equal(faqEntries[0].addable, undefined, 'professionals FAQ stays always-on (not converted to addable) — it already ships seeded with content in every preset');
  const cfg = headPreset('professionals');
  assert.ok(cfg.faq && Array.isArray(cfg.faq.items) && cfg.faq.items.length > 0, 'fixture sanity: professionals default preset still ships FAQ content');
});
