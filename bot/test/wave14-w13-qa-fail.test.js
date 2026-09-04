'use strict';
/**
 * bot/test/wave14-w13-qa-fail.test.js — Wave 14 remake of Wave 13 QA FAIL leaks.
 *
 * Opened chrome on parent 66c4b11 still sold pay-once:
 *   Draft saved / Complete your payment / Pay and publish
 *   Payment confirmed / 12 months hosting included / Hosting until <year>
 *   .site-live-link word-break:break-all shreds slug at 390
 *   Details drawer: images/cn-hero.jpg + Instagram feed link + INTERFACE LABELS
 *
 * VISION 2026-08-26: card → 7-day trial → live now → charge day 7 unless cancel.
 *
 * Run: node bot/test/wave14-w13-qa-fail.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '66c4b1112535a0c98dafcd424a132a84c9510906';

const BUILDER_HTML = 'builder/index.html';
const BUILDER_JS = 'builder/app.js';
const BUILDER_CSS = 'builder/app.css';
const SCHEMAS = [
  'templates/product-menu/schema.json',
  'templates/portfolio/schema.json',
  'templates/local-service/schema.json',
  'templates/professionals/schema.json',
];

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

function parentBlob(rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function headRead(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i++];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return src.slice(m.index, i);
}

function cssRule(css, selector) {
  const re = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]+)\\}',
    'i'
  );
  const m = css.match(re);
  return m ? m[0] : null;
}

// ── Causal RED on parent Wave 12 / W13 FAIL HEAD ─────────────────────────
check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} unpaid success still pay-once`, () => {
  const html = parentBlob(BUILDER_HTML);
  assert.ok(/Pay and publish/.test(html), 'parent has Pay and publish');
  assert.ok(
    /Complete your payment to publish the site\./.test(html),
    'parent has Complete your payment to publish the site.'
  );
  assert.ok(/Draft saved/.test(html), 'parent default success title Draft saved');
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} live chrome is 12-month pay-once`, () => {
  const js = parentBlob(BUILDER_JS);
  assert.ok(
    /Your site is live — 12 months hosting included/.test(js),
    'parent live success title is 12 months hosting'
  );
  assert.ok(
    /Payment confirmed\. Your site is live\./.test(js),
    'parent toast is Payment confirmed'
  );
  assert.ok(/Pay and publish/.test(js), 'parent dashboard CTA Pay and publish');
  assert.ok(/Hosting until /.test(js), 'parent hosting-until line only');
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} .site-live-link break-all`, () => {
  const css = parentBlob(BUILDER_CSS);
  const block = cssRule(css, '.site-live-link');
  assert.ok(block, 'parent .site-live-link rule');
  assert.ok(/word-break\s*:\s*break-all/i.test(block), 'parent shreds with break-all');
});

check(`causal RED: parent schemas still Instagram feed + Interface labels`, () => {
  for (const rel of SCHEMAS) {
    const src = parentBlob(rel);
    assert.ok(
      /Instagram feed link \(optional\)/.test(src),
      rel + ' parent Instagram feed link'
    );
    assert.ok(
      /Interface labels/.test(src),
      rel + ' parent Interface labels'
    );
  }
});

check(`causal RED: parent hero background input shows raw images/ path`, () => {
  const js = parentBlob(BUILDER_JS);
  const bgFn = extractFunction(js, 'buildField') || js;
  // Parent assigns parsed.image (may be images/cn-hero.jpg) into input.value
  assert.ok(
    /imgInput\.value\s*=\s*parsed\.image/.test(js) ||
      /imgInput\.value\s*=\s*parsed\.image\s*\|\|/.test(js),
    'parent puts parsed.image into visible input value'
  );
  assert.ok(
    /Photo path, e\.g\. images\//.test(js) || /images\/hero\.jpg/.test(js),
    'parent placeholder exposes images/ path pattern'
  );
  void bgFn;
});

// ── HEAD GREEN ───────────────────────────────────────────────────────────
check('HEAD unpaid success title/note/CTA are trial card chrome', () => {
  const html = headRead(BUILDER_HTML);
  const js = headRead(BUILDER_JS);
  const blob = html + '\n' + js;

  assert.ok(/Adaugă un card ca să fii live/.test(blob), 'unpaid success title');
  assert.ok(
    /Adaugă un card ca să începi trialul de 7 zile\./.test(blob),
    'unpaid success note'
  );
  assert.ok(/Site-ul e live imediat\./.test(blob), 'unpaid success note');
  assert.ok(/Ești taxat în ziua 7 dacă nu anulezi\./.test(blob), 'unpaid success note');
  assert.ok(
    /Adaugă un card — începe trialul de 7 zile/.test(blob),
    'unpaid CTA label'
  );
  assert.ok(
    /Adaugă un card ca să începi trialul de 7 zile/.test(blob),
    'aria / long trial phrase'
  );

  assert.ok(!/Pay and publish/.test(blob), 'no Pay and publish');
  assert.ok(
    !/Complete your payment to publish the site\./.test(blob),
    'no Complete your payment to publish the site.'
  );
  assert.ok(
    !/Pay and publish this site/.test(blob),
    'no Pay and publish this site aria'
  );
});

check('HEAD live success + toast are trial started, not paid year', () => {
  const js = headRead(BUILDER_JS);
  assert.ok(
    /Site-ul tău e live — trial de 7 zile început/.test(js),
    'live success title'
  );
  assert.ok(
    /Trial început\. Site-ul tău e live\./.test(js),
    'trial started toast'
  );
  assert.ok(
    !/Your site is live — 12 months hosting included/.test(js),
    'no 12 months hosting included title'
  );
  assert.ok(
    !/Payment confirmed\. Your site is live\./.test(js),
    'no Payment confirmed live toast'
  );
});

check('HEAD dashboard trial line during trial; Hosting until only after', () => {
  const js = headRead(BUILDER_JS);
  const card = extractFunction(js, 'buildSiteCard') || js;
  assert.ok(
    (/7-day trial|Trial de 7|7\u2011zile|7 zile/i.test(card)) && /first charge|prima taxare/i.test(card),
    'buildSiteCard trial hosting line'
  );
  assert.ok(/Hosting until |Hosting până pe /.test(card), 'Hosting until remains for non-trial paid');
});

check('HEAD .site-live-link does not use word-break:break-all', () => {
  const css = headRead(BUILDER_CSS);
  const block = cssRule(css, '.site-live-link');
  assert.ok(block, '.site-live-link rule');
  assert.ok(
    !/word-break\s*:\s*break-all/i.test(block),
    '.site-live-link must not break-all'
  );
});

check('HEAD buildSiteCard live link wraps only at / with wbr or segments', () => {
  const js = headRead(BUILDER_JS);
  const card = extractFunction(js, 'buildSiteCard') || '';
  assert.ok(card.length > 40, 'buildSiteCard');
  const liveLinkRegion =
    (card.match(/site-live-link[\s\S]{0,800}/) || [''])[0];
  assert.ok(
    /fillUrlWithSlashWbr/.test(liveLinkRegion) ||
      /<wbr>/.test(liveLinkRegion) ||
      /success-url-seg|site-live-seg|split\s*\(\s*['"]\/['"]\s*\)/.test(card),
    'dashboard live link must soft-wrap at / like success URL'
  );
  // Helper (or inline) must insert slash-only wbr
  assert.ok(
    /fillUrlWithSlashWbr/.test(js) && /\/<wbr>/.test(js) && /split\s*\(\s*['"]\/['"]\s*\)/.test(js),
    'slash-only wbr helper present in app.js'
  );
});

check('HEAD four schemas: Button and section text + Instafidget feed URL RO', () => {
  for (const rel of SCHEMAS) {
    const src = headRead(rel);
    assert.ok(
      /Texte butoane și secțiuni/.test(src),
      rel + ' group title Button and section text'
    );
    assert.ok(
      !/Interface labels/.test(src),
      rel + ' must not keep Interface labels'
    );
    assert.ok(
      /URL feed Instafidget \(opțional\)/.test(src),
      rel + ' URL feed Instafidget (opțional)'
    );
    assert.ok(
      !/Instafidget feed URL \(optional\)/.test(src),
      rel + ' must not keep English Instafidget feed URL (optional)'
    );
    assert.ok(
      !/Instagram feed link \(optional\)/.test(src),
      rel + ' must not keep Instagram feed link (optional)'
    );
  }
});

check('HEAD hero background control does not show raw images/*.jpg', () => {
  const js = headRead(BUILDER_JS);
  // Must not assign parsed.image (path) into visible input value
  assert.ok(
    !/imgInput\.value\s*=\s*parsed\.image\b/.test(js),
    'must not put parsed.image into input.value'
  );
  assert.ok(
    /Poză adăugată|Photo added/.test(js),
    'human photo state label'
  );
  // Visible control must not advertise images/cn-hero.jpg or images/*.jpg as values
  const bgIdx = js.indexOf("type === 'background'");
  assert.ok(bgIdx >= 0, 'background field branch');
  const bgBlock = js.slice(bgIdx, bgIdx + 2800);
  assert.ok(/Poză adăugată|Photo added/.test(bgBlock), 'photo-added label in background control');
  assert.ok(
    !/images\/cn-hero\.jpg/.test(bgBlock),
    'no cn-hero.jpg in background control UI'
  );
  assert.ok(
    !/imgInput\.value\s*=\s*[^;]*images\//.test(bgBlock),
    'no images/ path assigned to imgInput.value'
  );
  assert.ok(
    !/placeholder\s*=\s*["'][^"']*images\//.test(bgBlock),
    'placeholder must not show images/ path'
  );
  assert.ok(
    /bgImagePath/.test(bgBlock) || /Poză adăugată|Photo added/.test(bgBlock),
    'internal path kept off the visible field'
  );
});

process.exit(failed ? 1 : 0);
