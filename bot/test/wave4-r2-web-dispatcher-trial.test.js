'use strict';
/**
 * bot/test/wave4-r2-web-dispatcher-trial.test.js — Wave 4-R2 production path.
 *
 * Closes the REJECT on t_e012cf3f: Dockerfile CMD is `node web.js`, and the
 * previous onStripeEvent routed through flow.handleStripeWebhookEvent which
 * drops payment_status=no_payment_required (subscription trial start).
 *
 * This file requires the **web dispatcher** (`bot/web.js` → onStripeEvent),
 * NOT handleStripePaid directly and NOT bot/bot.js. It must fail if web.js
 * still drops trial checkouts, and pass when the dispatcher accepts trial
 * start while still rejecting unpaid/open.
 *
 * Run: node bot/test/wave4-r2-web-dispatcher-trial.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave4-r2-web-dispatch-'));
process.env.DATA_DIR              = tmpDir;
process.env.HIDOOK_FAKE_DEPLOY    = '1';
process.env.HIDOOK_TEST_PAY       = '1';
process.env.SERVER_SECRET         = 'test-secret-wave4-r2-web-dispatch';
process.env.NODE_ENV              = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

const pricing    = require('../pricing.js');
const registry   = require('../registry.js');
const webpublish = require('../webpublish.js');
// Production web entry dispatcher (same module Docker runs as `node web.js`).
const { onStripeEvent } = require('../web.js');

assert.strictEqual(typeof onStripeEvent, 'function', 'web.js must export onStripeEvent');

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
    const user = registry.getOrCreateUserByEmail(`w4r2-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: 'w4r2-' + crypto.randomUUID().slice(0, 8),
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

function seedPendingOrder(paymentStatusLabel) {
    const { user, site } = userSite();
    const sessionId = 'cs_test_w4r2_' + paymentStatusLabel + '_' + crypto.randomBytes(5).toString('hex');
    const order = registry.createOrder({
        siteId: site.id,
        userId: user.id,
        amountCents: pricing.PRICE_CENTS,
        currency: 'eur',
        stripeSessionId: sessionId,
        kind: 'publish',
    });
    registry.saveVersion(site.id, {
        businessName: 'W4R2 ' + paymentStatusLabel,
        sections: { hero: { title: 'Hello' } },
    });
    webpublish.savePendingDraft(order.id, {
        config: { businessName: 'W4R2 ' + paymentStatusLabel },
        images: [],
        siteId: site.id,
        savedAt: new Date().toISOString(),
    });
    return { user, site, sessionId, order };
}

(async () => {
    await check('PRICE_CENTS is 9900', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
    });

    await check('web.js onStripeEvent accepts no_payment_required (trial start → publish)', async () => {
        const { user, site, sessionId, order } = seedPendingOrder('trial');
        const { count } = await withPublishCounter(async () => {
            // Must go through web dispatcher — not handleStripePaid directly.
            await onStripeEvent(
                stripeEvent(sessionId, {
                    platform: 'web',
                    orderId: order.id,
                    siteId: site.id,
                    kind: 'publish',
                    userId: user.id,
                }, 'no_payment_required')
            );
        });
        assert.ok(count >= 1, 'web.js dispatcher must publish on trial start, publishes=' + count);
        const fresh = registry.getSite(site.id);
        assert.strictEqual(fresh.paid, true, 'site.paid after trial via web.js dispatcher');
        assert.ok(fresh.paidUntil, 'paidUntil set');
        const ord = registry.getOrderBySession(sessionId);
        assert.ok(ord && ord.status === 'paid', 'order marked paid on trial start via web.js');
    });

    await check('web.js onStripeEvent still accepts payment_status=paid', async () => {
        const { user, site, sessionId, order } = seedPendingOrder('paid');
        const { count } = await withPublishCounter(async () => {
            await onStripeEvent(
                stripeEvent(sessionId, {
                    platform: 'web',
                    orderId: order.id,
                    siteId: site.id,
                    kind: 'publish',
                    userId: user.id,
                }, 'paid')
            );
        });
        assert.ok(count >= 1, 'paid must still publish via web.js');
        assert.strictEqual(registry.getSite(site.id).paid, true);
    });

    await check('web.js onStripeEvent rejects unpaid — no publish', async () => {
        const { user, site, sessionId } = seedPendingOrder('unpaid');
        const { count } = await withPublishCounter(async () => {
            await onStripeEvent(
                stripeEvent(sessionId, {
                    platform: 'web',
                    siteId: site.id,
                    kind: 'publish',
                    userId: user.id,
                }, 'unpaid')
            );
        });
        assert.strictEqual(count, 0, 'unpaid must not publish via web.js');
        assert.strictEqual(registry.getSite(site.id).paid, false);
        const ord = registry.getOrderBySession(sessionId);
        assert.ok(ord && ord.status !== 'paid', 'order must stay unpaid');
    });

    await check('web.js onStripeEvent rejects open — no publish', async () => {
        const { user, site, sessionId } = seedPendingOrder('open');
        const { count } = await withPublishCounter(async () => {
            await onStripeEvent(
                stripeEvent(sessionId, {
                    platform: 'web',
                    siteId: site.id,
                    kind: 'publish',
                    userId: user.id,
                }, 'open')
            );
        });
        assert.strictEqual(count, 0, 'open must not publish via web.js');
        assert.strictEqual(registry.getSite(site.id).paid, false);
    });

    await check('web.js source routes onStripeEvent via webpublish.handleStripePaid (not flow paid-gate)', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'web.js'), 'utf8');
        // Strip block + line comments so docs naming the old gate cannot false-fail.
        const code = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        assert.ok(
            /await\s+webpublish\.handleStripePaid\s*\(/.test(code),
            'web.js must await webpublish.handleStripePaid(...)'
        );
        assert.ok(
            !/handleStripeWebhookEvent/.test(code),
            'web.js must not call or require handleStripeWebhookEvent for Stripe events'
        );
        const onStripe = code.match(/async function onStripeEvent[\s\S]*?\n\}/);
        assert.ok(onStripe, 'onStripeEvent body present');
        assert.ok(
            /webpublish\.handleStripePaid/.test(onStripe[0]),
            'onStripeEvent body must call webpublish.handleStripePaid'
        );
    });

    if (failed) {
        console.error('\nwave4-r2-web-dispatcher-trial.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nwave4-r2-web-dispatcher-trial.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
