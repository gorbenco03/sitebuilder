'use strict';
/**
 * bot/test/s80-s78-qa-fail.test.js — S80 remake of S78 QA FAIL leaks.
 *
 * STALE ORACLE RECONCILE (S-legacy G3, 2026-09-05):
 * startWithTemplate became async and awaits ensureTemplateLoaded before clearing
 * the paid-site bind. The S80 harness called it synchronously without stubbing
 * ensureTemplateLoaded, so the Promise rejected before currentSiteId=null and
 * the oracle falsely reported a product regression. Product still clears bind
 * after a successful catalog start (and bind still refuses cross-template paid
 * sites). Harness updated to async + ensureTemplateLoaded stub. Not a stranger
 * defect.
 *
 * Causal leftovers on parent b1e5042 / related S78 path:
 *   1. bindSignedInPaidSiteForEdit attaches any single paid site regardless of
 *      draft.templateId (restaurant bind onto professionals).
 *   2. startWithTemplate(different) can leave paid siteId in draft/localStorage.
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
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
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

function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
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

/**
 * Simulate bindSignedInPaidSiteForEdit (extracted) against fake sites + draft.
 */
function simulateBindPaid(appSrc, { sites, draft, user, savedDraft, current }) {
  const bindFn = extractFunction(appSrc, 'bindSignedInPaidSiteForEdit');
  assert.ok(bindFn && bindFn.length > 80, 'bindSignedInPaidSiteForEdit must exist');

  const sandbox = {
    currentUser: user || { email: 't@example.com', id: 'u1' },
    currentSiteId: (current && current.currentSiteId) || null,
    currentSitePaid: !!(current && current.currentSitePaid),
    currentSiteSlug: (current && current.currentSiteSlug) || '',
    publishedSiteId: (current && current.publishedSiteId) || null,
    publishedSiteUrl: null,
    draft: draft || { templateId: 'product-menu', config: { business: { name: 'Qa' } } },
    _saved: savedDraft || null,
    _sites: sites || [],
    console,
  };

  const prelude = `
    function loadDraft() { return _saved; }
    function saveDraft() {
      if (!draft.templateId || !draft.config) return;
      _saved = { templateId: draft.templateId, config: draft.config };
      if (currentSiteId) {
        _saved.siteId = currentSiteId;
        _saved.paid = !!currentSitePaid;
        if (currentSiteSlug) _saved.slug = currentSiteSlug;
      }
    }
    async function fetchCurrentUser() { return currentUser; }
    function updateUserUI(u) { currentUser = u; }
    async function apiGet(path) {
      if (path === '/api/sites') return { sites: _sites };
      throw new Error('unexpected ' + path);
    }
    function getPath(obj, pathStr) {
      return String(pathStr || '').split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
    }
    function toSlug(s) {
      return String(s || '').toLowerCase()
        .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    }
  `;

  vm.runInNewContext(
    prelude + '\n' + bindFn + '\n' +
      'this.__run = async function() { await bindSignedInPaidSiteForEdit(); return {' +
      ' currentSiteId, currentSitePaid, currentSiteSlug, publishedSiteId, saved: _saved }; };',
    sandbox
  );
  return sandbox.__run();
}

/**
 * Simulate startWithTemplate clearing + draft persistence for a template switch.
 * Uses extracted startWithTemplate + saveDraft helpers.
 * startWithTemplate is async and awaits ensureTemplateLoaded before bind clear.
 */
