'use strict';
/**
 * bot/test/s69-s68-qa-fail.test.js — S69 remake of S68 QA FAIL leaks.
 *
 * Causal leftovers on parent 230fe4e (S67 ACCEPT):
 *   1. resumeLocalDraft / #edit route restore template+config only — never
 *      currentSiteId / currentSitePaid / currentSiteSlug. openPublishModal only
 *      skips the slug modal when currentSiteId && currentSitePaid, so after
 *      test-pay a fresh /app/#edit treats Publică as first publish and slug-check
 *      says «Această adresă e deja folosită» for the paid slug.
 *   2. Detalii labels still contain factory jargon a stranger can open:
 *      embed Instagram / html lang / JSON-LD Schema.org … bot / +447 examples.
 *
 * GREEN on HEAD for each. Isolated adapters only.
 * Env: HIDOOK_ISOLATED_DEPLOY=1, HIDOOK_TEST_PAY=1; HIDOOK_FAKE_DEPLOY deleted.
 * Run: node bot/test/s69-s68-qa-fail.test.js
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const vm     = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const SCHEMA_PATHS = [
    'templates/product-menu/schema.json',
    'templates/portfolio/schema.json',
    'templates/local-service/schema.json',
];
const PARENT_SHA = '230fe4eaea3a8b02fc2c78ddfb216cb3d52c8830';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's69-s68-qa-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'test-secret-s69-' + crypto.randomBytes(4).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.SITEBUILDER_PARTNER_SECRET;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.BRAND_DOMAIN;
delete process.env.CONTACT_URL;
delete process.env.RESEND_API_KEY;
delete process.env.NODE_ENV;

const payments   = require('../payments.js');
const pricing    = require('../pricing.js');
const webpublish = require('../webpublish.js');
const { startServer } = require('../server.js');

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
    // Match optional async keyword so await inside body stays valid
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

function collectLabels(schema) {
    const labels = [];
    function walk(n) {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === 'object') {
            if (typeof n.label === 'string') labels.push(n.label);
            Object.values(n).forEach(walk);
        }
    }
    walk(schema);
    return labels;
}

function makeClient(base) {
    const jar = {};
    async function doFetch(urlPath, opts = {}) {
        const url     = base + urlPath;
        const headers = { ...(opts.headers || {}) };
        const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieStr) headers['Cookie'] = cookieStr;
        const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
        const setCookie = res.headers.getSetCookie
            ? res.headers.getSetCookie()
            : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
        for (const sc of setCookie) {
            if (!sc) continue;
            const first = sc.split(';')[0];
            const eq = first.indexOf('=');
            if (eq < 0) continue;
            const k = first.slice(0, eq).trim();
            const v = first.slice(eq + 1).trim();
            if (k) jar[k] = v;
        }
        return res;
    }
    doFetch.jar = jar;
    return doFetch;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForStatus(base, urlPath, wantStatus, { timeoutMs = 15000, intervalMs = 50 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const res = await fetch(base + urlPath, { redirect: 'manual' });
        last = res.status;
        if (res.status === wantStatus) return res;
        await sleep(intervalMs);
    }
    throw new Error(`timeout waiting for ${urlPath} → ${wantStatus} (last ${last})`);
}

async function loginClient(base, email) {
    const c = makeClient(base);
    const loginRes = await fetch(`${base}/api/auth/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginBody = await loginRes.json();
    let token;
    try {
        token = new URL(loginBody.devLink).searchParams.get('token');
    } catch {
        const qs = loginBody.devLink.includes('?')
            ? loginBody.devLink.slice(loginBody.devLink.indexOf('?') + 1)
            : '';
        token = new URLSearchParams(qs).get('token');
    }
    const v = await c(`/auth/verify?token=${encodeURIComponent(token)}`);
    assert.strictEqual(v.status, 302);
    return c;
}

function loadPresetConfig(templateId) {
    const presetsPath = path.join(ROOT, 'templates', templateId, 'presets.json');
    const body = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
    const presets = body.presets || [];
    assert.ok(presets.length >= 1, `${templateId} must have ≥1 preset`);
    return JSON.parse(JSON.stringify(presets[0].config));
}

/**
 * Simulate HEAD bindSignedInPaidSiteForEdit against a fake /api/sites list.
 * Proves openPublishModal paid skip after bind without loadSiteForEdit.
 */
