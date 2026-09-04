'use strict';
/**
 * bot/test/s92-s91-advocate.test.js — S92 remake of S91 ADVOCATE: STILL STANDING leaks.
 *
 * Causal leftovers on parent 8307da6 (S89 ACCEPT):
 *   1. Meseriași first-preset Extinderi blurb undiacritic factory
 *   2. local-service Detalii: English "Link Instagram" on contact.instagram.url
 *   3. After dashboard test-pay with empty in-memory draft, #edit / resume dumps to #templates
 *
 * Overlay RED on parent, GREEN on HEAD. Static + VM for #edit path.
 * Run: node bot/test/s92-s91-advocate.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '8307da6d7aeb0272453e58d4391e5da460ff79e1';

const LS_PRESETS = 'templates/local-service/presets.json';
const LS_SCHEMA = 'templates/local-service/schema.json';
const PRO_SCHEMA = 'templates/professionals/schema.json';
const APP_JS = 'builder/app.js';

/** Exact undiacritic leftovers a stranger saw on S91 Extinderi blurb. */
const EXTINDERI_LEFTOVERS = [
  'Extinderi casa',
  'autorizatie',
  'constructii noi',
  'mansardari,',
  'portanti cu',
];

const EXTINDERI_FINISHED =
  'Extinderi de locuințe, mansardări, desființări autorizate de pereți portanți și construcții noi în curte.';

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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** First Meseriași preset JSON slice (presets[0] only). */
function firstPresetSource(presetsJsonText) {
  const body = JSON.parse(presetsJsonText);
  const presets = body.presets || [];
  assert.ok(presets.length >= 1, 'local-service has presets');
  return JSON.stringify(presets[0]);
}

function schemaFieldLabel(schemaText, key) {
  const schema = JSON.parse(schemaText);
  let found = null;
  function walk(n) {
    if (found) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      if (n.key === key && typeof n.label === 'string') found = n.label;
      Object.values(n).forEach(walk);
    }
  }
  walk(schema);
  return found;
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

/**
 * Simulate #edit route when in-memory draft has no templateId (dashboard-pay stranger).
 * Parent: resumeLocalDraft fails → hash = #templates.
 * HEAD: must bind paid site templateId and stay on editor (not dump to templates).
 */
