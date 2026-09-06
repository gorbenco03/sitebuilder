'use strict';
/**
 * bot/test/wave7-sections-render-order.test.js
 *
 * Wave 7 — add/remove/reorder page sections (audit finding #44).
 *
 * Proves build.js's reorderSections() (wired into renderHtml()) does what
 * config.sections asks for the professionals template:
 *   - reorders the rendered <section id="…"> blocks to match config order,
 *   - drops a removable section marked removed,
 *   - refuses to drop a NON-removable section even when config asks — the
 *     guardrail is enforced in the render pipeline itself, not only by a
 *     disabled button in the builder UI, so a hand-edited config.json
 *     cannot bypass it either,
 *   - and applies identically whether reached via renderHtml() (preview /
 *     builder srcdoc) or build() (live publish + ZIP export both call
 *     build(), so a single assertion here covers all three surfaces).
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-sections-render-order.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml, build, NON_REMOVABLE_SECTION_IDS } = require(path.join(ROOT, 'build.js'));

const TPL = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
const PRESET = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config;

function sectionIdsIn(html) {
  return Array.from(html.matchAll(/<section\b[^>]*\bid="([a-zA-Z0-9_-]+)"/g)).map((m) => m[1]);
}

test('schema guardrail set matches the task brief: about + contact are not removable', () => {
  assert.ok(NON_REMOVABLE_SECTION_IDS.has('about'));
  assert.ok(NON_REMOVABLE_SECTION_IDS.has('contact'));
});

test('reorders sections to match config.sections order', () => {
  const cfg = JSON.parse(JSON.stringify(PRESET));
  const baseline = sectionIdsIn(renderHtml(TPL, cfg));
  assert.deepEqual(baseline, ['services', 'process', 'about', 'appointment', 'faq', 'contact'],
    'fixture sanity: template order before any reordering');

  cfg.sections = [
    { id: 'faq', removed: false },
    { id: 'contact', removed: false },
    { id: 'services', removed: false },
    { id: 'process', removed: false },
    { id: 'about', removed: false },
    { id: 'appointment', removed: false },
  ];
  const ids = sectionIdsIn(renderHtml(TPL, cfg));
  assert.deepEqual(ids, ['faq', 'contact', 'services', 'process', 'about', 'appointment']);
});

test('drops a removable section marked removed (services, process, appointment, faq, instagram)', () => {
  const cfg = JSON.parse(JSON.stringify(PRESET));
  cfg.sections = [
    { id: 'services', removed: false },
    { id: 'process', removed: true },
    { id: 'about', removed: false },
    { id: 'appointment', removed: true },
    { id: 'faq', removed: false },
    { id: 'contact', removed: false },
  ];
  const ids = sectionIdsIn(renderHtml(TPL, cfg));
  assert.ok(!ids.includes('process'), 'process must be dropped when removed:true');
  assert.ok(!ids.includes('appointment'), 'appointment must be dropped when removed:true');
  assert.deepEqual(ids, ['services', 'about', 'faq', 'contact']);
});

test('guardrail: "about" and "contact" render even when config marks them removed', () => {
  const cfg = JSON.parse(JSON.stringify(PRESET));
  cfg.sections = [
    { id: 'services', removed: false },
    { id: 'process', removed: false },
    { id: 'about', removed: true },     // attempted removal of a locked section
    { id: 'appointment', removed: false },
    { id: 'faq', removed: false },
    { id: 'contact', removed: true },   // attempted removal of a locked section
  ];
  const html = renderHtml(TPL, cfg);
  const ids = sectionIdsIn(html);
  assert.ok(ids.includes('about'), 'about must still render — server-side guardrail, not just a hidden UI button');
  assert.ok(ids.includes('contact'), 'contact must still render — server-side guardrail, not just a hidden UI button');
});

test('a section id absent from config.sections (older config, template gained a section) still renders, appended', () => {
  const cfg = JSON.parse(JSON.stringify(PRESET));
  cfg.sections = [
    { id: 'faq', removed: false },
    { id: 'services', removed: false },
    // process/about/appointment/contact intentionally omitted
  ];
  const ids = sectionIdsIn(renderHtml(TPL, cfg));
  assert.deepEqual(ids.slice(0, 2), ['faq', 'services'], 'listed ids lead in the requested order');
  for (const must of ['process', 'about', 'appointment', 'contact']) {
    assert.ok(ids.includes(must), `unmentioned section "${must}" must not be silently dropped`);
  }
});

test('a section with no data (e.g. instagram with no handle) is simply absent — not an error', () => {
  const cfg = JSON.parse(JSON.stringify(PRESET));
  assert.ok(!cfg.instagram || !cfg.instagram.handle, 'fixture sanity: preset has no instagram handle');
  cfg.sections = [
    { id: 'instagram', removed: false }, // listed, but the @if gate still hides it — no crash
    { id: 'services', removed: false },
    { id: 'contact', removed: false },
  ];
  const html = renderHtml(TPL, cfg);
  assert.ok(!sectionIdsIn(html).includes('instagram'));
});

test('build() (used by live publish + ZIP export) applies the same reorder/removal as renderHtml() (preview)', () => {
  const cfg = JSON.parse(JSON.stringify(PRESET));
  cfg.sections = [
    { id: 'faq', removed: false },
    { id: 'services', removed: false },
    { id: 'process', removed: true },
    { id: 'about', removed: false },
    { id: 'appointment', removed: false },
    { id: 'contact', removed: false },
  ];

  const preview = renderHtml(TPL, cfg);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-site-'));
  fs.writeFileSync(path.join(dir, 'template.html'), TPL, 'utf8');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg), 'utf8');
  build(dir);
  const published = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

  assert.deepEqual(sectionIdsIn(published), sectionIdsIn(preview));
  assert.deepEqual(sectionIdsIn(published), ['faq', 'services', 'about', 'appointment', 'contact']);
});
