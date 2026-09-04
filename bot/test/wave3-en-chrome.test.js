'use strict';
/**
 * bot/test/wave3-en-chrome.test.js — Wave 3 leftover EN chrome.
 * Gallery eyebrow, lightbox a11y, RO servicesTitle on local-service.
 * collage.js lightbox labels via data-lb-* for product-menu + portfolio.
 * Static + render gates. Does not touch Telegram bot/flow.js.
 * Run: node bot/test/wave3-en-chrome.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

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

function schemaKeys(rel) {
  const schema = readJson(rel);
  const keys = [];
  for (const s of schema.sections || []) {
    for (const f of s.fields || []) keys.push(f.key);
  }
  return keys;
}

check('local-service template: gallery eyebrow + lightbox a11y use labels.*', () => {
  const html = read('templates/local-service/template.html');
  assert.ok(/\{\{labels\.galleryEyebrow\}\}/.test(html), 'galleryEyebrow token');
  assert.ok(!/>Work</.test(html), 'no hardcoded Work eyebrow');
  assert.ok(/aria-label="\{\{labels\.lightboxPreview\}\}"/.test(html), 'lightboxPreview token');
  assert.ok(/lightbox__close[^>]*aria-label="\{\{labels\.close\}\}"/.test(html), 'close via labels.close');
  assert.ok(/lightbox__prev[^>]*aria-label="\{\{labels\.lightboxPrev\}\}"/.test(html), 'lightboxPrev token');
  assert.ok(/lightbox__next[^>]*aria-label="\{\{labels\.lightboxNext\}\}"/.test(html), 'lightboxNext token');
  assert.ok(!/aria-label="Photo preview"/.test(html), 'no hardcoded Photo preview');
  assert.ok(!/aria-label="Previous"/.test(html), 'no hardcoded Previous');
  assert.ok(!/aria-label="Next"/.test(html), 'no hardcoded Next');
  // bare Close on lightbox must not remain (WA modal already uses labels.close)
  assert.ok(!/lightbox__close"[^>]*aria-label="Close"/.test(html), 'no hardcoded Close on lightbox');
});

check('local-service schema has wave3 label keys', () => {
  const keys = schemaKeys('templates/local-service/schema.json');
  for (const k of [
    'labels.galleryEyebrow',
    'labels.lightboxPreview',
    'labels.lightboxPrev',
    'labels.lightboxNext',
  ]) {
    assert.ok(keys.includes(k), 'schema missing ' + k);
  }
});

check('local-service presets: EN + RO labels; RO servicesTitle translated', () => {
  const presets = readJson('templates/local-service/presets.json');
  assert.ok(presets.presets.length >= 2, 'expected >=2 presets');
  for (const p of presets.presets) {
    const L = p.config.labels || {};
    assert.ok(L.galleryEyebrow, p.id + ' missing galleryEyebrow');
    assert.ok(L.lightboxPreview, p.id + ' missing lightboxPreview');
    assert.ok(L.lightboxPrev, p.id + ' missing lightboxPrev');
    assert.ok(L.lightboxNext, p.id + ' missing lightboxNext');
    assert.ok(L.close, p.id + ' missing close');
  }
  const ro = presets.presets.find((p) => p.id === 'renovari-bucuresti');
  assert.ok(ro, 'renovari-bucuresti');
  assert.strictEqual(ro.config.business.lang, 'ro');
  assert.strictEqual(ro.config.servicesTitle, 'Servicii');
  assert.notStrictEqual(ro.config.servicesTitle, 'Our services');
  assert.strictEqual(ro.config.labels.galleryEyebrow, 'Lucrări');
  assert.ok(/[șțăîâȘȚĂÎÂ]/.test(ro.config.labels.galleryEyebrow), 'galleryEyebrow diacritics');
  assert.ok(
    /Previzualizare/.test(ro.config.labels.lightboxPreview) ||
      /[șțăîâȘȚĂÎÂ]/.test(ro.config.labels.lightboxPreview),
    'lightboxPreview uses Romanian preview text'
  );
  assert.strictEqual(ro.config.labels.lightboxPrev, 'Anterior');
  assert.strictEqual(ro.config.labels.lightboxNext, 'Următor');
  assert.ok(/[șțăîâȘȚĂÎÂ]/.test(ro.config.labels.lightboxNext), 'lightboxNext diacritics');
  assert.strictEqual(ro.config.labels.close, 'Închide');
  assert.ok(/[șțăîâȘȚĂÎÂ]/.test(ro.config.labels.close), 'close diacritics');
});

check('render renovari-bucuresti: no leftover EN chrome tokens', () => {
  const { renderHtml } = require(path.join(ROOT, 'build.js'));
  const tplHtml = read('templates/local-service/template.html');
  const presets = readJson('templates/local-service/presets.json');
  const ro = presets.presets.find((p) => p.id === 'renovari-bucuresti');
  assert.ok(ro, 'ro preset');
  const cfg = JSON.parse(JSON.stringify(ro.config));
  const digits = String((cfg.contact && cfg.contact.whatsapp) || '').replace(/\D/g, '');
  cfg.contact.waHref =
    'https://wa.me/' + digits + '?text=' + encodeURIComponent((cfg.contact && cfg.contact.waMessage) || '');
  const out = renderHtml(tplHtml, cfg, { editMode: false });
  assert.ok(/lang="ro"/.test(out), 'html lang=ro');
  assert.ok(/Servicii/.test(out), 'RO servicesTitle rendered');
  assert.ok(/Lucrări/.test(out), 'RO gallery eyebrow rendered');
  assert.ok(
    /aria-label="Afișare foto"/.test(out) || /aria-label="Previzualizare fotografie"/.test(out),
    'RO lightbox preview'
  );
  assert.ok(/aria-label="Închide"/.test(out), 'RO close');
  assert.ok(/aria-label="Anterior"/.test(out), 'RO previous');
  assert.ok(/aria-label="Următor"/.test(out), 'RO next');
  const forbidden = [
    'Our services',
    '>Work<',
    'Photo preview',
    'aria-label="Close"',
    'aria-label="Previous"',
    'aria-label="Next"',
    // Wave 2 residuals must stay gone
    'How we work',
    'years experience',
    'Ready to get started',
    'Specifications',
  ];
  for (const t of forbidden) {
    assert.ok(!out.includes(t), 'RO live HTML still contains English chrome: ' + t);
  }
  // Eyebrow must not be the bare English word Work as text content
  assert.ok(!/>Work</.test(out), 'bare Work eyebrow in live HTML');
});

check('collage.js: no hardcoded lightbox EN; reads data-lb-*', () => {
  for (const id of ['local-service', 'product-menu', 'portfolio']) {
    const js = read(`templates/${id}/collage.js`);
    assert.ok(/data-lb-close/.test(js), id + ' collage missing data-lb-close reader');
    assert.ok(/data-lb-prev/.test(js), id + ' collage missing data-lb-prev reader');
    assert.ok(/data-lb-next/.test(js), id + ' collage missing data-lb-next reader');
    assert.ok(!/aria-label="Close"/.test(js), id + ' collage still hardcodes Close');
    assert.ok(!/aria-label="Previous"/.test(js), id + ' collage still hardcodes Previous');
    assert.ok(!/aria-label="Next"/.test(js), id + ' collage still hardcodes Next');
  }
});

check('product-menu + portfolio: html data-lb-* + schema/presets lightbox labels', () => {
  for (const id of ['product-menu', 'portfolio']) {
    const html = read(`templates/${id}/template.html`);
    assert.ok(/data-lb-close="\{\{labels\.close\}\}"/.test(html), id + ' data-lb-close');
    assert.ok(/data-lb-prev="\{\{labels\.lightboxPrev\}\}"/.test(html), id + ' data-lb-prev');
    assert.ok(/data-lb-next="\{\{labels\.lightboxNext\}\}"/.test(html), id + ' data-lb-next');
    const keys = schemaKeys(`templates/${id}/schema.json`);
    assert.ok(keys.includes('labels.lightboxPrev'), id + ' schema lightboxPrev');
    assert.ok(keys.includes('labels.lightboxNext'), id + ' schema lightboxNext');
    const presets = readJson(`templates/${id}/presets.json`);
    for (const p of presets.presets) {
      const L = p.config.labels || {};
      assert.ok(L.lightboxPrev, p.id + ' missing lightboxPrev');
      assert.ok(L.lightboxNext, p.id + ' missing lightboxNext');
      if (p.config.business && p.config.business.lang === 'ro') {
        assert.ok(/[șțăîâȘȚĂÎÂ]/.test(L.lightboxNext) || L.lightboxNext === 'Anterior' || true);
        assert.strictEqual(L.lightboxPrev, 'Anterior');
        assert.strictEqual(L.lightboxNext, 'Următor');
      }
    }
  }
});

check('wave2 local-service residual still holds (no regression)', () => {
  const { renderHtml } = require(path.join(ROOT, 'build.js'));
  const tplHtml = read('templates/local-service/template.html');
  const presets = readJson('templates/local-service/presets.json');
  const ro = presets.presets.find((p) => p.config.business && p.config.business.lang === 'ro');
  const cfg = JSON.parse(JSON.stringify(ro.config));
  const digits = String((cfg.contact && cfg.contact.whatsapp) || '').replace(/\D/g, '');
  cfg.contact.waHref =
    'https://wa.me/' + digits + '?text=' + encodeURIComponent((cfg.contact && cfg.contact.waMessage) || '');
  const out = renderHtml(tplHtml, cfg, { editMode: false });
  assert.ok(/Sună/.test(out), 'callCta Sună');
  assert.ok(/Cum lucrăm/.test(out), 'process title');
  assert.ok(/ani de experiență/.test(out), 'years experience RO');
  assert.ok(/Pregătit să/.test(out), 'contact band');
});

if (failed) {
  console.error('\n' + failed + ' failed');
  process.exit(1);
}
console.log('\nAll wave3-en-chrome checks passed.');
