'use strict';
/**
 * bot/test/wave4-subscription-trial.test.js — Wave 4 commercial trial card.
 *
 * Invariants (VISION 2026-08-26):
 *   (a) createCheckout Stripe body uses mode=subscription + trial_period_days=7
 *   (b) HIDOOK_TEST_PAY offline complete still publishes on the paid path
 *   (c) checkout.session.completed with payment_status=no_payment_required
 *       is accepted as card-on-file / trial start (site.paid + deploy)
 *   unpaid / open still must not publish; payment_status=paid still works
 *
 * Run: node bot/test/wave4-subscription-trial.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave4-sub-trial-'));
process.env.DATA_DIR              = tmpDir;
process.env.HIDOOK_FAKE_DEPLOY    = '1';
process.env.HIDOOK_TEST_PAY       = '1';
process.env.SERVER_SECRET         = 'test-secret-wave4-sub-trial';
process.env.NODE_ENV              = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

const payments   = require('../payments.js');
const pricing    = require('../pricing.js');
const registry   = require('../registry.js');
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

function userSite() {
    const user = registry.getOrCreateUserByEmail(`w4-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: 'w4-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    return { user, site };
}

function stripeEvent(sessionId, metadata, paymentStatus, eventId) {
    return {
        id: eventId || ('evt_' + crypto.randomUUID().slice(0, 12)),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: sessionId,
                payment_status: paymentStatus,
                metadata: metadata || {},
            },
        },
    };
}

async function withPublishCounter(fn) {
    const orig = webpublish.publishSite;
    let count = 0;
    webpublish.publishSite = async (args) => {
        count++;
        return orig.call(webpublish, args);
    };
    try {
        const out = await fn();
        return { count, out };
    } finally {
        webpublish.publishSite = orig;
    }
}

/** Parse application/x-www-form-urlencoded Stripe body into a flat map. */
function parseStripeForm(body) {
    const map = {};
    for (const part of String(body || '').split('&')) {
        if (!part) continue;
        const i = part.indexOf('=');
        const k = decodeURIComponent(i < 0 ? part : part.slice(0, i));
        const v = decodeURIComponent(i < 0 ? '' : part.slice(i + 1));
        map[k] = v;
    }
    return map;
}

