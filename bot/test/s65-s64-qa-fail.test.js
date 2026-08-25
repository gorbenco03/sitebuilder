'use strict';
/**
 * bot/test/s65-s64-qa-fail.test.js — S65 remake of S64 QA FAIL leaks.
 *
 * Causal leftovers on parent cbbf955 (S63 ACCEPT):
 *   1. Catalog Meseriași says «lead-gen»
 *   2. Hero overlay splits background on ';' → misses data:image/jpeg;base64
 *   3. Instagram grant 503 without SITEBUILDER_PARTNER_SECRET (isolated must finish)
 *   4. #edit paid republish asks new slug → «adresa e deja folosită»
 *   5. Menu dishes hidden in closed <details> (Articol nou not visible)
 *
 * GREEN on HEAD for each. Isolated adapters only.
 * Env: HIDOOK_ISOLATED_DEPLOY=1, HIDOOK_TEST_PAY=1; HIDOOK_FAKE_DEPLOY deleted.
 * Run: node bot/test/s65-s64-qa-fail.test.js
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
const OVERLAY_JS = path.join(ROOT, 'builder', 'edit-overlay.js');
const REGISTRY_JSON = path.join(ROOT, 'templates', 'registry.json');
const PM_TPL = path.join(ROOT, 'templates', 'product-menu', 'template.html');
const PARENT_SHA = 'cbbf9556ba8e6a95eae62433495261e283896865';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's65-s64-qa-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'test-secret-s65-' + crypto.randomBytes(4).toString('hex');
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

/** Simulate overlay extractBackgroundUrls on a style string (HEAD helper logic). */
function simulateExtractBgUrls(overlaySrc, styleAttr) {
    const fn = extractFunction(overlaySrc, 'extractBackgroundUrls');
    assert.ok(fn && fn.length > 40, 'extractBackgroundUrls must exist on HEAD');
    const sandbox = { result: null };
    vm.runInNewContext(
        fn + '\nresult = extractBackgroundUrls(' + JSON.stringify(styleAttr) + ');',
        sandbox
    );
    return sandbox.result;
}

/** Parent-era matcher that splits on ';' (the S64 leak). */
function parentBgMatch(style) {
    const declMatch = style.match(/(?:^|;)\s*(?:background(?:-image)?)\s*:\s*([^;]+)/i);
    if (!declMatch) return null;
    const bgDecl = declMatch[1] || '';
    const urlMatch = bgDecl.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
    return urlMatch ? urlMatch[1] : null;
}

