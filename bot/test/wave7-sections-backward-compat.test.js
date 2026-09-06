'use strict';
/**
 * bot/test/wave7-sections-backward-compat.test.js
 *
 * Wave 7 (audit finding #44, RAPORT.md — "no add/remove/reorder of
 * SECTIONS") adds a page-sections feature: config.sections (an ordered
 * array of { id, removed }) lets a site owner reorder/hide the fixed
 * <section id="…"> blocks templates/professionals/template.html already
 * renders. See build.js's reorderSections() for the mechanism.
 *
 * The hard requirement from the task brief: "a site published last week
 * must keep rendering identically until its owner touches the order." A
 * config saved before this feature exists has NO `sections` key at all —
 * this oracle proves such a config renders BYTE-IDENTICAL output before and
 * after this change, by diffing against build.js as it existed at the
 * parent commit (git HEAD, before this wave's edits).
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-sections-backward-compat.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');

function oldBuildModule() {
  const src = execFileSync('git', ['-C', ROOT, 'show', 'HEAD:build.js'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-old-build-')), 'build.js');
  fs.writeFileSync(tmpFile, src, 'utf8');
  return require(tmpFile);
}

test('professionals: preset configs (no config.sections) render byte-identical to pre-feature build.js', () => {
  const oldMod = oldBuildModule();
  const newMod = require(path.join(ROOT, 'build.js'));
  const tpl = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets;

  assert.ok(presets.length > 0, 'fixture sanity: professionals must ship at least one preset');
  for (const preset of presets) {
    assert.ok(!('sections' in preset.config), `fixture sanity: preset "${preset.id}" must have no sections key yet`);
    const before = oldMod.renderHtml(tpl, preset.config);
    const after = newMod.renderHtml(tpl, preset.config);
    assert.equal(after, before, `preset "${preset.id}" must render byte-identical with no config.sections`);
  }
});

test('renderHtml + build() output is untouched when config.sections is absent, empty, or not an array', () => {
  const { renderHtml, reorderSections } = require(path.join(ROOT, 'build.js'));
  const tpl = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets;
  const base = presets[0].config;

  const withoutKey = renderHtml(tpl, base);
  const withEmptyArray = renderHtml(tpl, Object.assign({}, base, { sections: [] }));
  const withGarbage = renderHtml(tpl, Object.assign({}, base, { sections: 'not-an-array' }));
  const withNull = renderHtml(tpl, Object.assign({}, base, { sections: null }));

  assert.equal(withEmptyArray, withoutKey, 'empty sections array must not alter output');
  assert.equal(withGarbage, withoutKey, 'non-array sections value must not alter output');
  assert.equal(withNull, withoutKey, 'null sections value must not alter output');

  // reorderSections itself is a documented no-op on any falsy/empty input.
  assert.equal(reorderSections('<html></html>', undefined), '<html></html>');
  assert.equal(reorderSections('<html></html>', []), '<html></html>');
  assert.equal(reorderSections('<html></html>', null), '<html></html>');
});

test('build() writes byte-identical index.html for a legacy config (covers publish + ZIP export path, both call build())', () => {
  const { build } = require(path.join(ROOT, 'build.js'));
  const oldMod = oldBuildModule();

  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets;
  const tpl = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');

  const dirNew = fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-site-new-'));
  const dirOld = fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-site-old-'));
  for (const dir of [dirNew, dirOld]) {
    fs.writeFileSync(path.join(dir, 'template.html'), tpl, 'utf8');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(presets[0].config), 'utf8');
  }

  build(dirNew);
  oldMod.build(dirOld);

  const htmlNew = fs.readFileSync(path.join(dirNew, 'index.html'), 'utf8');
  const htmlOld = fs.readFileSync(path.join(dirOld, 'index.html'), 'utf8');
  assert.equal(htmlNew, htmlOld, 'build() output for a legacy config.json must be byte-identical to pre-feature build.js');
});