(async () => {
    await check('PRICE_CENTS remains 10000 in this card', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 10000);
    });

    // ── (a) createCheckout Stripe params: subscription + 7-day trial ────────
    await check('createCheckout Stripe body: mode=subscription + trial_period_days=7', async () => {
        const prevTestPay = process.env.HIDOOK_TEST_PAY;
        const prevKey = process.env.STRIPE_SECRET_KEY;
        process.env.HIDOOK_TEST_PAY = '0';
        process.env.STRIPE_SECRET_KEY = 'sk_test_wave4_subscription_params';

        const origFetch = global.fetch;
        let capturedBody = null;
        let capturedUrl = null;
        global.fetch = async (url, opts) => {
            capturedUrl = String(url);
            capturedBody = opts && opts.body;
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 'cs_live_wave4_mock', url: 'https://checkout.stripe.com/c/pay/cs_live_wave4_mock' }),
            };
        };
        try {
            const co = await payments.createCheckout({
                amountCents: pricing.PRICE_CENTS,
                currency: 'eur',
                productName: 'Hidook Site Builder site activation',
                successUrl: 'http://127.0.0.1/ok',
                cancelUrl: 'http://127.0.0.1/cancel',
                metadata: { platform: 'web', kind: 'publish' },
            });
            assert.strictEqual(co.id, 'cs_live_wave4_mock');
            assert.ok(capturedUrl && /checkout\/sessions/.test(capturedUrl), 'POST /checkout/sessions');
            const form = parseStripeForm(capturedBody);
            assert.strictEqual(form.mode, 'subscription', 'mode must be subscription, got ' + form.mode);
            assert.strictEqual(
                form['subscription_data[trial_period_days]'],
                '7',
                'trial_period_days must be 7'
            );
            assert.ok(
                form['line_items[0][price_data][recurring][interval]'] === 'year' ||
                    form['line_items[0][price_data][recurring][interval]'] === 'month',
                'subscription price_data must include recurring interval'
            );
            assert.notStrictEqual(form.mode, 'payment', 'must not use mode=payment');
            assert.strictEqual(payments.SUBSCRIPTION_TRIAL_DAYS, 7);
        } finally {
            global.fetch = origFetch;
            if (prevTestPay === undefined) delete process.env.HIDOOK_TEST_PAY;
            else process.env.HIDOOK_TEST_PAY = prevTestPay;
            if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
            else process.env.STRIPE_SECRET_KEY = prevKey;
        }
    });

    await check('createCheckout uses STRIPE_PRICE_ID_EUR when set (env catalog)', async () => {
        const prevTestPay = process.env.HIDOOK_TEST_PAY;
        const prevKey = process.env.STRIPE_SECRET_KEY;
        const prevEur = process.env.STRIPE_PRICE_ID_EUR;
        const prevGeneric = process.env.STRIPE_PRICE_ID;
        process.env.HIDOOK_TEST_PAY = '0';
        process.env.STRIPE_SECRET_KEY = 'sk_test_wave4_price_id';
        process.env.STRIPE_PRICE_ID_EUR = 'price_test_eur_wave4';
        delete process.env.STRIPE_PRICE_ID;

        const origFetch = global.fetch;
        let capturedBody = null;
        global.fetch = async (_url, opts) => {
            capturedBody = opts && opts.body;
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 'cs_price_wave4', url: 'https://checkout.stripe.com/c/pay/cs_price_wave4' }),
            };
        };
        try {
            assert.strictEqual(payments.resolveStripePriceId('eur'), 'price_test_eur_wave4');
            await payments.createCheckout({
                amountCents: pricing.PRICE_CENTS,
                currency: 'eur',
                productName: 'Hidook Site Builder site activation',
                successUrl: 'http://127.0.0.1/ok',
                cancelUrl: 'http://127.0.0.1/cancel',
            });
            const form = parseStripeForm(capturedBody);
            assert.strictEqual(form.mode, 'subscription');
            assert.strictEqual(form['line_items[0][price]'], 'price_test_eur_wave4');
            assert.strictEqual(form['subscription_data[trial_period_days]'], '7');
            assert.ok(!form['line_items[0][price_data][unit_amount]'], 'catalog path must not send unit_amount price_data');
        } finally {
            global.fetch = origFetch;
            if (prevTestPay === undefined) delete process.env.HIDOOK_TEST_PAY;
            else process.env.HIDOOK_TEST_PAY = prevTestPay;
            if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
            else process.env.STRIPE_SECRET_KEY = prevKey;
            if (prevEur === undefined) delete process.env.STRIPE_PRICE_ID_EUR;
            else process.env.STRIPE_PRICE_ID_EUR = prevEur;
            if (prevGeneric === undefined) delete process.env.STRIPE_PRICE_ID;
            else process.env.STRIPE_PRICE_ID = prevGeneric;
        }
    });

    await check('HIDOOK_TEST_PAY offline createCheckout still returns cs_test_* hash URL', async () => {
        process.env.HIDOOK_TEST_PAY = '1';
        delete process.env.STRIPE_SECRET_KEY;
        assert.ok(payments.isConfigured());
        const co = await payments.createCheckout({
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
            productName: 'Hidook Site Builder site activation',
            successUrl: 'http://127.0.0.1/app/#paid',
            cancelUrl: 'http://127.0.0.1/app/#cancelled',
            metadata: { platform: 'web' },
        });
        assert.ok(/^cs_test_[a-f0-9]+$/.test(co.id), 'offline id cs_test_*');
        assert.ok(co.url.includes('#test-checkout=' + co.id), 'hash offline URL');
    });

    // ── (c) no_payment_required accepted; unpaid rejected; paid still works ─
    await check('handleStripePaid accepts payment_status=no_payment_required (trial start)', async () => {
        const { user, site } = userSite();
        const sessionId = 'cs_test_trial_' + crypto.randomBytes(6).toString('hex');
        const order = registry.createOrder({
            siteId: site.id,
            userId: user.id,
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
            stripeSessionId: sessionId,
            kind: 'publish',
        });
        registry.saveVersion(site.id, {
            businessName: 'Wave4 Trial Co',
            sections: { hero: { title: 'Hello' } },
        });
        webpublish.savePendingDraft(order.id, {
            config: { businessName: 'Wave4 Trial Co' },
            images: [],
            siteId: site.id,
            savedAt: new Date().toISOString(),
        });

        const { count } = await withPublishCounter(async () => {
            await webpublish.handleStripePaid(
                stripeEvent(sessionId, {
                    platform: 'web',
                    orderId: order.id,
                    siteId: site.id,
                    kind: 'publish',
                    userId: user.id,
                }, 'no_payment_required'),
                { notifyAdmin: () => {} }
            );
        });
        assert.ok(count >= 1, 'trial start must publish immediately, publishes=' + count);
        const fresh = registry.getSite(site.id);
        assert.strictEqual(fresh.paid, true, 'site.paid after trial card-on-file');
        assert.ok(fresh.paidUntil, 'paidUntil set');
        const ord = registry.getOrderBySession(sessionId);
        assert.ok(ord && ord.status === 'paid', 'order marked paid on trial start');
    });

    await check('handleStripePaid still accepts payment_status=paid', async () => {
        const { user, site } = userSite();
        const sessionId = 'cs_test_paid_' + crypto.randomBytes(6).toString('hex');
        const order = registry.createOrder({
            siteId: site.id,
            userId: user.id,
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
            stripeSessionId: sessionId,
            kind: 'publish',
        });
        registry.saveVersion(site.id, { businessName: 'Wave4 Paid Co' });
        webpublish.savePendingDraft(order.id, {
            config: { businessName: 'Wave4 Paid Co' },
            images: [],
            siteId: site.id,
            savedAt: new Date().toISOString(),
        });

        const { count } = await withPublishCounter(async () => {
            await webpublish.handleStripePaid(
                stripeEvent(sessionId, {
                    platform: 'web',
                    orderId: order.id,
                    siteId: site.id,
                    kind: 'publish',
                    userId: user.id,
                }, 'paid'),
                { notifyAdmin: () => {} }
            );
        });
        assert.ok(count >= 1, 'paid must still publish');
        assert.strictEqual(registry.getSite(site.id).paid, true);
    });

    await check('handleStripePaid rejects unpaid — no publish', async () => {
        const { user, site } = userSite();
        const sessionId = 'cs_test_unpaid_' + crypto.randomBytes(6).toString('hex');
        registry.createOrder({
            siteId: site.id,
            userId: user.id,
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
            stripeSessionId: sessionId,
            kind: 'publish',
        });
        const { count } = await withPublishCounter(async () => {
            await webpublish.handleStripePaid(
                stripeEvent(sessionId, {
                    platform: 'web',
                    siteId: site.id,
                    kind: 'publish',
                    userId: user.id,
                }, 'unpaid'),
                { notifyAdmin: () => {} }
            );
        });
        assert.strictEqual(count, 0, 'unpaid must not publish');
        assert.strictEqual(registry.getSite(site.id).paid, false);
        const ord = registry.getOrderBySession(sessionId);
        assert.ok(ord && ord.status !== 'paid', 'order must stay unpaid');
    });

    // ── (b) HIDOOK_TEST_PAY /api/test-pay/complete still publishes ───────────
    await check('POST /api/test-pay/complete still publishes (HIDOOK_TEST_PAY)', async () => {
        process.env.HIDOOK_TEST_PAY = '1';
        process.env.HIDOOK_ISOLATED_DEPLOY = '1';
        delete process.env.STRIPE_SECRET_KEY;
        delete process.env.STRIPE_WEBHOOK_SECRET;

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

        try {
            const email = `w4-testpay-${crypto.randomUUID().slice(0, 8)}@example.com`;
            const loginRes = await fetch(`${base}/api/auth/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            assert.strictEqual(loginRes.status, 200, await loginRes.clone().text());
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
            assert.ok(token, 'dev magic-link token');

            const jar = { cookie: '' };
            const verifyRes = await fetch(`${base}/auth/verify?token=${encodeURIComponent(token)}`, {
                redirect: 'manual',
            });
            assert.ok([302, 303].includes(verifyRes.status), 'verify redirect ' + verifyRes.status);
            const setCookie = verifyRes.headers.getSetCookie
                ? verifyRes.headers.getSetCookie()
                : (verifyRes.headers.raw && verifyRes.headers.raw()['set-cookie']) || [];
            const cookieHeader = (Array.isArray(setCookie) ? setCookie : [setCookie])
                .map((c) => String(c).split(';')[0])
                .filter(Boolean)
                .join('; ');
            jar.cookie = cookieHeader;
            assert.ok(jar.cookie, 'session cookie after verify');

            async function api(pathname, opts = {}) {
                const headers = Object.assign({}, opts.headers || {}, {
                    Cookie: jar.cookie,
                });
                if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
                return fetch(base + pathname, { ...opts, headers });
            }

            const slug = 'w4tp-' + crypto.randomUUID().slice(0, 8);
            const pub = await api('/api/publish', {
                method: 'POST',
                body: JSON.stringify({
                    templateId: 'product-menu',
                    slug,
                    config: { businessName: 'Wave4 TestPay', sections: { hero: { title: 'TP' } } },
                    images: [],
                }),
            });
            assert.strictEqual(pub.status, 200, await pub.clone().text());
            const pubBody = await pub.json();
            assert.ok(pubBody.paymentUrl, 'paymentUrl from unpaid publish');
            assert.ok(pubBody.site && pubBody.site.paid === false, 'still unpaid draft');

            const m = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
            assert.ok(m, 'offline hash checkout id on paymentUrl');
            const sessionId = m[1];

            const complete = await api('/api/test-pay/complete', {
                method: 'POST',
                body: JSON.stringify({ sessionId }),
            });
            assert.strictEqual(complete.status, 200, await complete.clone().text());
            const done = await complete.json();
            assert.ok(done.ok, 'test-pay complete ok');
            assert.ok(done.site && done.site.paid === true, 'site.paid after test-pay complete');

            // Registry truth
            const sites = typeof registry.listSitesByUser === 'function'
                ? registry.listSitesByUser(pubBody.site.userId || done.site.id)
                : null;
            const siteRow = registry.getSite(done.site.id);
            assert.ok(siteRow && siteRow.paid, 'registry site paid');
            assert.ok(
                siteRow.status === 'live' || siteRow.url,
                'first public publish after test-pay (status=' + siteRow.status + ' url=' + siteRow.url + ')'
            );
            void sites;
        } finally {
            await new Promise((r) => srv.close(r));
        }
    });

    if (failed) {
        console.error('\nwave4-subscription-trial.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nwave4-subscription-trial.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