async function simulateStartWithTemplate(appSrc, { templateId, savedDraft, tplDataById }) {
  const startFn = extractFunction(appSrc, 'startWithTemplate');
  const saveFn = extractFunction(appSrc, 'saveDraft');
  assert.ok(startFn && startFn.length > 40, 'startWithTemplate must exist');
  assert.ok(saveFn && saveFn.length > 20, 'saveDraft must exist');

  const sandbox = {
    currentSiteId: (savedDraft && savedDraft.siteId) || null,
    currentSitePaid: !!(savedDraft && savedDraft.paid),
    currentSiteSlug: (savedDraft && savedDraft.slug) || '',
    publishedSiteId: (savedDraft && savedDraft.siteId) || null,
    draft: {
      templateId: (savedDraft && savedDraft.templateId) || null,
      config: (savedDraft && savedDraft.config) || null,
    },
    currentTemplate: null,
    previewFirstRender: true,
    iframeReady: true,
    _saved: savedDraft ? JSON.parse(JSON.stringify(savedDraft)) : null,
    _tplDataById: tplDataById || {},
    window: { location: { hash: '' } },
    console,
    Promise,
  };

  const prelude = `
    const DRAFT_KEY = 'hb_draft';
    function lsSet(k, v) { if (k === DRAFT_KEY) _saved = v; }
    function lsGet(k) { return k === DRAFT_KEY ? _saved : null; }
    function loadDraft() { return _saved; }
    ${saveFn}
    function getTemplateById(id) { return _tplDataById[id] || null; }
    function getTemplateList() {
      return Object.keys(_tplDataById).map(id => ({ id, name: id }));
    }
    async function ensureTemplateLoaded(id) {
      const data = _tplDataById[id];
      if (!data) throw new Error('missing template ' + id);
      return data;
    }
    function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
    function showToast() {}
    function hideToast() {}
    function prepareDrawerForNewDesign() {}
    function deriveWaHref() {}
    function $(id) { return null; }
  `;

  vm.runInNewContext(
    prelude + '\n' + startFn + '\n' +
      'this.__run = async function(tid) { await startWithTemplate(tid); return {' +
      ' currentSiteId, currentSitePaid, currentSiteSlug, publishedSiteId,' +
      ' draft: JSON.parse(JSON.stringify(draft)), saved: _saved ? JSON.parse(JSON.stringify(_saved)) : null }; };',
    sandbox
  );
  return sandbox.__run(templateId);
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
  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  const parentApp = parentBlob('builder/app.js');
  const parentBuild = parentBlob('build.js');
  assert.ok(parentApp, 'parent app.js at ' + PARENT_SHA);
  assert.ok(parentBuild, 'parent build.js at ' + PARENT_SHA);

  const restaurantSite = {
    id: 'site_rest_s80',
    paid: true,
    slug: 'qalive-s78-014843',
    projectName: 'qalive-s78-014843',
    templateId: 'product-menu',
    url: 'http://127.0.0.1/live/qalive-s78-014843/',
  };

  // ── Causal RED on parent ───────────────────────────────────────────────
  await check('causal RED: parent bind attaches single paid restaurant to professionals draft', async () => {
    const result = await simulateBindPaid(parentApp, {
      draft: {
        templateId: 'professionals',
        config: { business: { name: 'Cabinet S78' } },
      },
      savedDraft: {
        templateId: 'professionals',
        config: { business: { name: 'Cabinet S78' } },
      },
      sites: [restaurantSite],
    });
    assert.strictEqual(
      result.currentSiteId,
      restaurantSite.id,
      'parent wrongly binds paid restaurant siteId onto professionals draft'
    );
    assert.strictEqual(result.currentSitePaid, true);
    assert.strictEqual(result.currentSiteSlug, restaurantSite.slug);
  });

  await check('causal RED: parent startWithTemplate(different) can leave paid siteId in draft', async () => {
    const proPreset = { presets: [{ id: 'p', config: { business: { name: 'Cabinet' }, labels: {} } }] };
    const out = await simulateStartWithTemplate(parentApp, {
      templateId: 'professionals',
      savedDraft: {
        templateId: 'product-menu',
        config: { business: { name: 'Restaurant' } },
        siteId: restaurantSite.id,
        paid: true,
        slug: restaurantSite.slug,
      },
      tplDataById: {
        professionals: proPreset,
        'product-menu': { presets: [{ id: 'r', config: { business: { name: 'R' } } }] },
      },
    });
    // Soft: in-memory must be cleared on parent (it is). Draft must not keep siteId after different start.
    assert.strictEqual(out.currentSiteId, null, 'parent clears in-memory currentSiteId');
    // Prove parent bind from saved restaurant siteId ignores professionals draft.templateId:
    const bound = await simulateBindPaid(parentApp, {
      draft: { templateId: 'professionals', config: { business: { name: 'Cabinet' } } },
      savedDraft: {
        templateId: 'professionals',
        config: { business: { name: 'Cabinet' } },
        siteId: restaurantSite.id,
        paid: true,
        slug: restaurantSite.slug,
      },
      sites: [restaurantSite],
    });
    assert.strictEqual(
      bound.currentSiteId,
      restaurantSite.id,
      'parent bind restores paid restaurant from draft.siteId even when draft is professionals'
    );
  });

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
  await check('HEAD: startWithTemplate(professionals) after paid restaurant clears site bind from draft', async () => {
    const proPreset = {
      presets: [{ id: 'p', config: { business: { name: 'Cabinet S80' }, labels: { aboutEyebrow: 'Despre' } } }],
    };
    const out = await simulateStartWithTemplate(appSrc, {
      templateId: 'professionals',
      savedDraft: {
        templateId: 'product-menu',
        config: { business: { name: 'Restaurant Live' } },
        siteId: restaurantSite.id,
        paid: true,
        slug: restaurantSite.slug,
      },
      tplDataById: {
        professionals: proPreset,
        'product-menu': { presets: [{ id: 'r', config: { business: { name: 'R' } } }] },
      },
    });
    assert.strictEqual(out.currentSiteId, null, 'currentSiteId cleared');
    assert.strictEqual(out.currentSitePaid, false, 'currentSitePaid cleared');
    assert.strictEqual(out.currentSiteSlug, '', 'currentSiteSlug cleared');
    assert.ok(out.saved, 'draft saved');
    assert.ok(!out.saved.siteId, 'draft must not keep paid restaurant siteId');
    assert.ok(!out.saved.paid, 'draft must not keep paid flag');
    assert.ok(!out.saved.slug, 'draft must not keep restaurant slug');
    assert.strictEqual(out.draft.templateId, 'professionals');
  });

  await check('HEAD: bind does not attach paid site with different templateId', async () => {
    const result = await simulateBindPaid(appSrc, {
      draft: {
        templateId: 'professionals',
        config: { business: { name: 'Cabinet S80' } },
      },
      savedDraft: {
        templateId: 'professionals',
        config: { business: { name: 'Cabinet S80' } },
      },
      sites: [restaurantSite],
    });
    assert.strictEqual(result.currentSiteId, null, 'must not bind restaurant onto professionals');
    assert.strictEqual(result.currentSitePaid, false);
    assert.ok(!result.currentSiteSlug, 'must not take restaurant slug');
  });

  await check('HEAD: bind ignores draft.siteId when saved template/site template differs from draft', async () => {
    const result = await simulateBindPaid(appSrc, {
      draft: {
        templateId: 'professionals',
        config: { business: { name: 'Cabinet S80' } },
      },
      savedDraft: {
        templateId: 'professionals',
        config: { business: { name: 'Cabinet S80' } },
        siteId: restaurantSite.id,
        paid: true,
        slug: restaurantSite.slug,
      },
      sites: [restaurantSite],
    });
    assert.strictEqual(
      result.currentSiteId,
      null,
      'must not restore restaurant siteId from draft onto professionals'
    );
    assert.ok(!result.saved || !result.saved.siteId || result.saved.siteId !== restaurantSite.id,
      'must not re-persist foreign paid siteId');
  });

  await check('HEAD: bind still binds when draft template matches paid site (S69 path)', async () => {
    const result = await simulateBindPaid(appSrc, {
      draft: {
        templateId: 'product-menu',
        config: { business: { name: 'QaLive S80' } },
      },
      savedDraft: {
        templateId: 'product-menu',
        config: { business: { name: 'QaLive S80' } },
      },
      sites: [restaurantSite],
    });
    assert.strictEqual(result.currentSiteId, restaurantSite.id, 'same-template bind');
    assert.strictEqual(result.currentSitePaid, true);
    assert.strictEqual(result.currentSiteSlug, restaurantSite.slug);
    assert.ok(result.saved && result.saved.siteId === restaurantSite.id && result.saved.paid === true);
  });

  await check('HEAD: bind matches same-template among multiple paid sites', async () => {
    const proSite = {
      id: 'site_pro_s80',
      paid: true,
      slug: 'cabinet-s80-live',
      projectName: 'cabinet-s80-live',
      templateId: 'professionals',
      url: 'http://127.0.0.1/live/cabinet-s80-live/',
    };
    const result = await simulateBindPaid(appSrc, {
      draft: {
        templateId: 'professionals',
        config: { business: { name: 'Cabinet S80' } },
      },
      savedDraft: {
        templateId: 'professionals',
        config: { business: { name: 'Cabinet S80' } },
      },
      sites: [restaurantSite, proSite],
    });
    assert.strictEqual(result.currentSiteId, proSite.id);
    assert.strictEqual(result.currentSiteSlug, proSite.slug);
  });

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
