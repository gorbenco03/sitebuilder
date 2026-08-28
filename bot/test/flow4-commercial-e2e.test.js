'use strict';
/**
 * bot/test/flow4-commercial-e2e.test.js — VISION Flow 4.2 commercial E2E.
 *
 * Causal contracts (HIDOOK_TEST_PAY + HIDOOK_ISOLATED_DEPLOY, no live Stripe):
 *   1. Fake/test checkout (card-required 7-day trial) → site live immediately.
 *   2. Cancel before trial end → public site unpublished/locked; /live shows
 *      clear Romanian product state (not stale live HTML).
 *   3. Product-visible surfaces state trial 7 zile, card, 99 after trial,
 *      renewal 29/an — no pay-before-publish / one-time 99 / 100 price leak.
 *
 * Run: node bot/test/flow4-commercial-e2e.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BASE_SHA = '7ec562ae3ab1240e3ce03dcd846da9eed614f0a5';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow4-2-commercial-e2e-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'flow4-2-e2e-' + crypto.randomBytes(6).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

const payments = require('../payments.js');
const pricing = require('../pricing.js');
const webpublish = require('../webpublish.js');
const registry = require('../registry.js');
const auth = require('../auth.js');
const { onStripeEvent } = require('../web.js');
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

function baseBlob(rel) {
    try {
        return execFileSync('git', ['-C', ROOT, 'show', BASE_SHA + ':' + rel], {
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024,
        });
    } catch {
        return null;
    }
}

function headRead(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function productSurface() {
    // Product-visible surfaces only — exclude 00-Governance and historical QA.
    const rels = [
        'builder/index.html',
        'builder/app.js',
        'builder/terms.html',
        'builder/privacy.html',
        'bot/server.js',
        'PRODUCT.md',
        'OWNER-STRIPE-TRIAL.md',
    ];
    return rels.map((r) => headRead(r)).join('\n');
}

function publishedDir(slug) {
    return path.join(tmpDir, 'published', String(slug).toLowerCase());
}

function loadPreset() {
    const raw = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates/product-menu/presets.json'), 'utf8')
    );
    const cfg = JSON.parse(JSON.stringify(raw.presets[0].config));
    cfg.business = cfg.business || {};
    cfg.business.name = 'Flow42 Cafe ' + crypto.randomBytes(2).toString('hex');
    cfg.business.title = cfg.business.name;
    return cfg;
}

function makeClient(base) {
    const jar = {};
    async function doFetch(urlPath, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        const cookieStr = Object.entries(jar)
            .map(([k, v]) => k + '=' + v)
            .join('; ');
        if (cookieStr) headers.Cookie = cookieStr;
        const res = await fetch(base + urlPath, { ...opts, headers, redirect: 'manual' });
        const setCookie = res.headers.getSetCookie
            ? res.headers.getSetCookie()
            : res.headers.get('set-cookie')
              ? [res.headers.get('set-cookie')]
              : [];
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

/** Stale commercial model phrases on product surfaces (not docs-only). */
const STALE_PRODUCT = [
    { name: '100 as brochure price', re: /\bPays?\s+\*?\*?100\*?\*?\b/i },
    { name: '100 once then 29', re: /\b100\s+once\s+then\s+29\b/i },
    { name: 'one-time 99 as current model', re: /one[\s-]?time\s+99/i },
    { name: 'pay-before-publish as current model heading', re: /Payments\s*\(\s*builder\s+pay-before-publish\s*\)/i },
    { name: 'pay once and go live', re: /pay\s+once\s+and\s+your\s+site\s+goes\s+live/i },
    { name: 'Pay and publish (pay-once CTA)', re: /Pay and publish this site/i },
];