function simulateEditAfterDashPay(appSrc, { sites, siteDetail, savedDraft }) {
  const routeFn = extractFunction(appSrc, 'handleRoute');
  assert.ok(routeFn && routeFn.length > 80, 'handleRoute must exist');

  const resumeFn = extractFunction(appSrc, 'resumeLocalDraft') || 'function resumeLocalDraft(){return false;}';
  const bindFn =
    extractFunction(appSrc, 'bindSignedInPaidSiteForEdit') ||
    'async function bindSignedInPaidSiteForEdit(){}';
  const ensureFn = extractFunction(appSrc, 'ensureDraftBoundToPaidSite') || '';
  const loadPaidFn =
    extractFunction(appSrc, 'loadPaidSiteForEmptyEdit') ||
    extractFunction(appSrc, 'ensureEditHasTemplate') ||
    extractFunction(appSrc, 'loadSiteForEdit') ||
    '';

  const sandbox = {
    draft: { templateId: null, config: null },
    currentSiteId: null,
    currentSitePaid: false,
    currentSiteSlug: '',
    publishedSiteId: null,
    publishedSiteUrl: null,
    currentUser: { email: 's92@example.com', id: 'u92' },
    currentTemplate: null,
    previewFirstRender: true,
    iframeReady: false,
    _saved: savedDraft || null,
    _sites: sites || [],
    _siteDetail: siteDetail || null,
    _hash: '#edit',
    _screen: null,
    window: {
      location: {
        get hash() {
          return sandbox._hash;
        },
        set hash(v) {
          sandbox._hash = v;
        },
      },
    },
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
    function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
    function getTemplateById(id) {
      if (!id) return null;
      return { id: id, presets: [{ config: { business: { name: 'Sim' } } }], files: {} };
    }
    function getTemplateList() {
      return [
        { id: 'product-menu', name: 'Restaurant' },
        { id: 'local-service', name: 'Meseriași' },
        { id: 'professionals', name: 'Professionals' },
      ];
    }
    async function fetchCurrentUser() { return currentUser; }
    function updateUserUI() {}
    async function apiGet(p) {
      if (p === '/api/sites') return { sites: _sites };
      const m = /^\\/api\\/sites\\/([^/]+)$/.exec(p);
      if (m) {
        if (_siteDetail && _siteDetail.site && _siteDetail.site.id === m[1]) return _siteDetail;
        const s = _sites.find(x => x && x.id === m[1]);
        if (s) return { site: s, config: s.config || { business: { name: 'FromList' } } };
        throw new Error('not found');
      }
      throw new Error('unexpected ' + p);
    }
    function showScreen(name) { _screen = name; }
    function updateChecklist() {}
    function scheduleRerender() {}
    function setLoading() {}
    function showToast() {}
    function $(id) { return null; }
  `;

  // Include load helpers so HEAD empty-draft #edit can bind paid site
  const helpers = [resumeFn, bindFn, ensureFn, loadPaidFn].filter(Boolean).join('\n');

  vm.runInNewContext(
    prelude +
      '\n' +
      helpers +
      '\n' +
      routeFn +
      '\n' +
      'this.__run = async function() {' +
      '  await handleRoute("edit");' +
      '  return {' +
      '    hash: _hash,' +
      '    screen: _screen,' +
      '    templateId: draft.templateId,' +
      '    hasConfig: !!(draft.config),' +
      '    currentSiteId, currentSitePaid, currentSiteSlug,' +
      '    saved: _saved ? JSON.parse(JSON.stringify(_saved)) : null' +
      '  };' +
      '};',
    sandbox
  );
  return sandbox.__run();
}

(async () => {
  // ─── Causal RED on parent ───────────────────────────────────────────

  await check('causal RED: parent Meseriași first-preset still has Extinderi undiacritic leftovers', () => {
    const presets = parentBlob(LS_PRESETS);
    assert.ok(presets, 'parent presets');
    const src = firstPresetSource(presets);
    let hits = 0;
    for (const s of EXTINDERI_LEFTOVERS) {
      if (src.includes(s)) hits++;
    }
    assert.ok(hits >= 3, 'parent Extinderi leftovers hits=' + hits);
    assert.ok(!src.includes(EXTINDERI_FINISHED), 'parent lacks finished Extinderi blurb');
  });

  await check('causal RED: parent local-service contact.instagram.url is Link Instagram', () => {
    const schema = parentBlob(LS_SCHEMA);
    assert.ok(schema, 'parent local-service schema');
    const label = schemaFieldLabel(schema, 'contact.instagram.url');
    assert.strictEqual(label, 'Link Instagram', 'parent url label is Link Instagram');
    assert.ok(/\bLink\b/.test(label), 'parent has English Link');
  });

  await check('causal RED: parent #edit with empty draft dumps to #templates', async () => {
    const parentApp = parentBlob(APP_JS);
    assert.ok(parentApp, 'parent app.js');
    const paid = {
      id: 'site_rest_s91',
      paid: true,
      slug: 'adv-s91-870519',
      projectName: 'adv-s91-870519',
      templateId: 'product-menu',
      url: 'http://127.0.0.1/live/adv-s91-870519/',
      config: { business: { name: 'Adv S91 Live' } },
    };
    const out = await simulateEditAfterDashPay(parentApp, {
      sites: [paid],
      siteDetail: { site: paid, config: paid.config },
      savedDraft: null,
    });
    // Parent: no templateId → resume fails → #templates
    assert.ok(
      out.hash === '#templates' || !out.templateId,
      'parent dumps to templates or leaves templateId empty; got hash=' +
        out.hash +
        ' tpl=' +
        out.templateId
    );
    assert.ok(
      out.hash === '#templates' || out.screen !== 'edit' || !out.templateId,
      'parent does not open paid restaurant editor from empty draft'
    );
  });

  // ─── GREEN on HEAD ──────────────────────────────────────────────────

  await check('HEAD: Meseriași first-preset has finished Extinderi blurb, no leftovers', () => {
    const src = firstPresetSource(read(LS_PRESETS));
    for (const s of EXTINDERI_LEFTOVERS) {
      assert.ok(!src.includes(s), 'no leftover: ' + s);
    }
    assert.ok(src.includes(EXTINDERI_FINISHED), 'has finished Extinderi blurb');
  });

  await check('HEAD: local-service Instagram contact labels are Romanian', () => {
    const schema = read(LS_SCHEMA);
    const urlLabel = schemaFieldLabel(schema, 'contact.instagram.url');
    const textLabel = schemaFieldLabel(schema, 'contact.instagram.label');
    assert.ok(urlLabel, 'url label exists');
    assert.notStrictEqual(urlLabel, 'Link Instagram');
    assert.ok(!/\bLink\b/.test(urlLabel), 'url label has no English Link: ' + urlLabel);
    assert.ok(
      urlLabel.includes('Instagram') && /(\(secțiune contact\)|\(contact section\))/i.test(urlLabel),
      'url label is Instagram (secțiune contact)-style: ' + urlLabel
    );
    assert.ok(textLabel, 'text label exists');
    assert.ok(!/Text link Instagram|Link text Instagram/i.test(textLabel), 'no English Text link Instagram');
    assert.ok(
      /Etichetă Instagram|Instagram text/i.test(textLabel) ||
      /Instagram label/i.test(textLabel),
      'text label Romanian: ' + textLabel
    );
    // Professionals should align with the same Romanian section label.
    const pro = read(PRO_SCHEMA);
    assert.ok(
      /Instagram \(secțiune contact\)/i.test(pro) || /Instagram \(contact section\)/i.test(pro),
      'professionals Instagram contact label aligns with RO/EN legacy variants'
    );
    assert.ok(!/Link Instagram/.test(pro), 'professionals no Link Instagram');
  });

  await check('HEAD: #edit with empty draft after dash-pay binds paid site templateId', async () => {
    const appSrc = read(APP_JS);
    const paid = {
      id: 'site_rest_s92',
      paid: true,
      slug: 'adv-s92-paid',
      projectName: 'adv-s92-paid',
      templateId: 'product-menu',
      url: 'http://127.0.0.1/live/adv-s92-paid/',
      config: { business: { name: 'Adv S92 Live' } },
    };
    const out = await simulateEditAfterDashPay(appSrc, {
      sites: [paid],
      siteDetail: { site: paid, config: paid.config },
      savedDraft: null,
    });
    assert.notStrictEqual(out.hash, '#templates', 'must not dump to catalog');
    assert.strictEqual(out.templateId, 'product-menu', 'binds paid restaurant templateId');
    assert.ok(out.hasConfig, 'has config loaded');
    assert.strictEqual(out.currentSiteId, paid.id, 'binds paid site id');
    assert.strictEqual(out.currentSitePaid, true, 'paid flag');
    assert.ok(out.screen === 'edit' || out.templateId === 'product-menu', 'editor path');
  });

  await check('HEAD: completeTestCheckout persists template bind when draft empty OR #edit loads paid site', () => {
    const appSrc = read(APP_JS);
    const complete = extractFunction(appSrc, 'completeTestCheckout') || '';
    const route = extractFunction(appSrc, 'handleRoute') || '';
    const hasPayPersist =
      /templateId/.test(complete) &&
      (/api\/sites\//.test(complete) || /loadSiteForEdit|draft\.templateId\s*=/.test(complete));
    const hasEditFallback =
      /loadPaidSiteForEmptyEdit|ensureEditHasTemplate|loadSiteForEdit/.test(route) ||
      (/!draft\.templateId[\s\S]{0,400}api\/sites/.test(route) &&
        /templateId/.test(route));
    assert.ok(
      hasPayPersist || hasEditFallback,
      'pay must persist templateId/config or #edit must load paid site when draft empty'
    );
  });

  if (failed) {
    console.error('\n' + failed + ' failed');
    process.exit(1);
  }
  console.log('\nAll s92-s91-advocate checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
