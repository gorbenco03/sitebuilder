'use strict';
/**
 * S56: stranger-open /app/ preview of the three systems is the commercial product.
 * Bake + HidookEngine.renderPreview(first preset) must show local photos + vertical
 * business identity — not empty heroes, factory CDNs, or leftover bakery / MENU BOARD /
 * English factory chrome / Apple.com marketing copy.
 *
 * Run: node bot/test/s56-opened-preview-commercial.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SYSTEMS = ['product-menu', 'portfolio', 'local-service'];
const PARENT_SHA = '2a00f6cf634aee56aabad43e403c35f6622ac036';
const MIN_HTML = 8000;

const FORBIDDEN = [
  /picsum/i,
  /unsplash/i,
  /placehold/i,
  /loremflickr/i,
  /DESSERD/i,
  /desserdina/i,
  /MENU\s*BOARD/i,
  /\bbakery\b/i,
  /patisserie/i,
  /chalkboard/i,
  /Apple\.com/i,
];

// Product is now English throughout, so "Gallery/Services/Book" nav words are no
// longer a factory-vs-commercial signal by themselves (raw hardcoded-markup
// regressions are still caught below by the HEAD worktree surface check, which
// reads the template source rather than rendered copy). The stronger, English-era
// version of "not raw factory chrome" is: the opened preview must show the
// preset's OWN configured labels (proof it's config-driven), carry zero
// unresolved {{token}} placeholders, and carry zero leftover Romanian diacritics.
const UNRESOLVED_TOKEN = /\{\{\s*[\w.]+\s*\}\}/;
const ROMANIAN_DIACRITICS = /[ăâîșşțţĂÂÎȘŞȚŢ]/;

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

function buildApp() {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-builder.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 80 * 1024 * 1024,
  });
}

function loadBaked() {
  const engineSrc = fs.readFileSync(path.join(ROOT, 'builder/generated/engine.js'), 'utf8');
  const tplSrc = fs.readFileSync(path.join(ROOT, 'builder/generated/templates-data.js'), 'utf8');
  const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} } };
  vm.createContext(sandbox);
  vm.runInContext(engineSrc, sandbox);
  vm.runInContext(tplSrc, sandbox);
  assert.ok(sandbox.window.HidookEngine && typeof sandbox.window.HidookEngine.renderPreview === 'function');
  assert.ok(sandbox.window.HIDOOK_TEMPLATES);
  const heavyDir = path.join(ROOT, 'builder/generated/templates');
  const ids = fs.readdirSync(heavyDir)
    .filter((n) => n.endsWith('.js'))
    .map((n) => n.replace(/\.js$/, ''));
  sandbox.window.HIDOOK_TEMPLATE_HEAVY = sandbox.window.HIDOOK_TEMPLATE_HEAVY || {};
  sandbox.window.HIDOOK_TEMPLATES.templates = sandbox.window.HIDOOK_TEMPLATES.templates || {};
  for (const id of ids) {
    const heavySrc = fs.readFileSync(path.join(heavyDir, id + '.js'), 'utf8');
    vm.runInContext(heavySrc, sandbox);
    const heavy = sandbox.window.HIDOOK_TEMPLATE_HEAVY[id];
    assert.ok(heavy && heavy.files, 'heavy payload missing for ' + id);
    sandbox.window.HIDOOK_TEMPLATES.templates[id] = {
      schema: heavy.schema,
      presets: heavy.presets,
      files: heavy.files,
    };
  }
  assert.ok(
    Object.keys(sandbox.window.HIDOOK_TEMPLATES.templates).length > 0,
    'expected heavy templates after load'
  );
  return {
    renderPreview: sandbox.window.HidookEngine.renderPreview,
    templates: sandbox.window.HIDOOK_TEMPLATES.templates,
  };
}

function firstPreset(tpl) {
  const presets = tpl.presets || [];
  assert.ok(presets.length >= 1, 'expected at least one preset');
  return presets[0];
}

function businessName(preset) {
  return (
    (preset.config && preset.config.business && preset.config.business.name) ||
    preset.name ||
    ''
  );
}

function assertCommercialPreview(id, html, preset) {
  assert.ok(html && html.length >= MIN_HTML, `${id}: preview HTML too small (${html && html.length})`);
  const name = businessName(preset);
  assert.ok(name, `${id}: missing business name`);
  assert.ok(html.includes(name), `${id}: business name missing from preview: ${name}`);
  const dataImgs = html.match(/data:image\//g) || [];
  assert.ok(dataImgs.length >= 1, `${id}: expected inlined data:image/ photos, got ${dataImgs.length}`);
  // Hero path should be a baked local photo, not a leftover relative images/ URL.
  const leftoverImgs = html.match(/(?:src|url\()\s*[=:]?\s*['"]?images\/[^'")\s]+/gi) || [];
  assert.deepStrictEqual(
    leftoverImgs,
    [],
    `${id}: relative images/ still present (bake/imageMap failed): ${leftoverImgs.slice(0, 5).join(', ')}`
  );
  for (const re of FORBIDDEN) {
    assert.ok(!re.test(html), `${id}: forbidden leftover in opened preview: ${re}`);
  }
  if (id === 'portfolio') {
    const labels = (preset.config && preset.config.labels) || {};
    assert.ok(
      labels.navGallery && html.includes(labels.navGallery),
      `${id}: expected preset's own nav gallery label in opened preview`
    );
    assert.ok(
      labels.navServices && html.includes(labels.navServices),
      `${id}: expected preset's own nav services label in opened preview`
    );
    assert.ok(
      labels.navBooking && html.includes(labels.navBooking),
      `${id}: expected preset's own nav booking label in opened preview`
    );
    assert.ok(!UNRESOLVED_TOKEN.test(html), `${id}: unresolved {{token}} leaked into opened preview`);
    assert.ok(
      !ROMANIAN_DIACRITICS.test(html),
      `${id}: Romanian diacritics leaked into opened English preview`
    );
  }
  // Class language: no MENU BOARD-era pm-board chrome in restaurant system.
  if (id === 'product-menu') {
    assert.ok(!/\bpm-board\b/.test(html), `${id}: leftover pm-board class (MENU BOARD era)`);
    assert.ok(/\bpm-hero\b/.test(html), `${id}: expected pm-hero hero layout class`);
  }
}

console.log('S56: building builder (bake imageMap)…');
buildApp();
const baked = loadBaked();

check('baked templates expose imageMap for each system', () => {
  for (const id of SYSTEMS) {
    const tpl = baked.templates[id];
    assert.ok(tpl, `missing template ${id}`);
    assert.ok(tpl.files && tpl.files.imageMap, `${id}: missing files.imageMap after bake`);
    assert.ok(Object.keys(tpl.files.imageMap).length >= 3, `${id}: imageMap too thin`);
  }
});

const previews = {};
check('renderPreview first preset is commercial for all three systems', () => {
  for (const id of SYSTEMS) {
    const tpl = baked.templates[id];
    const preset = firstPreset(tpl);
    const html = baked.renderPreview(tpl.files, preset.config || preset);
    previews[id] = { html, preset };
    assertCommercialPreview(id, html, preset);
    console.log(
      `  ${id}/${preset.id}: html=${html.length} data:image=${(html.match(/data:image\//g) || []).length} name=${businessName(preset)}`
    );
  }
});

check('product-menu opened preview is restaurant (not bakery persona)', () => {
  const { html, preset } = previews['product-menu'];
  const blob = html.toLowerCase();
  assert.ok(!/cofet[aă]rie|patiserie|pr[aă]jitur/.test(blob), 'product-menu still bakery persona text');
  const tag = (preset.config && preset.config.business && preset.config.business.tagline) || '';
  assert.ok(tag && html.includes(tag), 'restaurant tagline missing from preview');
});

check('portfolio opened preview is salon booking CTA (not generic Book now factory)', () => {
  const { html, preset } = previews.portfolio;
  assert.ok(!/Book\s+now/i.test(html), 'portfolio still Book now');
  const cta = preset.config && preset.config.hero && preset.config.hero.ctaLabel;
  assert.ok(
    cta && /book|appointment|schedul|reserv/i.test(String(cta)),
    `salon CTA not booking-family: ${cta}`
  );
  assert.ok(html.includes(String(cta)), 'salon CTA missing from preview');
});

check('local-service opened preview is trade with business name', () => {
  const { html, preset } = previews['local-service'];
  const name = businessName(preset);
  assert.ok(name && html.includes(name));
  assert.ok(!/\bbakery\b/i.test(html));
});

// Causal overlay: parent SHA must FAIL the exact leftovers we remade.
check(`parent ${PARENT_SHA.slice(0, 7)} is RED on bakery/Apple.com CSS + factory Gallery nav + pm-board`, () => {
  function parentBlob(rel) {
    return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  }
  const parentPmCss = parentBlob('templates/product-menu/styles.css');
  const parentPfHtml = parentBlob('templates/portfolio/template.html');
  const parentPmHtml = parentBlob('templates/product-menu/template.html');

  assert.ok(
    /\bbakery\b/i.test(parentPmCss) || /Apple\.com/i.test(parentPmCss),
    'parent product-menu CSS no longer has bakery/Apple.com — pick another causal RED'
  );
  assert.ok(
    />\s*Gallery\s*</i.test(parentPfHtml) && />\s*Book\s*</i.test(parentPfHtml),
    'parent portfolio no longer has English Gallery/Book nav — pick another causal RED'
  );
  assert.ok(
    /\bpm-board\b/.test(parentPmHtml) || /\bpm-board\b/.test(parentPmCss),
    'parent product-menu no longer has pm-board — pick another causal RED'
  );

  // Simulate parent render surface: inlined CSS comments + factory nav would appear in srcdoc.
  const parentSurface = [parentPmCss, parentPfHtml, parentPmHtml].join('\n');
  assert.ok(/\bbakery\b/i.test(parentSurface), 'parent surface missing bakery (expected RED)');
  assert.ok(/Apple\.com/i.test(parentSurface), 'parent surface missing Apple.com (expected RED)');
  assert.ok(/>\s*Gallery\s*</i.test(parentSurface), 'parent surface missing Gallery nav (expected RED)');
});

check('HEAD worktree surface is GREEN on the same leftovers', () => {
  for (const id of SYSTEMS) {
    const css = fs.readFileSync(path.join(ROOT, 'templates', id, 'styles.css'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'templates', id, 'template.html'), 'utf8');
    const blob = css + '\n' + html;
    assert.ok(!/\bbakery\b/i.test(blob), `${id}: bakery still in source`);
    assert.ok(!/Apple\.com/i.test(blob), `${id}: Apple.com still in source`);
    assert.ok(!/MENU\s*BOARD/i.test(blob), `${id}: MENU BOARD still in source`);
  }
  const pf = fs.readFileSync(path.join(ROOT, 'templates/portfolio/template.html'), 'utf8');
  assert.ok(!/>\s*Gallery\s*</i.test(pf), 'portfolio still hardcodes Gallery');
  assert.ok(!/>\s*Book\s*</i.test(pf), 'portfolio still hardcodes Book');
  const pm = fs.readFileSync(path.join(ROOT, 'templates/product-menu/template.html'), 'utf8');
  assert.ok(!/\bpm-board\b/.test(pm), 'product-menu still has pm-board');
});

if (failed) {
  console.error('\nS56 FAILED');
  process.exit(1);
}
console.log('\nS56 OK');
process.exit(0);
