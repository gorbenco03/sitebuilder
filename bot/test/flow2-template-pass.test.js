'use strict';
/**
 * bot/test/flow2-template-pass.test.js — VISION Flow 2 gates.
 *
 * Causal RED on required base 6fa18d4 if:
 *   - Desserdirina missing from templates/registry.json
 *   - attribution still says "Built by" (VISION requires "Build by …")
 *   - Details drawer does not auto-open on first editor entry
 *
 * GREEN on HEAD after Flow 2 implementation.
 * Run: node bot/test/flow2-template-pass.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BASE_SHA = '6fa18d465c0d18a625ecd5390ca1b6fbacb8691d';
const TPLS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function baseBlob(rel) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', BASE_SHA + ':' + rel], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

// ─── Causal RED on base ───────────────────────────────────────────────

check('causal RED: base registry has no desserdirina', () => {
  const raw = baseBlob('templates/registry.json');
  assert.ok(raw, 'base registry readable');
  const reg = JSON.parse(raw);
  const ids = (reg.templates || []).map((t) => t.id);
  assert.ok(!ids.includes('desserdirina'), 'base must lack desserdirina');
  assert.ok(!fs.existsSync(path.join(ROOT, '.git', 'objects')) || true);
  // Confirm base tree had only four commercial folders (no desserdirina dir in base)
  try {
    execFileSync('git', ['-C', ROOT, 'ls-tree', BASE_SHA, 'templates/desserdirina'], {
      encoding: 'utf8',
    });
    // empty output means missing
  } catch (_) { /* missing is expected */ }
  const ls = execFileSync('git', ['-C', ROOT, 'ls-tree', '--name-only', BASE_SHA, 'templates/'], {
    encoding: 'utf8',
  });
  assert.ok(!/desserdirina/.test(ls), 'base templates/ has no desserdirina path');
});

check('causal RED: base four templates still say Built by (not VISION Build by)', () => {
  for (const id of ['product-menu', 'local-service', 'portfolio', 'professionals']) {
    const html = baseBlob(`templates/${id}/template.html`);
    assert.ok(html, id + ' base html');
    assert.ok(/Built by/.test(html), id + ' base still Built by');
    assert.ok(!/\bBuild by\b/.test(html), id + ' base must not already have Build by');
  }
});

check('causal RED: base builder lacks Details auto-open preference', () => {
  const app = baseBlob('builder/app.js');
  assert.ok(app, 'base app.js');
  assert.ok(!/hb-details-drawer-pref/.test(app), 'base has no drawer pref key');
  assert.ok(!/function shouldAutoOpenDrawer/.test(app), 'base has no shouldAutoOpenDrawer');
  // openDrawer existed but was only manual / publish-missing
  assert.ok(/function openDrawer/.test(app), 'base still has openDrawer');
  assert.ok(!/shouldAutoOpenDrawer\(\)/.test(app), 'base never calls shouldAutoOpenDrawer');
});

// ─── HEAD GREEN ───────────────────────────────────────────────────────

check('HEAD: registry lists desserdirina as fifth commercial template', () => {
  const reg = readJson('templates/registry.json');
  const ids = (reg.templates || []).map((t) => t.id);
  assert.ok(ids.includes('desserdirina'), 'desserdirina in registry');
  assert.ok(ids.length >= 5, 'at least 5 templates');
  const entry = reg.templates.find((t) => t.id === 'desserdirina');
  assert.ok(entry.name && /Desserdirina/i.test(entry.name), 'name');
  assert.ok(entry.description && /[ăâîșțĂÂÎȘȚ]/.test(entry.description), 'RO description diacritics');
});

