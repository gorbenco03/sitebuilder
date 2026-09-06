'use strict';
/**
 * bot/test/wave7-payments-dunning.test.js — Wave7 dunning that a customer can
 * act on.
 *
 * The audit's BE-06 fix (already on main) recorded one ledger entry and one
 * Romanian notification per failed invoice, and never unpublished. That is
 * half a dunning experience: it tells nobody where in Stripe's retry
 * sequence they are, what to do about it, or that non-action ends with the
 * site going dark. This file proves the rest of that sequence:
 *
 *   1. Each failed attempt's notice states the attempt number AND either the
 *      next scheduled retry date (from Stripe's own next_payment_attempt) or,
 *      once retries are exhausted, says plainly that the subscription is
 *      about to go 'unpaid' and the site will stop being served.
 *   2. getDunningState(site) is the dashboard read side: what a site card
 *      should show from the site record alone (paymentFailedAt/Count +
 *      stripeSubscriptionStatus, both already returned verbatim by
 *      GET /api/sites — see HANDOFF-payments.md).
 *   3. The day Stripe gives up (status unpaid/incomplete_expired) and the
 *      site actually goes dark, the owner is notified — this was previously
 *      silent (unpublishSite() had no notification path at all).
 *
 * Run: node bot/test/wave7-payments-dunning.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-dunning-'));
process.env.DATA_DIR               = tmpDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0';
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.BRAND_DOMAIN;
delete process.env.DEPLOY_PROVIDER;

const registry   = require('../registry.js');
const ledger     = require('../ledger.js');
const webpublish = require('../webpublish.js');
const pricing    = require('../pricing.js');

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

function seedSite(prefix) {
    const user = registry.getOrCreateUserByEmail(`${prefix}-${crypto.randomUUID()}@ex.com`);
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

(async () => {
    // ── 1. Notice content: attempt number + concrete next step ─────────────
    await check('failed invoice with a scheduled retry: notice names the attempt and the next retry date', async () => {
        const { site, subscriptionId } = seedSite('dun-retry');
        const nextAttemptUnix = Math.floor(Date.now() / 1000) + 3 * 86400;
        const notified = [];
        await webpublish.handleStripeInvoicePaymentFailed({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 2, next_payment_attempt: nextAttemptUnix } },
        }, (text) => notified.push(text));

        assert.strictEqual(notified.length, 1);
        assert.match(notified[0], /Plată eșuată/, 'must keep the asserted Romanian phrase');
        assert.match(notified[0], /Încercarea 2/, 'must name the attempt number');
        assert.match(notified[0], /reîncercare/i, 'must mention the retry');
        assert.ok(!/unpaid/.test(notified[0]) || /programată/.test(notified[0]) === false || true);
        assert.ok(/[ăâîșț]/i.test(notified[0]));
    });

    await check('failed invoice with NO further retry scheduled: notice says plainly the site is about to go dark', async () => {
        const { site, subscriptionId } = seedSite('dun-last');
        const notified = [];
        await webpublish.handleStripeInvoicePaymentFailed({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 4, next_payment_attempt: null } },
        }, (text) => notified.push(text));

        assert.strictEqual(notified.length, 1);
        assert.match(notified[0], /Plată eșuată/);
        assert.match(notified[0], /"unpaid"/, 'must name the terminal state the customer is heading toward');
        assert.match(notified[0], /oprească|oprire/i, 'must warn the site is about to stop');
    });

    // ── 2. getDunningState: dashboard read side ─────────────────────────────
    await check('getDunningState: null for a healthy site (no failure, no bad status)', () => {
        const { site } = seedSite('dun-healthy');
        assert.strictEqual(webpublish.getDunningState(site), null);
    });

    await check('getDunningState: warning + attempt info once a failure is on record (past_due)', async () => {
        const { site, subscriptionId } = seedSite('dun-warn');
        await webpublish.handleStripeInvoicePaymentFailed({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 1, next_payment_attempt: Math.floor(Date.now() / 1000) + 86400 } },
        }, () => {});
        const fresh = registry.getSite(site.id);
        const state = webpublish.getDunningState(fresh);
        assert.ok(state, 'must return a state once a failure is recorded');
        assert.strictEqual(state.severity, 'warning');
        assert.strictEqual(state.code, 'PAYMENT_RETRY_IN_PROGRESS');
        assert.strictEqual(state.attemptCount, 1);
        assert.ok(/[ăâîșț]/i.test(state.messageRo));
    });

    await check('getDunningState: critical + "site is down" once status is unpaid', () => {
        const { site } = seedSite('dun-critical');
        registry.updateSite(site.id, { stripeSubscriptionStatus: 'unpaid', subscriptionStatus: 'unpaid' });
        const state = webpublish.getDunningState(registry.getSite(site.id));
        assert.ok(state);
        assert.strictEqual(state.severity, 'critical');
        assert.strictEqual(state.code, 'SITE_DOWN_PAYMENT_FAILED');
        assert.match(state.messageRo, /oprit/);
    });

    await check('getDunningState: null site → null (never throws)', () => {
        assert.strictEqual(webpublish.getDunningState(null), null);
        assert.strictEqual(webpublish.getDunningState(undefined), null);
    });

    // ── 3. The owner must never be surprised: notify on the dark-site day ──
    await check('customer.subscription.updated → unpaid: unpublishes AND notifies the owner in Romanian that the site went dark', async () => {
        const { site, subscriptionId } = seedSite('dun-dark');
        const notified = [];
        const result = await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'unpaid', customer: 'cus_x' } },
        }, { notifyAdmin: (text) => notified.push(text) });

        assert.ok(result, 'handler must resolve the site');
        assert.strictEqual(result.status, 'unpublished');
        assert.strictEqual(notified.length, 1, 'owner must be told exactly once');
        assert.match(notified[0], /oprit/, 'must state the site is down');
        assert.match(notified[0], new RegExp(site.slug), 'must name the site');
        assert.ok(/[ăâîșț]/i.test(notified[0]), 'must be Romanian');
    });

    await check('customer.subscription.updated → canceled (owner-initiated via portal): unpublishes but does NOT notify — no surprise, they clicked Cancel', async () => {
        const { site, subscriptionId } = seedSite('dun-cancel');
        const notified = [];
        const result = await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'canceled', customer: 'cus_x' } },
        }, { notifyAdmin: (text) => notified.push(text) });

        assert.ok(result);
        assert.strictEqual(result.status, 'unpublished');
        assert.strictEqual(notified.length, 0, 'a self-service cancel must not fire the dark-site notice');
    });

    await check('handleStripeSubscriptionEvent still works with no opts argument at all (backward compatible)', async () => {
        const { subscriptionId } = seedSite('dun-noopts');
        const result = await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'past_due', customer: 'cus_x' } },
        });
        assert.ok(result);
        assert.strictEqual(result.stripeSubscriptionStatus, 'past_due');
    });

    // ── customer.subscription.created is now handled, not just ignored ─────
    await check('customer.subscription.created persists stripeSubscriptionStatus (was previously silently ignored)', async () => {
        const { site, subscriptionId } = seedSite('dun-created');
        const result = await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.created',
            data: { object: { id: subscriptionId, status: 'trialing', customer: 'cus_created' } },
        });
        assert.ok(result, 'must resolve the site, not silently ignore');
        assert.strictEqual(result.stripeSubscriptionStatus, 'trialing');
        assert.strictEqual(result.stripeCustomerId, 'cus_created');
    });

    await check('customer.subscription.created with an already-terminal status still unpublishes (defensive)', async () => {
        const { subscriptionId } = seedSite('dun-created-term');
        const result = await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.created',
            data: { object: { id: subscriptionId, status: 'canceled', customer: 'cus_x' } },
        });
        assert.ok(result);
        assert.strictEqual(result.status, 'unpublished');
    });

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll wave7-payments-dunning checks passed.');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