function simulateBindPaid(appSrc, { sites, draft, user, savedDraft }) {
    const bindFn = extractFunction(appSrc, 'bindSignedInPaidSiteForEdit');
    assert.ok(bindFn && bindFn.length > 80, 'bindSignedInPaidSiteForEdit must exist');

    const sandbox = {
        currentUser: user || { email: 't@example.com', id: 'u1' },
        currentSiteId: null,
        currentSitePaid: false,
        currentSiteSlug: '',
        publishedSiteId: null,
        publishedSiteUrl: null,
        draft: draft || { templateId: 'product-menu', config: { business: { name: 'Qa Live' } } },
        _saved: savedDraft || null,
        _sites: sites || [],
        console,
    };

    // Minimal helpers the bind function closes over when extracted as source
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

(async () => {
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const parentApp = parentBlob('builder/app.js');

    // ── Causal RED on parent ───────────────────────────────────────────────
    await check('causal RED: parent resumeLocalDraft does not restore paid site id/slug/paid', () => {
        assert.ok(parentApp, 'parent app.js');
        const resume = extractFunction(parentApp, 'resumeLocalDraft') || '';
        assert.ok(resume.length > 40, 'parent resumeLocalDraft');
        assert.ok(!/currentSiteId\s*=/.test(resume), 'parent resume does not set currentSiteId');
        assert.ok(!/currentSitePaid\s*=/.test(resume), 'parent resume does not set currentSitePaid');
        assert.ok(!/currentSiteSlug\s*=/.test(resume), 'parent resume does not set currentSiteSlug');
        assert.ok(!/saved\.siteId|saved\.paid|saved\.slug/.test(resume), 'parent resume ignores site bind in draft');
    });

    await check('causal RED: parent handleRoute edit has no bindSignedInPaidSiteForEdit', () => {
        assert.ok(parentApp, 'parent app.js');
        assert.ok(
            !/bindSignedInPaidSiteForEdit/.test(parentApp),
            'parent lacks bindSignedInPaidSiteForEdit'
        );
        const route = extractFunction(parentApp, 'handleRoute') || '';
        assert.ok(route.length > 40, 'parent handleRoute');
        // edit branch only resumeLocalDraft + showScreen — no await bind
        assert.ok(/resumeLocalDraft/.test(route), 'parent uses resumeLocalDraft');
        assert.ok(!/await\s+bindSignedInPaidSiteForEdit/.test(route), 'parent edit route no paid bind');
        const openFn = extractFunction(parentApp, 'openPublishModal') || '';
        assert.ok(
            !/bindSignedInPaidSiteForEdit/.test(openFn),
            'parent openPublishModal does not bind before paid skip'
        );
        // Parent saveDraft only stores templateId+config
        const save = extractFunction(parentApp, 'saveDraft') || '';
        assert.ok(save.length > 20, 'parent saveDraft');
        assert.ok(
            !/siteId|currentSitePaid|\.paid/.test(save),
            'parent saveDraft does not persist paid site bind'
        );
    });

    await check('causal RED: parent Detalii labels still have embed / html lang / Schema.org|bot / +447', () => {
        let foundEmbed = false;
        let foundHtmlLang = false;
        let foundSchemaBot = false;
        let foundUkPhone = false;
        for (const rel of SCHEMA_PATHS) {
            const src = parentBlob(rel);
            assert.ok(src, 'parent ' + rel);
            if (/URL embed Instagram/i.test(src) || /\bembed\b/i.test(src)) foundEmbed = true;
            if (/html\s*lang/i.test(src)) foundHtmlLang = true;
            if (/JSON-LD|Schema\.org/i.test(src) && /\bbot\b/i.test(src)) foundSchemaBot = true;
            if (/\+447|447911|\+44\s*7911/i.test(src)) foundUkPhone = true;
        }
        assert.ok(foundEmbed, 'parent still has embed Instagram jargon');
        assert.ok(foundHtmlLang, 'parent still has html lang jargon');
        assert.ok(foundSchemaBot, 'parent still has JSON-LD/Schema.org/bot jargon');
        assert.ok(foundUkPhone, 'parent still has +447 UK phone examples');
    });

    // ── HEAD source locks ──────────────────────────────────────────────────
    await check('HEAD: resumeLocalDraft restores siteId/paid/slug from draft', () => {
        const resume = extractFunction(appSrc, 'resumeLocalDraft') || '';
        assert.ok(/saved\.siteId/.test(resume), 'reads saved.siteId');
        assert.ok(/currentSiteId\s*=\s*saved\.siteId/.test(resume), 'sets currentSiteId');
        assert.ok(/currentSitePaid\s*=/.test(resume), 'sets currentSitePaid');
        assert.ok(/currentSiteSlug\s*=/.test(resume), 'sets currentSiteSlug');
    });

    await check('HEAD: saveDraft persists paid site bind', () => {
        const save = extractFunction(appSrc, 'saveDraft') || '';
        assert.ok(/payload\.siteId\s*=\s*currentSiteId/.test(save), 'persists siteId');
        assert.ok(/payload\.paid\s*=\s*!!currentSitePaid/.test(save), 'persists paid');
        assert.ok(/payload\.slug/.test(save), 'persists slug');
    });

    await check('HEAD: bindSignedInPaidSiteForEdit + #edit route + openPublishModal', () => {
        assert.ok(/function\s+bindSignedInPaidSiteForEdit/.test(appSrc), 'helper exists');
        const bind = extractFunction(appSrc, 'bindSignedInPaidSiteForEdit') || '';
        assert.ok(/\/api\/sites/.test(bind), 'loads user sites');
        assert.ok(/currentSitePaid/.test(bind), 'sets paid');
        assert.ok(/currentSiteSlug/.test(bind), 'sets slug');
        const route = extractFunction(appSrc, 'handleRoute') || '';
        assert.ok(/await\s+bindSignedInPaidSiteForEdit\s*\(/.test(route), 'edit route awaits bind');
        const openFn = extractFunction(appSrc, 'openPublishModal') || '';
        assert.ok(/await\s+bindSignedInPaidSiteForEdit\s*\(/.test(openFn), 'openPublishModal binds first');
        assert.ok(
            /currentSiteId\s*&&\s*currentSitePaid/.test(openFn),
            'paid path still skips slug modal'
        );
        assert.ok(
            /doActualPublish\s*\(\s*currentSiteSlug/.test(openFn),
            'republish uses existing slug'
        );
        // completeTestCheckout + execPublish persist bind
        assert.ok(/function\s+completeTestCheckout[\s\S]*?saveDraft\s*\(/.test(appSrc),
            'completeTestCheckout saves draft bind');
        const exec = extractFunction(appSrc, 'execPublish') || '';
        assert.ok(/saveDraft\s*\(/.test(exec), 'execPublish saves draft bind');
        assert.ok(!/HIDOOK_FAKE_DEPLOY/.test(appSrc), 'no fake deploy');
    });

    await check('HEAD VM: bind without loadSiteForEdit sets paid id/slug so openPublish would skip modal', async () => {
        const slug = 'qalive-s69';
        const siteId = 'site_' + crypto.randomUUID().slice(0, 8);
        const result = await simulateBindPaid(appSrc, {
            draft: {
                templateId: 'product-menu',
                config: { business: { name: 'QaLive S69' } },
            },
            // Draft has template+config only — no siteId (fresh #edit after pay)
            savedDraft: {
                templateId: 'product-menu',
                config: { business: { name: 'QaLive S69' } },
            },
            sites: [{
                id: siteId,
                paid: true,
                slug,
                projectName: slug,
                templateId: 'product-menu',
                url: 'http://127.0.0.1/live/' + slug + '/',
            }],
        });
        assert.strictEqual(result.currentSiteId, siteId, 'bound site id');
        assert.strictEqual(result.currentSitePaid, true, 'bound paid');
        assert.strictEqual(result.currentSiteSlug, slug, 'bound slug');
        assert.ok(result.saved && result.saved.siteId === siteId && result.saved.paid === true,
            'persists bind into draft');
        // openPublishModal condition
        assert.ok(result.currentSiteId && result.currentSitePaid,
            'openPublishModal would skip slug modal');
    });

    await check('HEAD: Detalii labels commercial English only (no embed/html lang/Schema.org/bot/+447)', () => {
        for (const rel of SCHEMA_PATHS) {
            const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            const schema = JSON.parse(src);
            const labels = collectLabels(schema);
            const joined = labels.join('\n');
            assert.ok(!/\bembed\b/i.test(joined), rel + ' no embed in labels');
            assert.ok(!/\biframe\b/i.test(joined), rel + ' no iframe');
            assert.ok(!/html\s*lang/i.test(joined), rel + ' no html lang');
            assert.ok(!/JSON-LD/i.test(joined), rel + ' no JSON-LD');
            assert.ok(!/Schema\.org/i.test(joined), rel + ' no Schema.org');
            assert.ok(!/\bbot\b/i.test(joined), rel + ' no bot jargon');
            assert.ok(!/\+447|447911|\+44\s*7911/i.test(joined), rel + ' no UK +447 examples');
            // Must still have commercial Instagram / contact surface
            if (rel.includes('local-service')) {
                assert.ok(labels.some(l => /\+1\b/.test(l)), 'local-service has US +1 example');
            }
        }
    });

    await check('HIDOOK_FAKE_DEPLOY not set (isolated + test-pay)', () => {
        assert.strictEqual(process.env.HIDOOK_FAKE_DEPLOY, undefined);
        assert.strictEqual(process.env.HIDOOK_ISOLATED_DEPLOY, '1');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
        assert.ok(payments.isConfigured(), 'test-pay configured');
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
    });

    // ── Isolated HTTP: paid #edit without loadSiteForEdit ──────────────────
    async function onStripeEvent(event) {
        const cs = event && event.data && event.data.object;
        const platform = cs && cs.metadata && cs.metadata.platform;
        if (platform === 'web' || (cs && cs.metadata && cs.metadata.siteId)) {
            await webpublish.handleStripePaid(event, { notifyAdmin: () => {} });
        }
    }

    const srv = startServer({ port: 0, onStripeEvent });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    process.env.PUBLIC_URL = base;

    await check('isolated: after pay, bind via /api/sites + republish same slug (no loadSiteForEdit)', async () => {
        const email = `s69-edit-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const c = await loginClient(base, email);
        const cfg = loadPresetConfig('product-menu');
        const nameV1 = 'S69EditV1-' + crypto.randomUUID().slice(0, 6);
        const nameV2 = 'S69EditV2-' + crypto.randomUUID().slice(0, 6);
        cfg.business.name = nameV1;
        const slugHint = 's69-qalive-' + crypto.randomUUID().slice(0, 8);

        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'RO' },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: slugHint,
                config: cfg,
                images: [],
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        const siteId = pubBody.site.id;
        const slug = pubBody.site.slug;
        assert.ok(pubBody.paymentUrl, 'paymentUrl');

        const sessM = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
        assert.ok(sessM, 'test checkout session');
        const complete = await c('/api/test-pay/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sessM[1] }),
        });
        assert.ok([200, 201].includes(complete.status), await complete.clone().text());
        await waitForStatus(base, `/live/${slug}/`, 200, { timeoutMs: 25000 });

        // Fresh #edit simulation: no siteId in client — only GET /api/sites (bind helper path)
        const list = await c('/api/sites');
        assert.strictEqual(list.status, 200);
        const listBody = await list.json();
        const sites = listBody.sites || [];
        const bound = sites.find(s => s.paid && (s.slug === slug || s.id === siteId));
        assert.ok(bound, 'signed-in list exposes paid site');
        assert.strictEqual(bound.id, siteId);
        assert.strictEqual(bound.slug, slug);
        assert.strictEqual(bound.paid, true);

        // Simulate bind result driving openPublishModal skip + republish with siteId only
        const bindResult = await simulateBindPaid(appSrc, {
            draft: { templateId: 'product-menu', config: { business: { name: nameV1 } } },
            savedDraft: { templateId: 'product-menu', config: { business: { name: nameV1 } } },
            sites,
        });
        assert.strictEqual(bindResult.currentSiteId, siteId);
        assert.strictEqual(bindResult.currentSitePaid, true);
        assert.strictEqual(bindResult.currentSiteSlug, slug);

        // Public slug-check says taken — builder must not open modal / must republish own
        const slugCheck = await fetch(`${base}/api/slug-check?slug=${encodeURIComponent(slug)}`);
        assert.strictEqual(slugCheck.status, 200);
        const scBody = await slugCheck.json();
        assert.strictEqual(scBody.available, false, 'own paid slug appears taken publicly');

        cfg.business.name = nameV2;
        const rep = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                siteId: bindResult.currentSiteId,
                templateId: 'product-menu',
                config: cfg,
                images: [],
                // omit slug — paid republish keeps address
            }),
        });
        assert.strictEqual(rep.status, 200, await rep.clone().text());
        const repBody = await rep.json();
        assert.strictEqual(repBody.site.paid, true);
        assert.strictEqual(repBody.site.slug, slug, 'same paid address');
        assert.strictEqual(repBody.site.id, siteId);

        const deadline = Date.now() + 12000;
        let html2 = '';
        while (Date.now() < deadline) {
            const live2 = await fetch(`${base}/live/${slug}/`);
            assert.strictEqual(live2.status, 200);
            html2 = await live2.text();
            if (html2.includes(nameV2)) break;
            await sleep(50);
        }
        assert.ok(html2.includes(nameV2), 'live shows in-editor rename after #edit republish');
        assert.ok(!html2.includes(nameV1), 'v1 name gone from live');
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (failed) {
        console.error('\n' + failed + ' failure(s)');
        process.exit(1);
    }
    console.log('\nAll s69-s68-qa-fail checks passed.');
    process.exit(0);
})().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
});
