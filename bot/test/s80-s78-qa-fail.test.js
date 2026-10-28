'use strict';
/**
 * bot/test/s80-s78-qa-fail.test.js — S80 remake of S78 QA FAIL leaks.
 *
 * Form editor removed 2026-10-28: leftovers 1 and 2 (bindSignedInPaidSiteForEdit / startWithTemplate
 * carrying a paid site bind across templates in the editor) covered deleted code and their VM-simulation
 * checks were dropped. Leftover 3 (build.js renderHtml mustache leak) is a server/render contract and stays.
 *
 * Causal leftover on parent b1e5042:
 *   3. renderHtml leaves factory {{labels.about}} when key missing.
 *
 * GREEN on HEAD for each. Isolated adapters only.
 * Run: node bot/test/s80-s78-qa-fail.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BUILD_JS = path.join(ROOT, 'build.js');
const PARENT_SHA = 'b1e5042df3f52378cc77cc643cd4ff6d23d29447';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's80-s78-qa-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'test-secret-s80-' + crypto.randomBytes(4).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.NODE_ENV;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;

const { renderHtml } = require('../../build.js');

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

function parentBlob(rel) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function loadPresetConfig(templateId) {
  const body = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates', templateId, 'presets.json'), 'utf8')
  );
  const presets = body.presets || [];
  assert.ok(presets.length >= 1, templateId + ' presets');
  return JSON.parse(JSON.stringify(presets[0].config));
}

function loadTpl(templateId) {
  return fs.readFileSync(path.join(ROOT, 'templates', templateId, 'template.html'), 'utf8');
}

function hasFactoryMustache(html) {
  return (
    html.includes('{{labels.about}}') ||
    html.includes('{{LABELS.ABOUT}}') ||
    /\{\{\s*labels\./i.test(html) ||
    /\{\{\s*LABELS\./i.test(html)
  );
}

(async () => {
  const parentBuild = parentBlob('build.js');
  assert.ok(parentBuild, 'parent build.js at ' + PARENT_SHA);

  // ── Causal RED on parent ───────────────────────────────────────────────
  await check('causal RED: parent renderHtml leaves {{labels.about}} when key missing', () => {
    // Evaluate parent build.js replaceTokens behavior via vm-less: write temp require
    // Parent build is identical path — load via Function wrapper from source file blob.
    const tmpBuild = path.join(tmpDir, 'parent-build.js');
    fs.writeFileSync(tmpBuild, parentBuild, 'utf8');
    // Clear require cache
    delete require.cache[require.resolve(tmpBuild)];
    const parentRender = require(tmpBuild).renderHtml;
    const pmTpl = parentBlob('templates/product-menu/template.html') || loadTpl('product-menu');
    const proCfg = JSON.parse(parentBlob('templates/professionals/presets.json') || fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config;
    const hybrid = parentRender(pmTpl, proCfg);
    assert.ok(
      hybrid.includes('{{labels.about}}') || hybrid.includes('{{LABELS.ABOUT}}'),
      'parent hybrid professionals→product-menu still shows factory mustache labels.about'
    );
    const sparse = parentRender(pmTpl, {
      business: { name: 'X', title: 'X', metaDescription: 'Y', lang: 'ro', tagline: 't', about: 'a' },
      labels: { aboutEyebrow: 'Despre', scroll: 's', instaTitle: 'i', instaFollow: 'f', waQr: 'w', waOpen: 'o', heroEyebrow: 'h' },
      theme: { primary: '#000', primaryLight: '#111', primaryDark: '#222', cream: '#fff' },
      hero: { ctaLabel: 'c', background: '#fff' },
      servicesTitle: 'M',
      contact: { title: 'C', intro: 'i' },
      footer: { address: 'a', year: '2026', note: 'n' },
      categories: [],
    });
    assert.ok(
      sparse.includes('{{labels.about}}') || sparse.includes('{{LABELS.ABOUT}}'),
      'parent leaves {{labels.about}} when labels.about missing'
    );
  });

  // ── HEAD GREEN ─────────────────────────────────────────────────────────
  await check('HEAD: rendered HTML never shows factory {{labels.about}} / {{LABELS.ABOUT}}', () => {
    const pmTpl = loadTpl('product-menu');
    const prTpl = loadTpl('professionals');
    const proCfg = loadPresetConfig('professionals');

    const hybrid = renderHtml(pmTpl, proCfg);
    assert.ok(!hasFactoryMustache(hybrid), 'professionals config through product-menu must not leak mustache');
    assert.ok(!hybrid.includes('{{labels.about}}'));
    assert.ok(!hybrid.includes('{{LABELS.ABOUT}}'));

    const sparsePm = renderHtml(pmTpl, {
      business: { name: 'X', title: 'X', metaDescription: 'Y', lang: 'ro', tagline: 't', about: 'a' },
      labels: { aboutEyebrow: 'Despre', scroll: 's', instaTitle: 'i', instaFollow: 'f', waQr: 'w', waOpen: 'o', heroEyebrow: 'h' },
      theme: { primary: '#000', primaryLight: '#111', primaryDark: '#222', cream: '#fff' },
      hero: { ctaLabel: 'c', background: '#fff' },
      servicesTitle: 'M',
      contact: { title: 'C', intro: 'i' },
      footer: { address: 'a', year: '2026', note: 'n' },
      categories: [],
    });
    assert.ok(!sparsePm.includes('{{labels.about}}'), 'missing labels.about → empty, not mustache');
    assert.ok(!sparsePm.includes('{{LABELS.ABOUT}}'));

    const sparsePr = renderHtml(prTpl, {
      business: { name: 'Cab', title: 'Cab', metaDescription: 'm', lang: 'ro', about: 'a', tagline: 't' },
      labels: { aboutEyebrow: 'Despre' },
      theme: { primary: '#000', primaryLight: '#111', primaryDark: '#222', cream: '#fff' },
      hero: { ctaLabel: 'c', background: '#fff', qualifier: 'q' },
      servicesTitle: 'S',
      services: [],
      process: { title: 'P', steps: [] },
      faq: { title: 'F', items: [] },
      contact: { title: 'C', intro: 'i', email: 'a@b.c', phone: '+40', phoneDisplay: '40', waHref: '#' },
      footer: { note: 'n', year: '2026' },
      appointment: { enabled: false },
    });
    assert.ok(!hasFactoryMustache(sparsePr), 'professionals sparse must not leak label mustache');
  });

  await check('HEAD: professionals template/preset used for live includes appointment markup', () => {
    const prTpl = loadTpl('professionals');
    const proCfg = loadPresetConfig('professionals');
    assert.ok(/id=["']appointment["']/.test(prTpl), 'template has #appointment');
    assert.ok(/pr-appt/.test(prTpl), 'template has pr-appt form');
    const html = renderHtml(prTpl, proCfg);
    assert.ok(/id=["']appointment["']/.test(html), 'rendered live has #appointment');
    assert.ok(/pr-appt|Cerere|programare/i.test(html), 'appointment/cerere UI present');
    assert.ok(!hasFactoryMustache(html), 'clean professionals render');
    assert.ok(!/calendly/i.test(html), 'no Calendly');
    // preset supplies about eyebrow used by template
    assert.ok(proCfg.labels && proCfg.labels.aboutEyebrow, 'preset labels.aboutEyebrow');
  });

  await check('HEAD: unresolved tokens become empty (build.js), not raw mustache', () => {
    const src = fs.readFileSync(BUILD_JS, 'utf8');
    assert.ok(/unresolved token:.*omitted|return ''/.test(src), 'build.js omits unresolved tokens');
    const sample = renderHtml('Hi {{labels.about}} / {{LABELS.ABOUT}} end', { labels: {} });
    assert.ok(!sample.includes('{{labels.about}}'), 'no labels.about mustache: ' + sample);
    assert.ok(!sample.includes('{{LABELS.ABOUT}}'), 'no LABELS.ABOUT mustache: ' + sample);
    assert.ok(!/\{\{/.test(sample), 'no leftover mustache: ' + sample);
    assert.strictEqual(sample.replace(/\s+/g, ' ').trim(), 'Hi / end');
  });

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  if (failed) {
    console.error('\n' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('\nAll s80-s78-qa-fail checks passed.');
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
