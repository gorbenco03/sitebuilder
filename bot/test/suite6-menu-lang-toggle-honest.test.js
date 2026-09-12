'use strict';
/**
 * bot/test/suite6-menu-lang-toggle-honest.test.js
 *
 * Oracle for PLAN-QA-2026-09-12 suite 6, S6-4 variant (a) (D8 in
 * 04-QA-Evidence/QA-Explorare-2026-09-12/reports/04-sections-schema.md, "M8"):
 * desserdirina's EN/RO buttons only ever swap the Meniu panel — About,
 * Comandă acum, gallery, hero tagline, CTA, "Derulează", contact labels and
 * the whole footer stay Romanian regardless of which button is active. A
 * bare "EN"/"RO" pill pair next to a heading is a UI pattern visitors
 * everywhere read as "translate the whole page" (that IS what it means on
 * the vast majority of sites that use it), so leaving it unlabeled visually
 * misleads sighted visitors about its scope even though the group's
 * accessible name never claimed more.
 *
 * On top of the mislabeling, the "EN" content itself was not English: both
 * shipped presets had `menu.en[0].category === "Torturi"` and items like
 * "Tort de morcovi", "Tort Oreo", "Pandispan Victoria" — Romanian words
 * under an EN flag.
 *
 * Decision taken (variant (a) from the plan, not (b) — see the suite 6
 * report for what a real whole-site switch would require): do NOT build a
 * site-wide translator. Instead:
 *   1. The control gets a real ON-PAGE caption ("Limba meniului", from the
 *      existing labels.menuLang field) next to the EN/RO buttons — visible
 *      to sighted users, not just announced via aria-label — so nobody can
 *      read it as a whole-site switch.
 *   2. menu.en in both shipped presets is corrected to genuine English
 *      words with no overlap with menu.ro's words.
 *
 * This oracle is static (renders the real template with the real presets;
 * no browser needed) and checks BOTH halves: the visible caption text does
 * not promise site-wide translation, and menu.en shares zero
 * category/item words with menu.ro, for every shipped preset.
 *
 * Run: node bot/test/suite6-menu-lang-toggle-honest.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { renderHtml } = require('../../build.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const template = read('templates/desserdirina/template.html');
const presetsData = JSON.parse(read('templates/desserdirina/presets.json'));
const presets = presetsData.presets || [];

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

function words(...strings) {
  return strings
    .join(' ')
    .toLowerCase()
    .split(/[^a-zà-öø-ÿăâîșțĂÂÎȘȚ]+/i)
    .filter(Boolean);
}

check('desserdirina menu-lang control has a real ON-PAGE caption, not just an aria-only label', () => {
  assert.ok(presets.length > 0, 'at least one preset to check');
  for (const preset of presets) {
    const html = renderHtml(template, preset.config, { editMode: false });
    // A visible element (not aria-*, not sr-only) carrying the label text.
    const captionMatch = /<span id="menu-lang-caption" class="menu-langs-caption">([^<]*)<\/span>/.exec(html);
    assert.ok(captionMatch, `${preset.id}: visible menu-lang-caption span must be rendered`);
    const captionText = captionMatch[1].trim();
    assert.ok(captionText.length > 0, `${preset.id}: caption must not be empty`);
    // The group's a11y name is delegated to that same visible element.
    assert.match(
      html,
      /<div class="menu-langs" role="group" aria-labelledby="menu-lang-caption">/,
      `${preset.id}: group must point its accessible name at the visible caption, not a separate aria-label`
    );
  }
});

check('the visible caption never promises whole-site translation', () => {
  for (const preset of presets) {
    const html = renderHtml(template, preset.config, { editMode: false });
    const captionMatch = /<span id="menu-lang-caption" class="menu-langs-caption">([^<]*)<\/span>/.exec(html);
    assert.ok(captionMatch, `${preset.id}: caption present`);
    const captionText = captionMatch[1].trim();
    assert.doesNotMatch(
      captionText,
      /\bsite\b|\bpagin[aă]\b|\bpage\b|\bwebsite\b/i,
      `${preset.id}: caption "${captionText}" must not claim to translate the whole site/page`
    );
    assert.match(
      captionText,
      /meniu|menu/i,
      `${preset.id}: caption "${captionText}" should scope itself to the menu, honestly`
    );
  }
});

check('EN/RO buttons on the page never wander outside the menu panel (still only 2 controls named EN/RO)', () => {
  for (const preset of presets) {
    const html = renderHtml(template, preset.config, { editMode: false });
    const btns = html.match(/class="menu-lang-btn[^"]*"[^>]*>(EN|RO)</g) || [];
    assert.equal(btns.length, 2, `${preset.id}: exactly one EN and one RO toggle button, nowhere else on the page`);
  }
});

check('menu.en shares no category or item words with menu.ro, for every shipped preset', () => {
  assert.ok(presets.length > 0, 'at least one preset to check');
  for (const preset of presets) {
    const menu = preset.config.menu;
    assert.ok(menu && Array.isArray(menu.en) && menu.en.length > 0, `${preset.id}: menu.en present`);
    assert.ok(menu && Array.isArray(menu.ro) && menu.ro.length > 0, `${preset.id}: menu.ro present`);

    const roWords = new Set(
      words(...menu.ro.flatMap((section) => [section.category, ...(section.items || [])]))
    );
    const enWords = words(...menu.en.flatMap((section) => [section.category, ...(section.items || [])]));

    const overlap = enWords.filter((w) => roWords.has(w));
    assert.deepStrictEqual(
      overlap,
      [],
      `${preset.id}: menu.en still contains Romanian word(s) from menu.ro: ${JSON.stringify(overlap)}`
    );

    // Also guard the specific regression: the exact Romanian strings the QA
    // audit found under the EN flag must be gone.
    const enFlat = JSON.stringify(menu.en);
    for (const stale of ['Torturi', 'Tort de morcovi', 'Tort Oreo', 'Pandispan Victoria', 'Tort de ciocolată', 'Cu legume', 'Cu brânză']) {
      assert.ok(!enFlat.includes(stale), `${preset.id}: menu.en must not still contain "${stale}"`);
    }
  }
});

if (failed) {
  console.error(`\nsuite6-menu-lang-toggle-honest.test.js: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\nsuite6-menu-lang-toggle-honest.test.js: all checks passed');
