'use strict';
/**
 * bot/test/wave10-admin-dashboard.test.js — Wave 10 operator /admin dashboard.
 *
 * VISION: operators need a token-gated admin/history view of all registry sites
 * (live + unpublished). Missing/wrong token must look like a plain 404 (do not
 * advertise the surface). No mutations, no refund API, no secret echo.
 *
 * Causal contracts:
 *   1. HIDOOK_ADMIN_TOKEN set → GET /admin with Bearer or ?token= returns 200 HTML
 *      listing a live site (slug + Live) and an unpublished site (slug + Unpublished).
 *   2. Wrong/missing token → 404, no site list, no token echo.
 *   3. Page never includes Stripe secrets, SERVER_SECRET, magic-link tokens, or
 *      factory jargon; brands Hidook Site Builder.
 *
 * Run: node bot/test/wave10-admin-dashboard.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const http   = require('http');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '50e2701e92ea92bbf79bd2b3d174709f7e5d235f';

const ADMIN_TOKEN = 'wave10-admin-token-' + crypto.randomBytes(12).toString('hex');
const SERVER_SECRET = 'wave10-server-secret-' + crypto.randomBytes(8).toString('hex');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave10-admin-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = SERVER_SECRET;
process.env.HIDOOK_ADMIN_TOKEN     = ADMIN_TOKEN;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0';
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

const pricing    = require('../pricing.js');
const webpublish = require('../webpublish.js');
const registry   = require('../registry.js');
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

function httpGet(port, urlPath, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get(
            {
                hostname: '127.0.0.1',
                port,
                path: urlPath,
                headers: Object.assign({ Accept: 'text/html' }, headers),
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf8'),
                    });
                });
            }
        );
        req.on('error', reject);
    });
}

function seedSite(slugPrefix) {
    const user = registry.getOrCreateUserByEmail(`w10-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: (slugPrefix || 'w10') + '-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    const sessionId = 'cs_test_w10_' + crypto.randomBytes(6).toString('hex');
    const order = registry.createOrder({
        siteId: site.id,
        userId: user.id,
        amountCents: pricing.PRICE_CENTS,
        currency: 'eur',
        stripeSessionId: sessionId,
        kind: 'publish',
    });
    registry.saveVersion(site.id, {
        businessName: 'Wave10 Admin Cafe',
        sections: { hero: { title: 'Wave10 live copy' } },
    });
    webpublish.savePendingDraft(order.id, {
        config: { businessName: 'Wave10 Admin Cafe', sections: { hero: { title: 'Wave10 live copy' } } },
        images: [],
        siteId: site.id,
        savedAt: new Date().toISOString(),
    });
    const subscriptionId = 'sub_test_w10_' + crypto.randomBytes(5).toString('hex');
    const customerId = 'cus_test_w10_' + crypto.randomBytes(5).toString('hex');
    return { user, site, sessionId, order, subscriptionId, customerId };
}

async function publishViaTrialWebhook({ sessionId, site, order, user, subscriptionId, customerId }) {
    await onStripeEvent({
        id: 'evt_w10_paid_' + crypto.randomUUID().slice(0, 10),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: sessionId,
                payment_status: 'no_payment_required',
                customer: customerId,
                subscription: subscriptionId,
                metadata: {
                    platform: 'web',
                    orderId: order.id,
                    siteId: site.id,
                    kind: 'publish',
                    userId: user.id,
                    billing_contract: 'first_then_renewal',
                    first_period_cents: String(pricing.PRICE_CENTS),
                    renewal_cents: String(pricing.RENEWAL_CENTS),
                },
            },
        },
    });
}

function assertNoSecretLeak(body, token) {
    assert.ok(!body.includes(token), 'must not echo admin token');
    assert.ok(!body.includes(SERVER_SECRET), 'must not echo SERVER_SECRET');
    assert.ok(!/sk_live_|sk_test_|whsec_|SERVER_SECRET|magic.?link|factory|Kanban|DESSERD/i.test(body),
        'must not leak secrets or factory jargon');
    assert.ok(!/HIDOOK_ADMIN_TOKEN/i.test(body), 'must not name the env var on the page');
}

(async () => {
    await check('PRICE_CENTS stays 9900', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
    });

    await check(`parent blob ${PARENT_SHA.slice(0, 7)} had no /admin route (causal RED archive)`, () => {
        // Archive: parent tree lacked /admin. Working tree may already be GREEN.
        const parentSrc = require('child_process').execFileSync(
            'git',
            ['-C', ROOT, 'show', `${PARENT_SHA}:bot/server.js`],
            { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
        );
        assert.ok(
            !/handleAdmin|HIDOOK_ADMIN_TOKEN|url === '\/admin'/.test(parentSrc),
            'parent ' + PARENT_SHA.slice(0, 7) + ' must not yet serve /admin'
        );
    });

    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((resolve, reject) => {
        if (server.listening) return resolve();
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    process.env.PUBLIC_URL = base;

    try {
        // Seed live + unpublished sites
        const liveSeed = seedSite('w10live');
        await publishViaTrialWebhook(liveSeed);
        const liveSite = registry.getSite(liveSeed.site.id);
        assert.ok(liveSite.status === 'live' || liveSite.status === 'active', 'live seed');
        const liveSlug = liveSite.slug;

        const unpubSeed = seedSite('w10unpub');
        await publishViaTrialWebhook(unpubSeed);
        await onStripeEvent({
            id: 'evt_w10_cancel_' + crypto.randomUUID().slice(0, 10),
            type: 'customer.subscription.deleted',
            data: {
                object: {
                    id: unpubSeed.subscriptionId,
                    customer: unpubSeed.customerId,
                    status: 'canceled',
                    metadata: { siteId: unpubSeed.site.id },
                },
            },
        });
        const unpubSite = registry.getSite(unpubSeed.site.id);
        assert.ok(
            unpubSite.status !== 'live' && unpubSite.status !== 'active',
            'unpublished seed status, got ' + unpubSite.status
        );
        const unpubSlug = unpubSite.slug;

        await check('GET /admin with Bearer token → 200 HTML lists live + unpublished', async () => {
            const res = await httpGet(port, '/admin', {
                Authorization: 'Bearer ' + ADMIN_TOKEN,
                Accept: 'text/html',
            });
            assert.strictEqual(res.status, 200, 'expected 200, got ' + res.status + ' body=' + res.body.slice(0, 200));
            const ct = String(res.headers['content-type'] || '');
            assert.ok(/text\/html/i.test(ct), 'content-type html, got ' + ct);
            assert.ok(/Hidook Site Builder/i.test(res.body), 'brands Hidook Site Builder');
            assert.ok(/\bSites\b/.test(res.body), 'label Sites');
            assert.ok(res.body.includes(liveSlug), 'lists live slug ' + liveSlug);
            assert.ok(res.body.includes(unpubSlug), 'lists unpublished slug ' + unpubSlug);
            // Live label near live slug; Unpublished near unpublished slug
            assert.ok(/\bLive\b/.test(res.body), 'label Live present');
            assert.ok(/\bUnpublished\b/.test(res.body), 'label Unpublished present');
            // Public URL for live if present
            if (liveSite.url) {
                assert.ok(
                    res.body.includes(liveSite.url) || res.body.includes('/live/' + liveSlug),
                    'shows public URL or /live path for live site'
                );
            }
            assertNoSecretLeak(res.body, ADMIN_TOKEN);
            // No mutation controls
            assert.ok(!/unpublish|refund|button/i.test(res.body.replace(/Unpublished/g, '')),
                'no mutation buttons');
        });

        await check('GET /admin?token= → 200 HTML (query token for browser)', async () => {
            const res = await httpGet(port, '/admin?token=' + encodeURIComponent(ADMIN_TOKEN), {
                Accept: 'text/html',
            });
            assert.strictEqual(res.status, 200, 'query token must 200, got ' + res.status);
            assert.ok(res.body.includes(liveSlug) && res.body.includes(unpubSlug), 'lists both sites');
            assertNoSecretLeak(res.body, ADMIN_TOKEN);
        });

        await check('GET /admin missing token → 404, no site list, no token echo', async () => {
            const res = await httpGet(port, '/admin', { Accept: 'text/html' });
            assert.strictEqual(res.status, 404, 'missing token must 404, got ' + res.status);
            assert.ok(!res.body.includes(liveSlug), 'must not list live slug');
            assert.ok(!res.body.includes(unpubSlug), 'must not list unpublished slug');
            assert.ok(!/Authorization|Bearer|HIDOOK_ADMIN/i.test(res.body), 'no auth advertisement');
            assertNoSecretLeak(res.body, ADMIN_TOKEN);
        });

        await check('GET /admin wrong token → 404, no site list', async () => {
            const res = await httpGet(port, '/admin', {
                Authorization: 'Bearer wrong-token-not-it',
                Accept: 'text/html',
            });
            assert.strictEqual(res.status, 404, 'wrong token must 404, got ' + res.status);
            assert.ok(!res.body.includes(liveSlug), 'must not list live slug');
            assert.ok(!res.body.includes(unpubSlug), 'must not list unpublished slug');
            assert.ok(!res.body.includes('wrong-token-not-it'), 'must not echo wrong token');
            assertNoSecretLeak(res.body, ADMIN_TOKEN);
        });

        await check('GET /admin?token=wrong → 404', async () => {
            const res = await httpGet(port, '/admin?token=wrong-query-token', { Accept: 'text/html' });
            assert.strictEqual(res.status, 404);
            assert.ok(!res.body.includes(liveSlug));
            assert.ok(!res.body.includes('wrong-query-token'));
        });

        await check('OWNER-STRIPE-TRIAL.md documents Ops /admin (no secrets)', () => {
            const md = fs.readFileSync(path.join(ROOT, 'OWNER-STRIPE-TRIAL.md'), 'utf8');
            assert.ok(/\/admin/i.test(md), 'mentions /admin');
            assert.ok(/HIDOOK_ADMIN_TOKEN/i.test(md), 'documents HIDOOK_ADMIN_TOKEN env');
            assert.ok(/Live|Unpublished|Sites/i.test(md), 'describes what done looks like');
            assert.ok(!/sk_live_[a-zA-Z0-9]{8,}|sk_test_[a-zA-Z0-9]{8,}|whsec_[a-zA-Z0-9]{8,}/.test(md),
                'no secrets printed');
            // Must not still park admin dashboard as out-of-scope once Wave 10 ships
            assert.ok(
                !/## Out of this how-to[\s\S]*Admin dashboard/i.test(md) ||
                    /Ops\s*\/admin|operator.*\/admin/i.test(md),
                'admin must be documented as shipped, not only parked out-of-scope'
            );
        });
    } finally {
        await new Promise((r) => server.close(() => r()));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }

    if (failed) {
        console.error('\nwave10-admin-dashboard.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nwave10-admin-dashboard.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
