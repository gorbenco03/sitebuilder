'use strict';
/**
 * bot/test/s69-s68-qa-fail.test.js — S69 remake of S68 QA FAIL leaks.
 *
 * STALE ORACLE RECONCILE (S-legacy G3, 2026-09-05):
 * Phone-example lock required US "+1" on local-service Detalii. Product is now
 * RO-first (+40 721 … examples across systems). Keep bans on embed/html lang/
 * Schema.org/bot/+447 factory jargon; require RO international phone examples
 * instead of +1. Not a stranger-facing regression.
 *
 * Form editor removed 2026-10-28: leftover 1 (resumeLocalDraft / saveDraft / bindSignedInPaidSiteForEdit /
 * openPublishModal restoring the paid site bind in the editor) covered deleted code and its source
 * and VM checks were dropped; the server half (GET /api/sites lists the paid site, republish by
 * siteId keeps the slug while the public slug-check says taken) stays.
 *
 * Causal leftovers on parent 230fe4e (S67 ACCEPT):
 *   1. (editor paid-site bind after test-pay — see note above)
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
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
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

(async () => {

    // ── Causal RED on parent ───────────────────────────────────────────────
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
    await check('HEAD: Detalii labels commercial RO (no embed/html lang/Schema.org/bot/+447)', () => {
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
            // RO commercial phone examples (+40…), not US +1 factory leftovers
            if (rel.includes('local-service')) {
                assert.ok(
                    labels.some((l) => /\+40\b/.test(l)),
                    'local-service has RO +40 phone example'
                );
                assert.ok(!labels.some((l) => /\+1\b/.test(l)), 'local-service no US +1 example');
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

    await check('isolated: after pay, GET /api/sites exposes the paid site + republish by siteId keeps the slug', async () => {
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

        // The client only needs siteId + the paid flag from GET /api/sites to republish its own site.
        const bindResult = { currentSiteId: bound.id, currentSitePaid: bound.paid, currentSiteSlug: bound.slug };
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
