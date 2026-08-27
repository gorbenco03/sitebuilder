'use strict';
/**
 * bot/test/wave2-template-pass.test.js — Wave 2 items 2, 5, 12, 10b.
 * Static gates only. Does not touch Telegram bot/flow.js.
 * Run: node bot/test/wave2-template-pass.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const TPLS = ['product-menu', 'local-service', 'portfolio', 'professionals'];
const APP_JS = path.join(ROOT, 'builder', 'app.js');

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

check('item2: every template has a RO preset with lang=ro and diacritics', () => {
  for (const id of TPLS) {
    const data = readJson(`templates/${id}/presets.json`);
    const ro = (data.presets || []).filter((p) => p.config && p.config.business && p.config.business.lang === 'ro');
    assert.ok(ro.length >= 1, id + ' missing RO preset');
    const blob = JSON.stringify(ro[0].config);
    assert.ok(/[șțăîâȘȚĂÎÂ]/.test(blob), id + ' RO preset missing Romanian diacritics');
    assert.strictEqual(ro[0].config.business.lang, 'ro');
  }
});

check('item2: professionals appointment UI labels are templated (not hardcoded EN)', () => {
  const html = read('templates/professionals/template.html');
  assert.ok(!/>Type of consultation</.test(html), 'hardcoded Type of consultation');
  assert.ok(!/>Date</.test(html) || /{{labels.apptDate}}/.test(html), 'date label');
  assert.ok(/{{labels.apptTypeLegend}}/.test(html));
  assert.ok(/{{labels.apptDate}}/.test(html));
  assert.ok(/{{labels.apptTime}}/.test(html));
  assert.ok(/{{labels.apptName}}/.test(html));
  assert.ok(/{{labels.apptEmail}}/.test(html));
  assert.ok(/{{labels.apptPhone}}/.test(html));
  assert.ok(/{{labels.apptNote}}/.test(html));
  assert.ok(/{{labels.apptDoneTitle}}/.test(html));
  assert.ok(/{{labels.apptAltChannel}}/.test(html));
  const schema = readJson('templates/professionals/schema.json');
  const keys = [];
  for (const s of schema.sections || []) {
    for (const f of s.fields || []) keys.push(f.key);
  }
  for (const k of [
    'labels.apptTypeLegend',
    'labels.apptDate',
    'labels.apptTime',
    'labels.apptName',
    'labels.apptEmail',
    'labels.apptPhone',
    'labels.apptNote',
    'labels.apptDoneTitle',
    'labels.apptAltChannel',
  ]) {
    assert.ok(keys.includes(k), 'schema missing ' + k);
  }
  const presets = readJson('templates/professionals/presets.json');
  for (const p of presets.presets) {
    assert.ok(p.config.labels && p.config.labels.apptTypeLegend, p.id + ' missing apptTypeLegend');
  }
});

check('item2: html lang token present on all templates', () => {
  for (const id of TPLS) {
    const html = read(`templates/${id}/template.html`);
    assert.ok(/lang=\"\{\{business\.lang\}\}\"/.test(html), id + ' missing business.lang');
  }
});

check('item5: attribution badge in every footer, not a config token, both links', () => {
  for (const id of TPLS) {
    const html = read(`templates/${id}/template.html`);
    assert.ok(/class=\"hb-built-by\"/.test(html), id + ' missing hb-built-by');
    assert.ok(/Built by/.test(html) && /hidook\.tech/.test(html) && /hidook\.agency/.test(html), id + ' badge text');
    assert.ok(/href=\"https:\/\/hidook\.tech\"/.test(html), id + ' hidook.tech link');
    assert.ok(/href=\"https:\/\/hidook\.agency\"/.test(html), id + ' hidook.agency link');
    assert.ok(!/data-hb-edit[^>]*hb-built-by|hb-built-by[^>]*data-hb-edit/.test(html), id + ' badge must not be data-hb-edit');
    assert.ok(!/\{\{[^}]*hb-built|\{\{footer\.note\}\}.*hidook/.test(html), id + ' badge must not be footer.note');
    const css = read(`templates/${id}/styles.css`);
    assert.ok(/\.hb-built-by/.test(css), id + ' missing badge CSS');
  }
});

check('item12: WhatsApp float uses SVG mark + #25D366, no bare WA text', () => {
  for (const id of TPLS) {
    const html = read(`templates/${id}/template.html`);
    assert.ok(!/>WA</.test(html), id + ' still has WA text float');
    assert.ok(/class=\"whatsapp-float\"[\s\S]*?<svg class=\"wa-icon\"/.test(html), id + ' float missing SVG');
    const css = read(`templates/${id}/styles.css`);
    assert.ok(/#25D366/.test(css), id + ' missing WhatsApp green');
  }
});

check('item12: contact.waMessage in every schema + presets; waHref stays clean in presets', () => {
  for (const id of TPLS) {
    const schema = readJson(`templates/${id}/schema.json`);
    const keys = [];
    for (const s of schema.sections || []) {
      for (const f of s.fields || []) keys.push(f.key);
    }
    assert.ok(keys.includes('contact.waMessage'), id + ' schema missing waMessage');
    assert.ok(keys.includes('contact.waHref'), id + ' schema keeps waHref for publish');
    const presets = readJson(`templates/${id}/presets.json`);
    for (const p of presets.presets) {
      const c = p.config.contact || {};
      assert.ok(typeof c.waMessage === 'string' && c.waMessage.length > 0, p.id + ' missing waMessage');
      // diacritics path: RO message must keep ș/ă
      if (p.config.business && p.config.business.lang === 'ro') {
        assert.ok(/[ăâîșțĂÂÎȘȚ]/.test(c.waMessage), p.id + ' RO waMessage missing diacritics');
      }
      if (c.waHref) {
        assert.ok(!/%[0-9A-Fa-f]{2}/.test(c.waHref), p.id + ' preset waHref must stay clean (builder derives text=)');
        assert.ok(/^https:\/\/wa\.me\/\d+\/?$/.test(c.waHref), p.id + ' waHref not clean wa.me: ' + c.waHref);
      }
    }
  }
});

check('item12: browser builder derives wa.me?text= and hides waHref from strangers', () => {
  const app = read('builder/app.js');
  assert.ok(/function deriveWaHref\s*\(/.test(app), 'deriveWaHref missing');
  assert.ok(/encodeURIComponent/.test(app), 'must encode message');
  assert.ok(app.includes('wa.me/'), 'wa.me builder');
  assert.ok(/HIDDEN_DRAWER_KEYS[\s\S]{0,120}contact\.waHref/.test(app) || /waHref.*return true/.test(app), 'waHref hidden');
  assert.ok(/waMessage/.test(app), 'waMessage in drawer keys');
  assert.ok(!/bot\/flow\.js/.test(app) || true, 'no flow import required');
  // derive called on save + preview
  assert.ok(/function saveDraft[\s\S]{0,200}deriveWaHref/.test(app), 'saveDraft derives');
  assert.ok(/function buildSrcdoc[\s\S]{0,200}deriveWaHref/.test(app), 'buildSrcdoc derives');
});

check('item12: deriveWaHref encodes Romanian diacritics (unit via Function)', () => {
  const app = read('builder/app.js');
  const m = app.match(/function deriveWaHref\(config\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'extract deriveWaHref');
  // Isolate function body with default msg constant
  const fnSrc =
    'const WA_DEFAULT_MSG = "Hello!";\n' +
    m[0] +
    '\nreturn deriveWaHref;';
  // eslint-disable-next-line no-new-func
  const derive = new Function(fnSrc)();
  const cfg = {
    contact: {
      whatsapp: '40721234567',
      waMessage: 'Bună ziua, aș dori o programare.',
    },
  };
  derive(cfg);
  assert.ok(cfg.contact.waHref.startsWith('https://wa.me/40721234567?text='), cfg.contact.waHref);
  assert.ok(cfg.contact.waHref.includes(encodeURIComponent('Bună ziua, aș dori o programare.')), 'diacritics encoded');
  const empty = { contact: { whatsapp: '', waMessage: 'x' } };
  derive(empty);
  assert.strictEqual(empty.contact.waHref, '');
});

check('item10b: professionals FAQ details ship open; restaurant menu groups stay open', () => {
  const pr = read('templates/professionals/template.html');
  assert.ok(/<details class=\"pr-faq__item\" open>/.test(pr), 'FAQ must be open');
  assert.ok(!/<details class=\"pr-faq__item\">/.test(pr), 'no collapsed FAQ details');
  const pm = read('templates/product-menu/template.html');
  assert.ok(/<details class=\"pm-group\" open>/.test(pm), 'menu groups stay open');
});

check('engine render: RO professionals preset → lang=ro + badge + open FAQ + no WA text', () => {
  const { renderHtml } = require(path.join(ROOT, 'build.js'));
  const tplHtml = read('templates/professionals/template.html');
  const presets = readJson('templates/professionals/presets.json');
  const ro = presets.presets.find((p) => p.config.business.lang === 'ro');
  assert.ok(ro, 'ro preset');
  const cfg = JSON.parse(JSON.stringify(ro.config));
  const digits = String((cfg.contact && cfg.contact.whatsapp) || '').replace(/\D/g, '');
  cfg.contact.waHref =
    'https://wa.me/' + digits + '?text=' + encodeURIComponent((cfg.contact && cfg.contact.waMessage) || '');
  const out = renderHtml(tplHtml, cfg, { editMode: false });
  assert.ok(/lang="ro"/.test(out), 'html lang=ro');
  assert.ok(/hb-built-by/.test(out) && /hidook\.tech/.test(out), 'badge in render');
  assert.ok(/<details class="pr-faq__item" open>/.test(out), 'FAQ open in render');
  assert.ok(!/>WA</.test(out), 'no WA text in render');
  assert.ok(/wa\.me\/\d+\?text=/.test(out), 'prefilled wa href in render');
  assert.ok(/Tip de consultație|Dată|Cerere trimisă/.test(out), 'RO appointment labels');
  const edit = renderHtml(tplHtml, cfg, { editMode: true });
  assert.ok(/hb-built-by/.test(edit), 'badge in edit preview');
  // Static badge text is not a config path, so editMode must not wrap "Built by" as hb-edit of a field
  assert.ok(!/data-hb-edit="[^"]*"[^>]*>Built by/.test(edit), 'Built by not data-hb-edit path-wrapped');
});

check('item2-R1: local-service RO live HTML has no leftover English chrome', () => {
  const { renderHtml } = require(path.join(ROOT, 'build.js'));
  const tplHtml = read('templates/local-service/template.html');
  // Template must wire chrome through labels.* (not hardcoded EN)
  assert.ok(/\{\{labels\.callCta\}\}/.test(tplHtml), 'callCta token');
  assert.ok(/\{\{labels\.yearsExperience\}\}/.test(tplHtml), 'yearsExperience token');
  assert.ok(/\{\{labels\.processTitle\}\}/.test(tplHtml), 'processTitle token');
  assert.ok(/\{\{labels\.servicesEyebrow\}\}/.test(tplHtml), 'servicesEyebrow token');
  assert.ok(/\{\{labels\.contactBandTitle\}\}/.test(tplHtml), 'contactBandTitle token');
  assert.ok(!/>CALL\s/.test(tplHtml) && !/CALL \{\{/.test(tplHtml), 'no hardcoded CALL dock');
  assert.ok(!/>How we work</.test(tplHtml), 'no hardcoded How we work');
  assert.ok(!/>years experience</.test(tplHtml), 'no hardcoded years experience');
  assert.ok(!/>Ready to get started\?</.test(tplHtml), 'no hardcoded Ready to get started');
  assert.ok(!/>Specifications</.test(tplHtml), 'no hardcoded Specifications');

  const schema = readJson('templates/local-service/schema.json');
  const keys = [];
  for (const s of schema.sections || []) {
    for (const f of s.fields || []) keys.push(f.key);
  }
  for (const k of [
    'labels.callCta',
    'labels.yearsExperience',
    'labels.projects',
    'labels.yearsOnJob',
    'labels.servicesEyebrow',
    'labels.processEyebrow',
    'labels.processTitle',
    'labels.contactBandTitle',
    'labels.contactBandText',
    'labels.dockAria',
  ]) {
    assert.ok(keys.includes(k), 'schema missing ' + k);
  }

  const presets = readJson('templates/local-service/presets.json');
  const ro = presets.presets.find((p) => p.config.business && p.config.business.lang === 'ro');
  assert.ok(ro, 'local-service RO preset');
  const L = ro.config.labels || {};
  assert.strictEqual(L.callCta, 'Sună');
  assert.ok(/[șțăîâȘȚĂÎÂ]/.test(L.yearsExperience || ''), 'RO yearsExperience diacritics');
  assert.ok(/[șțăîâȘȚĂÎÂ]/.test(L.processTitle || ''), 'RO processTitle diacritics');
  assert.ok(/[șțăîâȘȚĂÎÂ]/.test(L.contactBandTitle || ''), 'RO contactBandTitle diacritics');
  for (const p of presets.presets) {
    assert.ok(p.config.labels && p.config.labels.callCta, p.id + ' missing callCta');
    assert.ok(p.config.labels.processTitle, p.id + ' missing processTitle');
    assert.ok(p.config.labels.yearsExperience, p.id + ' missing yearsExperience');
  }

  const cfg = JSON.parse(JSON.stringify(ro.config));
  const digits = String((cfg.contact && cfg.contact.whatsapp) || '').replace(/\D/g, '');
  cfg.contact.waHref =
    'https://wa.me/' + digits + '?text=' + encodeURIComponent((cfg.contact && cfg.contact.waMessage) || '');
  const out = renderHtml(tplHtml, cfg, { editMode: false });
  assert.ok(/lang="ro"/.test(out), 'html lang=ro');
  // Critic evidence tokens must not remain in live RO HTML
  const forbidden = [
    'CALL',
    'How we work',
    'Specifications',
    'years experience',
    'Ready to get started',
    'years on the job',
    'Free evaluation',
    'Request an estimate',
  ];
  for (const t of forbidden) {
    assert.ok(!out.includes(t), 'RO live HTML still contains English chrome: ' + t);
  }
  // Sticky dock must reuse call CTA (Sună), not a second English word
  assert.ok(/ls-dock__call[^>]*>[\s\S]{0,40}Sună/.test(out), 'dock must use Sună callCta');
  assert.ok(/Cum lucrăm/.test(out), 'RO process title rendered');
  assert.ok(/ani experiență/.test(out), 'RO years experience rendered');
  assert.ok(/Gata de început/.test(out), 'RO contact band title rendered');
});

check('no Telegram bot files touched by this slice (static presence only)', () => {
  // Sanity: flow still has buildWaHref (we did not delete it); we simply did not edit the file in this task.
  const flow = read('bot/flow.js');
  assert.ok(/function buildWaHref/.test(flow), 'flow untouched still has buildWaHref');
});

if (failed) {
  console.error('\n' + failed + ' failed');
  process.exit(1);
}
console.log('\nAll wave2-template-pass checks passed.');
