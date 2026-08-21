'use strict';
/**
 * bot/test/stranger-e2e.test.js — S6 stranger HTTP journey (real server + registry).
 *
 * Journey: open builder → edit → magic-link (dev) → pay (test) → fetchable live URL
 * → edit latest and republish. Does NOT set HIDOOK_FAKE_DEPLOY.
 *
 * Env under test:
 *   HIDOOK_ISOLATED_DEPLOY=1  → $DATA_DIR/published/<slug>/ + GET /live/<slug>/
 *   HIDOOK_TEST_PAY=1         → offline checkout + unsigned webhook (non-production)
 *
 * Run: node bot/test/stranger-e2e.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stranger-e2e-'));
process.env.DATA_DIR                 = tmpDir;
process.env.SERVER_SECRET            = 'test-secret-stranger-e2e-' + crypto.randomBytes(4).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY   = '1';
process.env.HIDOOK_TEST_PAY          = '1';
// Explicitly NOT fake deploy — client journey uses isolated local publish
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
delete process.env.NODE_ENV; // ensure not production so test adapters are allowed

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

const DISTINCTIVE_V1 = 'STRANGER-E2E-COPY-V1-' + crypto.randomUUID().slice(0, 8);
const DISTINCTIVE_V2 = 'STRANGER-E2E-COPY-V2-' + crypto.randomUUID().slice(0, 8);

function siteConfig(name) {
    return {
        business: {
            name,
            tagline: 'E2E',
            title: name,
            metaDescription: 'stranger e2e',
            about: name,
            lang: 'ro',
        },
        labels: {
            about: 'Despre',
            instaTitle: 'Insta',
            instaFollow: 'Follow',
            scroll: 'Scroll',
            waQr: 'WA',
            waOpen: 'WA',
        },
        theme: {
            primary: '#E8588C',
            primaryLight: '#f07aa5',
            primaryDark: '#d14477',
            cream: '#fafafa',
        },
        logo: '',
        showWordmark: true,
        hero: {
            background: 'linear-gradient(135deg,#f7f3f0,#efe7ea)',
            ctaLabel: 'Contact',
        },
        servicesTitle: 'Servicii',
        services: [{ icon: '✦', label: 'Svc' }],
        galleryTitle: '',
        categories: [{ title: '', blurb: '', photos: [] }],
        instagram: { handle: '', url: '', gallery: [] },
        contact: {
            title: 'Contact',
            intro: 'hi',
            instagram: { url: '', label: '' },
            facebook: { url: '', label: '' },
            whatsapp: '',
            phone: '',
            phoneDisplay: '',
            waHref: '',
            address: '',
            addressHref: '',
        },
        seo: { ogImage: '', jsonLd: '' },
        footer: { address: 'Str. E2E 1', year: 2026, note: 'e2e' },
    };
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/** Wait until GET path returns expected status (async webhook → publish). */
async function waitForStatus(base, urlPath, wantStatus, { timeoutMs = 8000, intervalMs = 50 } = {}) {
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

(async () => {
    // ── Unit: adapters refuse production ───────────────────────────────────
    await check('HIDOOK_TEST_PAY createCheckout works offline (no STRIPE_SECRET_KEY)', async () => {
        assert.strictEqual(process.env.HIDOOK_FAKE_DEPLOY, undefined);
        assert.ok(payments.isConfigured(), 'test-pay must make payments configured');
        const co = await payments.createCheckout({
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
            productName: 'Activare site Hidook',
            successUrl: 'http://127.0.0.1/ok',
            cancelUrl: 'http://127.0.0.1/cancel',
            metadata: { platform: 'web' },
        });
        assert.ok(co.id && typeof co.id === 'string', 'checkout id');
        assert.ok(co.url && typeof co.url === 'string', 'checkout url');
    });

    await check('HIDOOK_TEST_PAY refused when NODE_ENV=production', async () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            let threw = false;
            try {
                await payments.createCheckout({
                    amountCents: 10000,
                    currency: 'eur',
                    productName: 'x',
                    successUrl: 'http://x/ok',
                    cancelUrl: 'http://x/c',
                });
            } catch (e) {
                threw = true;
                assert.ok(
                    /refused|not set|STRIPE/i.test(e.message),
                    'production must refuse test-pay or missing secret: ' + e.message
                );
            }
            assert.ok(threw, 'createCheckout must throw in production without Stripe secret');
            // isConfigured must not claim ready without real secret in production
            assert.strictEqual(
                payments.isConfigured(),
                false,
                'isConfigured false in production without STRIPE_SECRET_KEY'
            );
        } finally {
            if (prev === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = prev;
        }
    });

    await check('HIDOOK_ISOLATED_DEPLOY refused when NODE_ENV=production', async () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            let threw = false;
            try {
                await webpublish.publishSite({
                    site: {
                        id: 'x',
                        projectName: 'prod-refuse',
                        slug: 'prod-refuse',
                        userId: 'u',
                        templateId: 'product-menu',
                        paid: true,
                    },
                    config: siteConfig('Prod Refuse'),
                    images: [],
                });
            } catch (e) {
                threw = true;
                assert.ok(
                    /refused|production|HIDOOK_ISOLATED/i.test(e.message) ||
                        /token|deploy|provider|Furnizor/i.test(e.message),
                    'expected production refusal or missing real deploy: ' + e.message
                );
            }
            assert.ok(threw, 'isolated deploy must not succeed in production');
        } finally {
            if (prev === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = prev;
        }
    });

    // ── HTTP server (real registry + onStripeEvent → webpublish) ───────────
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
    const client = makeClient(base);

    await check('GET /app/ → 200 HTML', async () => {
        const res = await fetch(`${base}/app/`);
        assert.strictEqual(res.status, 200);
        const ct = res.headers.get('content-type') || '';
        assert.ok(/text\/html/i.test(ct), 'content-type html');
        const html = await res.text();
        assert.ok(html.length > 50, 'builder HTML body');
    });

    await check('GET /api/templates includes product-menu, local-service, portfolio', async () => {
        const res = await fetch(`${base}/api/templates`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        const ids = (body.templates || []).map((t) => t.id);
        for (const id of ['product-menu', 'local-service', 'portfolio']) {
            assert.ok(ids.includes(id), `missing template ${id}: ${ids.join(',')}`);
        }
    });

    const email = `stranger-${crypto.randomUUID().slice(0, 8)}@example.com`;
    let siteId;
    let slug;
    let checkoutSessionId;
    let orderId;

    await check('POST /api/auth/email → devLink; GET verify sets session', async () => {
        const res = await fetch(`${base}/api/auth/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.ok(body.devLink, 'devLink required');
        let token;
        try {
            token = new URL(body.devLink).searchParams.get('token');
        } catch {
            const qs = body.devLink.includes('?') ? body.devLink.slice(body.devLink.indexOf('?') + 1) : '';
            token = new URLSearchParams(qs).get('token');
        }
        assert.ok(token);
        const v = await client(`/auth/verify?token=${encodeURIComponent(token)}`);
        assert.strictEqual(v.status, 302);
        assert.ok(client.jar.hb_session, 'session cookie');
        const me = await client('/api/me');
        assert.strictEqual(me.status, 200);
        assert.ok((await me.json()).user);
    });

    await check('POST /api/publish unpaid with distinctive copy → paid=false, url null; /live 404', async () => {
        const slugHint = 'stranger-' + crypto.randomUUID().slice(0, 8);
        const res = await client('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: slugHint,
                config: siteConfig(DISTINCTIVE_V1),
                images: [],
            }),
        });
        assert.strictEqual(res.status, 200, await res.clone().text());
        const body = await res.json();
        assert.ok(body.site && body.site.id, 'site id');
        siteId = body.site.id;
        slug = body.site.slug;
        assert.strictEqual(body.site.paid, false);
        assert.ok(body.site.url == null || body.site.url === '', 'no public url when unpaid');
        assert.ok(body.paymentUrl, 'test-pay must return paymentUrl');
        assert.ok(!/\.test\.local\b/i.test(String(body.site.url || '')), 'must not be *.test.local');

        // Capture checkout session from durable order
        const db = JSON.parse(fs.readFileSync(path.join(tmpDir, '.registry.json'), 'utf8'));
        const orders = Object.values(db.orders || {}).filter((o) => o.siteId === siteId);
        assert.ok(orders.length >= 1, 'pending order exists');
        const pending = orders.find((o) => o.status === 'pending') || orders[0];
        orderId = pending.id;
        checkoutSessionId = pending.stripeSessionId;
        assert.ok(checkoutSessionId && checkoutSessionId !== 'pending', 'session attached in place');
        assert.strictEqual(pending.amountCents, pricing.PRICE_CENTS, 'amount from pricing.js only');
        assert.strictEqual(pending.currency, 'eur', 'DE → EUR');

        const live = await fetch(`${base}/live/${slug}/`, { redirect: 'manual' });
        assert.strictEqual(live.status, 404, 'unpaid must not be served at /live');
    });

    await check('test webhook payment_status=paid → site.paid, paidUntil ~+12m, fetchable live HTML', async () => {
        assert.ok(checkoutSessionId && siteId && slug);
        const event = {
            id: 'evt_stranger_' + crypto.randomUUID().slice(0, 10),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: checkoutSessionId,
                    payment_status: 'paid',
                    metadata: {
                        platform: 'web',
                        orderId,
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

        await waitForStatus(base, `/live/${slug}/`, 200, { timeoutMs: 15000 });

        const site = registry.getSite(siteId);
        assert.strictEqual(site.paid, true, 'site.paid');
        assert.ok(site.paidUntil, 'paidUntil set');
        const until = Date.parse(site.paidUntil);
        const now = Date.now();
        assert.ok(until > now + 360 * 86400000, 'paidUntil ~+12 months (lower)');
        assert.ok(until < now + 370 * 86400000, 'paidUntil ~+12 months (upper)');

        assert.ok(site.url, 'live url set');
        assert.ok(!/\.test\.local\b/i.test(site.url), 'live URL must not be *.test.local');
        assert.ok(
            site.url.includes('/live/' + slug),
            'live URL must be PUBLIC_URL/live/<slug>/ got ' + site.url
        );

        const live = await fetch(site.url.startsWith('http') ? site.url : base + site.url);
        assert.strictEqual(live.status, 200);
        const html = await live.text();
        assert.ok(html.includes(DISTINCTIVE_V1), 'live HTML must contain edited copy v1');
    });

    await check('path traversal on /live denied', async () => {
        const tries = [
            `/live/../${path.basename(tmpDir)}/`,
            `/live/${slug}/../../.registry.json`,
            `/live/%2e%2e/${slug}/`,
        ];
        for (const p of tries) {
            const res = await fetch(base + p, { redirect: 'manual' });
            assert.ok(
                res.status === 403 || res.status === 404,
                `${p} must be denied, got ${res.status}`
            );
        }
    });

    await check('save newer version + republish → live HTML shows latest copy', async () => {
        const res = await client('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                siteId,
                templateId: 'product-menu',
                config: siteConfig(DISTINCTIVE_V2),
                images: [],
            }),
        });
        assert.strictEqual(res.status, 200, await res.clone().text());
        const body = await res.json();
        assert.strictEqual(body.site.paid, true);
        assert.ok(body.site.url);
        assert.ok(!/\.test\.local\b/i.test(body.site.url));

        // Poll until v2 appears (deploy is sync on paid path, but be resilient)
        const deadline = Date.now() + 10000;
        let html = '';
        while (Date.now() < deadline) {
            const live = await fetch(`${base}/live/${slug}/`);
            assert.strictEqual(live.status, 200);
            html = await live.text();
            if (html.includes(DISTINCTIVE_V2)) break;
            await sleep(50);
        }
        assert.ok(html.includes(DISTINCTIVE_V2), 'live HTML must contain v2 copy');
        assert.ok(!html.includes(DISTINCTIVE_V1), 'v1 copy should be replaced on republish');
    });

    await check('amounts still only from pricing.js (10000 / 2900)', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 10000);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll stranger-e2e checks passed.');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
