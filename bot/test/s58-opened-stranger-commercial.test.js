'use strict';
/**
 * S58: stranger-open /app/ preview must not leak factory chrome leftovers.
 * Exact leftovers remade this slice:
 *   - portfolio hardcoded English "Studio" about-cap chrome
 *   - local-service "CONSTRUCTII template" script header inlined in srcdoc
 *   - CSS file headers using factory system ids (PRODUCT-MENU / PORTFOLIO / LOCAL-SERVICE)
 *
 * Overlay parent SHA 00188e7 → RED on those leftovers; HEAD → GREEN.
 * Run: node bot/test/s58-opened-stranger-commercial.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SYSTEMS = ['product-menu', 'portfolio', 'local-service'];
const PARENT_SHA = '00188e777571a4ec13052e863ed6a30eb40de5c9';
const MIN_HTML = 8000;

const FORBIDDEN_SURFACE = [
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
  // Factory script header only — do not match Romanian body "constructii".
  /CONSTRUCTII\s+template/i,
  /v2\s+premium\s+redesign/i,
  /\bpm-board\b/,
  /PRODUCT-MENU\s*—/i,
  /LOCAL-SERVICE\s*—/i,
  /PORTFOLIO\s*—\s*Hidook/i,
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
  // Light boot registry has empty templates{}; load each heavy payload from disk.
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

function parentBlob(rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

console.log('S58: building builder (bake imageMap)…');
buildApp();
const baked = loadBaked();

const previews = {};
check('renderPreview first preset is commercial for all three systems', () => {
  for (const id of SYSTEMS) {
    const tpl = baked.templates[id];
    assert.ok(tpl, `missing template ${id}`);
    const preset = firstPreset(tpl);
    const html = baked.renderPreview(tpl.files, preset.config || preset);
    previews[id] = { html, preset };
    assert.ok(html && html.length >= MIN_HTML, `${id}: preview HTML too small (${html && html.length})`);
    const name = businessName(preset);
    assert.ok(name && html.includes(name), `${id}: business name missing: ${name}`);
    const dataImgs = html.match(/data:image\//g) || [];
    assert.ok(dataImgs.length >= 1, `${id}: expected inlined data:image/ photos, got ${dataImgs.length}`);
    const leftoverImgs = html.match(/(?:src|url\()\s*[=:]?\s*['"]?images\/[^'")\s]+/gi) || [];
    assert.deepStrictEqual(
      leftoverImgs,
      [],
      `${id}: relative images/ still present: ${leftoverImgs.slice(0, 5).join(', ')}`
    );
    for (const re of FORBIDDEN_SURFACE) {
      assert.ok(!re.test(html), `${id}: forbidden leftover in opened preview: ${re}`);
    }
    console.log(
      `  ${id}/${preset.id}: html=${html.length} data:image=${dataImgs.length} name=${name}`
    );
  }
});

check('portfolio opened preview has salon about-cap, not English Studio factory chrome', () => {
  const { html, preset } = previews.portfolio;
  assert.ok(!/>\s*Studio\s*</i.test(html), 'portfolio still hardcodes English Studio chrome');
  const cap =
    (preset.config && preset.config.labels && preset.config.labels.aboutCap) || '';
  assert.ok(cap && /Salon|Atelier/i.test(String(cap)), `aboutCap not salon-family: ${cap}`);
  assert.ok(html.includes(String(cap)), `aboutCap missing from opened preview: ${cap}`);
  assert.ok(
    /Galerie|Servicii|Programare/i.test(html),
    'expected Romanian salon nav labels in opened preview'
  );
});

check('local-service opened preview drops CONSTRUCTII factory script header', () => {
  const { html, preset } = previews['local-service'];
  assert.ok(
    !/CONSTRUCTII\s+template/i.test(html) && !/v2\s+premium\s+redesign/i.test(html),
    'CONSTRUCTII factory script header still inlined in opened srcdoc'
  );
  const name = businessName(preset);
  assert.ok(name && html.includes(name));
});

check('CSS factory system-id headers absent from opened srcdoc surface', () => {
  for (const id of SYSTEMS) {
    const { html } = previews[id];
    assert.ok(!/PRODUCT-MENU\s*—/i.test(html), `${id}: PRODUCT-MENU factory header in srcdoc`);
    assert.ok(!/LOCAL-SERVICE\s*—/i.test(html), `${id}: LOCAL-SERVICE factory header in srcdoc`);
    assert.ok(!/PORTFOLIO\s*—\s*Hidook/i.test(html), `${id}: PORTFOLIO factory header in srcdoc`);
  }
  // Source headers use commercial vertical names, not factory ids as title.
  const pmCss = fs.readFileSync(path.join(ROOT, 'templates/product-menu/styles.css'), 'utf8');
  const pfCss = fs.readFileSync(path.join(ROOT, 'templates/portfolio/styles.css'), 'utf8');
  const lsCss = fs.readFileSync(path.join(ROOT, 'templates/local-service/styles.css'), 'utf8');
  assert.ok(/Restaurant/i.test(pmCss.slice(0, 400)), 'product-menu CSS missing Restaurant header');
  assert.ok(/Beauty|salon/i.test(pfCss.slice(0, 400)), 'portfolio CSS missing Beauty/salon header');
  assert.ok(/Construction|trade/i.test(lsCss.slice(0, 400)), 'local-service CSS missing Construction header');
  assert.ok(!/PRODUCT-MENU\s*—/i.test(pmCss), 'product-menu source still PRODUCT-MENU —');
  assert.ok(!/LOCAL-SERVICE\s*—/i.test(lsCss), 'local-service source still LOCAL-SERVICE —');
  assert.ok(!/PORTFOLIO\s*—\s*Hidook/i.test(pfCss), 'portfolio source still PORTFOLIO — Hidook');
});

// Causal overlay: parent SHA must FAIL the exact leftovers we remade.
check(`parent ${PARENT_SHA.slice(0, 7)} is RED on Studio + CONSTRUCTII + factory CSS ids`, () => {
  const parentPfHtml = parentBlob('templates/portfolio/template.html');
  const parentLsJs = parentBlob('templates/local-service/script.js');
  const parentPmCss = parentBlob('templates/product-menu/styles.css');
  const parentPfCss = parentBlob('templates/portfolio/styles.css');
  const parentLsCss = parentBlob('templates/local-service/styles.css');

  assert.ok(
    />\s*Studio\s*</i.test(parentPfHtml),
    'parent portfolio no longer hardcodes Studio — pick another causal RED'
  );
  assert.ok(
    /CONSTRUCTII\s+template/i.test(parentLsJs),
    'parent local-service script no longer has CONSTRUCTII template — pick another causal RED'
  );
  assert.ok(
    /PRODUCT-MENU\s*—/i.test(parentPmCss),
    'parent product-menu CSS no longer has PRODUCT-MENU — header'
  );
  assert.ok(
    /PORTFOLIO\s*—/i.test(parentPfCss),
    'parent portfolio CSS no longer has PORTFOLIO — header'
  );
  assert.ok(
    /LOCAL-SERVICE\s*—/i.test(parentLsCss),
    'parent local-service CSS no longer has LOCAL-SERVICE — header'
  );

  const parentSurface = [parentPfHtml, parentLsJs, parentPmCss, parentPfCss, parentLsCss].join('\n');
  assert.ok(/>\s*Studio\s*</i.test(parentSurface), 'parent surface missing Studio (expected RED)');
  assert.ok(
    /CONSTRUCTII\s+template/i.test(parentSurface),
    'parent surface missing CONSTRUCTII template (expected RED)'
  );
  assert.ok(/PRODUCT-MENU\s*—/i.test(parentSurface), 'parent surface missing PRODUCT-MENU (expected RED)');
});

check('HEAD worktree surface is GREEN on the same leftovers', () => {
  const pf = fs.readFileSync(path.join(ROOT, 'templates/portfolio/template.html'), 'utf8');
  const lsJs = fs.readFileSync(path.join(ROOT, 'templates/local-service/script.js'), 'utf8');
  assert.ok(!/>\s*Studio\s*</i.test(pf), 'portfolio still hardcodes Studio');
  assert.ok(/labels\.aboutCap/.test(pf), 'portfolio template missing labels.aboutCap binding');
  assert.ok(!/CONSTRUCTII\s+template/i.test(lsJs), 'local-service script still CONSTRUCTII template');
  assert.ok(!/v2\s+premium\s+redesign/i.test(lsJs), 'local-service script still v2 premium redesign');
  for (const id of SYSTEMS) {
    const css = fs.readFileSync(path.join(ROOT, 'templates', id, 'styles.css'), 'utf8');
    assert.ok(!/PRODUCT-MENU\s*—/i.test(css), `${id}: PRODUCT-MENU still in CSS`);
    assert.ok(!/LOCAL-SERVICE\s*—/i.test(css), `${id}: LOCAL-SERVICE still in CSS`);
    assert.ok(!/PORTFOLIO\s*—\s*Hidook/i.test(css), `${id}: PORTFOLIO — Hidook still in CSS`);
  }
});

if (failed) {
  console.error('\nS58 FAILED');
  process.exit(1);
}
console.log('\nS58 OK');
process.exit(0);
