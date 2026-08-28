'use strict';
/**
 * bot/test/s50-builder-pay-republish.test.js — S50 browser pay + isolated republish.
 *
 * Causal lock-in for /app/ after S47/S49 verticals:
 *   - Slug preview fallback is sites.hidook.agency (PRODUCT.md), not hidook.ro
 *   - Unpaid success stays draft + Plătește și publică; not HIDOOK_FAKE_DEPLOY journey
 *   - Real registry presets (restaurant + salon/trade): unpaid /live 404 → test pay →
 *     fetchable PUBLIC_URL/live/<slug>/ with distinctive business.name → edit republish
 *
 * Env under test (same adapters as S6 stranger-e2e):
 *   HIDOOK_ISOLATED_DEPLOY=1, HIDOOK_TEST_PAY=1; HIDOOK_FAKE_DEPLOY deleted
 *
 * Run: node bot/test/s50-builder-pay-republish.test.js
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const INDEX_HTML = path.join(ROOT, 'builder', 'index.html');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's50-pay-republish-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'test-secret-s50-' + crypto.randomBytes(4).toString('hex');
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

/** Load first preset config from real template registry on disk. */
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
    if (c.business.title) c.business.title = name + ' | S50';
    if (c.business.about) c.business.about = name + ' — S50 vertical proof.';
    return c;
}