(async () => {
    // ── Causal RED on required base (English commercial chrome / bare EN 404) ─
    await check('causal RED: base ' + BASE_SHA.slice(0, 7) + ' builder lacks RO trial 7 zile chrome', () => {
        const html = baseBlob('builder/index.html') || '';
        const js = baseBlob('builder/app.js') || '';
        const blob = html + '\n' + js;
        assert.ok(blob.length > 100, 'base builder readable');
        // Base still sells English "7-day trial" without Romanian "7 zile"
        assert.ok(/7[\s-]*day\s+trial/i.test(blob), 'base has EN 7-day trial');
        assert.ok(
            !/trial\s+de\s+7\s+zile|7\s+zile/i.test(blob),
            'base must not already claim Romanian 7 zile trial chrome'
        );
    });

    await check('causal RED: base live 404 is English Page not found (not RO cancel state)', () => {
        const src = baseBlob('bot/server.js') || '';
        assert.ok(/Page not found/i.test(src), 'base has English Page not found');
        assert.ok(
            !/nu mai este public|Site-ul nu mai este|anulat.*trial/i.test(src),
            'base must not already have Romanian unpublished/cancel live copy'
        );
    });

    // ── HEAD: product-visible commercial copy ───────────────────────────────
    await check('HEAD product surfaces: trial 7 zile + card + 99 + 29/an', () => {
        const surface = productSurface();
        assert.ok(
            /7\s*zile|trial\s+de\s+7\s+zile/i.test(surface),
            'must state trial 7 zile on product surface'
        );
        assert.ok(
            /card/i.test(surface),
            'must mention card (card required)'
        );
        assert.ok(
            /\b99\b/.test(surface),
            'must show 99 after trial'
        );
        assert.ok(
            /29\s*\/?\s*an|29\s*€\s*\/\s*an|29\/an|renewal.*29|29.*an/i.test(surface),
            'must state renewal 29/an'
        );
        assert.ok(
            /anuleaz|unless you cancel|dac[aă] nu anulezi|unless cancelled|anulat/i.test(surface),
            'must state cancel path'
        );
        // Live immediately
        assert.ok(
            /live\s+(imediat|acum|now)|site.*live.*(acum|imediat|now)|devine\s+live/i.test(surface),
            'must state live immediately after card'
        );
    });

    await check('HEAD product surfaces: no stale 100 / one-time / pay-once commercial leak', () => {
        const surface = productSurface();
        for (const s of STALE_PRODUCT) {
            assert.ok(!s.re.test(surface), 'stale leak: ' + s.name);
        }
        // Hard ban on brochure **100** as price in product MD/html
        assert.ok(!/\*\*100\*\*\s*EUR/i.test(surface), 'no **100** EUR brochure price');
    });

    // ── HTTP E2E: test checkout → live immediately ──────────────────────────
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((resolve, reject) => {
        if (server.listening) return resolve();
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const addr = server.address();
    const base = `http://127.0.0.1:${addr.port}`;
    process.env.PUBLIC_URL = base;

    const cfg = loadPreset();
    const bizName = cfg.business.name;
    const user = registry.getOrCreateUserByEmail('flow42-' + crypto.randomUUID().slice(0, 8) + '@ex.com');
    const sessionCookie = 'hb_session=' + auth.signSession(user.id);
    const client = makeClient(base);
    // seed cookie jar
    client.jar.hb_session = auth.signSession(user.id);

    await check('E2E: unpaid draft publish → paymentUrl #test-checkout=cs_test_*', async () => {
        const res = await client('/api/publish', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: sessionCookie,
                'CF-IPCountry': 'RO',
            },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: 'f42-' + crypto.randomUUID().slice(0, 8),
                config: cfg,
                images: [],
            }),
        });
        assert.strictEqual(res.status, 200, await res.clone().text());
        const body = await res.json();
        assert.ok(body.site && body.site.id, 'site id');
        assert.strictEqual(body.site.paid, false, 'unpaid before checkout');
        assert.ok(body.paymentUrl, 'paymentUrl');
        assert.ok(
            /#test-checkout=cs_test_/.test(body.paymentUrl),
            'offline test checkout hash, got ' + body.paymentUrl
        );
        // Persist for next checks
        global.__f42 = {
            siteId: body.site.id,
            slug: body.site.slug,
            paymentUrl: body.paymentUrl,
            sessionId: String(body.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/)[1],
        };
        const liveUnpaid = await fetch(base + '/live/' + body.site.slug + '/', {
            headers: { Accept: 'text/html' },
            redirect: 'manual',
        });
        assert.strictEqual(liveUnpaid.status, 404, 'unpaid must not be live');
    });

    await check('E2E: POST /api/test-pay/complete → site live immediately with distinctive copy', async () => {
        const { siteId, slug, sessionId } = global.__f42;
        const complete = await client('/api/test-pay/complete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: sessionCookie,
            },
            body: JSON.stringify({ sessionId }),
        });
        assert.ok(
            complete.status === 200 || complete.status === 201,
            'test-pay complete status ' + complete.status + ' ' + (await complete.clone().text())
        );

        const site = registry.getSite(siteId);
        assert.ok(site.paid === true || site.status === 'live' || site.status === 'active',
            'site paid/live after test checkout, got ' + JSON.stringify({ paid: site.paid, status: site.status }));
        assert.ok(
            site.status === 'live' || site.status === 'active',
            'status live immediately after card/trial start, got ' + site.status
        );
        assert.ok(fs.existsSync(path.join(publishedDir(slug), 'index.html')), 'isolated publish files');

        const live = await fetch(base + '/live/' + slug + '/', {
            headers: { Accept: 'text/html' },
            redirect: 'manual',
        });
        assert.strictEqual(live.status, 200, 'live must 200 after test checkout');
        const html = await live.text();
        assert.ok(html.includes(bizName) || html.length > 200, 'live HTML serves site content');
        // No charge invent on trial start in test-pay
        assert.ok(pricing.PRICE_CENTS === 9900 && pricing.RENEWAL_CENTS === 2900);
    });

    await check('E2E: offline Cancel (billing-portal) unpublishes; /live Romanian locked state', async () => {
        const { siteId, slug } = global.__f42;
        // Ensure subscription id present for cancel routing
        let site = registry.getSite(siteId);
        if (!site.stripeSubscriptionId) {
            registry.updateSite(siteId, {
                stripeSubscriptionId: 'sub_test_f42_' + crypto.randomBytes(4).toString('hex'),
                stripeCustomerId: site.stripeCustomerId || ('cus_test_f42_' + siteId.slice(0, 8)),
            });
            site = registry.getSite(siteId);
        }

        const portal = await client('/api/sites/' + encodeURIComponent(siteId) + '/billing-portal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: sessionCookie,
            },
            body: '{}',
        });
        assert.strictEqual(portal.status, 200, await portal.clone().text());
        const portalBody = await portal.json();
        assert.ok(portalBody.portalUrl || portalBody.url, 'portal url');
        assert.ok(
            portalBody.offline === true ||
                /test-billing-portal|bps_test_/i.test(String(portalBody.portalUrl || portalBody.url)),
            'offline test portal without live Stripe'
        );

        site = registry.getSite(siteId);
        assert.ok(
            site.status !== 'live' && site.status !== 'active',
            'registry not live after cancel, got ' + site.status
        );
        assert.ok(
            !fs.existsSync(path.join(publishedDir(slug), 'index.html')),
            'published index removed after cancel'
        );

        const liveAfter = await fetch(base + '/live/' + slug + '/', {
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            redirect: 'manual',
        });
        assert.strictEqual(liveAfter.status, 404, 'live must 404 after cancel');
        const body = await liveAfter.text();
        assert.ok(!/^\s*\{/.test(body.trim()), 'must not be raw JSON');
        assert.ok(
            /nu mai este public|nu mai este disponibil|anulat|nepublicat|Site-ul nu mai/i.test(body),
            'Romanian unpublished/cancel state required, got: ' + body.slice(0, 280)
        );
        // Must not still serve the business live content
        assert.ok(
            !body.includes(bizName),
            'must not silently serve stale live business HTML after cancel'
        );
        assert.ok(/lang=["']ro["']/i.test(body), 'HTML lang=ro');
    });

    await check('E2E: createCheckout offline contract is card trial 7d + 99 then 29', async () => {
        delete process.env.STRIPE_SECRET_KEY;
        const session = await payments.createCheckout({
            orderId: 'ord_f42_' + crypto.randomBytes(3).toString('hex'),
            amountCents: pricing.PRICE_CENTS,
            renewalCents: pricing.RENEWAL_CENTS,
            currency: 'eur',
            productName: 'Hidook Site Builder',
            successUrl: base + '/app/',
            cancelUrl: base + '/app/',
            metadata: { siteId: 'x', kind: 'publish' },
            customerEmail: 'f42-co@ex.com',
        });
        assert.ok(session && session.url, 'checkout url');
        assert.ok(/#test-checkout=cs_test_/.test(session.url), 'test checkout hash');
        assert.ok(session.contract, 'billing contract on offline session');
        const c = session.contract;
        assert.ok(
            c.firstPeriodCents === pricing.PRICE_CENTS || c.amountCents === pricing.PRICE_CENTS || c.first === 99,
            'first period 99'
        );
        assert.ok(
            c.renewalCents === pricing.RENEWAL_CENTS || c.renewal === 29 || c.renewalCents === 2900,
            'renewal 29'
        );
        assert.ok(
            c.trialDays === 7 || c.trial_period_days === 7,
            'trial days must be 7, got ' + JSON.stringify(c)
        );
    });

    await new Promise((r) => server.close(() => r()));
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}

    if (failed) {
        console.error('\nflow4-commercial-e2e.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nflow4-commercial-e2e.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
