'use strict';
/**
 * bot/test/wave10-payments-notify-integration.test.js — proves the Wave10
 * owner-payment-failure emails fire through the REAL production entry point
 * (bot/web.js#onStripeEvent → bot/server.js's HTTP `/webhooks/stripe` route),
 * not just via direct webpublish.js function calls.
 *
 * This matters for two reasons:
 *   1. bot/web.js is the Dockerfile CMD (`node web.js`) — the actual
 *      production dispatcher — and it always calls
 *      webpublish.handleStripeInvoicePaymentFailed(event, undefined) /
 *      webpublish.handleStripeSubscriptionEvent(event) with no notifyAdmin
 *      (web-only deployments have no Telegram admin chat; see its own
 *      docblock). If the new email notifications depended on a notifyAdmin
 *      callback being wired, they would silently never fire in production.
 *   2. This agent does not own bot/server.js or bot/web.js — the fix had to
 *      land entirely inside webpublish.js (owned) so that zero changes to
 *      either file were needed. This test is the proof: it requires
 *      bot/web.js completely unmodified and drives a real signed HTTP
 *      webhook request through bot/server.js's real routing.
 *
 * Run: node bot/test/wave10-payments-notify-integration.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave10-notify-integration-'));
process.env.DATA_DIR               = tmpDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'https://example.test';
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BRAND_DOMAIN;
delete process.env.DEPLOY_PROVIDER;

const registry   = require('../registry.js');
const ledger     = require('../ledger.js');
const { startServer } = require('../server.js');
const { onStripeEvent } = require('../web.js'); // the real, unmodified production dispatcher

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

function sign(payload, secret, tSec = Math.floor(Date.now() / 1000)) {
    const mac = crypto.createHmac('sha256', secret).update(`${tSec}.${payload}`, 'utf8').digest('hex');
    return `t=${tSec},v1=${mac}`;
}

function seedSite(prefix, email) {
    const user = registry.getOrCreateUserByEmail(email);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: prefix + '-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    registry.updateSite(site.id, {
        paid: true,
        paidUntil: new Date(Date.now() + 300 * 86400000).toISOString(),
        status: 'live',
    });
    const subscriptionId = 'sub_test_' + prefix + '_' + crypto.randomBytes(4).toString('hex');
    registry.updateSite(site.id, { stripeSubscriptionId: subscriptionId, stripeCustomerId: 'cus_test_' + prefix });
    return { user, site: registry.getSite(site.id), subscriptionId };
}

function ownerEmailLedgerRows(siteId) {
    return ledger.read().filter((r) => r && r.event === 'owner_notified' && r.channel === 'email' && r.siteId === siteId);
}

(async () => {
    const SECRET = 'whsec_wave10_integration';
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const srv = startServer({ port: 0, onStripeEvent });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;

    async function postWebhook(event) {
        const body = JSON.stringify(event);
        const res = await fetch(`${base}/webhooks/stripe`, {
            method: 'POST',
            headers: { 'stripe-signature': sign(body, SECRET) },
            body,
        });
        return res;
    }

    await check('real signed HTTP webhook, invoice.payment_failed, through bot/web.js unmodified: decline email is recorded', async () => {
        const { site, subscriptionId, user } = seedSite('int-decline', 'owner-int-decline@example.test');
        const res = await postWebhook({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 1, next_payment_attempt: Math.floor(Date.now() / 1000) + 86400 } },
        });
        assert.strictEqual(res.status, 200, 'webhook must ACK 200 (async handler runs after)');
        await new Promise((r) => setTimeout(r, 80)); // let the async handler run past the ACK

        const rows = ownerEmailLedgerRows(site.id);
        assert.strictEqual(rows.length, 1, 'the real HTTP path must reach the same email pipeline as the direct unit test');
        assert.strictEqual(rows[0].kind, 'payment_declined');
        assert.strictEqual(rows[0].to, user.email);
    });

    await check('real signed HTTP webhook, subscription unpaid, through bot/web.js unmodified: site-down email is recorded', async () => {
        const { site, subscriptionId, user } = seedSite('int-sitedown', 'owner-int-sitedown@example.test');
        const res = await postWebhook({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'unpaid', customer: 'cus_x' } },
        });
        assert.strictEqual(res.status, 200);
        await new Promise((r) => setTimeout(r, 80));

        const fresh = registry.getSite(site.id);
        assert.strictEqual(fresh.status, 'unpublished', 'the site must actually be taken down');

        const rows = ownerEmailLedgerRows(site.id);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].kind, 'site_down');
        assert.strictEqual(rows[0].to, user.email);
    });

    await check('real signed HTTP webhook, duplicate delivery of the same event id: no double email through the real path either', async () => {
        const { site, subscriptionId } = seedSite('int-dup', 'owner-int-dup@example.test');
        const event = {
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 1, next_payment_attempt: Math.floor(Date.now() / 1000) + 86400 } },
        };
        await postWebhook(event);
        await new Promise((r) => setTimeout(r, 60));
        await postWebhook(event); // Stripe redelivers the identical event id
        await new Promise((r) => setTimeout(r, 60));

        assert.strictEqual(ownerEmailLedgerRows(site.id).length, 1, 'must not double-send across a real webhook redelivery');
    });

    srv.close();

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll wave10-payments-notify-integration checks passed.');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