(async () => {
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const overlaySrc = fs.readFileSync(OVERLAY_JS, 'utf8');
    const regSrc = fs.readFileSync(REGISTRY_JSON, 'utf8');
    const pmTpl = fs.readFileSync(PM_TPL, 'utf8');

    const parentReg = parentBlob('templates/registry.json');
    const parentOverlay = parentBlob('builder/edit-overlay.js');
    const parentApp = parentBlob('builder/app.js');
    const parentPm = parentBlob('templates/product-menu/template.html');
    const parentServer = parentBlob('bot/server.js');

    // ── Causal RED on parent ───────────────────────────────────────────────
    await check('causal RED: parent catalog Meseriași still says lead-gen', () => {
        assert.ok(parentReg, 'parent registry');
        assert.ok(/lead-gen/i.test(parentReg), 'parent has lead-gen jargon');
        const local = JSON.parse(parentReg).templates.find((t) => t.id === 'local-service');
        assert.ok(local && /lead-gen/i.test(local.description || ''), 'Meseriași description has lead-gen');
    });

    await check('causal RED: parent overlay misses data:image/jpeg;base64 background url', () => {
        assert.ok(parentOverlay, 'parent overlay');
        assert.ok(
            /background(?:-image)?\)\?\s*\)\s*:\\s\*\(\[\^;\]\+\)/.test(parentOverlay) ||
                parentOverlay.includes('([^;]+)') &&
                    /background(?:-image)?/.test(parentOverlay),
            'parent uses semicolon-split bg declaration'
        );
        assert.ok(
            !parentOverlay.includes('extractBackgroundUrls'),
            'parent lacks extractBackgroundUrls helper'
        );
        const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAg';
        const style =
            "background: linear-gradient(160deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.25) 55%), url('" +
            dataUrl +
            "'); color: #fff";
        const got = parentBgMatch(style);
        assert.ok(
            !got || !got.startsWith('data:image/jpeg;base64,'),
            'parent matcher must fail full data-URL (got ' + JSON.stringify(got) + ')'
        );
    });

    await check('causal RED: parent Instagram grant 503 without partner secret (no isolated stub)', () => {
        assert.ok(parentServer, 'parent server');
        assert.ok(
            !/isIsolatedTestSocial|site_bundle_isolated|isolatedStubEmbedUrl/.test(parentServer),
            'parent has no isolated Instagram stub'
        );
        assert.ok(
            /Conectarea Instagram nu e configurată pe server/.test(parentServer),
            'parent still has 503 copy'
        );
        // requireOwnedSiteWithEmail gates on isConfigured alone
        assert.ok(
            /if\s*\(\s*!partner\.isConfigured\(\)\s*\)/.test(parentServer),
            'parent 503s whenever partner secret missing'
        );
    });

    await check('causal RED: parent openPublishModal always asks slug (no paid skip)', () => {
        assert.ok(parentApp, 'parent app');
        const openFn = extractFunction(parentApp, 'openPublishModal') || '';
        assert.ok(openFn.length > 40, 'parent openPublishModal');
        assert.ok(
            !/currentSitePaid/.test(openFn + parentApp),
            'parent has no currentSitePaid paid-republish path'
        );
        assert.ok(/openModal\(\s*['"]modal-publish['"]\s*\)/.test(openFn), 'always opens slug modal');
        assert.ok(
            !/if\s*\(\s*currentSiteId\s*&&\s*currentSitePaid/.test(openFn),
            'parent does not skip modal for paid #edit'
        );
    });

    await check('causal RED: parent menu details closed by default (dishes not visible)', () => {
        assert.ok(parentPm, 'parent product-menu template');
        assert.ok(
            /<details class="pm-group">/.test(parentPm),
            'parent uses closed details'
        );
        assert.ok(
            !/<details class="pm-group" open>/.test(parentPm),
            'parent details lack open attribute'
        );
    });

    // ── HEAD source locks ──────────────────────────────────────────────────
    await check('HEAD: catalog has no lead-gen jargon for strangers', () => {
        assert.ok(!/lead-gen/i.test(regSrc), 'registry must not say lead-gen');
        const reg = JSON.parse(regSrc);
        for (const t of reg.templates || []) {
            assert.ok(!/lead-gen/i.test(t.description || ''), t.id + ' description clean');
            assert.ok(!/lead-gen/i.test(t.name || ''), t.id + ' name clean');
        }
        assert.ok(!/HIDOOK_FAKE_DEPLOY/.test(appSrc), 'no fake deploy in app');
    });

    await check('HEAD: overlay extracts full data:image/jpeg;base64 from multi-layer background', () => {
        const dataUrl =
            'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z';
        const style =
            "background: linear-gradient(160deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.25) 55%), url('" +
            dataUrl +
            "'); padding-top: 4rem";
        const urls = simulateExtractBgUrls(overlaySrc, style);
        assert.ok(Array.isArray(urls) && urls.length >= 1, 'extracts at least one url');
        assert.ok(
            urls.some((u) => u === dataUrl || u.startsWith('data:image/jpeg;base64,')),
            'full data URL recovered, got ' + JSON.stringify(urls.map((u) => u.slice(0, 40)))
        );
        assert.ok(/hb-bg-btn|Schimbă poza/.test(overlaySrc), 'Schimbă poza control present');
        // Parent-style split still documented as insufficient
        const broken = parentBgMatch(style);
        assert.ok(!broken || broken !== dataUrl, 'parent matcher still wrong on same style');
    });

    await check('HEAD: openPublishModal skips slug modal for paid site; own slug valid', () => {
        assert.ok(/currentSitePaid/.test(appSrc), 'tracks paid state');
        assert.ok(/currentSiteSlug/.test(appSrc), 'tracks site slug');
        const openFn = extractFunction(appSrc, 'openPublishModal') || '';
        assert.ok(
            /currentSiteId\s*&&\s*currentSitePaid/.test(openFn),
            'paid path in openPublishModal'
        );
        assert.ok(
            /doActualPublish\s*\(\s*currentSiteSlug/.test(openFn),
            'republish uses existing slug'
        );
        const checkFn = extractFunction(appSrc, 'checkSlug') || '';
        assert.ok(
            /currentSiteSlug/.test(checkFn),
            'checkSlug treats own slug as available'
        );
        const loadFn = extractFunction(appSrc, 'loadSiteForEdit') || '';
        assert.ok(/currentSitePaid\s*=/.test(loadFn), 'loadSiteForEdit sets paid');
        assert.ok(/currentSiteSlug\s*=/.test(loadFn), 'loadSiteForEdit sets slug');
    });

    await check('HEAD: menu details open by default so Articol nou is visible', () => {
        assert.ok(
            /<details class="pm-group" open>/.test(pmTpl),
            'details open attribute on menu groups'
        );
        const cfg = loadPresetConfig('product-menu');
        cfg.menu = cfg.menu || { title: 'Meniu', en: [], ro: [] };
        cfg.menu.en = (cfg.menu.en || []).concat([
            { category: 'Secțiune nouă', items: ['Articol nou', 'Fel special S65'] },
        ]);
        cfg.menu.ro = (cfg.menu.ro || []).concat([
            { category: 'Secțiune nouă', items: ['Articol nou', 'Fel special S65'] },
        ]);
        const html = renderHtml(pmTpl, cfg);
        assert.ok(html.includes('Secțiune nouă'), 'section in HTML');
        assert.ok(html.includes('Articol nou'), 'dish Articol nou in HTML');
        assert.ok(html.includes('Fel special S65'), 'extra dish in HTML');
        assert.ok(
            /<details[^>]*\sopen[\s>]/.test(html),
            'rendered details are open'
        );
    });

    await check('HIDOOK_FAKE_DEPLOY not set (isolated + test-pay)', () => {
        assert.strictEqual(process.env.HIDOOK_FAKE_DEPLOY, undefined);
        assert.strictEqual(process.env.HIDOOK_ISOLATED_DEPLOY, '1');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
        assert.ok(payments.isConfigured(), 'test-pay configured');
        assert.strictEqual(pricing.PRICE_CENTS, 10000);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
    });

    // ── Isolated HTTP ──────────────────────────────────────────────────────
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

    await check('isolated: Instagram grant finishes without SITEBUILDER_PARTNER_SECRET', async () => {
        assert.ok(!process.env.SITEBUILDER_PARTNER_SECRET, 'secret must be unset');
        const email = `s65-ig-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const c = await loginClient(base, email);
        const cfg = loadPresetConfig('product-menu');
        cfg.business.name = 'S65 IG ' + crypto.randomUUID().slice(0, 6);
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'RO' },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: 's65-ig-' + crypto.randomUUID().slice(0, 8),
                config: cfg,
                images: [],
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const body = await pub.json();
        const siteId = body.site.id;

        const grant = await c(`/api/sites/${siteId}/social-feed/grant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acceptedTerms: true }),
        });
        assert.strictEqual(grant.status, 200, 'grant must 200 isolated, got ' + grant.status + ' ' + await grant.clone().text());
        const gBody = await grant.json();
        assert.ok(gBody.embedUrl && /instafidget|isolated/i.test(gBody.embedUrl), 'stub embedUrl');
        assert.ok(!/SITEBUILDER_PARTNER_SECRET|x-sitebuilder-partner-secret/i.test(JSON.stringify(gBody)));

        const ed = await c(`/api/sites/${siteId}/social-feed/editor-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        assert.strictEqual(ed.status, 200, 'editor-session 200 isolated');
        const edBody = await ed.json();
        // No live partner UI required; null editorUrl is OK when embed already set
        assert.ok(edBody.editorUrl == null || typeof edBody.editorUrl === 'string');
        assert.ok(!/nu e configurat/i.test(JSON.stringify(edBody)));
    });

    await check('isolated: paid #edit republish keeps slug and updates live HTML', async () => {
        const email = `s65-repub-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const c = await loginClient(base, email);
        const cfg = loadPresetConfig('product-menu');
        const nameV1 = 'S65RepubV1-' + crypto.randomUUID().slice(0, 6);
        const nameV2 = 'S65RepubV2-' + crypto.randomUUID().slice(0, 6);
        cfg.business.name = nameV1;
        const slugHint = 's65-repub-' + crypto.randomUUID().slice(0, 8);

        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' },
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

        // Slug of own paid site is "taken" on public check — builder must not block on it
        const slugCheck = await fetch(`${base}/api/slug-check?slug=${encodeURIComponent(slug)}`);
        assert.strictEqual(slugCheck.status, 200);
        const scBody = await slugCheck.json();
        assert.strictEqual(scBody.available, false, 'own slug appears taken publicly');

        // Republish with siteId only (no new slug) — paid path
        cfg.business.name = nameV2;
        cfg.menu = cfg.menu || { title: 'Meniu', en: [], ro: [] };
        const dish = 'Articol nou S65-' + crypto.randomUUID().slice(0, 5);
        cfg.menu.en = (cfg.menu.en || []).concat([
            { category: 'Secțiune nouă', items: [dish, 'Articol nou'] },
        ]);
        cfg.menu.ro = (cfg.menu.ro || []).concat([
            { category: 'Secțiune nouă', items: [dish, 'Articol nou'] },
        ]);

        const rep = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                siteId,
                templateId: 'product-menu',
                config: cfg,
                images: [],
                // intentionally omit slug — paid must not require a free new address
            }),
        });
        assert.strictEqual(rep.status, 200, await rep.clone().text());
        const repBody = await rep.json();
        assert.strictEqual(repBody.site.paid, true);
        assert.strictEqual(repBody.site.slug, slug, 'slug unchanged');

        const deadline = Date.now() + 12000;
        let html2 = '';
        while (Date.now() < deadline) {
            const live2 = await fetch(`${base}/live/${slug}/`);
            assert.strictEqual(live2.status, 200);
            html2 = await live2.text();
            if (html2.includes(nameV2) && html2.includes(dish)) break;
            await sleep(50);
        }
        assert.ok(html2.includes(nameV2), 'live shows v2 name');
        assert.ok(html2.includes(dish), 'live shows new menu dish');
        assert.ok(html2.includes('Articol nou'), 'live shows Articol nou');
        assert.ok(/details[^>]*\sopen/i.test(html2), 'menu sections open on live');
        assert.ok(!html2.includes(nameV1), 'v1 name gone');
    });

    // Non-isolated path must still 503 without secret (do not weaken social-feed-partner)
    await check('non-isolated still 503 without partner secret (regression guard)', async () => {
        // Spin a second server without isolated flags by temporarily clearing them
        // is impractical once modules cached env — assert source still has 503 path.
        const serverSrc = fs.readFileSync(path.join(ROOT, 'bot', 'server.js'), 'utf8');
        assert.ok(
            /Instagram connection is not configured on this server/.test(serverSrc),
            '503 copy retained for non-isolated'
        );
        assert.ok(
            /!partner\.isConfigured\(\)\s*&&\s*!isIsolatedTestSocial\(\)/.test(serverSrc) ||
                (/isIsolatedTestSocial/.test(serverSrc) &&
                    /!partner\.isConfigured\(\)/.test(serverSrc)),
            '503 only when not isolated'
        );
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (failed) {
        console.error('\n' + failed + ' failure(s)');
        process.exit(1);
    }
    console.log('\nAll s65-s64-qa-fail checks passed.');
    process.exit(0);
})().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
});