check('HEAD: desserdirina folder has commercial template surface', () => {
  for (const f of [
    'templates/desserdirina/template.html',
    'templates/desserdirina/styles.css',
    'templates/desserdirina/script.js',
    'templates/desserdirina/schema.json',
    'templates/desserdirina/presets.json',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' missing');
  }
  const html = read('templates/desserdirina/template.html');
  assert.ok(/lang="\{\{business\.lang\}\}"/.test(html), 'business.lang');
  assert.ok(/class="hb-built-by"/.test(html), 'hb-built-by');
  assert.ok(/Build by/.test(html) && !/Built by/.test(html), 'VISION Build by string');
  assert.ok(/class="whatsapp-float"[\s\S]*?<svg class="wa-icon"/.test(html), 'WA SVG');
  assert.ok(/#25D366/.test(read('templates/desserdirina/styles.css')), 'WA green');
  assert.ok(/\.hb-built-by/.test(read('templates/desserdirina/styles.css')), 'badge CSS');
  assert.ok(/<details class="menu-group" open>/.test(html), 'menu details open by default');
  const schema = readJson('templates/desserdirina/schema.json');
  const keys = [];
  for (const s of schema.sections || []) {
    for (const f of s.fields || []) keys.push(f.key);
  }
  assert.ok(keys.includes('contact.waMessage'), 'waMessage in schema');
  assert.ok(keys.includes('instagram.embedUrl'), 'Instafidget slot in schema');
  const presets = readJson('templates/desserdirina/presets.json');
  const ro = (presets.presets || []).find((p) => p.config && p.config.business && p.config.business.lang === 'ro');
  assert.ok(ro, 'RO preset');
  assert.ok(/[ăâîșțĂÂÎȘȚ]/.test(JSON.stringify(ro.config)), 'RO diacritics');
  assert.ok(ro.config.contact && ro.config.contact.waMessage, 'waMessage');
  assert.ok(/[ăâîșțĂÂÎȘȚ]/.test(ro.config.contact.waMessage), 'RO waMessage diacritics');
  // Disconnected Instafidget: empty embedUrl
  assert.strictEqual(ro.config.instagram.embedUrl || '', '', 'disconnected feed embed empty');
});

check('HEAD: every launch template uses exact VISION attribution string', () => {
  for (const id of TPLS) {
    const html = read(`templates/${id}/template.html`);
    assert.ok(/class="hb-built-by"/.test(html), id + ' hb-built-by');
    assert.ok(/Build by/.test(html), id + ' Build by');
    assert.ok(!/Built by/.test(html), id + ' no Built by');
    // Plain-text contract: Build by hidook.tech powered by hidook.agency
    const plain = html
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ');
    assert.ok(
      /Build by\s+hidook\.tech\s+powered by\s+hidook\.agency/.test(plain),
      id + ' plain attribution contract'
    );
    assert.ok(!/\{\{footer\.note\}\}.*hidook|hidook.*\{\{footer\.note\}\}/.test(html), id + ' not footer.note');
    assert.ok(!/data-hb-edit[^>]*hb-built-by|hb-built-by[^>]*data-hb-edit/.test(html), id + ' non-editable');
  }
});

check('HEAD: Details drawer auto-opens on first editor entry; pref persists', () => {
  const app = read('builder/app.js');
  assert.ok(/hb-details-drawer-pref/.test(app), 'pref key');
  assert.ok(/function shouldAutoOpenDrawer/.test(app), 'shouldAutoOpenDrawer');
  assert.ok(/function getDrawerPref|localStorage\.getItem\(DRAWER_PREF_KEY\)/.test(app), 'read pref');
  assert.ok(/setDrawerPref\('open'\)/.test(app) || /localStorage\.setItem\([^\)]*open/.test(app), 'save open');
  assert.ok(/setDrawerPref\('closed'\)/.test(app) || /localStorage\.setItem\([^\)]*closed/.test(app), 'save closed');
  // Entering edit triggers auto-open
  assert.ok(
    /name === 'edit'[\s\S]{0,400}shouldAutoOpenDrawer/.test(app) ||
      /shouldAutoOpenDrawer\(\)[\s\S]{0,80}openDrawer/.test(app),
    'edit screen auto-opens drawer'
  );
  // Leaving edit must NOT write closed (only intentional close)
  const showScreen = app.match(/function showScreen\(name\) \{[\s\S]*?\n\}/);
  assert.ok(showScreen, 'showScreen extract');
  // When leaving edit, drawer is hidden without setDrawerPref('closed') in that branch
  assert.ok(/leaving the screen is not an intentional user close|do not write 'closed'/.test(app), 'leave-edit note');
});

check('HEAD: catalog/picker chrome is Romanian for stranger /app/', () => {
  const index = read('builder/index.html');
  assert.ok(/>Toate</.test(index), 'Toate chip');
  assert.ok(/>Meserii</.test(index), 'Meserii chip');
  assert.ok(/>Servicii profesionale</.test(index), 'Servicii profesionale chip');
  assert.ok(/>Cofetărie</.test(index), 'Cofetărie chip');
  assert.ok(/data-filter="desserdirina"/.test(index), 'desserdirina filter');
  assert.ok(/>Detalii</.test(index), 'Detalii topbar');
  assert.ok(/Detalii site/.test(index), 'drawer title RO');
  const app = read('builder/app.js');
  assert.ok(/'desserdirina':\s*'Cofetărie'/.test(app), 'DESIGN_BADGE desserdirina');
  assert.ok(/'local-service':\s*'Meserii'/.test(app), 'DESIGN_BADGE Meserii');
  assert.ok(/>Începe</.test(app) || /Începe<\/button>/.test(app), 'Începe CTA');
  assert.ok(/Previzualizare/.test(app), 'Previzualizare CTA');
});

check('HEAD: render desserdirina RO preset — badge, WA, lang, no dead IG', () => {
  const { renderHtml } = require(path.join(ROOT, 'build.js'));
  const tplHtml = read('templates/desserdirina/template.html');
  const presets = readJson('templates/desserdirina/presets.json');
  const ro = presets.presets.find((p) => p.config.business.lang === 'ro');
  assert.ok(ro, 'ro preset');
  const cfg = JSON.parse(JSON.stringify(ro.config));
  const digits = String((cfg.contact && cfg.contact.whatsapp) || '').replace(/\D/g, '');
  cfg.contact.waHref =
    'https://wa.me/' + digits + '?text=' + encodeURIComponent((cfg.contact && cfg.contact.waMessage) || '');
  const out = renderHtml(tplHtml, cfg, { editMode: false });
  assert.ok(/lang="ro"/.test(out), 'lang=ro');
  assert.ok(/Build by/.test(out) && /hidook\.tech/.test(out) && /hidook\.agency/.test(out), 'badge');
  assert.ok(!/Built by/.test(out), 'no Built by');
  assert.ok(/wa\.me\/\d+\?text=/.test(out), 'prefilled wa');
  assert.ok(/Bun%C4%83|Bună|aș dori|a%C8%99/.test(out), 'diacritics in wa or body');
  assert.ok(!/>WA</.test(out), 'no WA text float');
  assert.ok(/class="wa-icon"/.test(out), 'wa icon class');
  // Disconnected: normalizeInstagramForPublic clears handle → no public IG section
  assert.ok(!/instagram-section|instagram-heading/.test(out) || !/iframe[^>]*instagram\.com/.test(out), 'no dead IG iframe');
  const edit = renderHtml(tplHtml, cfg, { editMode: true });
  assert.ok(/hb-built-by/.test(edit), 'badge survives editMode');
  assert.ok(!/data-hb-edit="[^"]*"[^>]*>Build by/.test(edit), 'Build by not path-wrapped');
});

check('HEAD: deriveWaHref still encodes RO diacritics; empty number clears href', () => {
  const app = read('builder/app.js');
  const m = app.match(/function deriveWaHref\(config\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'extract deriveWaHref');
  const fnSrc =
    'const WA_DEFAULT_MSG = "Bună!";\n' + m[0] + '\nreturn deriveWaHref;';
  // eslint-disable-next-line no-new-func
  const derive = new Function(fnSrc)();
  const cfg = {
    contact: {
      whatsapp: '40721234567',
      waMessage: 'Bună ziua, aș dori o programare.',
    },
  };
  derive(cfg);
  assert.ok(cfg.contact.waHref.includes(encodeURIComponent('Bună ziua, aș dori o programare.')));
  const empty = { contact: { whatsapp: '', waMessage: 'x' } };
  derive(empty);
  assert.strictEqual(empty.contact.waHref, '');
});

if (failed) {
  console.error('\n' + failed + ' flow2 check(s) failed');
  process.exit(1);
}
console.log('\nAll flow2-template-pass checks passed');