(async () => {
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const htmlSrc = fs.readFileSync(INDEX_HTML, 'utf8');
    const combined = appSrc + '\n' + htmlSrc;
    const updateSlugSrc = extractFunction(appSrc, 'updateSlugPreview') || '';
    const showSuccessSrc = extractFunction(appSrc, 'showSuccessScreen') || '';

    // ── Builder source lock-ins ────────────────────────────────────────────
    await check('updateSlugPreview fallback domain is sites.hidook.agency (not hidook.ro)', () => {
        assert.ok(updateSlugSrc.length > 40, 'updateSlugPreview must exist');
        assert.ok(
            /brandDomain\s*\|\|\s*['"]sites\.hidook\.agency['"]/.test(updateSlugSrc),
            'slug fallback must be sites.hidook.agency when brandDomain unset'
        );
        assert.ok(
            !/brandDomain\s*\|\|\s*['"]hidook\.ro['"]/.test(updateSlugSrc),
            'slug fallback must not be hidook.ro'
        );
        assert.ok(
            !/\|\|\s*['"]hidook\.ro['"]/.test(updateSlugSrc),
            'updateSlugPreview must not hardcode hidook.ro'
        );
    });

    await check('builder has no hidook.ro fallback outside brandDomain override path', () => {
        // Allow mentions only if brandDomain is explicitly set; bare 'hidook.ro' as default is forbidden
        const bareFallback = /appConfig\.brandDomain\s*\|\|\s*['"]hidook\.ro['"]/;
        assert.ok(!bareFallback.test(appSrc), 'builder/app.js must not default brandDomain to hidook.ro');
    });

    await check('unpaid success chrome: Adaugă card trial (not Draft saved / Pay and publish)', () => {
        assert.ok(showSuccessSrc.length > 40, 'showSuccessScreen must exist');
        assert.ok(
            /Adaugă un card ca să fii live/i.test(showSuccessSrc) ||
                /Adaugă un card ca să fii live/i.test(htmlSrc) ||
                /success-draft-note/.test(showSuccessSrc),
            'unpaid success must prompt add card to go live'
        );
        assert.ok(
            /Adaugă un card — începe trialul de 7 zile/i.test(htmlSrc) ||
                /Adaugă un card — începe trialul de 7 zile/i.test(appSrc),
            'pay CTA must be RO trial card verb'
        );
        assert.ok(
            /7-day trial|trial(?:ul)? de 7 zile|7 zile/i.test(htmlSrc + showSuccessSrc),
            'success chrome must mention trial 7 zile'
        );
        assert.ok(
            !/Pay and publish/i.test(htmlSrc + appSrc) &&
                !/Complete your payment to publish the site/i.test(htmlSrc + showSuccessSrc),
            'must not keep pay-once Draft/Pay chrome'
        );
    });

    await check('builder commercial chrome: Hidook Site Builder; no DESSERD/bakery/test.local/fake journey', () => {
        assert.ok(/Hidook Site Builder/.test(htmlSrc), 'publish/success chrome names Hidook Site Builder');
        assert.ok(!/\bDESSERD\b/i.test(combined), 'no DESSERD');
        assert.ok(!/\bbakery\b/i.test(combined), 'no bakery as customer address');
        assert.ok(!/\.test\.local\b/i.test(combined), 'no *.test.local as customer address');
        assert.ok(
            !/HIDOOK_FAKE_DEPLOY/.test(appSrc) && !/HIDOOK_FAKE_DEPLOY/.test(htmlSrc),
            'builder journey must not wire HIDOOK_FAKE_DEPLOY'
        );
        // Slice IDs must not appear as the customer-facing site address copy
        assert.ok(
            !/slug.*S50|S50.*slug|adresa.*S\d+/i.test(updateSlugSrc),
            'slug preview must not use slice IDs as domain'
        );
    });

    await check('HIDOOK_FAKE_DEPLOY not set in this test process (isolated journey)', () => {
        assert.strictEqual(process.env.HIDOOK_FAKE_DEPLOY, undefined);
        assert.strictEqual(process.env.HIDOOK_ISOLATED_DEPLOY, '1');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
        assert.ok(payments.isConfigured(), 'test-pay configured');
    });

    // ── HTTP: real vertical presets ────────────────────────────────────────
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
    /**
     * Full pay → live → republish for one templateId using disk preset + distinctive names.
     */
    async function journeyVertical(templateId, label) {
        const { presetId, config: baseCfg } = loadPresetConfig(templateId);
        const nameV1 = `S50-${label}-V1-${crypto.randomUUID().slice(0, 8)}`;
        const nameV2 = `S50-${label}-V2-${crypto.randomUUID().slice(0, 8)}`;
        const email = `s50-${label.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}@example.com`;

        // Fresh client jar per vertical so sessions do not collide on unpaid-one-site rules
        const c = makeClient(base);
        // re-login helper using this jar
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

        const slugHint = `s50-${label.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' },
            body: JSON.stringify({
                templateId,
                slug: slugHint,
                config: withBusinessName(baseCfg, nameV1),
                images: [],
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        assert.ok(pubBody.site && pubBody.site.id, 'site id');
        assert.strictEqual(pubBody.site.paid, false, 'unpaid draft');
        assert.ok(pubBody.site.url == null || pubBody.site.url === '', 'no live url unpaid');
        assert.ok(pubBody.paymentUrl, 'paymentUrl from test-pay');
        assert.ok(!/\.test\.local\b/i.test(String(pubBody.site.url || '')), 'not *.test.local');

        const siteId = pubBody.site.id;
        const slug = pubBody.site.slug;

        const liveUnpaid = await fetch(`${base}/live/${slug}/`, { redirect: 'manual' });
        assert.strictEqual(liveUnpaid.status, 404, `${label} unpaid /live must 404`);

        const db = JSON.parse(fs.readFileSync(path.join(tmpDir, '.registry.json'), 'utf8'));
        const orders = Object.values(db.orders || {}).filter((o) => o.siteId === siteId);
        assert.ok(orders.length >= 1, 'pending order');
        const pending = orders.find((o) => o.status === 'pending') || orders[0];
        assert.strictEqual(pending.amountCents, pricing.PRICE_CENTS);
        const checkoutSessionId = pending.stripeSessionId;
        assert.ok(checkoutSessionId && checkoutSessionId !== 'pending');

        const event = {
            id: 'evt_s50_' + crypto.randomUUID().slice(0, 10),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: checkoutSessionId,
                    payment_status: 'paid',
                    metadata: {
                        platform: 'web',
                        orderId: pending.id,
                        siteId,
                        kind: 'publish',
                    },
                },
            },
        };
        const wh = await fetch(`${base}/webhooks/stripe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event),
        });
        assert.strictEqual(wh.status, 200, await wh.clone().text());

        await waitForStatus(base, `/live/${slug}/`, 200);

        const site = registry.getSite(siteId);
        assert.strictEqual(site.paid, true);
        assert.ok(site.url, 'live url');
        assert.ok(!/\.test\.local\b/i.test(site.url), 'live not *.test.local');
        assert.ok(
            site.url.includes('/live/' + slug),
            'live URL is PUBLIC_URL/live/<slug>/ got ' + site.url
        );

        const live1 = await fetch(site.url.startsWith('http') ? site.url : base + site.url);
        assert.strictEqual(live1.status, 200);
        const html1 = await live1.text();
        assert.ok(
            html1.includes(nameV1),
            `${label} (${templateId}/${presetId}) live HTML must contain ${nameV1}`
        );

        // Edit + republish
        const rep = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                siteId,
                templateId,
                config: withBusinessName(baseCfg, nameV2),
                images: [],
            }),
        });
        assert.strictEqual(rep.status, 200, await rep.clone().text());
        const repBody = await rep.json();
        assert.strictEqual(repBody.site.paid, true);
        assert.ok(repBody.site.url);
        assert.ok(!/\.test\.local\b/i.test(repBody.site.url));

        const deadline = Date.now() + 10000;
        let html2 = '';
        while (Date.now() < deadline) {
            const live2 = await fetch(`${base}/live/${slug}/`);
            assert.strictEqual(live2.status, 200);
            html2 = await live2.text();
            if (html2.includes(nameV2)) break;
            await sleep(50);
        }
        assert.ok(html2.includes(nameV2), `${label} republish must show v2 name`);
        assert.ok(!html2.includes(nameV1), `${label} v1 name must be gone after republish`);
    }

    await check('restaurant product-menu preset: unpaid 404 → pay → live name → republish', async () => {
        await journeyVertical('product-menu', 'REST');
    });

    await check('salon portfolio preset: unpaid 404 → pay → live name → republish', async () => {
        await journeyVertical('portfolio', 'SALON');
    });

    await check('pricing still 9900 / 2900 only', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll s50-builder-pay-republish checks passed.');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
