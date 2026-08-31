'use strict';
/**
 * Flow 2 regression oracle for truthful product-menu language controls.
 *
 * Run: node bot/test/flow2-product-menu-language.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { renderHtml } = require('../../build.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const template = read('templates/product-menu/template.html');
const script = read('templates/product-menu/script.js');
const presets = JSON.parse(read('templates/product-menu/presets.json')).presets || [];

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (error) {
    failed++;
    console.error('FAIL', name, '-', error.message);
  }
}

check('product-menu uses Romanian accessible language-control copy', () => {
  assert.ok(!/aria-label=["']Menu language["']/i.test(template), 'hard-coded English group label');
  assert.ok(
    /role=["']group["'][^>]*aria-label=["']\{\{labels\.menuLang\}\}["']/i.test(template),
    'group label does not use labels.menuLang'
  );
  for (const preset of presets) {
    assert.strictEqual(preset.config.labels.menuLang, 'Limba meniului', preset.id);
  }
});

check('product-menu initially selects and displays Romanian', () => {
  assert.ok(
    /class=["']menu-lang-btn["'][^>]*data-menu-lang=["']en["'][^>]*aria-pressed=["']false["']/i.test(template),
    'EN button is selected by default'
  );
  assert.ok(
    /class=["']menu-lang-btn is-active["'][^>]*data-menu-lang=["']ro["'][^>]*aria-pressed=["']true["']/i.test(template),
    'RO button is not selected by default'
  );
  assert.ok(
    /class=["']menu-panel pm-panel["'][^>]*data-menu-panel=["']en["'][^>]*hidden/i.test(template),
    'English panel is visible by default'
  );
  assert.ok(
    /class=["']menu-panel pm-panel["'][^>]*data-menu-panel=["']ro["'](?![^>]*hidden)/i.test(template),
    'Romanian panel is hidden by default'
  );
});

check('menu toggle does not overwrite the Romanian document language', () => {
  assert.ok(
    /<html\b[^>]*lang=["']\{\{business\.lang\}\}["']/i.test(template),
    'document language is not sourced from business.lang'
  );
  assert.ok(
    !/document\.documentElement\.setAttribute\(\s*["']lang["']/.test(script),
    'menu toggle overwrites the page language'
  );
});

check('both product-menu presets provide distinct English menu copy', () => {
  assert.deepStrictEqual(presets.map((preset) => preset.id), ['casa-nord', 'traista-verde']);
  const expectedEnglish = {
    'casa-nord': { category: 'Starters', item: 'Sourdough bread, cultured butter' },
    'traista-verde': { category: 'Breakfast', item: 'Eggs your way, homemade bread' },
  };
  for (const preset of presets) {
    const menu = preset.config.menu;
    assert.notDeepStrictEqual(menu.en, menu.ro, `${preset.id}: EN duplicates RO`);
    assert.strictEqual(menu.en[0].category, expectedEnglish[preset.id].category, `${preset.id}: English category`);
    assert.strictEqual(menu.en[0].items[0], expectedEnglish[preset.id].item, `${preset.id}: English item`);
    assert.notStrictEqual(menu.en[0].category, menu.ro[0].category, `${preset.id}: first category still Romanian`);
    assert.notStrictEqual(menu.en[0].items[0], menu.ro[0].items[0], `${preset.id}: first item still Romanian`);
  }
});

check('rendered preview/export HTML starts in Romanian for both presets', () => {
  for (const preset of presets) {
    const html = renderHtml(template, preset.config, { editMode: false });
    assert.ok(/<html\b[^>]*lang=["']ro["']/i.test(html), `${preset.id}: document language`);
    assert.ok(/role=["']group["'][^>]*aria-label=["']Limba meniului["']/i.test(html), `${preset.id}: group label`);
    assert.ok(/data-menu-lang=["']ro["'][^>]*aria-pressed=["']true["']/i.test(html), `${preset.id}: RO selected`);
    assert.ok(/data-menu-panel=["']en["'][^>]*hidden/i.test(html), `${preset.id}: EN hidden`);
    assert.ok(new RegExp(expectedEscape(preset.config.menu.ro[0].items[0])).test(html), `${preset.id}: Romanian menu rendered`);
    assert.ok(new RegExp(expectedEscape(preset.config.menu.en[0].items[0])).test(html), `${preset.id}: English menu rendered`);
  }
});

function expectedEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (failed) {
  console.error(`\nflow2-product-menu-language.test.js: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\nflow2-product-menu-language.test.js: all checks passed');
