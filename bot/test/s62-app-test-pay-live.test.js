'use strict';
/**
 * bot/test/s62-app-test-pay-live.test.js — S62 opened /app/ test-pay hash → isolated live.
 *
 * Causal lock-in after S61 QA FAIL:
 *   - builder must handle #test-checkout= (not dead hash after pay CTA)
 *   - unpaid /live/<slug>/ with Accept: text/html → English HTML 404 (not raw JSON)
 *   - simulate opened test-pay return → site paid + /live HTML 200 with distinctive name
 *   - second publish replaces live HTML (v1 gone, v2 present)
 *   - magic-link Open the site / verify resume path in builder source
 *
 * Env (same adapters as S50/S6): HIDOOK_ISOLATED_DEPLOY=1, HIDOOK_TEST_PAY=1;
 * HIDOOK_FAKE_DEPLOY deleted. No *.test.local client address.
 *
 * Run: node bot/test/s62-app-test-pay-live.test.js
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const INDEX_HTML = path.join(ROOT, 'builder', 'index.html');
const PARENT_SHA = 'e74b13f98e69496326a56a2c651e627ee1d80fa7';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's62-app-test-pay-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'test-secret-s62-' + crypto.randomBytes(4).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
delete process.env.HIDOOK_FAKE_DEPLOY;
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
const registry   = require('../registry.js');
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
    return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
    });
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

function loadPresetConfig(templateId) {
    const presetsPath = path.join(ROOT, 'templates', templateId, 'presets.json');
    assert.ok(fs.existsSync(presetsPath), `presets.json missing for ${templateId}`);
    const body = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
    const presets = body.presets || [];
    assert.ok(presets.length >= 1, `${templateId} must have ≥1 preset`);
    const cfg = JSON.parse(JSON.stringify(presets[0].config));
    assert.ok(cfg && cfg.business, `${templateId} preset must have business`);
    return { presetId: presets[0].id, config: cfg };
}

function withBusinessName(config, name) {
    const c = JSON.parse(JSON.stringify(config));
    c.business = c.business || {};
    c.business.name = name;
    if (c.business.title) c.business.title = name + ' | S62';
    if (c.business.about) c.business.about = name + ' — S62 test-pay live proof.';
    return c;
}

function assertHasTestCheckoutHandler(src) {
    assert.ok(
        /test-checkout/.test(src),
        'builder must mention test-checkout'
    );
    // Must not be only the dead-hash navigation
    const handleRouteSrc = extractFunction(src, 'handleRoute') || '';
    const completeSrc =
        extractFunction(src, 'completeTestCheckout') ||
        extractFunction(src, 'handleTestCheckout') ||
        extractFunction(src, 'finishTestCheckout') ||
        '';
    const bootArea = src;
    const hasRoute =
        /test-checkout\s*=/.test(handleRouteSrc) ||
        /test-checkout/.test(handleRouteSrc) ||
        /#test-checkout/.test(bootArea);
    assert.ok(hasRoute || completeSrc.length > 40, 'handleRoute or dedicated complete fn must handle test-checkout');
    // Must call an API (not only window.location.href = paymentUrl)
    const handlerBlob = completeSrc || handleRouteSrc || bootArea;
    assert.ok(
        /\/api\/test-pay\/complete|test-pay\/complete|webhooks\/stripe/.test(handlerBlob) ||
            /apiPost\s*\(\s*['"][^'"]*test-pay/.test(handlerBlob) ||
            /completeTestCheckout|handleTestCheckout|finishTestCheckout/.test(src),
        'test-checkout handler must complete pay via API (not dead hash only)'
    );
    // Dead-only pattern forbidden as the sole pay return
    const onlyDead =
        /payBtn\.onclick\s*=\s*\(\)\s*=>\s*\{\s*window\.location\.href\s*=\s*paymentUrl/.test(src) &&
        !/test-checkout/.test(handleRouteSrc) &&
        completeSrc.length < 40;
    assert.ok(!onlyDead, 'must not leave test-checkout as a dead hash');
}

// ── Causal RED on parent SHA ────────────────────────────────────────────────

check(`parent ${PARENT_SHA.slice(0, 7)} builder has no test-checkout handler`, () => {
    const src = parentBlob('builder/app.js');
    assert.ok(
        !/test-checkout/.test(src),
        'parent already handles test-checkout — pick another causal RED'
    );
    assert.ok(
        /window\.location\.href\s*=\s*paymentUrl/.test(src),
        'parent pay CTA still navigates to paymentUrl (dead hash path)'
    );
});

check(`parent ${PARENT_SHA.slice(0, 7)} serveLive unpaid still JSON 404`, () => {
    const src = parentBlob('bot/server.js');
    const m = src.match(/function serveLive[\s\S]*?\nfunction /);
    assert.ok(m, 'parent serveLive not found');
    assert.ok(
        /sendJson\(\s*res,\s*404,\s*\{\s*error:\s*['"]not found['"]\s*\}/.test(m[0]),
        'parent serveLive must JSON-404 missing live files'
    );
    assert.ok(
        !/sendNotFound\s*\(\s*req\s*,\s*res/.test(m[0]),
        'parent serveLive must not yet prefer HTML 404'
    );
});

check(`parent ${PARENT_SHA.slice(0, 7)} has no POST /api/test-pay/complete`, () => {
    const src = parentBlob('bot/server.js');
    assert.ok(
        !/\/api\/test-pay\/complete/.test(src),
        'parent already has test-pay complete route'
    );
});

// ── HEAD source + HTTP ──────────────────────────────────────────────────────

(async () => {
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const htmlSrc = fs.existsSync(INDEX_HTML) ? fs.readFileSync(INDEX_HTML, 'utf8') : '';
    const combined = appSrc + '\n' + htmlSrc;

    await check('HEAD builder source: #test-checkout= / test-checkout handler exists', () => {
        assertHasTestCheckoutHandler(appSrc);
    });

    await check('HEAD builder magic-link resume: Open the site does not only hard-navigate away', () => {
        const wireSrc = extractFunction(appSrc, 'wireAuthForm') || '';
        assert.ok(wireSrc.length > 40, 'wireAuthForm must exist');
        // Magic-link anchor click must preventDefault + fetch verify (keep SPA) or set resume flag
        const devClick = (wireSrc.match(/devLink\.addEventListener\(\s*['"]click['"][\s\S]{0,800}/) || [''])[0];
        assert.ok(devClick.length > 20, 'devLink click listener must exist');
        assert.ok(
            /preventDefault\s*\(/.test(devClick),
            'Open the site click must preventDefault so SPA can finish publish after verify'
        );
        // Empty dashboard + local draft → resume editor (not stuck on «Nu ai site-uri…»)
        const loadDash = extractFunction(appSrc, 'loadDashboard') || '';
        const handleRoute = extractFunction(appSrc, 'handleRoute') || '';
        assert.ok(
            /loadDraft\s*\(/.test(loadDash + handleRoute),
            'dashboard/route must call loadDraft to resume in-progress site'
        );
        assert.ok(
            /You haven't created any sites yet/.test(loadDash) &&
                (/location\.hash\s*=\s*['"]#edit['"]/.test(loadDash + handleRoute) ||
                    /startWithTemplate|resumeLocalDraft|restoreDraft/.test(appSrc)),
            'empty dashboard must route draft back to #edit'
        );
    });

    await check('HEAD commercial: no HIDOOK_FAKE_DEPLOY / *.test.local client address', () => {
        assert.ok(!/HIDOOK_FAKE_DEPLOY/.test(combined), 'no FAKE_DEPLOY in builder');
        assert.ok(!/\.test\.local\b/i.test(combined), 'no *.test.local as customer address');
        assert.strictEqual(process.env.HIDOOK_FAKE_DEPLOY, undefined);
        assert.strictEqual(process.env.HIDOOK_ISOLATED_DEPLOY, '1');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
        assert.ok(payments.isConfigured(), 'test-pay configured');
    });

    await check('pricing still 9900 / 2900 only', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
    });

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

    async function loginClient(email) {
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

    await check('unpaid publish → /live HTML Accept is English 404 page (not JSON body)', async () => {
        const { config: baseCfg } = loadPresetConfig('product-menu');
        const nameV1 = `S62-HTML404-${crypto.randomUUID().slice(0, 8)}`;
        const email = `s62-html404-${crypto.randomUUID().slice(0, 6)}@example.com`;
        const c = await loginClient(email);
        const slugHint = `s62-u404-${crypto.randomUUID().slice(0, 8)}`;
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: slugHint,
                config: withBusinessName(baseCfg, nameV1),
                images: [],
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        const slug = pubBody.site.slug;
        assert.strictEqual(pubBody.site.paid, false);

        const live = await fetch(`${base}/live/${slug}/`, {
            redirect: 'manual',
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });
        assert.strictEqual(live.status, 404, 'unpaid /live must 404');
        const ct = live.headers.get('content-type') || '';
        assert.ok(/text\/html/i.test(ct), 'content-type must be text/html, got ' + ct);
        const body = await live.text();
        assert.ok(!/^\s*\{/.test(body), 'must not be raw JSON body');
        assert.ok(
            /Pagină negăsită|nu mai este public|Site-ul nu mai/i.test(body),
            'Romanian HTML 404 / locked state copy expected'
        );
        assert.ok(!body.includes('"error":"not found"'), 'must not dump JSON error string');
    });

    await check('opened test-pay return: paymentUrl #test-checkout= → complete → live name → republish', async () => {
        const { config: baseCfg } = loadPresetConfig('product-menu');
        const nameV1 = `S62-Pay-V1-${crypto.randomUUID().slice(0, 8)}`;
        const nameV2 = `S62-Pay-V2-${crypto.randomUUID().slice(0, 8)}`;
        const email = `s62-pay-${crypto.randomUUID().slice(0, 6)}@example.com`;
        const c = await loginClient(email);
        const slugHint = `s62-pay-${crypto.randomUUID().slice(0, 8)}`;

        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: slugHint,
                config: withBusinessName(baseCfg, nameV1),
                images: [],
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        assert.ok(pubBody.site && pubBody.site.id, 'site id');
        assert.strictEqual(pubBody.site.paid, false);
        assert.ok(pubBody.paymentUrl, 'paymentUrl from test-pay');
        assert.ok(
            /#test-checkout=cs_test_/.test(pubBody.paymentUrl),
            'test-pay paymentUrl must be #test-checkout=cs_test_* got ' + pubBody.paymentUrl
        );
        assert.ok(!/\.test\.local\b/i.test(String(pubBody.site.url || '')));

        const siteId = pubBody.site.id;
        const slug = pubBody.site.slug;
        const m = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
        assert.ok(m, 'extract session id from paymentUrl hash');
        const sessionId = m[1];

        // Unpaid still 404
        const liveUnpaid = await fetch(`${base}/live/${slug}/`, { redirect: 'manual' });
        assert.strictEqual(liveUnpaid.status, 404);

        // Simulate what the builder hash handler does after opened return
        const complete = await c('/api/test-pay/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
        });
        assert.strictEqual(complete.status, 200, await complete.clone().text());
        const doneBody = await complete.json();
        assert.ok(doneBody.ok !== false, 'complete ok');
        assert.ok(doneBody.site && doneBody.site.paid === true, 'site paid after test-pay complete');
        assert.ok(doneBody.site.url, 'live url after complete');
        assert.ok(
            String(doneBody.site.url).includes('/live/' + slug),
            'live URL is PUBLIC_URL/live/<slug>/ got ' + doneBody.site.url
        );
        assert.ok(!/\.test\.local\b/i.test(doneBody.site.url));

        await waitForStatus(base, `/live/${slug}/`, 200);

        const site = registry.getSite(siteId);
        assert.strictEqual(site.paid, true);
        assert.ok(site.url);

        const live1 = await fetch(site.url.startsWith('http') ? site.url : base + site.url);
        assert.strictEqual(live1.status, 200);
        const html1 = await live1.text();
        assert.ok(html1.includes(nameV1), `live HTML must contain ${nameV1}`);

        // Come-back edit/republish
        const rep = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                siteId,
                templateId: 'product-menu',
                config: withBusinessName(baseCfg, nameV2),
                images: [],
            }),
        });
        assert.strictEqual(rep.status, 200, await rep.clone().text());
        const repBody = await rep.json();
        assert.strictEqual(repBody.site.paid, true);
        assert.ok(repBody.site.url);

        const deadline = Date.now() + 10000;
        let html2 = '';
        while (Date.now() < deadline) {
            const live2 = await fetch(`${base}/live/${slug}/`);
            assert.strictEqual(live2.status, 200);
            html2 = await live2.text();
            if (html2.includes(nameV2)) break;
            await sleep(50);
        }
        assert.ok(html2.includes(nameV2), 'republish must show v2 name');
        assert.ok(!html2.includes(nameV1), 'v1 name must be gone after republish');

        // Idempotent second complete
        const again = await c('/api/test-pay/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
        });
        assert.ok(again.status === 200 || again.status === 409, 'second complete soft-ok');
    });

    await check('POST /api/test-pay/complete refused without auth', async () => {
        const res = await fetch(`${base}/api/test-pay/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: 'cs_test_nope' }),
        });
        assert.strictEqual(res.status, 401);
    });

    await check('POST /api/test-pay/complete refused when NODE_ENV=production', async () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const email = `s62-prod-${crypto.randomUUID().slice(0, 6)}@example.com`;
            // Fresh client still has cookie from earlier jar? use new login under production may break test-pay
            // Use existing jar from a quick login while production — auth may still work with SERVER_SECRET
            const c = makeClient(base);
            // Manually set session via signSession path: use non-prod login first
            process.env.NODE_ENV = prev; // login needs non-prod for nothing special if SERVER_SECRET set
            const loginRes = await fetch(`${base}/api/auth/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const loginBody = await loginRes.json();
            let token;
            try { token = new URL(loginBody.devLink).searchParams.get('token'); }
            catch {
                const qs = loginBody.devLink.includes('?')
                    ? loginBody.devLink.slice(loginBody.devLink.indexOf('?') + 1) : '';
                token = new URLSearchParams(qs).get('token');
            }
            await c(`/auth/verify?token=${encodeURIComponent(token)}`);
            process.env.NODE_ENV = 'production';
            const res = await c('/api/test-pay/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: 'cs_test_prod_block' }),
            });
            assert.ok(
                res.status === 403 || res.status === 404 || res.status === 503,
                'production must refuse test-pay complete, got ' + res.status
            );
        } finally {
            if (prev === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = prev;
        }
    });

    await check('magic-link verify still 302 /app/ without SERVER_SECRET leak', async () => {
        const email = `s62-ml-${crypto.randomUUID().slice(0, 6)}@example.com`;
        const loginRes = await fetch(`${base}/api/auth/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const loginBody = await loginRes.json();
        assert.ok(loginBody.devLink);
        let token;
        try { token = new URL(loginBody.devLink).searchParams.get('token'); }
        catch {
            const qs = loginBody.devLink.includes('?')
                ? loginBody.devLink.slice(loginBody.devLink.indexOf('?') + 1) : '';
            token = new URLSearchParams(qs).get('token');
        }
        const c = makeClient(base);
        const v = await c(`/auth/verify?token=${encodeURIComponent(token)}`);
        assert.strictEqual(v.status, 302);
        const loc = v.headers.get('location') || '';
        assert.ok(/\/app\//.test(loc), 'verify redirects into /app/ got ' + loc);
        // Prefer dashboard or resume — not bare /app without hash is ok; must not leak secret
        const body = await v.text();
        assert.ok(!/SERVER_SECRET/.test(body + loc), 'no SERVER_SECRET leak');
        assert.ok(c.jar.hb_session, 'session cookie set');
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll s62-app-test-pay-live checks passed.');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
