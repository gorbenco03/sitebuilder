'use strict';
/**
 * S49: browser editor is the commercial product —
 * pick a design → replace copy/images → preview updates.
 *
 * Catalog must show three human design systems (not raw API ids as badges).
 * Builder chrome must not sell DESSERD / bakery / factory "Șabloane" leftovers.
 *
 * Run: node bot/test/builder-editor-commercial.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const IDS = ['product-menu', 'local-service', 'portfolio', 'professionals'];
const BUILDER_HTML = path.join(ROOT, 'builder', 'index.html');
const BUILDER_JS = path.join(ROOT, 'builder', 'app.js');
const REGISTRY = path.join(ROOT, 'templates', 'registry.json');

const FORBIDDEN_PRODUCT = [
  /\bDESSERD\b/i,
  /desserdina/i,
  /MENU BOARD/i,
  /chalkboard/i,
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

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

check('four design systems remain in registry with stable ids', () => {
  const reg = JSON.parse(read(REGISTRY));
  assert.ok(Array.isArray(reg.templates), 'registry.templates array');
  const ids = reg.templates.map((t) => t.id);
  assert.deepStrictEqual(ids.slice().sort(), IDS.slice().sort());
  for (const t of reg.templates) {
    assert.ok(t.name && String(t.name).trim(), `${t.id} needs human name`);
    assert.ok(t.description && String(t.description).trim(), `${t.id} needs description`);
    // Visible name must not be the raw id
    assert.notStrictEqual(String(t.name).trim(), t.id, `${t.id} name must not equal id`);
  }
  const byId = Object.fromEntries(reg.templates.map((t) => [t.id, t]));
  assert.ok(/restaurant/i.test(byId['product-menu'].name), 'product-menu name restaurant');
  assert.ok(/salon/i.test(byId['portfolio'].name), 'portfolio name salon');
  assert.ok(/trade/i.test(byId['local-service'].name), 'local-service trade name');
  assert.ok(/profession/i.test(byId['professionals'].name), 'professionals name');
  // Telegram-friendly substrings stay somewhere in registry copy (S48 contract)
  const blob = JSON.stringify(reg);
  assert.ok(/menu/i.test(blob), 'registry keeps menu substring for picker tests');
  assert.ok(/portfolio/i.test(blob), 'registry keeps portfolio substring');
  assert.ok(/service/i.test(blob), 'registry keeps service(s) substring');
});

check('catalog badge markup never uses raw vertical/id as visible badge text', () => {
  const js = read(BUILDER_JS);
  // The factory bug: template-card-badge with tpl.vertical || tpl.id
  assert.ok(
    !/template-card-badge[^`]{0,80}\$\{escHtml\(\s*tpl\.vertical/s.test(js),
    'badge must not interpolate tpl.vertical'
  );
  assert.ok(
    !/template-card-badge[^`]{0,120}tpl\.vertical\s*\|\|\s*tpl\.id/s.test(js),
    'badge must not fall back to tpl.vertical || tpl.id'
  );
  // Must still keep ids on data-id for start handlers
  assert.ok(
    /btn-start-tpl[^>]*data-id="\$\{escHtml\(tpl\.id\)\}"/.test(js) ||
      /data-id="\$\{escHtml\(tpl\.id\)\}"/.test(js),
    'Începe button must keep data-id=template id'
  );
  // Human badge helper or name-based badge required
  const hasHumanBadge =
    /designBadgeLabel|humanBadge|badgeLabel|designSystemLabel/i.test(js) ||
    /template-card-badge">\$\{escHtml\(\s*tpl\.name\s*\)\}/.test(js);
  assert.ok(hasHumanBadge, 'badge must use human label helper or tpl.name, not raw id');
});

check('builder chrome prefers Designs / Choose a design over factory Șabloane nav', () => {
  const html = read(BUILDER_HTML);
  const js = read(BUILDER_JS);
  // Nav / hero catalog language
  assert.ok(
    /Designs|Choose a design/i.test(html),
    'index.html should offer Designs or Choose a design'
  );
  // Factory admin chrome should not dominate
  assert.ok(
    !/>\s*Șabloane\s*</.test(html),
    'header nav must not label the route as bare Șabloane'
  );
  assert.ok(
    !/aria-label="Șabloane disponibile"/.test(html),
    'templates grid aria-label must not say Șabloane disponibile'
  );
  assert.ok(
    !/aria-label="Alege un șablon"/.test(html),
    'screen must not say Alege un șablon'
  );
  // app.js empty/error catalog copy should not shout Șabloane factory
  assert.ok(
    !/Șabloanele nu sunt disponibile/.test(js),
    'empty catalog copy should not say Șabloanele nu sunt disponibile'
  );
});

check('builder chrome has no DESSERD / MENU BOARD / chalkboard leftovers', () => {
  const sources = [read(BUILDER_HTML), read(BUILDER_JS), read(REGISTRY)];
  for (const src of sources) {
    for (const re of FORBIDDEN_PRODUCT) {
      assert.ok(!re.test(src), `forbidden product residue matched ${re}`);
    }
  }
  const chrome = read(BUILDER_HTML) + read(BUILDER_JS);
  assert.ok(!/\bsynthetic\b/i.test(chrome), 'builder chrome must not say synthetic');
  assert.ok(!/\bS49\b/.test(chrome), 'builder chrome must not expose slice ids');
});

check('pick design path: startWithTemplate loads default preset into draft.config', () => {
  const js = read(BUILDER_JS);
  assert.ok(/function startWithTemplate\s*\(/.test(js), 'startWithTemplate exists');
  // Uses first preset config when no saved draft for that template
  assert.ok(
    /presets\[0\]\.config|presets\.length\s*>\s*0\s*\?\s*deepClone\(presets\[0\]\.config\)/.test(js),
    'startWithTemplate must seed draft from presets[0].config'
  );
  assert.ok(/window\.location\.hash\s*=\s*['"]#edit['"]/.test(js), 'opens #edit editor route');
  assert.ok(/function fullRerender\s*\(/.test(js) && /buildSrcdoc\s*\(/.test(js), 'preview path present');
  assert.ok(
    /HidookEngine\.renderPreview\s*\([^)]*editMode:\s*true/.test(js) ||
      /renderPreview\([^)]*\{\s*editMode:\s*true/.test(js),
    'preview uses engine editMode'
  );
});

check('replace copy + image updates preview (renderHtml + app apply path)', () => {
  const { renderHtml } = require('../../build.js');
  const tid = 'product-menu';
  const tplHtml = read(path.join(ROOT, 'templates', tid, 'template.html'));
  const presets = JSON.parse(read(path.join(ROOT, 'templates', tid, 'presets.json'))).presets;
  assert.ok(presets && presets[0] && presets[0].config, 'product-menu preset0');

  const base = deepClone(presets[0].config);
  const markerName = 'Local Comercial Test ' + Date.now().toString(36);
  // Engine may strip data: URLs; use a distinct https image the renderer keeps.
  const markerImg = 'https://example.com/s49-replaced-image-' + Date.now().toString(36) + '.jpg';

  base.business = base.business || {};
  base.business.name = markerName;
  base.logo = markerImg;

  const html = renderHtml(tplHtml, base);
  assert.ok(html.includes(markerName), 'rendered preview must show replaced business.name');
  assert.ok(html.includes(markerImg), 'rendered preview must include replaced logo/image URL');

  // Causal: parent app wires text + image into config then re-renders
  const js = read(BUILDER_JS);
  assert.ok(/function onInlineTextEdit\s*\(/.test(js), 'inline text edit handler');
  assert.ok(/setPath\(\s*draft\.config/.test(js), 'writes draft.config via setPath');
  assert.ok(
    /function onImageChangeRequest|initImageFileInput/.test(js),
    'image replace path'
  );
  assert.ok(
    /setPath\(\s*draft\.config,\s*path,\s*dataUrl\)[\s\S]{0,120}fullRerender\s*\(/.test(js),
    'image dataUrl set must fullRerender preview'
  );
});

check('Hidook Site Builder chrome, pay-before-publish, Instagram slot preserved', () => {
  const html = read(BUILDER_HTML);
  assert.ok(html.includes('Hidook Site Builder'), 'product name');
  assert.ok(/id="btn-publish"|Publish site/.test(html), 'publish CTA');
  assert.ok(/id="btn-pay-publish"|Add a card — start 7-day trial/.test(html), 'trial-card CTA');
  assert.ok(/id="btn-add-instagram"|Add Instagram/.test(html), 'Instagram partner slot');
  assert.ok(/lang="en"/.test(html), 'English UI');
});

if (failed) {
  console.error('\nbuilder-editor-commercial: FAILED');
  process.exit(1);
}
console.log('\nbuilder-editor-commercial: OK');
process.exit(0);
